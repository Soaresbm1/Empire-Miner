import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Empreinte du code qui décide du déroulement d'une partie (simulation, données, sauvegarde, réseau) : à deux, les deux
 * téléphones calculent la même partie, donc deux versions qui diffèrent là ne doivent pas jouer ensemble (la partie
 * divergerait sans cesse). Elle devient la version du protocole (`PROTOCOL` dans src/net/session.ts) : tout changement de
 * ces dossiers est refusé à la connexion avec « rechargez la page des deux côtés ». Le dessin et l'interface n'en font
 * pas partie : une mise à jour qui n'y touche pas reste compatible avec la version précédente.
 */
function simVersion(): string {
  const hash = createHash('sha1');
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.ts')) hash.update(path.replace(/\\/g, '/')).update(readFileSync(path));
    }
  };
  for (const dir of ['src/sim', 'src/data', 'src/core', 'src/save', 'src/net']) walk(dir);
  return hash.digest('hex').slice(0, 10);
}

// `vite build` produit un build classique dans dist/.
// `vite build --mode single` produit un unique fichier HTML autonome (dist-single/)
// pratique pour partager une version jouable sans serveur.
// `vite build --mode artifact` : fichier unique pour un hébergement où les
// téléchargements sont interdits (l'export de sauvegarde y est masqué).
/** Les builds en un seul fichier n'ont ni manifeste ni icônes à côté : on retire leurs liens. */
const withoutAppFiles = () => ({
  name: 'sans-fichiers-d-application',
  transformIndexHtml: (html: string) => html.replace(/\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, ''),
});

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __SIM_VERSION__: JSON.stringify(simVersion()) },
  plugins: mode === 'single' || mode === 'artifact' ? [withoutAppFiles(), viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'artifact' ? 'dist-artifact' : 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
