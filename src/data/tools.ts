/** Outils du joueur : pioches et moyens de transport personnels. */

export interface PickaxeDef {
  id: string;
  name: string;
  /** Niveau : doit être >= au niveau du bloc pour pouvoir le miner. */
  tier: number;
  /** Dégâts par coup. */
  damage: number;
  /** Durée d'un coup (s). */
  swingTime: number;
  /** Portée (en tuiles, depuis le centre du joueur). */
  reach: number;
  price: number;
  /** Couleur de la tête (rendu). */
  head: string;
  description: string;
}

export const PICKAXES: PickaxeDef[] = [
  { id: 'old', name: 'Vieille pioche', tier: 1, damage: 1, swingTime: 0.55, reach: 1.9, price: 0, head: '#7b7064', description: 'Émoussée et rouillée. Elle a connu des jours meilleurs.' },
  { id: 'improved', name: 'Pioche améliorée', tier: 2, damage: 2, swingTime: 0.45, reach: 1.9, price: 60, head: '#a9a9b3', description: 'Tête affûtée : perce la roche dure et le fer.' },
  { id: 'iron', name: 'Pioche en fer', tier: 3, damage: 4, swingTime: 0.38, reach: 2.0, price: 380, head: '#c7ccd6', description: "Assez solide pour le basalte, la roche volcanique, l'argent et l'or." },
  { id: 'pro', name: 'Pioche pro en acier', tier: 4, damage: 7, swingTime: 0.32, reach: 2.1, price: 1500, head: '#7fb4e0', description: 'Équipement professionnel, rapide et redoutable. La seule à tailler les filons de diamant (sous 500 m).' },
];

export interface BagDef {
  id: string;
  name: string;
  /** Capacité (kg). */
  capacity: number;
  /** Multiplicateur de vitesse de déplacement. */
  speedMul: number;
  price: number;
  description: string;
}

export const BAGS: BagDef[] = [
  { id: 'old', name: 'Petit sac', capacity: 20, speedMul: 1, price: 0, description: 'Un sac de toile rapiécé.' },
  { id: 'large', name: 'Grand sac', capacity: 45, speedMul: 1, price: 90, description: 'Plus du double de place.' },
  { id: 'barrow', name: 'Brouette', capacity: 120, speedMul: 0.85, price: 450, description: 'Énorme capacité, mais ralentit un peu la marche.' },
];

/**
 * Outil mécanique : attaque plusieurs cases à la fois et brûle un combustible pris
 * dans le sac. Il s'ajoute aux pioches (touche T pour passer de l'un à l'autre).
 */
export interface PowerToolDef {
  id: string;
  name: string;
  /** Niveau : doit être >= au niveau du bloc pour pouvoir le miner. */
  tier: number;
  /** Dégâts par coup, sur chaque case du front d'attaque. */
  damage: number;
  /** Durée d'un coup (s). */
  swingTime: number;
  /** Portée (en tuiles, depuis le centre du joueur). */
  reach: number;
  /** Largeur du front d'attaque : la case visée et ses voisines, perpendiculairement au coup. */
  width: number;
  /** Combustible pris dans le sac : une unité donne `secondsPerUnit` secondes de marteau. */
  fuel: { res: string; secondsPerUnit: number };
  price: number;
  unlock: { pickaxeTier: number; text: string };
  description: string;
}

export const JACKHAMMER: PowerToolDef = {
  id: 'jackhammer',
  name: 'Marteau-piqueur',
  tier: 3,
  damage: 3,
  swingTime: 0.16,
  reach: 1.9,
  width: 3,
  fuel: { res: 'coal', secondsPerUnit: 12 },
  price: 900,
  unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' },
  description: "Attaque la paroi sur trois cases de large, très vite. Brûle le charbon de votre sac ; sans charbon, vous repassez à la pioche.",
};

/**
 * Moyen de déplacement personnel, acheté à l'Atelier. On le monte en maintenant Maj et on en
 * descend en relâchant la touche ; tant qu'on roule, la vitesse est multipliée par `speedMul`,
 * mais les mains sont au guidon : on ne peut pas miner.
 */
export interface RideDef {
  id: string;
  name: string;
  price: number;
  /** Multiplicateur de vitesse de déplacement pendant que l'on roule. */
  speedMul: number;
  description: string;
}

export const SCOOTER: RideDef = {
  id: 'scooter',
  name: 'Trottinette à moteur',
  price: 500,
  speedMul: 1.7,
  description: "Un petit moteur de pompe sur un plateau d'acier : on file 70 % plus vite, au camp comme dans les galeries. Les deux mains sont au guidon : impossible de miner en roulant.",
};

/**
 * Corde de rappel : une corde à usage unique, achetée à l'Atelier. On se suspend quelques secondes
 * sans bouger, puis on remonte au camp avec son sac. La corde reste accrochée à l'endroit quitté :
 * depuis le camp, on y redescend gratuitement (touche V dans les deux sens).
 */
export interface RopeDef {
  id: string;
  name: string;
  /** Prix d'une corde. */
  price: number;
  /** Lot de plusieurs cordes, un peu moins cher à l'unité. */
  pack: { qty: number; price: number };
  /** Cordes qu'on peut porter. */
  maxStock: number;
  /** Temps passé suspendu avant de partir (s) : il faut rester immobile. */
  channel: number;
  /** Un choc d'au moins ce nombre de points de vie (éboulement…) interrompt la manœuvre. */
  interruptDamage: number;
  /** Profondeur à partir de laquelle l'Atelier la conseille (m). */
  adviseDepth: number;
  description: string;
}

export const ROPE: RopeDef = {
  id: 'rope',
  name: 'Corde de rappel',
  price: 90,
  pack: { qty: 5, price: 400 },
  maxStock: 9,
  channel: 3,
  interruptDamage: 10,
  adviseDepth: 80,
  description: "Accrochez-la, ne bougez plus pendant trois secondes, et vous voilà au camp avec tout votre sac. La corde reste en place : redescendez au même endroit depuis le camp, sans payer de nouveau.",
};
