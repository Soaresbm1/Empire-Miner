import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

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
