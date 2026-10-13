/**
 * Recettes de la Manufacture (données pures) : ce qu'elle fabrique, avec quoi, et en combien de temps.
 *
 * Chaque recette donne un produit de `data/resources.ts` (plaque, acier, diamant taillé). Le charbon n'est pas une matière
 * de recette : la machine le brûle pendant qu'elle travaille, comme un four (voir `fuel` de la machine).
 *
 * Pour ajouter un produit : une ressource `product(...)` dans `resources.ts`, une recette ici, et si les clients doivent
 * le demander, une ligne dans `GOODS` (`data/contracts.ts`). Rien d'autre.
 */

export interface RecipeSpec {
  /** Identifiant de la recette : celui du produit qu'elle fabrique. */
  id: string;
  /** Matières consommées à chaque fabrication : ressource → quantité. */
  inputs: Readonly<Record<string, number>>;
  /** Unités du produit obtenues à chaque fabrication. */
  yield: number;
  /** Durée d'une fabrication (s), à la cadence normale. */
  time: number;
}

/** Dans l'ordre du panneau de la Manufacture : les plaques (du cuivre à l'or), l'acier, puis le diamant taillé. */
export const RECIPES: readonly RecipeSpec[] = [
  { id: 'copper_plate', inputs: { copper_ingot: 1 }, yield: 1, time: 2 },
  { id: 'iron_plate', inputs: { iron_ingot: 1 }, yield: 1, time: 2 },
  { id: 'silver_plate', inputs: { silver_ingot: 1 }, yield: 1, time: 2 },
  { id: 'gold_plate', inputs: { gold_ingot: 1 }, yield: 1, time: 2 },
  { id: 'steel', inputs: { iron_ingot: 2 }, yield: 1, time: 4 },
  { id: 'cut_diamond', inputs: { diamond: 1 }, yield: 1, time: 5 },
];

const byId = new Map(RECIPES.map((r) => [r.id, r]));

export function getRecipe(id: string): RecipeSpec {
  const r = byId.get(id);
  if (!r) throw new Error(`Recette inconnue : ${id}`);
  return r;
}

/** La recette `id` existe-t-elle ? (Les sauvegardes et les actions du réseau ne sont jamais crues sur parole.) */
export function hasRecipe(id: unknown): id is string {
  return typeof id === 'string' && byId.has(id);
}
