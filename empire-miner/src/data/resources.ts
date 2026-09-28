/**
 * Définition des ressources (données pures).
 *
 * Pour ajouter un nouveau minerai : ajouter une entrée dans RESOURCES.
 * Le générateur de monde, les blocs de filon, l'économie, l'inventaire,
 * les foreuses et le rendu le prennent en compte automatiquement.
 */

export type Rarity = 'commun' | 'peu commun' | 'rare' | 'très rare' | 'légendaire';

export interface VeinSpec {
  /** Nombre moyen de filons pour 1000 tuiles de roche dans sa tranche de profondeur. */
  perThousand: number;
  /** Taille d'un filon (nombre de tuiles). */
  size: [number, number];
}

export interface ResourceDef {
  id: string;
  name: string;
  /** Nom du bloc de filon, ex. « Filon de cuivre ». */
  veinName: string;
  /** Prix de vente unitaire au comptoir ($). */
  value: number;
  /** Poids unitaire (kg). */
  weight: number;
  rarity: Rarity;
  /** Points de résistance du filon (dégâts de pioche nécessaires). */
  resistance: number;
  /** Niveau de pioche minimum pour l'extraire. */
  tier: number;
  /** Profondeur minimale / maximale d'apparition (m). */
  minDepth: number;
  maxDepth: number;
  /** Nombre d'unités lâchées par un filon détruit à la pioche. */
  drops: [number, number];
  /** Absent pour les ressources qui ne forment pas de filons (ex. pierre). */
  vein?: VeinSpec;
  /** Réserves laissées au sol une fois le filon ouvert (exploitables par une foreuse). */
  deposit?: [number, number];
  /** Durée de vie d'un tas laissé par terre (s) avant qu'il s'effrite. Absent : il reste indéfiniment. */
  groundLife?: number;
  /** Couleurs : base, reflet, ombre. */
  color: string;
  light: string;
  dark: string;
  /** Utilisations connues (affichées dans l'inventaire). */
  uses: string[];
}

export const RESOURCES: ResourceDef[] = [
  {
    id: 'stone',
    name: 'Pierre',
    veinName: 'Roche',
    value: 1,
    weight: 3,
    rarity: 'commun',
    resistance: 3,
    tier: 1,
    minDepth: 0,
    maxDepth: Infinity,
    drops: [1, 1],
    // Les pierres abandonnées s'effritent : elles n'encombrent pas les galeries.
    groundLife: 60,
    color: '#8d857c',
    light: '#b9b1a6',
    dark: '#5b544d',
    uses: ['Vente (faible valeur)'],
  },
  {
    id: 'coal',
    name: 'Charbon',
    veinName: 'Filon de charbon',
    value: 4,
    weight: 1.5,
    rarity: 'commun',
    resistance: 4,
    tier: 1,
    minDepth: 0,
    maxDepth: 230,
    drops: [2, 3],
    vein: { perThousand: 9, size: [4, 9] },
    deposit: [260, 520],
    color: '#2b2a2e',
    light: '#6d6c78',
    dark: '#121114',
    uses: ['Combustible des foreuses', 'Vente'],
  },
  {
    id: 'copper',
    name: 'Cuivre',
    veinName: 'Filon de cuivre',
    value: 7,
    weight: 2.5,
    rarity: 'commun',
    resistance: 5,
    tier: 1,
    minDepth: 5,
    maxDepth: 270,
    drops: [1, 3],
    vein: { perThousand: 7, size: [4, 8] },
    deposit: [220, 460],
    color: '#c8743a',
    light: '#f0a768',
    dark: '#7d4020',
    uses: ['Vente'],
  },
  {
    id: 'iron',
    name: 'Fer',
    veinName: 'Filon de fer',
    value: 16,
    weight: 3,
    rarity: 'peu commun',
    resistance: 9,
    tier: 2,
    minDepth: 95,
    maxDepth: 430,
    drops: [1, 3],
    vein: { perThousand: 6, size: [3, 7] },
    deposit: [180, 400],
    color: '#a5654e',
    light: '#d99b82',
    dark: '#5e3325',
    uses: ['Vente'],
  },
  {
    id: 'silver',
    name: 'Argent',
    veinName: "Filon d'argent",
    value: 38,
    weight: 2,
    rarity: 'rare',
    resistance: 14,
    tier: 3,
    minDepth: 150,
    maxDepth: 470,
    drops: [1, 2],
    vein: { perThousand: 3.5, size: [2, 5] },
    deposit: [120, 300],
    color: '#c9d0da',
    light: '#ffffff',
    dark: '#7c8594',
    uses: ['Vente'],
  },
  {
    id: 'gold',
    name: 'Or',
    veinName: "Filon d'or",
    value: 95,
    weight: 3.5,
    rarity: 'très rare',
    resistance: 22,
    tier: 3,
    minDepth: 290,
    maxDepth: Infinity,
    drops: [1, 2],
    vein: { perThousand: 3, size: [2, 4] },
    deposit: [80, 200],
    color: '#f2c230',
    light: '#fff1a0',
    dark: '#a07410',
    uses: ['Vente'],
  },
];

const byId = new Map(RESOURCES.map((r) => [r.id, r]));

export function getResource(id: string): ResourceDef {
  const r = byId.get(id);
  if (!r) throw new Error(`Ressource inconnue : ${id}`);
  return r;
}

export function hasResource(id: string): boolean {
  return byId.has(id);
}

/** Index numérique (stocké dans les tableaux du monde, ex. gisements). */
export function resourceIndex(id: string): number {
  return RESOURCES.findIndex((r) => r.id === id);
}

export const RARITY_COLORS: Record<Rarity, string> = {
  commun: '#c9c2b8',
  'peu commun': '#7fd07a',
  rare: '#6fb3ff',
  'très rare': '#d38cff',
  légendaire: '#ffb347',
};
