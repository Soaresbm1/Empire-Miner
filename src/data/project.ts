/**
 * Les grands chantiers du camp (données pures) : le Grand Chevalement (cinq phases), puis l'Ascenseur de puits (quatre phases de plus).
 *
 * Chaque phase réclame des matériaux (livrés à la main ou par des caisses d'expédition réglées sur « Chantier »), de
 * l'argent versé aux ouvriers, et un nombre de commandes déjà honorées. Une fois terminée, elle accorde un avantage
 * et la tour grandit au camp (les cinq premières phases ; elle garde son dernier état ensuite). La cinquième phase couronne le Grand Chevalement (titre d'Empereur) ; les quatre suivantes forment
 * le second chantier, l'Ascenseur de puits, dont la dernière phase est la vraie fin de la partie, que l'on peut poursuivre.
 *
 * Toutes les quantités sont réglées ici.
 */

export interface PhaseNeed {
  res: string;
  qty: number;
}

/** Ce qu'une phase accorde une fois terminée (cumulatif avec les précédentes). */
export interface PhasePerk {
  /** Phrase affichée au chantier et à la fin de la phase. */
  text: string;
  /** Commandes acceptées en même temps, en plus. */
  slots?: number;
  /** Propositions affichées en même temps, en plus. */
  offers?: number;
  /** Prime en plus sur les commandes (0,1 = +10 points). */
  premium?: number;
}

export interface PhaseSpec {
  id: string;
  name: string;
  /** Une phrase pour le panneau et le message de fin de phase. */
  blurb: string;
  needs: readonly PhaseNeed[];
  /** Argent à verser aux ouvriers ($). */
  money: number;
  /** Commandes honorées (en tout depuis le début de la partie) pour que les ouvriers acceptent de poursuivre. */
  contracts: number;
  perk: PhasePerk;
}

export const PHASES: readonly PhaseSpec[] = [
  {
    id: 'foundations',
    name: 'Fondations',
    blurb: 'On creuse le socle et on coule la base de la tour.',
    needs: [
      { res: 'coal', qty: 80 },
      { res: 'copper', qty: 100 },
      { res: 'copper_ingot', qty: 30 },
    ],
    money: 500,
    contracts: 0,
    perk: { text: 'Une commande de plus en parallèle', slots: 1 },
  },
  {
    id: 'frame',
    name: 'Charpente',
    blurb: "Les premières poutres d'acier dressent la tour.",
    needs: [
      { res: 'iron_ingot', qty: 60 },
      { res: 'copper_ingot', qty: 60 },
    ],
    money: 2500,
    contracts: 2,
    perk: { text: 'Une proposition de plus au Tableau d’affichage', offers: 1 },
  },
  {
    id: 'winch',
    name: 'Treuil et poulies',
    blurb: 'Le grand treuil, ses poulies et ses câbles.',
    needs: [
      { res: 'iron_ingot', qty: 120 },
      { res: 'silver_ingot', qty: 40 },
    ],
    money: 8000,
    contracts: 5,
    perk: { text: 'Les clients paient 10 points de plus de prime', premium: 0.1 },
  },
  {
    id: 'gilding',
    name: 'Poulies dorées',
    blurb: "Les poulies sont plaquées d'or : elles ne rouilleront jamais.",
    // Les dorures se font à la Manufacture : plaques d'or, et de l'acier (2 lingots de fer chacun) pour les poulies.
    needs: [
      { res: 'gold_plate', qty: 40 },
      { res: 'silver_ingot', qty: 80 },
      { res: 'steel', qty: 50 },
    ],
    money: 25000,
    contracts: 9,
    perk: { text: 'Une commande de plus en parallèle, et 10 points de prime de plus', slots: 1, premium: 0.1 },
  },
  {
    id: 'crown',
    name: 'Couronnement',
    blurb: 'Un diamant au sommet : le Grand Chevalement domine la mine.',
    // Le diamant du sommet est taillé à la Manufacture, et la couronne se plaque d'or.
    needs: [
      { res: 'gold_plate', qty: 100 },
      { res: 'silver_ingot', qty: 100 },
      { res: 'cut_diamond', qty: 12 },
    ],
    money: 75000,
    contracts: 14,
    perk: { text: 'Le monument est achevé : vous êtes l’Empereur de la mine', premium: 0.05 },
  },
  // ---- Second chantier : l'Ascenseur de puits. Matériaux surtout fabriqués (mécanismes, acier, plaques, diamants taillés).
  {
    id: 'sinking',
    name: 'Fonçage',
    blurb: 'On fore le puits profond au pied de la tour : de quoi fixer le premier palier.',
    needs: [
      { res: 'mechanism', qty: 20 },
      { res: 'steel', qty: 150 },
    ],
    money: 150000,
    contracts: 20,
    perk: { text: 'Une commande de plus en parallèle', slots: 1 },
  },
  {
    id: 'hoist',
    name: 'Machine d’extraction',
    blurb: 'La machine d’extraction : mécanismes, acier et des centaines de mètres de fil pour les commandes.',
    needs: [
      { res: 'mechanism', qty: 60 },
      { res: 'steel', qty: 200 },
      { res: 'copper_wire', qty: 400 },
    ],
    money: 250000,
    contracts: 27,
    perk: { text: 'Les clients paient 5 points de plus de prime', premium: 0.05 },
  },
  {
    id: 'lining',
    name: 'Cuvelage',
    blurb: 'On cuvelle le puits : plaques d’or et d’argent contre l’eau et les éboulements.',
    needs: [
      { res: 'mechanism', qty: 80 },
      { res: 'gold_plate', qty: 150 },
      { res: 'silver_plate', qty: 150 },
    ],
    money: 400000,
    contracts: 35,
    perk: { text: 'Une proposition de plus au Tableau d’affichage, et 10 points de prime de plus', offers: 1, premium: 0.1 },
  },
  {
    id: 'service',
    name: 'Mise en service',
    blurb: 'Dernier palier : un diamant taillé par cage, et l’ascenseur descend jusqu’au cœur de la mine.',
    needs: [
      { res: 'mechanism', qty: 120 },
      { res: 'gold_plate', qty: 200 },
      { res: 'cut_diamond', qty: 30 },
    ],
    money: 600000,
    contracts: 45,
    perk: { text: 'L’ascenseur est en service : vous êtes le Souverain des profondeurs', premium: 0.05 },
  },
];

/** Phases du Grand Chevalement : le monument est couronné (titre d'Empereur) quand elles sont toutes terminées. */
export const CROWN_PHASE = 5;

/** Titres que reçoit le joueur : au couronnement du Grand Chevalement, puis à la fin de l'Ascenseur de puits. */
export const PROJECT_TITLE = 'Empereur de la mine';
export const PROJECT2_TITLE = 'Souverain des profondeurs';

/** Un chantier : son nom, ses phases (de `from` inclus à `to` exclu) et le titre qu'il donne. */
export interface Stage {
  name: string;
  from: number;
  to: number;
  title: string;
}

export const STAGES: readonly Stage[] = [
  { name: 'Grand Chevalement', from: 0, to: CROWN_PHASE, title: PROJECT_TITLE },
  { name: 'Ascenseur de puits', from: CROWN_PHASE, to: PHASES.length, title: PROJECT2_TITLE },
];

/** Le chantier dont fait partie la phase d'indice `phase` (le dernier si l'indice dépasse la liste). */
export function stageOf(phase: number): Stage {
  return STAGES.find((s) => phase < s.to) ?? STAGES[STAGES.length - 1];
}
