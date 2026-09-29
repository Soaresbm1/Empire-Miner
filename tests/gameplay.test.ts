import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { AIR, ORE_BLOCK } from '../src/data/blocks';
import { getResource } from '../src/data/resources';
import { GameState } from '../src/sim/GameState';
import { goTo, run, teleport, timeToBreak } from './helpers';

const S = SURFACE_ROWS;

function freshCopperTile(g: GameState): { tx: number; ty: number } {
  // Filon de cuivre de la galerie est (mine de départ).
  g.world.set(59, S + 10, ORE_BLOCK.copper);
  return { tx: 59, ty: S + 10 };
}

describe('déplacement', () => {
  it('le joueur se déplace et est bloqué par la roche', () => {
    const g = new GameState(1);
    const x0 = g.player.x;
    run(g, 0.5, { mx: 1, my: 0, mine: false, target: null });
    expect(g.player.x).toBeGreaterThan(x0 + 20);
    // Dans le puits, aller vers l'ouest bute contre la paroi.
    teleport(g, 49, S + 2);
    run(g, 2, { mx: -1, my: 0, mine: false, target: null });
    expect(g.player.x).toBeGreaterThanOrEqual(49 * TILE + g.player.halfW - 0.01);
  });
});

describe('minage', () => {
  it('chaque coup inflige des dégâts puis détruit la roche et lâche les ressources', () => {
    const g = new GameState(1);
    const { tx, ty } = freshCopperTile(g);
    teleport(g, 58, S + 10);
    const intent = { mx: 0, my: 0, mine: true, target: { tx, ty } };
    run(g, 0.6, intent);
    expect(g.world.damage.get(g.world.idx(tx, ty))).toBeGreaterThan(0);
    expect(g.world.isSolid(tx, ty)).toBe(true);
    const t = timeToBreak(g, tx, ty);
    expect(t).toBeLessThan(10);
    expect(g.world.get(tx, ty)).toBe(AIR);
    expect(g.drops.list.some((d) => d.res === 'copper')).toBe(true);
    // Un gisement exploitable reste au sol.
    expect(g.world.depositAt(tx, ty)).toBe('copper');
  });

  it('la vieille pioche ne peut pas miner le fer', () => {
    const g = new GameState(1);
    teleport(g, 51, S + 15);
    const t = timeToBreak(g, 51, S + 16, 5);
    expect(t).toBeGreaterThanOrEqual(5);
    expect(g.world.get(51, S + 16)).toBe(ORE_BLOCK.iron);
    expect(g.events.some((e) => e.t === 'denied')).toBe(true);
  });

  it('les ressources sont ramassées et le sac est limité en poids', () => {
    const g = new GameState(1);
    teleport(g, 50, S + 5);
    for (let i = 0; i < 20; i++) g.drops.spawn('copper', 1, g.player.x + 6, g.player.y, false);
    run(g, 3);
    const copper = getResource('copper');
    expect(g.inventory.count('copper')).toBe(Math.floor(g.inventory.capacity / copper.weight));
    expect(g.inventory.weight()).toBeLessThanOrEqual(g.inventory.capacity);
    expect(g.drops.list.length).toBeGreaterThan(0); // le reste attend au sol
  });
});

describe('économie et progression', () => {
  it('vendre au comptoir rapporte de l’argent', () => {
    const g = new GameState(1);
    g.inventory.add('copper', 4);
    expect(g.sellAll()).toBe(0); // trop loin du comptoir
    goTo(g, 'counter');
    expect(g.sellAll()).toBe(4 * getResource('copper').value);
    expect(g.money).toBe(28);
    expect(g.inventory.isEmpty()).toBe(true);
  });

  it('la pioche améliorée mine réellement plus vite', () => {
    const g = new GameState(1);
    const { tx, ty } = freshCopperTile(g);
    teleport(g, 58, S + 10);
    const slow = timeToBreak(g, tx, ty);

    g.money = 1000;
    goTo(g, 'workshop');
    expect(g.buyNextPickaxe()).toBe(true);
    expect(g.pickaxe.name).toBe('Pioche améliorée');
    g.world.set(tx, ty, ORE_BLOCK.copper);
    teleport(g, 58, S + 10);
    run(g, 1);
    const fast = timeToBreak(g, tx, ty);
    expect(fast).toBeLessThan(slow * 0.6);
    // Et elle perce désormais le fer.
    teleport(g, 51, S + 15);
    expect(timeToBreak(g, 51, S + 16, 10)).toBeLessThan(10);
  });

  it('refuse un achat sans argent suffisant', () => {
    const g = new GameState(1);
    goTo(g, 'workshop');
    expect(g.buyNextPickaxe()).toBe(false);
    expect(g.pickaxeLevel).toBe(0);
  });
});
