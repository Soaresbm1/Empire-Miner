/**
 * Ouvriers (données pures) : des travailleurs qu'on achète une fois à l'Atelier et qui font des corvées à la place
 * du joueur. Chacun a un métier, qu'on peut changer gratuitement.
 */
export type WorkerJob = 'picker' | 'refueler' | 'driller';

export interface WorkerJobDef {
  id: WorkerJob;
  name: string;
  /** Ce qu'il fait, en une phrase (fiche de l'Atelier). */
  description: string;
  /** Couleur de son casque (puces de l'interface). */
  color: string;
}

export const WORKER_JOBS: readonly WorkerJobDef[] = [
  {
    id: 'picker',
    name: 'Ramasseur',
    description: 'Ramasse les minerais laissés au sol (restes de la foreuse de percement, éboulements, tas oubliés) et les range dans le coffre le plus proche.',
    color: '#6cc04a',
  },
  {
    id: 'driller',
    name: 'Foreur',
    description:
      "Pose des foreuses à charbon sur les gisements au sol : d'abord les petits minerais, puis de plus précieux à chaque amélioration. Prend les foreuses de votre stock, à défaut les achète lui-même.",
    color: '#4a8fe0',
  },
  {
    id: 'refueler',
    name: 'Ravitailleur',
    description: 'Prend du charbon dans les coffres et recharge les foreuses, les fours et les foreuses de percement qui en manquent.',
    color: '#e8662a',
  },
];

export function getJob(id: WorkerJob): WorkerJobDef {
  return WORKER_JOBS.find((j) => j.id === id) ?? WORKER_JOBS[0];
}

export const isJob = (id: unknown): id is WorkerJob => WORKER_JOBS.some((j) => j.id === id);

export const WORKERS = {
  /** Ouvriers au plus. */
  max: 6,
  /** Prix du premier, du deuxième… ouvrier (achat unique, pas de salaire). */
  prices: [300, 600, 1000, 1500, 2200, 3000],
  /** Vitesse de marche (pixels par seconde ; le joueur va à 72). */
  speed: 54,
  /** Ce qu'un ouvrier porte (kg). */
  capacity: 15,
  /**
   * Plus long chemin (en cases) qu'un ouvrier cherche, pour un tas, un coffre, du charbon, une machine ou son poste :
   * autrement dit, aucune limite de distance en pratique (la mine entière tient dans moins de 2 000 cases de chemin).
   * Seuls un passage coupé (roche, grisou, eau profonde, machine) ou l'absence de cible l'arrêtent.
   */
  reach: 2000,
  /** Le ravitailleur recharge une machine dont le réservoir est à moitié vide ou moins. */
  fuelLow: 0.5,
  /** Pause après un geste : ramasser, déposer, recharger (s). */
  actWait: 0.3,
  /**
   * Un ramasseur ne vide une machine que lorsqu'elle garde assez de minerai (pour ne pas piquer ce qui part déjà sur un
   * convoyeur) : foreuse à charbon (minerai dans sa sortie), base de la foreuse de percement (minerai de sa benne).
   */
  machinePickup: { drill: 3, borerBase: 5 },
  /** Attente avant de chercher du travail quand il n'y en a pas (s). */
  idleWait: 1.2,
  unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  names: ['Gus', 'Mina', 'Tom', 'Lila', 'Bob', 'Zoé'],
} as const;

/** Prix du prochain ouvrier quand on en a `count` (null : l'équipe est complète). */
export function workerPrice(count: number): number | null {
  return count >= WORKERS.max ? null : WORKERS.prices[Math.min(count, WORKERS.prices.length - 1)];
}

export function workerName(id: number): string {
  return WORKERS.names[(Math.max(1, id) - 1) % WORKERS.names.length];
}

/** Un niveau du foreur : jusqu'à quel minerai il équipe, et à quelle vitesse il travaille. */
export interface DrillerLevel {
  level: number;
  /** Prix de l'amélioration vers ce niveau (0 : niveau de base, compris dans l'embauche). */
  price: number;
  /** Niveau de minerai le plus élevé sur lequel il pose une foreuse (voir `ResourceDef.tier` : cuivre 1, fer 2, or 3, diamant 4). */
  maxTier: number;
  /** Temps de pause après chaque foreuse posée (s). */
  placeTime: number;
  /** Vitesse de marche, en multiple de celle des autres ouvriers. */
  speed: number;
  /** Condition supplémentaire (niveau de pioche). */
  unlock?: { pickaxeTier: number; text: string };
}

/** Niveaux du foreur : de plus en plus de minerais, de plus en plus vite, de plus en plus cher. */
export const DRILLER_LEVELS: readonly DrillerLevel[] = [
  { level: 1, price: 0, maxTier: 1, placeTime: 3, speed: 1 },
  { level: 2, price: 400, maxTier: 2, placeTime: 2.2, speed: 1.15 },
  { level: 3, price: 900, maxTier: 3, placeTime: 1.6, speed: 1.3, unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' } },
  { level: 4, price: 2200, maxTier: 4, placeTime: 1.1, speed: 1.5, unlock: { pickaxeTier: 4, text: 'Nécessite la Pioche pro en acier' } },
];

export function drillerLevel(level: number): DrillerLevel {
  return DRILLER_LEVELS[Math.max(1, Math.min(Math.floor(level) || 1, DRILLER_LEVELS.length)) - 1];
}

/** Réglages du foreur (hors niveaux). */
export const DRILLER = {
  /** Il n'achète une foreuse que s'il vous reste au moins cette somme ensuite ($). */
  moneyReserve: 200,
  /** Un gisement qui a moins que cela en réserve ne vaut pas une foreuse. */
  minReserve: 10,
  /** Machine qu'il pose. */
  machine: 'drill',
  /** Distance (cases) jusqu'où il vérifie qu'une foreuse ne bouche pas un passage. */
  passageRadius: 14,
} as const;
