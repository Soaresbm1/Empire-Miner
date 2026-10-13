/**
 * Réglages des commandes du Tableau d'affichage (données pures).
 *
 * Un client propose de temps en temps d'acheter une quantité précise d'un minerai ou d'un lingot, plus cher que le
 * marché, à livrer avant une échéance. Tout se règle ici : quoi, combien, quelle prime, quel délai.
 */

/** Une marchandise qu'un client peut demander. */
export interface GoodSpec {
  res: string;
  /** Quantité demandée (bornes, avant la hausse due à la réputation). */
  qty: readonly [number, number];
  /** Poids dans le tirage : plus il est grand, plus la marchandise revient souvent. */
  weight: number;
  /** Délai accordé une fois la commande acceptée (s de jeu). */
  time: number;
  /** Les quantités tombent juste : multiples de ce pas (30, 35, 40…). */
  step: number;
}

/**
 * Marchandises demandées, du plus courant au plus rare. Un client ne demande que ce que le joueur connaît déjà ; les
 * lingots n'apparaissent qu'après le premier lingot fondu : ce sont eux qui donnent une raison de bâtir une ligne de fonte.
 * Même chose pour les produits de la Manufacture (plaques, acier, diamant taillé), après le premier fabriqué.
 */
export const GOODS: readonly GoodSpec[] = [
  { res: 'coal', qty: [30, 80], weight: 3, time: 600, step: 5 },
  { res: 'copper', qty: [24, 64], weight: 3, time: 600, step: 2 },
  { res: 'iron', qty: [16, 44], weight: 2.5, time: 660, step: 2 },
  { res: 'silver', qty: [8, 24], weight: 2, time: 720, step: 2 },
  { res: 'gold', qty: [4, 12], weight: 1.5, time: 780, step: 1 },
  { res: 'diamond', qty: [1, 3], weight: 0.8, time: 900, step: 1 },
  { res: 'copper_ingot', qty: [12, 36], weight: 2, time: 720, step: 2 },
  { res: 'iron_ingot', qty: [8, 24], weight: 2, time: 780, step: 2 },
  { res: 'silver_ingot', qty: [4, 12], weight: 1.5, time: 840, step: 1 },
  { res: 'gold_ingot', qty: [2, 6], weight: 1, time: 900, step: 1 },
  { res: 'copper_plate', qty: [8, 24], weight: 1.5, time: 780, step: 2 },
  { res: 'iron_plate', qty: [6, 18], weight: 1.5, time: 840, step: 2 },
  { res: 'silver_plate', qty: [3, 9], weight: 1, time: 900, step: 1 },
  { res: 'steel', qty: [4, 12], weight: 1.2, time: 900, step: 1 },
  { res: 'gold_plate', qty: [2, 5], weight: 0.8, time: 960, step: 1 },
  { res: 'cut_diamond', qty: [1, 2], weight: 0.5, time: 1000, step: 1 },
];

export const CONTRACTS = {
  /** Propositions affichées en même temps, au plus (le chantier en ajoute). */
  offers: 3,
  /** Commandes acceptées en même temps, au plus (le chantier en ajoute). */
  slots: 2,
  /** Une proposition reste affichée aussi longtemps (s de jeu), puis le client en cherche un autre. */
  offerLife: 420,
  /** Délai avant la première proposition, puis entre deux propositions (s de jeu, bornes). */
  first: [20, 40],
  gap: [45, 90],
  /** Une commande à deux lignes laisse ce temps de plus (s). */
  extraTime: 120,
  /** Chance qu'une commande ait deux lignes, dès que le joueur connaît au moins trois marchandises. */
  twoLines: 0.35,
  /** Prime sur le prix de base (bornes) : +25 à +55 %. */
  premium: [0.25, 0.55],
  /** Prime en plus quand une forte demande a lieu sur l'une des marchandises, et pour une commande à deux lignes. */
  hotBonus: 0.1,
  twoLinesBonus: 0.05,
  /** Plus de poids dans le tirage pour une marchandise en forte demande, moins pour une marchandise bradée. */
  demandWeight: 3,
  glutWeight: 0.4,
  /** Les récompenses tombent juste : multiples de 5 $. */
  roundTo: 5,
  /** Si l'on abandonne ou si l'échéance passe, le client paie ce qui est livré à cette part du prix de base, sans prime. */
  partialPay: 1,
  /** Commandes terminées à avoir pour chaque rang, et son nom. */
  ranks: [
    { at: 0, name: 'Livreur' },
    { at: 3, name: 'Fournisseur' },
    { at: 8, name: 'Négociant' },
    { at: 16, name: 'Grossiste' },
    { at: 30, name: 'Magnat' },
  ],
  /** Par rang : les commandes grossissent (+25 % par rang) et la prime monte (+2 points par rang). */
  rankQty: 0.25,
  rankPremium: 0.02,
} as const;

/** Nom d'un client : prénom et métier, tirés au sort pour chaque commande. */
export const CLIENTS: readonly string[] = [
  'Forge de Maître Aubin',
  'Fonderie Delacroix',
  'Compagnie des Rails du Nord',
  'Maison Bertrand & Fils',
  'Chaudronnerie Lemoine',
  'Arsenal de la Vallée',
  'Atelier Moreau',
  'Chantiers Navals Vasseur',
  'Orfèvrerie Lacombe',
  'Manufacture Royale',
  'Usine à gaz de Vauclair',
  'Coopérative des Mineurs',
  'Banque Duplessis',
  'Verrerie Garnier',
  'Quincaillerie Hubert',
  'Société des Hauts Fourneaux',
];

export interface Rank {
  index: number;
  name: string;
  /** Commandes terminées pour atteindre ce rang, et pour le suivant (null au dernier rang). */
  at: number;
  next: number | null;
}

/** Rang atteint avec `done` commandes terminées. */
export function rankOf(done: number): Rank {
  let index = 0;
  for (let i = 0; i < CONTRACTS.ranks.length; i++) if (done >= CONTRACTS.ranks[i].at) index = i;
  const r = CONTRACTS.ranks[index];
  const next = CONTRACTS.ranks[index + 1];
  return { index, name: r.name, at: r.at, next: next ? next.at : null };
}
