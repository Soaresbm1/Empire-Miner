import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { ORE_BLOCK } from '../src/data/blocks';
import { getResource, resourceIndex } from '../src/data/resources';
import { hex } from '../src/render/color';
import { exploredBounds, mapFrame, mapTileColor } from '../src/render/MineMap';
import { GameState } from '../src/sim/GameState';
import { teleport, timeToBreak } from './helpers';

const S = SURFACE_ROWS;
const lum = (c: number[]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

/** Première tuile (x, y) de la carte qui contient ce bloc et n'a pas encore été vue. */
function findHidden(g: GameState, block: number): [number, number] {
  const w = g.world;
  for (let y = S; y < w.h; y++)
    for (let x = 0; x < w.w; x++) if (w.tiles[w.idx(x, y)] === block && !w.explored[w.idx(x, y)]) return [x, y];
  throw new Error('bloc introuvable');
}

describe('carte de la mine', () => {
  it("ne montre que ce que le joueur a déjà vu", () => {
    const g = new GameState(4);
    const [x, y] = findHidden(g, ORE_BLOCK.gold);
    expect(mapTileColor(g.world, x, y)).toBe(null);
    g.world.setExplored(x, y);
    expect(mapTileColor(g.world, x, y)).toEqual(hex(getResource('gold').color));
  });

  it('la surface est connue dès le début de la partie', () => {
    const g = new GameState(4);
    for (const x of [0, 30, 99]) expect(mapTileColor(g.world, x, 5)).not.toBe(null);
  });

  it('les galeries sont plus claires que la roche qui les entoure', () => {
    const g = new GameState(4);
    // Galerie est de la mine de départ (ouverte) et roche juste au-dessus, une fois vues.
    g.world.setExplored(55, S + 10);
    g.world.setExplored(55, S + 8);
    const floor = mapTileColor(g.world, 55, S + 10)!;
    const rock = mapTileColor(g.world, 55, S + 8)!;
    expect(g.world.isSolid(55, S + 8)).toBe(true);
    expect(lum(floor)).toBeGreaterThan(lum(rock) * 1.4);
  });

  it('un filon miné laisse un gisement visible, en plus clair', () => {
    const g = new GameState(4);
    teleport(g, 50, S + 5);
    g.pickaxeLevel = 3;
    g.world.set(51, S + 5, ORE_BLOCK.copper);
    g.world.setExplored(51, S + 5);
    expect(mapTileColor(g.world, 51, S + 5)).toEqual(hex(getResource('copper').color));
    timeToBreak(g, 51, S + 5);
    expect(g.world.depositAt(51, S + 5)).toBe('copper');
    expect(mapTileColor(g.world, 51, S + 5)).toEqual(hex(getResource('copper').light));
    // Même chose pour un gisement posé directement.
    g.world.setDeposit(52, S + 10, resourceIndex('iron'), 100);
    expect(mapTileColor(g.world, 52, S + 10)).toEqual(hex(getResource('iron').light));
  });

  it('la zone explorée grandit quand on descend', () => {
    const g = new GameState(4);
    const before = exploredBounds(g.world)!;
    expect(before.y0).toBe(0);
    expect(before.x1 - before.x0).toBe(g.world.w - 1); // toute la surface
    const [x, y] = findHidden(g, ORE_BLOCK.gold);
    g.world.setExplored(x, y);
    const after = exploredBounds(g.world)!;
    expect(after.y1).toBe(Math.max(before.y1, y));
  });

  it('la carte complète se cadre sur la mine explorée et le camp, pas sur toute la surface', () => {
    const g = new GameState(4);
    const start = mapFrame(g);
    expect(start.y0).toBe(0);
    expect(start.x1 - start.x0).toBeLessThan(g.world.w / 2); // le camp, pas toute la largeur
    const e = g.layout.entrance;
    expect(start.x0).toBeLessThanOrEqual(e.x);
    expect(start.x1).toBeGreaterThanOrEqual(e.x + e.w - 1);
    // Une galerie découverte loin sur le côté et en profondeur élargit le cadre.
    g.world.setExplored(3, 150);
    const later = mapFrame(g);
    expect(later.x0).toBe(3);
    expect(later.y1).toBe(150);
  });
});
