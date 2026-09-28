/** Directions cardinales. 0 = Est, 1 = Sud, 2 = Ouest, 3 = Nord. */
export type Dir = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function rotateCW(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}

/** Direction dominante d'un vecteur. */
export function dirFromVector(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

export const DIR_ARROWS = ['→', '↓', '←', '↑'];
