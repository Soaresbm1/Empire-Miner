/**
 * Le Grand Chevalement (données pures) : le grand chantier du camp, en cinq phases.
 *
 * Chaque phase réclame des matériaux (livrés à la main ou par des caisses d'expédition réglées sur « Chantier »), de
 * l'argent versé aux ouvriers, et un nombre de commandes déjà honorées. Une fois terminée, elle accorde un avantage
 * et la tour grandit au camp. La dernière phase achève le monument : c'est la fin de la partie, que l'on peut poursuivre.
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
];

/** Titre que reçoit le joueur à la fin du chantier. */
export const PROJECT_TITLE = 'Empereur de la mine';
