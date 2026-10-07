/**
 * Plein écran. Safari sur iPhone n'a pas d'API plein écran : la barre d'adresse et les onglets ne disparaissent que si le
 * jeu est ouvert depuis son icône de l'écran d'accueil (« Sur l'écran d'accueil » dans le menu Partager). Ailleurs
 * (Android, ordinateur, iPad), l'API du navigateur suffit.
 */

/** Où en est l'affichage : déjà plein écran, possible d'un bouton, possible par l'écran d'accueil (iPhone), ou impossible. */
export type DisplayMode = 'app' | 'fullscreen' | 'button' | 'home-screen' | 'none';

interface FullscreenDoc {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
}

interface FullscreenEl {
  requestFullscreen?: (opts?: { navigationUI?: string }) => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

/** Ouvert depuis l'écran d'accueil (iOS) ou installé comme application : aucune barre de navigateur. */
export function isInstalledApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  const mm = window.matchMedia;
  return !!mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches);
}

/** Un iPhone (ou un iPod) : pas d'API plein écran, seule l'icône de l'écran d'accueil enlève les barres de Safari. */
export function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

export function inFullscreen(): boolean {
  const d = document as unknown as FullscreenDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function displayMode(): DisplayMode {
  if (isInstalledApp()) return 'app';
  if (inFullscreen()) return 'fullscreen';
  const d = document as unknown as FullscreenDoc;
  const el = document.documentElement as unknown as FullscreenEl;
  const api = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
  if (api && !isIPhone()) return 'button';
  if (isIPhone()) return 'home-screen';
  return 'none';
}

/** Entre ou sort du plein écran (là où l'API existe) ; vrai si quelque chose a changé. */
export async function toggleFullscreen(): Promise<boolean> {
  const d = document as unknown as FullscreenDoc;
  const el = document.documentElement as unknown as FullscreenEl;
  try {
    if (inFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else d.webkitExitFullscreen?.();
      return true;
    }
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    // Un téléphone Android reste en travers une fois en plein écran (le verrou n'existe pas partout : sans effet sinon).
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.('landscape').catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

const HINT_KEY = 'empire-miner.homescreen-hint';

/** L'astuce « écran d'accueil » n'est affichée qu'une fois (et jamais si le jeu est déjà installé). */
export function homeScreenHintDue(): boolean {
  if (!isIPhone() || isInstalledApp()) return false;
  try {
    return localStorage.getItem(HINT_KEY) !== '1';
  } catch {
    return false;
  }
}

export function homeScreenHintShown(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* ignoré */
  }
}
