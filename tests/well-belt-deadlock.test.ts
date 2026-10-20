/**
 * Puits alimenté par une bande mixte (charbon puis mécanisme). Quand le puits est plein de charbon et sans mécanisme, il ne brûle
 * plus rien : le charbon de tête ne descend pas et le mécanisme qui le suit ne passe jamais. Ce test pose la question, il
 * n'impose pas encore la réponse.
 */
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/sim/GameState';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import type { Well } from '../src/sim/structures/Well';
import { run, teleport } from './helpers';
import { SURFACE_ROWS } from '../src/core/constants';

function spot(g: GameState): { x: number; y: number } {
  for (let y = 0; y + 3 <= SURFACE_ROWS; y++)
    for (let x = 8; x < 80; x++) {
      let ok = true;
      for (let yy = y; yy < y + 3 && ok; yy++) for (let xx = x - 2; xx < x + 5 && ok; xx++) ok = g.world.isOpen(xx, yy) && !g.structures.at(xx, yy);
      if (ok) return { x, y };
    }
  throw new Error('aucune place');
}

describe('puits : bande mixte charbon + mécanisme', () => {
  it('puits plein de charbon, sans mécanisme : le mécanisme derrière le charbon passe-t-il ?', () => {
    const g = new GameState(4);
    const { x, y } = spot(g);
    g.inventory.addKit('well', 1);
    g.inventory.addKit('conveyor', 1);
    teleport(g, x + 1, Math.min(SURFACE_ROWS - 1, y + 4));
    const w = g.place('well', x, y, 0) as Well;
    const belt = g.place('conveyor', x - 1, y + 1, 0) as Conveyor; // pointe vers l'est, dans le puits
    expect(w).toBeTruthy();
    expect(belt).toBeTruthy();
    w.addFuel(w.fuelMax);
    expect(w.fuelUnits).toBe(w.fuelMax);
    expect(w.mech).toBe(0);
    expect(belt.accept('coal', 0)).toBe(true);
    run(g, 1);
    expect(belt.accept('mechanism', 0)).toBe(true);
    run(g, 60);
    // Constat : le puits n'a pas bougé, la bande est bloquée.
    expect(w.status).toBe('nomech');
    expect(belt.flowState()).toBe('stuck');
    expect(w.mech).toBe(0);
    expect(belt.items.map((i) => i.res)).toEqual(['coal', 'mechanism']);
  });
});
