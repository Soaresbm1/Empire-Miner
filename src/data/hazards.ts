/**
 * Dangers de la mine (données pures) : éboulements, grisou, eau, et santé du joueur.
 *
 * Les profondeurs sont en mètres. La mine de départ (vers 35 m) reste sûre : les dangers
 * commencent plus bas, là où le joueur arrive avec de meilleurs outils.
 */
export const CAVE_IN = {
  /** Profondeur à partir de laquelle un plafond creusé à la main peut s'effondrer (m). */
  minDepth: 60,
  /** Rayon (cases) de la zone examinée autour de la case creusée. */
  radius: 2,
  /** Au-delà de ce nombre de cases creusées à la main dans la zone, le plafond craque. */
  maxDug: 10,
  /** Un étai consolide les cases à cette distance (en cases, carré). */
  propRadius: 3,
  /** Délai entre le craquement et l'effondrement (s) : le temps de poser un étai ou de fuir. */
  warning: 4,
  /** Nombre de cases d'éboulis qui tombent. */
  fill: [4, 6] as [number, number],
  /** Dégâts au joueur pris dans l'effondrement. */
  damage: 35,
};

export const GAS = {
  /** Profondeur des premières poches de grisou (m). */
  minDepth: 120,
  /** Poches pour 1000 cases de roche dans leur tranche de profondeur. */
  perThousand: 2.4,
  /** Taille d'une poche (cases de roche). */
  size: [2, 4] as [number, number],
  /** Cases de galerie envahies quand une poche est percée. */
  spread: 22,
  /** Dissipation naturelle (niveau / s, sur 255). */
  decay: 2.5,
  /** Ventilateur : rayon (cases) et vitesse de dissipation (niveau / s). */
  fanRadius: 6,
  fanDecay: 90,
  /** Niveau à partir duquel le gaz fait mal, et dégâts par seconde. */
  harmful: 50,
  dps: 7,
};

export const WATER = {
  /** Profondeur des premières poches d'eau (m). */
  minDepth: 70,
  perThousand: 2.6,
  size: [2, 4] as [number, number],
  /** Cases de galerie inondées quand une poche est percée. */
  spread: 30,
  /** Infiltration naturelle (niveau / s, sur 255). */
  drain: 1,
  /** Pompe : rayon (cases) et débit (niveau / s retiré à chaque case). */
  pumpRadius: 5,
  pumpDrain: 70,
  /** Au-dessus de ce niveau, l'eau est profonde : on y avance à peine et on s'y épuise. */
  deep: 128,
  slowDeep: 0.45,
  slowShallow: 0.75,
  dps: 3,
};

export const HEALTH = {
  max: 100,
  /** Délai sans blessure avant de récupérer (s), puis points par seconde. */
  regenDelay: 4,
  regen: 8,
};

/** Poche cachée dans la roche. */
export const POCKET_GAS = 1;
export const POCKET_WATER = 2;
