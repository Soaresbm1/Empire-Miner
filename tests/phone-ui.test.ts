import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/sim/GameState';
import { displayMode, homeScreenHintDue, homeScreenHintShown, isIPhone, isInstalledApp } from '../src/ui/fullscreen';
import { kgPair } from '../src/ui/format';
import { installPanel, mapPanel } from '../src/ui/panels';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

/** Un navigateur minimal : agent, mode d'affichage, API plein écran, stockage. */
function fakeBrowser(opts: { ua: string; standalone?: boolean; displayMode?: string; fullscreenApi?: boolean; fullscreen?: boolean; storage?: Record<string, string> | null }) {
  const g = globalThis as Record<string, unknown>;
  const store = opts.storage === null ? null : { ...(opts.storage ?? {}) };
  Object.defineProperty(g, 'navigator', { value: { userAgent: opts.ua, standalone: opts.standalone }, configurable: true, writable: true });
  g.window = { matchMedia: (q: string) => ({ matches: !!opts.displayMode && q.includes(`(display-mode: ${opts.displayMode})`) }) };
  g.document = {
    documentElement: opts.fullscreenApi ? { requestFullscreen: () => Promise.resolve() } : {},
    fullscreenEnabled: !!opts.fullscreenApi,
    fullscreenElement: opts.fullscreen ? {} : null,
  };
  g.localStorage = store
    ? { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    : {
        getItem: () => {
          throw new Error('stockage bloqué');
        },
        setItem: () => {
          throw new Error('stockage bloqué');
        },
      };
  return store;
}

const g = globalThis as Record<string, unknown>;
let saved: Record<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(['navigator', 'window', 'document', 'localStorage'].map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]));
});
afterEach(() => {
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(g, k, d);
    else delete g[k];
  }
});

describe('plein écran', () => {
  it('iPhone dans Safari : seule l\'icône de l\'écran d\'accueil enlève les barres', () => {
    fakeBrowser({ ua: IPHONE, fullscreenApi: false });
    expect(isIPhone()).toBe(true);
    expect(isInstalledApp()).toBe(false);
    expect(displayMode()).toBe('home-screen');
  });

  it('iPhone ouvert depuis l\'icône (standalone) : déjà une application', () => {
    fakeBrowser({ ua: IPHONE, standalone: true });
    expect(isInstalledApp()).toBe(true);
    expect(displayMode()).toBe('app');
    expect(homeScreenHintDue()).toBe(false);
  });

  it('application installée ailleurs (display-mode: fullscreen ou standalone)', () => {
    fakeBrowser({ ua: ANDROID, displayMode: 'standalone' });
    expect(displayMode()).toBe('app');
    fakeBrowser({ ua: ANDROID, displayMode: 'fullscreen' });
    expect(displayMode()).toBe('app');
  });

  it('Android et ordinateur : un bouton, par l\'API du navigateur ; déjà en plein écran sinon', () => {
    fakeBrowser({ ua: ANDROID, fullscreenApi: true });
    expect(isIPhone()).toBe(false);
    expect(displayMode()).toBe('button');
    fakeBrowser({ ua: ANDROID, fullscreenApi: true, fullscreen: true });
    expect(displayMode()).toBe('fullscreen');
  });

  it('rien à proposer sans API ni iPhone', () => {
    fakeBrowser({ ua: ANDROID, fullscreenApi: false });
    expect(displayMode()).toBe('none');
  });

  it('l\'astuce de l\'écran d\'accueil n\'est donnée qu\'une fois, et jamais hors iPhone', () => {
    const store = fakeBrowser({ ua: IPHONE });
    expect(homeScreenHintDue()).toBe(true);
    homeScreenHintShown();
    expect(store).toEqual({ 'empire-miner.homescreen-hint': '1' });
    expect(homeScreenHintDue()).toBe(false);
    fakeBrowser({ ua: ANDROID });
    expect(homeScreenHintDue()).toBe(false);
  });

  it('stockage bloqué (navigation privée) : pas d\'erreur, pas d\'astuce', () => {
    fakeBrowser({ ua: IPHONE, storage: null });
    expect(homeScreenHintDue()).toBe(false);
    expect(() => homeScreenHintShown()).not.toThrow();
  });
});

describe('textes pour petits écrans', () => {
  it('kgPair : la première unité est dans une balise que le style tactile masque', () => {
    expect(kgPair(16.5, 20)).toBe('16,5<i class="u"> kg</i> / 20 kg');
    expect(kgPair(0, 20)).toBe('0<i class="u"> kg</i> / 20 kg');
    // Arrondi à une décimale.
    expect(kgPair(3.14159, 20.04)).toBe('3,1<i class="u"> kg</i> / 20 kg');
  });

  it('la marche à suivre iPhone cite Partager et « Sur l\'écran d\'accueil », et la sauvegarde séparée', () => {
    const html = installPanel();
    expect(html).toContain('Partager');
    expect(html).toContain('Sur l\'écran d\'accueil');
    expect(html).toMatch(/Exporter/);
    expect(html).toMatch(/Importer/);
  });

  it('la carte parle de pincer au doigt et de molette à la souris', () => {
    const colors = { player: '#fff', gallery: '#444', rock: '#222', building: '#a80', drill: '#0a0', borer: '#08f', furnace: '#f60', shipping: '#fc0', storage: '#a64', conveyor: '#888', rail: '#975', hazard: '#f33' };
    const finger = mapPanel(new GameState(4), colors, true);
    const mouse = mapPanel(new GameState(4), colors);
    expect(finger).toContain('Pincer');
    expect(finger).not.toContain('Molette');
    expect(finger).not.toContain('<kbd>0</kbd>');
    expect(mouse).toContain('Molette');
    expect(mouse).not.toContain('Pincer');
  });
});
