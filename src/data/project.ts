/**
 * Le Grand Chevalement (données pures) : le grand chantier du camp, en cinq phases.
 *
 * Chaque phase réclame des matériaux (livrés à la main ou par des caisses d'expédition réglées sur « Chantier »), de
 * l'argent versé aux ouvriers, et un nombre de commandes déjà honorées. Une fois terminée, elle accorde un avantage
 * et la tour grandit au camp. La dernière phase achève le monument (acte I), puis le chantier se poursuit avec le Grand Ascenseur
 * (acte II, `PHASES_II`) ; son achèvement est la fin de la partie, que l'on peut poursuivre.
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
  /** Places en plus dans l'équipe d'ouvriers (au-delà de celles que les pioches ouvrent). */
  crew?: number;
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
  /** Clients qui vous font confiance (niveau « Fidèle » ou mieux) pour que les ouvriers acceptent de poursuivre (0 : aucun). */
  faithful?: number;
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

/**
 * Acte II : le Grand Ascenseur. Une fois le Grand Chevalement achevé, le même chantier se poursuit : un ascenseur de puits
 * qui descend jusqu'au fond de la mine. Plus gros, il réclame les produits de la Manufacture en quantité, bien plus d'argent,
 * toujours plus de commandes honorées et, surtout, des clients qui vous font confiance (voir `REPUTATION` dans
 * `data/contracts.ts`). Ses avantages agrandissent l'équipe d'ouvriers (de 9 à 12) et les commandes.
 */
export const PHASES_II: readonly PhaseSpec[] = [
  {
    id: 'cage',
    name: 'Cage d’acier',
    blurb: 'Une cage d’acier et ses guides : la première cabine descendra le long de la tour.',
    needs: [
      { res: 'steel', qty: 80 },
      { res: 'iron_plate', qty: 60 },
    ],
    money: 30000,
    contracts: 18,
    faithful: 1,
    perk: { text: 'Une place de plus dans l’équipe d’ouvriers', crew: 1 },
  },
  {
    id: 'counterweight',
    name: 'Contrepoids',
    blurb: 'Des contrepoids de fer et d’argent équilibrent la cabine.',
    needs: [
      { res: 'iron_plate', qty: 100 },
      { res: 'silver_plate', qty: 60 },
      { res: 'steel', qty: 60 },
    ],
    money: 50000,
    contracts: 24,
    faithful: 2,
    perk: { text: 'Une commande de plus en parallèle', slots: 1 },
  },
  {
    id: 'engine',
    name: 'Machinerie',
    blurb: 'La grande machine qui tire la cabine : de l’acier, du cuivre et des pièces dorées.',
    needs: [
      { res: 'steel', qty: 120 },
      { res: 'gold_plate', qty: 60 },
      { res: 'copper_plate', qty: 80 },
    ],
    money: 80000,
    contracts: 32,
    faithful: 2,
    perk: { text: 'Une place de plus dans l’équipe, et 5 points de prime de plus', crew: 1, premium: 0.05 },
  },
  {
    id: 'lobby',
    name: 'Salle dorée',
    blurb: 'La salle d’attente du fond, lambrissée d’or, où les clients viennent traiter.',
    needs: [
      { res: 'gold_plate', qty: 150 },
      { res: 'silver_plate', qty: 100 },
      { res: 'cut_diamond', qty: 8 },
    ],
    money: 120000,
    contracts: 40,
    faithful: 3,
    perk: { text: 'Une proposition de plus au Tableau d’affichage, et une place de plus dans l’équipe', offers: 1, crew: 1 },
  },
  {
    id: 'opening',
    name: 'Inauguration',
    blurb: 'On coupe le ruban : l’ascenseur descend jusqu’au fond de la mine.',
    needs: [
      { res: 'gold_plate', qty: 250 },
      { res: 'steel', qty: 150 },
      { res: 'cut_diamond', qty: 20 },
    ],
    money: 200000,
    contracts: 52,
    faithful: 4,
    perk: { text: 'L’ascenseur est inauguré : vous êtes le Roi des profondeurs', premium: 0.05 },
  },
];

export const PROJECT_TITLE_II = 'Roi des profondeurs';

/** Fidélité qu'un client doit avoir pour compter comme « fidèle » (niveau de confiance, voir `REPUTATION.levels` : 3 = Fidèle). */
export const FAITHFUL_LEVEL = 3;
