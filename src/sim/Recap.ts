/**
 * Bilan de session : ce que la partie a rapporté entre deux instants (au début de la session et maintenant), pour l'écran
 * « Bilan » et pour le rappel de la dernière session à la reprise.
 *
 * Rien ici ne décide de la suite de la partie : ce sont des différences de compteurs que la simulation tient déjà (`Stats`).
 * Le bilan de la session précédente est écrit dans la sauvegarde (champ facultatif `recap`), mais jamais dans l'empreinte de
 * synchronisation du jeu à deux : chaque appareil a sa propre session.
 */
import type { GameState } from './GameState';

/** Une session plus courte que cela (s de jeu) ne remplace pas le bilan de la précédente dans la sauvegarde. */
export const RECAP_MIN_SECONDS = 120;

/** Les chiffres d'un bilan. */
export interface Recap {
  /** Temps de jeu (s). */
  seconds: number;
  earned: number;
  spent: number;
  contracts: number;
  mined: number;
  collected: number;
  smelted: number;
  crafted: number;
  delivered: number;
  autoSold: number;
  built: number;
  /** Ce que les ouvriers ont fait : objets rangés, charges de combustible, foreuses posées, objets livrés. */
  crewStored: number;
  crewFueled: number;
  crewPlaced: number;
  crewDelivered: number;
  /** Phases de chantier terminées (des deux actes). */
  phases: number;
  /** Clients devenus fidèles. */
  faithful: number;
  /** Mètres de profondeur gagnés sur le précédent record. */
  depth: number;
}

export const RECAP_KEYS = ['seconds', 'earned', 'spent', 'contracts', 'mined', 'collected', 'smelted', 'crafted', 'delivered', 'autoSold', 'built', 'crewStored', 'crewFueled', 'crewPlaced', 'crewDelivered', 'phases', 'faithful', 'depth'] as const;

/** L'état des compteurs à un instant : les mêmes champs, en valeurs absolues. */
export type Snap = Recap;

export function snapshot(g: GameState): Snap {
  const s = g.stats;
  return {
    seconds: s.playTime,
    earned: s.earned,
    spent: s.spent,
    contracts: s.contracts,
    mined: s.tilesMined,
    collected: s.itemsCollected,
    smelted: s.smelted,
    crafted: s.crafted,
    delivered: s.delivered,
    autoSold: s.autoSold,
    built: s.structuresBuilt,
    crewStored: s.crewStored,
    crewFueled: s.crewFueled,
    crewPlaced: s.crewPlaced,
    crewDelivered: s.crewDelivered,
    phases: g.project.phase + g.project2.phase,
    faithful: g.contracts.faithfulCount(),
    depth: s.maxDepth,
  };
}

/** Ce qui s'est passé depuis `base` (jamais de valeur négative : on ne montre pas de recul). */
export function recapSince(base: Snap, g: GameState): Recap {
  const now = snapshot(g);
  const out = {} as Recap;
  for (const k of RECAP_KEYS) out[k] = Math.max(0, Math.round((now[k] - base[k]) * 100) / 100);
  return out;
}

/** Une valeur lue dans une sauvegarde : un bilan sain, ou rien (les valeurs absurdes sont écartées). */
export function parseRecap(raw: unknown): Recap | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Recap;
  for (const k of RECAP_KEYS) {
    const v = Number(src[k] ?? 0);
    out[k] = Number.isFinite(v) && v >= 0 ? Math.min(v, 1e12) : 0;
  }
  return out.seconds > 0 ? out : null;
}

/** Y a-t-il de quoi montrer (au-delà du seul temps de jeu) ? */
export function hasNews(r: Recap): boolean {
  return RECAP_KEYS.some((k) => k !== 'seconds' && r[k] > 0);
}
