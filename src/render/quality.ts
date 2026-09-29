/**
 * Réglage de la qualité graphique (menu pause), mémorisé dans le navigateur.
 *
 * Il ne change jamais le jeu, seulement le nombre d'effets dessinés : particules, lueurs,
 * animations de détail et décor animé des menus. « Basse » convient aux petits appareils.
 */
export type Quality = 'high' | 'medium' | 'low';

export const QUALITY_ORDER: Quality[] = ['high', 'medium', 'low'];

export const QUALITY_LABEL: Record<Quality, string> = { high: 'Élevée', medium: 'Moyenne', low: 'Basse' };

export interface QualityProfile {
  /** Part des particules réellement émises (1 = toutes). */
  particles: number;
  /** Lueurs douces autour des machines et des lampes, reflets animés. */
  glow: boolean;
  /** Animations de détail : voyants clignotants, vapeur, lumière qui vacille. */
  detail: boolean;
  /** Décor animé des menus : poussières, braises, halo. Nombre de grains. */
  menuMotes: number;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  high: { particles: 1, glow: true, detail: true, menuMotes: 46 },
  medium: { particles: 0.55, glow: true, detail: false, menuMotes: 18 },
  low: { particles: 0.2, glow: false, detail: false, menuMotes: 0 },
};

const KEY = 'empire-miner.quality';

export function parseQuality(v: unknown): Quality {
  return v === 'medium' || v === 'low' || v === 'high' ? v : 'high';
}

/** Qualité suivante dans l'ordre Élevée → Moyenne → Basse → Élevée. */
export function nextQuality(q: Quality): Quality {
  return QUALITY_ORDER[(QUALITY_ORDER.indexOf(q) + 1) % QUALITY_ORDER.length];
}

export function loadQuality(): Quality {
  try {
    return parseQuality(localStorage.getItem(KEY));
  } catch {
    return 'high';
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* ignoré */
  }
}
