/**
 * Constantes globales du jeu.
 *
 * Unités :
 *  - 1 tuile = TILE unités monde (pixels à zoom 1).
 *  - La profondeur se mesure en mètres : chaque rangée de tuiles sous la surface
 *    représente METERS_PER_TILE mètres. Descendre vers le sud de la carte = descendre
 *    dans la mine.
 */
export const TILE = 16;
/** Taille (en tuiles) d'un bloc de rendu mis en cache. */
export const CHUNK = 16;
/** Nombre de rangées de surface (camp, comptoir, atelier) au-dessus de la mine. */
export const SURFACE_ROWS = 12;
export const METERS_PER_TILE = 2.5;
/** Pas de simulation fixe (secondes). */
export const SIM_DT = 1 / 60;

export const WORLD_W = 100;
export const WORLD_H = 190;

/** Profondeur (m) du bas d'une rangée de tuiles. 0 en surface. */
export function depthAt(tileY: number): number {
  return tileY < SURFACE_ROWS ? 0 : (tileY - SURFACE_ROWS + 1) * METERS_PER_TILE;
}

/** Première rangée dont la profondeur atteint `meters`. */
export function rowForDepth(meters: number): number {
  return SURFACE_ROWS - 1 + Math.ceil(meters / METERS_PER_TILE);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
