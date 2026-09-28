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
  { id: 'iron', name: 'Pioche en fer', tier: 3, damage: 4, swingTime: 0.38, reach: 2.0, price: 380, head: '#c7ccd6', description: "Assez solide pour le basalte, l'argent et l'or." },
  { id: 'pro', name: 'Pioche pro en acier', tier: 4, damage: 7, swingTime: 0.32, reach: 2.1, price: 1500, head: '#7fb4e0', description: 'Équipement professionnel. Rapide et redoutable.' },
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
