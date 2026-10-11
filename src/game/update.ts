/**
 * Mise à jour du jeu : une page restée ouverte (ou gardée en cache par le navigateur) ne sait pas qu'une version plus récente a
 * été publiée. À deux, c'est le piège : les deux appareils doivent avoir la même version, sinon « Versions différentes du jeu ».
 * La construction écrit `version.json` à côté de la page ; le jeu le relit de temps en temps et prévient s'il a changé.
 */

/** Identifiant de cette version du jeu, posé à la construction (voir vite.config.ts) ; « dev » hors construction. */
declare const __BUILD_ID__: string | undefined;
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export interface UpdateWatch {
  /** Relit `version.json` ; vrai si une autre version est publiée. */
  check(): Promise<boolean>;
  stop(): void;
}

export interface UpdateOptions {
  /** Identifiant de la version en cours (les essais fournissent le leur). */
  build?: string;
  /** Adresse de `version.json` (par défaut, à côté de la page). */
  url?: string;
  fetchFn?: typeof fetch;
  /** Premier contrôle après ce délai, puis toutes les `every` ms (ms). */
  first?: number;
  every?: number;
}

/**
 * Surveille la publication d'une nouvelle version : un contrôle peu après le démarrage, un autre toutes les trois minutes, un
 * autre quand la page revient au premier plan. `onNew` n'est appelé qu'une fois.
 */
export function watchForUpdate(onNew: (build: string) => void, opts: UpdateOptions = {}): UpdateWatch {
  const build = opts.build ?? BUILD_ID;
  const none: UpdateWatch = { check: async () => false, stop: () => undefined };
  // Pas de surveillance en développement, ni dans un fichier ouvert depuis un dossier ou un hébergement sans `version.json`.
  if (build === 'dev' || (typeof location !== 'undefined' && location.protocol === 'file:' && !opts.fetchFn)) return none;
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const base = opts.url ?? new URL('version.json', typeof document !== 'undefined' ? document.baseURI : location.href).toString();
  let found = false;
  let lastCheck = 0;
  const check = async (): Promise<boolean> => {
    if (found) return true;
    lastCheck = Date.now();
    try {
      const r = await fetchFn(`${base}${base.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return false;
      const data = (await r.json()) as { build?: unknown };
      if (typeof data.build === 'string' && data.build !== build) {
        found = true;
        onNew(data.build);
        return true;
      }
    } catch {
      /* hors ligne, ou pas de version.json : on réessaiera */
    }
    return false;
  };
  const first = setTimeout(() => void check(), opts.first ?? 4000);
  const timer = setInterval(() => void check(), opts.every ?? 180000);
  const visible = () => {
    if (typeof document !== 'undefined' && !document.hidden && Date.now() - lastCheck > 30000) void check();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  return {
    check,
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
    },
  };
}

/**
 * Recharge la page en contournant le cache du navigateur : une adresse nouvelle (`?v=…`) oblige à relire la page, donc à prendre
 * la dernière version. Le reste de l'adresse (code d'invitation compris) est conservé.
 */
export function reloadFresh(): void {
  const u = new URL(location.href);
  u.searchParams.set('v', Date.now().toString(36));
  location.replace(u.toString());
}

/** Retire de l'adresse le `?v=…` laissé par `reloadFresh`, pour ne pas le garder dans les favoris et les liens partagés. */
export function cleanReloadParam(): void {
  const u = new URL(location.href);
  if (!u.searchParams.has('v')) return;
  u.searchParams.delete('v');
  history.replaceState(null, '', u.toString());
}
