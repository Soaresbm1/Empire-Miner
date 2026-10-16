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
  /** Plus riche dans la Fournaise (sous 450 m) : filons pour 1000 tuiles à cette profondeur. */
  deepPerThousand?: number;
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
  /** Minerai fondu au four : identifiant du lingot obtenu (1 minerai → 1 lingot). */
  smeltsTo?: string;
  /** Lingot (produit par un four ou une fonderie, jamais trouvé dans la roche). */
  ingot?: boolean;
  /** Produit fabriqué à la Manufacture (plaque, acier, diamant taillé) : jamais trouvé dans la roche ni fondu. */
  product?: boolean;
  /** Pour un produit : le minerai dont il suit le cours au marché. */
  follows?: string;
  /** Dessin de l'objet quand ce n'est ni une pépite ni un lingot : plaque, barre (acier), gemme (diamant taillé), bobine (fil), roue dentée (engrenage) ou boîtier (mécanisme). */
  shape?: 'plate' | 'bar' | 'gem' | 'wire' | 'gear' | 'mech';
  /** Nom court dans les listes serrées (« Plaque »). */
  short?: string;
}

/** Lingot d'un minerai : même poids, vendu 2,5 fois plus cher. Il ne se trouve pas dans la roche. */
function ingot(id: string, name: string, value: number, weight: number, rarity: Rarity, color: string, light: string, dark: string): ResourceDef {
  return {
    id,
    name,
    veinName: name,
    value,
    weight,
    rarity,
    resistance: 0,
    tier: 0,
    minDepth: 0,
    maxDepth: 0,
    drops: [0, 0],
    color,
    light,
    dark,
    uses: ['Vente (2,5 fois le prix du minerai)'],
    ingot: true,
  };
}

/**
 * Produit de la Manufacture : se vend plus cher que ses matières, suit le cours du métal dont il est fait et ne se trouve
 * jamais dans la roche. Les recettes qui le fabriquent sont dans `data/recipes.ts`.
 */
function product(
  id: string,
  name: string,
  short: string,
  value: number,
  weight: number,
  rarity: Rarity,
  follows: string,
  shape: NonNullable<ResourceDef['shape']>,
  color: string,
  light: string,
  dark: string,
  uses: string[],
): ResourceDef {
  return {
    id,
    name,
    veinName: name,
    value,
    weight,
    rarity,
    resistance: 0,
    tier: 0,
    minDepth: 0,
    maxDepth: 0,
    drops: [0, 0],
    color,
    light,
    dark,
    uses,
    product: true,
    follows,
    shape,
    short,
  };
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
    uses: ['Vente', 'Four et fonderie : lingot'],
    smeltsTo: 'copper_ingot',
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
    uses: ['Vente', 'Four et fonderie : lingot'],
    smeltsTo: 'iron_ingot',
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
    uses: ['Vente', 'Four et fonderie : lingot'],
    smeltsTo: 'silver_ingot',
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
    vein: { perThousand: 3, deepPerThousand: 5, size: [2, 4] },
    deposit: [80, 200],
    color: '#f2c230',
    light: '#fff1a0',
    dark: '#a07410',
    uses: ['Vente', 'Four et fonderie : lingot'],
    smeltsTo: 'gold_ingot',
  },
  {
    id: 'diamond',
    name: 'Diamant',
    veinName: 'Filon de diamant',
    value: 260,
    weight: 0.5,
    rarity: 'légendaire',
    resistance: 40,
    tier: 4,
    minDepth: 500,
    maxDepth: Infinity,
    drops: [1, 1],
    vein: { perThousand: 1.6, size: [2, 3] },
    deposit: [30, 70],
    color: '#8fe3ee',
    light: '#ffffff',
    dark: '#2f7f92',
    uses: ['Vente : la ressource la plus précieuse', 'Ne se fond pas', 'Pioche pro en acier requise'],
  },
  // Lingots : toujours après les minerais. Un nouveau minerai s'ajoute à la suite des autres
  // (leur index sert aux gisements sauvegardés ; les lingots, eux, ne forment jamais de gisement).
  ingot('copper_ingot', 'Lingot de cuivre', 18, 2.5, 'commun', '#d9793c', '#ffb27a', '#8a4520'),
  ingot('iron_ingot', 'Lingot de fer', 40, 3, 'peu commun', '#9aa3b0', '#e2e7ee', '#565d69'),
  ingot('silver_ingot', "Lingot d'argent", 95, 2, 'rare', '#dfe5ee', '#ffffff', '#8b95a4'),
  ingot('gold_ingot', "Lingot d'or", 240, 3.5, 'très rare', '#f5c21f', '#fff3a6', '#a8740a'),
  // Produits de la Manufacture : toujours après les lingots (même raison : l'ordre sert aux gisements sauvegardés).
  // Chacun vaut plus que ce qu'il faut pour le fabriquer, et suit le cours du métal dont il est fait.
  product('copper_plate', 'Plaque de cuivre', 'Plaque', 27, 2.5, 'commun', 'copper', 'plate', '#e0894a', '#ffc590', '#8a4520', ['Vente (1,5 fois le lingot)', 'Commandes des clients', 'Matière du fil de cuivre']),
  product('iron_plate', 'Plaque de fer', 'Plaque', 60, 3, 'peu commun', 'iron', 'plate', '#aab3c0', '#eef2f7', '#5a6270', ['Vente (1,5 fois le lingot)', 'Commandes des clients', "Matière de l'engrenage"]),
  product('silver_plate', "Plaque d'argent", 'Plaque', 140, 2, 'rare', 'silver', 'plate', '#e8edf5', '#ffffff', '#8f9aab', ['Vente (1,5 fois le lingot)', 'Commandes des clients']),
  product('gold_plate', "Plaque d'or", 'Plaque', 360, 3.5, 'très rare', 'gold', 'plate', '#f7cc3a', '#fff6b8', '#a8740a', ['Vente (1,5 fois le lingot)', 'Commandes des clients', 'Grand Chevalement']),
  product('steel', 'Acier', 'Acier', 170, 5, 'peu commun', 'iron', 'bar', '#7f93ad', '#d3e0f0', '#3d4b60', ['Vente (plus de 2 fois les lingots de fer)', 'Commandes des clients', 'Grand Chevalement', 'Matière du mécanisme']),
  product('cut_diamond', 'Diamant taillé', 'Diamant taillé', 520, 0.4, 'légendaire', 'diamond', 'gem', '#9aeaf5', '#ffffff', '#2f8aa0', ['Vente (2 fois le diamant brut)', 'Commandes des clients', 'Grand Chevalement']),
  // Composants : fabriqués à partir d'autres produits (plaque, acier), donc à plusieurs étages de Manufacture. Ils s'ajoutent à la fin.
  product('copper_wire', 'Fil de cuivre', 'Fil', 16, 0.4, 'commun', 'copper', 'wire', '#e0894a', '#ffc590', '#8a4520', ['Vente', 'Commandes des clients', 'Matière du mécanisme']),
  product('gear', 'Engrenage', 'Engrenage', 78, 2, 'peu commun', 'iron', 'gear', '#aab3c0', '#eef2f7', '#5a6270', ['Vente', 'Commandes des clients', 'Matière du mécanisme']),
  product('mechanism', 'Mécanisme', 'Mécanisme', 525, 3, 'rare', 'iron', 'mech', '#8fa4bd', '#dce8f6', '#3d4b60', ['Vente (environ 1,4 fois ses matières)', 'Commandes des clients']),
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

/** Poids de la ressource la plus légère (kg) : un coffre qui a moins de place que ça ne reçoit plus rien. */
export const LIGHTEST_WEIGHT = Math.min(...RESOURCES.map((r) => r.weight));

export const RARITY_COLORS: Record<Rarity, string> = {
  commun: '#c9c2b8',
  'peu commun': '#7fd07a',
  rare: '#6fb3ff',
  'très rare': '#d38cff',
  légendaire: '#ffb347',
};
