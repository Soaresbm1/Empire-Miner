/**
 * Machines et structures constructibles.
 *
 * Chaque machine expose des statistiques homogènes (vitesse, consommation,
 * capacité, efficacité, niveau, coût) afin que les futures machines
 * (trieurs, concasseurs, fonderies, générateurs…) s'intègrent sans changer l'UI.
 */

export type MachineCategory = 'extraction' | 'logistique' | 'stockage' | 'vente';

export interface MachineStats {
  /** Extraction : unités/s. Convoyeur : tuiles/s. */
  speed: number;
  /** Consommation électrique (kW). 0 = aucune (mécanique ou combustion). */
  power: number;
  /** Convoyeur : objets par tuile. Stockage : kg. Foreuse : tampon de sortie. */
  capacity: number;
  /** Efficacité (1 = 100 %) : unités extraites par unité de réserve consommée. */
  efficiency: number;
  level: number;
}

export interface FuelSpec {
  res: string;
  /** Secondes de fonctionnement par unité de combustible. */
  secondsPerUnit: number;
  /** Nombre max d'unités stockées dans la machine. */
  maxUnits: number;
}

export interface ShippingSpec {
  /** Intervalle entre deux passages du transporteur (s). */
  interval: number;
}

export interface MachineDef {
  id: string;
  name: string;
  category: MachineCategory;
  description: string;
  price: number;
  w: number;
  h: number;
  /** Bloque le passage du joueur. */
  solid: boolean;
  rotatable: boolean;
  stats: MachineStats;
  fuel?: FuelSpec;
  /** Condition de déblocage (texte + test sur le niveau de pioche). */
  unlock?: { pickaxeTier: number; text: string };
  /** Doit être posée sur un gisement exposé. */
  needsDeposit?: boolean;
  /** Ne peut être posée qu'en surface (au camp). */
  surfaceOnly?: boolean;
  /** Vente automatique (caisse d'expédition). */
  shipping?: ShippingSpec;
}

export const MACHINES: MachineDef[] = [
  {
    id: 'conveyor',
    name: 'Convoyeur',
    category: 'logistique',
    description: 'Transporte les minerais dans la direction de la flèche. Débit limité : il peut saturer.',
    price: 6,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 0.75, power: 0, capacity: 3, efficiency: 1, level: 1 },
  },
  {
    id: 'drill',
    name: 'Foreuse à charbon',
    category: 'extraction',
    description: 'Extrait le gisement sous elle et pousse le minerai vers l\'avant (ou dans un convoyeur collé). Brûle du charbon.',
    price: 220,
    w: 1,
    h: 1,
    solid: true,
    rotatable: true,
    stats: { speed: 0.4, power: 0, capacity: 8, efficiency: 1, level: 1 },
    fuel: { res: 'coal', secondsPerUnit: 30, maxUnits: 10 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
    needsDeposit: true,
  },
  {
    id: 'storage',
    name: 'Coffre de stockage',
    category: 'stockage',
    description: 'Reçoit les minerais des convoyeurs et des machines, et se vide dans les convoyeurs qui en partent. Vous pouvez aussi y déposer votre sac.',
    price: 45,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 150, efficiency: 1, level: 1 },
  },
  {
    id: 'shipping',
    name: "Caisse d'expédition",
    category: 'vente',
    description: 'Vend automatiquement tout ce qui y entre, au prix du comptoir. Un transporteur la vide régulièrement. Se pose en surface.',
    price: 180,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    // capacity : kg en attente du transporteur ; efficiency : part du prix du comptoir.
    stats: { speed: 0, power: 0, capacity: 120, efficiency: 1, level: 1 },
    shipping: { interval: 15 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
    surfaceOnly: true,
  },
];

const byId = new Map(MACHINES.map((m) => [m.id, m]));

export function getMachine(id: string): MachineDef {
  const m = byId.get(id);
  if (!m) throw new Error(`Machine inconnue : ${id}`);
  return m;
}

/** Débit maximum théorique d'un convoyeur (objets/s). */
export function conveyorThroughput(def: MachineDef): number {
  return def.stats.speed * def.stats.capacity;
}
