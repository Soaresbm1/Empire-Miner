import { TILE } from '../src/core/constants';
import { GameState, NO_INTENT, PlayerIntent } from '../src/sim/GameState';
import type { Structure } from '../src/sim/structures/Structure';

export function run(g: GameState, seconds: number, intent: PlayerIntent = NO_INTENT): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) g.update(dt, intent);
}

/** Téléporte le joueur au centre d'une tuile. */
export function teleport(g: GameState, tx: number, ty: number): void {
  g.player.x = (tx + 0.5) * TILE;
  g.player.y = (ty + 0.5) * TILE;
}

export function building(g: GameState, type: string): Structure {
  const b = g.structures.list.find((s) => s.type === type);
  if (!b) throw new Error(type);
  return b;
}

/** Place le joueur juste devant (sous) un bâtiment. */
export function goTo(g: GameState, type: string): void {
  const b = building(g, type);
  teleport(g, b.x + 1, b.y + b.h);
}

/** Temps (s) pour détruire une tuile en maintenant le minage. */
export function timeToBreak(g: GameState, tx: number, ty: number, max = 30): number {
  const dt = 1 / 60;
  let t = 0;
  const intent: PlayerIntent = { mx: 0, my: 0, mine: true, target: { tx, ty } };
  while (g.world.isSolid(tx, ty) && t < max) {
    g.update(dt, intent);
    t += dt;
  }
  return t;
}
