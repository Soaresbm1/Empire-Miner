/**
 * Ouvriers (données pures) : des travailleurs qu'on achète une fois à l'Atelier et qui font des corvées à la place
 * du joueur. Chacun a un métier, qu'on peut changer gratuitement.
 */
export type WorkerJob = 'picker' | 'refueler';

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
  /** Un tas ou un coffre plus loin que cela (cases à parcourir) n'est pas visé quand l'ouvrier cherche du travail. */
  reach: 90,
  /**
   * Pour rentrer (déposer sa charge, retourner à son poste), un ouvrier cherche bien plus loin : sans cela, un ramasseur
   * qui a suivi une traînée de minerai jusqu'au fond de la mine ne retrouverait jamais un coffre.
   */
  farReach: 2000,
  /** Le ravitailleur recharge une machine dont le réservoir est à moitié vide ou moins. */
  fuelLow: 0.5,
  /** Pause après un geste : ramasser, déposer, recharger (s). */
  actWait: 0.3,
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
