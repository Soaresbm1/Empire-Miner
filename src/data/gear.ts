/**
 * Équipement de protection du mineur : un objet par emplacement, acheté à l'Atelier.
 *
 * Chaque pièce contre un danger précis (éboulement, grisou, eau, chaleur) : elle absorbe une
 * part des dégâts (`absorb`, de 0 à 1). Les bottes ralentissent moins dans l'eau.
 */
export type GearSlot = 'head' | 'lungs' | 'feet' | 'body';
export type HazardKind = 'cavein' | 'gas' | 'water' | 'heat';

export interface GearDef {
  id: string;
  slot: GearSlot;
  name: string;
  /** Emplacement, en toutes lettres (fiche de l'Atelier). */
  slotName: string;
  price: number;
  /** Danger contré, et part des dégâts absorbée. */
  hazard: HazardKind;
  absorb: number;
  /** Dès quelle profondeur ce danger existe (m), pour le conseil d'achat. */
  fromDepth: number;
  description: string;
}

export const GEAR: GearDef[] = [
  {
    id: 'helmet',
    slot: 'head',
    name: 'Casque renforcé',
    slotName: 'Tête',
    price: 120,
    hazard: 'cavein',
    absorb: 0.65,
    fromDepth: 60,
    description: "Calotte d'acier rivetée : les éboulis font beaucoup moins mal. Il ne remplace pas un étai, mais il évite l'évanouissement.",
  },
  {
    id: 'mask',
    slot: 'lungs',
    name: 'Masque à gaz',
    slotName: 'Visage',
    price: 200,
    hazard: 'gas',
    absorb: 0.85,
    fromDepth: 120,
    description: 'Deux cartouches filtrantes : le grisou devient presque inoffensif, le temps de sortir du nuage ou de poser un ventilateur.',
  },
  {
    id: 'boots',
    slot: 'feet',
    name: 'Cuissardes étanches',
    slotName: 'Jambes',
    price: 150,
    hazard: 'water',
    absorb: 0.6,
    fromDepth: 70,
    description: "Caoutchouc jaune jusqu'aux cuisses : on marche dans l'eau sans être ralenti, et l'eau profonde épuise moins.",
  },
  {
    id: 'suit',
    slot: 'body',
    name: 'Combinaison ignifugée',
    slotName: 'Corps',
    price: 650,
    hazard: 'heat',
    absorb: 0.85,
    fromDepth: 450,
    description: 'Veste orange et salopette aluminisée : la chaleur de la Fournaise devient supportable pendant de longues minutes.',
  },
];

export function getGear(id: string): GearDef {
  const g = GEAR.find((x) => x.id === id);
  if (!g) throw new Error(`Équipement inconnu : ${id}`);
  return g;
}

export const isGear = (id: string): boolean => GEAR.some((g) => g.id === id);

/** Vitesse de marche dans l'eau avec les cuissardes (1 = normale). */
export const BOOTS_WATER = { shallow: 1, deep: 0.75 };

/** Danger à l'origine d'une blessure, d'après la cause affichée à l'écran. */
export const CAUSE_HAZARD: Record<string, HazardKind> = {
  éboulement: 'cavein',
  grisou: 'gas',
  noyade: 'water',
  chaleur: 'heat',
};

/** Ce que le HUD dit d'un danger que l'équipement contre, selon qu'on le porte ou non. */
export const HAZARD_LABEL: Record<HazardKind, string> = {
  cavein: 'Éboulements',
  gas: 'Grisou',
  water: 'Eau',
  heat: 'Chaleur',
};
