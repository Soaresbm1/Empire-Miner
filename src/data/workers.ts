/**
 * Ouvriers (données pures) : des travailleurs qu'on achète une fois à l'Atelier et qui font des corvées à la place
 * du joueur. Chacun a un métier, qu'on peut changer gratuitement.
 */
export type WorkerJob = 'picker' | 'refueler' | 'fixer';

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
    id: 'fixer',
    name: 'Dépanneur',
    description:
      "Va vers une machine à l'arrêt, regarde ce qui la bloque et le règle si c'est possible : il recharge une machine sans charbon, vide une sortie pleine dans un coffre. Sinon il rentre au camp et affiche la cause dans les statistiques (« Machines à surveiller »), puis repart vers une autre machine.",
    color: '#e0b030',
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
  max: 9,
  /** Ouvriers d'un même métier au plus (3 ramasseurs, 3 dépanneurs, 3 ravitailleurs). */
  perJob: 3,
  /** Prix du premier, du deuxième… ouvrier (achat unique, pas de salaire). */
  prices: [300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6500],
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
  /** Premier palier : les ouvriers se débloquent avec la pioche améliorée (voir `WORKER_SLOTS` pour la suite). */
  unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  names: ['Gus', 'Mina', 'Tom', 'Lila', 'Bob', 'Zoé', 'Ugo', 'Rita', 'Sam'],
} as const;

/** Places dans l'équipe : chaque pioche qu'on achète en ouvre trois de plus, jusqu'à `WORKERS.max`. */
export const WORKER_SLOTS: readonly { pickaxeTier: number; slots: number; text: string }[] = [
  { pickaxeTier: 2, slots: 3, text: 'Nécessite la Pioche améliorée' },
  { pickaxeTier: 3, slots: 6, text: 'Nécessite la Pioche en fer' },
  { pickaxeTier: 4, slots: 9, text: 'Nécessite la Pioche pro en acier' },
];

/** Places ouvertes dans l'équipe avec une pioche de ce niveau (0 : les ouvriers ne sont pas encore débloqués). */
export function workerSlots(pickaxeTier: number): number {
  return WORKER_SLOTS.reduce((n, s) => (pickaxeTier >= s.pickaxeTier ? Math.max(n, s.slots) : n), 0);
}

/** Prochain palier qui ouvre une place de plus quand l'équipe compte `count` ouvriers (null : aucune ne manque). */
export function nextSlotStep(count: number): (typeof WORKER_SLOTS)[number] | null {
  return WORKER_SLOTS.find((s) => s.slots > count) ?? null;
}

/** Prix du prochain ouvrier quand on en a `count` (null : l'équipe est complète). */
export function workerPrice(count: number): number | null {
  return count >= WORKERS.max ? null : WORKERS.prices[Math.min(count, WORKERS.prices.length - 1)];
}

export function workerName(id: number): string {
  return WORKERS.names[(Math.max(1, id) - 1) % WORKERS.names.length];
}

/** Réglages du dépanneur. */
export const REPAIR = {
  /** Temps passé à examiner une machine avant de se prononcer (s). */
  inspectTime: 1.5,
  /** Une machine signalée n'est pas revisitée avant ce délai (s). */
  cooldown: 90,
  /** Signalements gardés au plus (le moins récemment renouvelé part d'abord). */
  maxReports: 40,
  /** Gestes de réparation tentés sur une même machine avant d'abandonner et de la signaler. */
  maxTries: 8,
} as const;

/** Ce qui peut bloquer une machine, vu par le dépanneur. */
export type RepairCause = 'nofuel' | 'nocoal' | 'outfull' | 'nochest' | 'noexit' | 'beltfull' | 'cratefull' | 'unreachable';

export const REPAIR_CAUSES: readonly RepairCause[] = ['nofuel', 'nocoal', 'outfull', 'nochest', 'noexit', 'beltfull', 'cratefull', 'unreachable'];

export const isRepairCause = (c: unknown): c is RepairCause => REPAIR_CAUSES.includes(c as RepairCause);

/** Textes du jeu : la cause en quelques mots, et ce que le joueur peut faire. */
export const REPAIR_TEXT: Record<RepairCause, { label: string; advice: string }> = {
  nofuel: { label: 'plus de charbon', advice: 'Un dépanneur ou un ravitailleur peut la recharger : il y a du charbon en coffre.' },
  nocoal: { label: 'plus de charbon, et aucun coffre n’en a', advice: 'Rangez du charbon dans un coffre du camp, ou posez une foreuse à charbon qui y mène.' },
  outfull: { label: 'sortie pleine', advice: 'Un coffre peut recevoir ce qu’elle produit : un dépanneur ou un ramasseur peut la vider.' },
  nochest: { label: 'sortie pleine, aucun coffre ne la reçoit', advice: 'Les coffres sont pleins ou réglés sur d’autres minerais : videz-les ou posez un coffre qui accepte ce produit.' },
  noexit: { label: 'aucune sortie reliée', advice: 'Rien ne reçoit sa production : posez un convoyeur, un coffre ou une caisse devant sa flèche.' },
  beltfull: { label: 'convoyeur plein plus loin', advice: 'La ligne est saturée en aval : un convoyeur plus rapide, une deuxième ligne ou une sortie libre (vue goulots, touche G).' },
  cratefull: { label: 'caisse d’expédition pleine', advice: 'Videz la caisse (vente ou livraison) ou ajoutez-en une.' },
  unreachable: { label: 'inaccessible pour le dépanneur', advice: 'Aucun chemin jusqu’à la machine ou au coffre (roche, grisou, eau profonde, machine en travers) : dégagez le passage.' },
};
