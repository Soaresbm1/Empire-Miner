/**
 * Exploration : révèle les galeries visibles depuis une position.
 * Parcours en largeur à travers les tuiles ouvertes (la lumière ne traverse pas la roche),
 * les parois bordant ces tuiles deviennent visibles elles aussi.
 */
import type { World } from './World';

/** Révèle autour de (sx, sy). Renvoie les indices des tuiles nouvellement explorées. */
export function revealAround(world: World, sx: number, sy: number, radius: number): number[] {
  const revealed: number[] = [];
  const mark = (x: number, y: number) => {
    if (world.setExplored(x, y)) revealed.push(world.idx(x, y));
  };
  if (!world.inBounds(sx, sy)) return revealed;
  const visited = new Set<number>();
  const queue: [number, number, number][] = [[sx, sy, 0]];
  visited.add(world.idx(sx, sy));
  while (queue.length) {
    const [x, y, d] = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(x + dx, y + dy);
    if (d >= radius) continue;
    const next: [number, number][] = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of next) {
      if (!world.isOpen(nx, ny)) continue;
      const i = world.idx(nx, ny);
      if (visited.has(i)) continue;
      visited.add(i);
      queue.push([nx, ny, d + 1]);
    }
  }
  return revealed;
}
