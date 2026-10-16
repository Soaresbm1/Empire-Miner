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
  { res: 'copper_wire', qty: [12, 36], weight: 1, time: 840, step: 2 },
  { res: 'gear', qty: [4, 12], weight: 1, time: 900, step: 1 },
  { res: 'mechanism', qty: [1, 4], weight: 0.6, time: 1100, step: 1 },
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

/**
 * Réputation : chaque client se souvient de vous. Une commande honorée à temps lui donne confiance ; un retard ou un abandon
 * lui en retire un peu (jamais sous zéro : les clients sont doux). Plus un client a confiance, plus il revient souvent, mieux
 * il paie et plus il laisse de temps. À chaque nouveau rang, le plus fidèle d'entre eux vous réserve une commande exclusive.
 */
export const REPUTATION = {
  /** Points gagnés par commande honorée à temps (le double pour une exclusive), perdus par un retard ou un abandon. */
  gain: 1,
  exclusiveGain: 2,
  late: 1,
  abandon: 1,
  /** Points gardés au plus par client. */
  max: 12,
  /** Un client de confiance revient plus souvent : son poids dans le tirage est 1 + ce nombre × ses points. */
  returnWeight: 1,
  /** Niveaux de confiance : points à avoir, nom, prime en plus (0,02 = 2 points de prime) et délai en plus (0,05 = 5 %). */
  levels: [
    { at: 0, name: 'Nouveau', premium: 0, time: 0 },
    { at: 1, name: 'Connaissance', premium: 0.02, time: 0.05 },
    { at: 3, name: 'Habitué', premium: 0.04, time: 0.1 },
    { at: 6, name: 'Fidèle', premium: 0.06, time: 0.15 },
    { at: 10, name: 'Partenaire', premium: 0.08, time: 0.2 },
  ],
  /** Commande exclusive : quantités et délai multipliés, prime en plus, durée d'affichage multipliée. */
  exclusive: { qty: 1.5, time: 1.25, premium: 0.15, life: 2 },
} as const;

export interface Trust {
  /** Indice du niveau (0 : nouveau client). */
  index: number;
  name: string;
  premium: number;
  time: number;
  /** Points pour atteindre ce niveau, et le suivant (null au dernier niveau). */
  at: number;
  next: number | null;
}

/** Niveau de confiance d'un client qui a `points` points. */
export function trustOf(points: number): Trust {
  let index = 0;
  for (let i = 0; i < REPUTATION.levels.length; i++) if (points >= REPUTATION.levels[i].at) index = i;
  const l = REPUTATION.levels[index];
  const next = REPUTATION.levels[index + 1];
  return { index, name: l.name, premium: l.premium, time: l.time, at: l.at, next: next ? next.at : null };
}

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
