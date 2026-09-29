import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { AIR, BEDROCK, HOST_ROCK_IDS, ORE_BLOCK } from '../src/data/blocks';
import { getMachine } from '../src/data/machines';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { TunnelBorer } from '../src/sim/structures/Borer';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ (x de 46 à 53, y de S+13 à S+15) ; la roche commence à x = 54.
const X = 53;
const Y = S + 14;
const SOFT = HOST_ROCK_IDS[0];
const LEVELS = getMachine('borer').levels!;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

/** Base vers l'est, devant 30 cases de roche sur 3 rangées (le tunnel et ses deux côtés). */
function setup(g: GameState, level = 1, block = SOFT, coal = 20) {
  for (let x = X + 1; x <= X + 30; x++) for (const y of [Y - 1, Y, Y + 1]) g.world.set(x, y, block);
  const b = put(g, 'borer', X, Y, 0) as TunnelBorer;
  b.level = level;
  b.addFuel(coal);
  return b;
}

/** Avance pas à pas (1/60 s) jusqu'à ce que `until` soit vrai, ou `max` secondes. */
function runUntil(g: GameState, until: () => boolean, max = 90): void {
  for (let t = 0; t < max && !until(); t += 1 / 60) run(g, 1 / 60);
}

function onGround(g: GameState, res: string): number {
  return g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);
}

describe('foreuse de percement : améliorations', () => {
  it('s’améliore sur sa base, niveau par niveau, jusqu’au niveau 4', () => {
    const g = new GameState(4);
    const b = setup(g);
    expect(b.maxLevel).toBe(4);
    g.money = 100;
    expect(g.upgradeBlocker(b)).toBe("Pas assez d'argent");
    expect(g.upgradeMachine(b)).toBe(false);
    g.money = 10_000;
    for (const l of LEVELS.slice(1)) {
      expect(g.upgradeMachine(b)).toBe(true);
      expect(b.level).toBe(l.level);
    }
    expect(g.money).toBe(10_000 - LEVELS.reduce((n, l) => n + l.price, 0));
    expect(g.upgradeBlocker(b)).toBe('Niveau maximal atteint');
    expect(g.events.some((e) => e.t === 'bought' && e.name.includes('benne à minerai'))).toBe(true);
  });

  it('ne s’améliore pas pendant que la foreuse est sortie', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.money = 10_000;
    b.start();
    runUntil(g, () => b.dist >= 2);
    expect(g.upgradeBlocker(b)).toBe('Rappelez d’abord la foreuse à sa base');
    expect(g.upgradeMachine(b)).toBe(false);
    b.stop();
    runUntil(g, () => b.home);
    expect(g.upgradeMachine(b)).toBe(true);
  });

  it('niveau 2, moteur renforcé : perce bien plus vite et emporte 4 unités de charbon', () => {
    const dug = (level: number) => {
      const g = new GameState(4);
      const b = setup(g, level);
      g.setBorerLength(b, 0);
      b.start();
      run(g, 10);
      return b;
    };
    const l1 = dug(1);
    const l2 = dug(2);
    expect(l2.totalDug).toBeGreaterThan(l1.totalDug * 1.6);
    expect(l1.tankMax).toBe(2);
    expect(l2.tankMax).toBe(4);
  });

  it('niveau 3, tête large : tunnel de 3 cases, les côtés indestructibles sont épargnés', () => {
    const g = new GameState(4);
    const b = setup(g, 3);
    g.world.set(X + 5, Y - 1, BEDROCK);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.status).toBe('done');
    expect(b.tunnel).toBe(10);
    for (let x = X + 1; x <= X + 10; x++) {
      expect(g.world.get(x, Y)).toBe(AIR);
      expect(g.world.get(x, Y + 1)).toBe(AIR);
      if (x !== X + 5) expect(g.world.get(x, Y - 1)).toBe(AIR);
    }
    expect(g.world.get(X + 5, Y - 1)).toBe(BEDROCK);
    expect(g.world.get(X + 11, Y)).toBe(SOFT);
    expect(b.totalDug).toBe(29);
  });

  it('niveau 4, benne : ramène le minerai à la base et laisse la pierre au sol', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, ORE_BLOCK.copper);
    g.setBorerLength(b, 0);
    b.start();
    runUntil(g, () => b.dist >= 3 && b.loadCount() > 0);
    expect(b.load.copper).toBeGreaterThan(0);
    expect(onGround(g, 'copper')).toBe(0); // rien ne traîne : tout est dans la benne
    // Benne pleine : elle rentre la vider dans la base, puis repart.
    runUntil(g, () => b.returning === 'full');
    expect(b.loadCount()).toBe(b.stats.hopper);
    runUntil(g, () => b.home);
    expect(b.loadCount()).toBe(0);
    // Tout ce qu'elle a ramassé est dans la base (y compris la première case, percée depuis la base).
    expect(b.store.copper).toBe(b.collected);
    expect(b.collected).toBeGreaterThanOrEqual(b.stats.hopper);
    expect(b.tunnel).toBeLessThan(30); // benne pleine bien avant la fin des 30 cases préparées
    run(g, 1);
    expect(b.home).toBe(false);
    expect(b.running).toBe(true);
    // La pierre, elle, reste dans le tunnel (et s'effrite) ; le cuivre au sol n'est que le surplus d'une benne pleine.
    expect(onGround(g, 'stone')).toBeGreaterThan(0);
    expect(onGround(g, 'copper')).toBeLessThan(b.collected);
  });

  it('la base pousse le minerai ramené dans un coffre collé ; le joueur peut aussi le récupérer', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: 10, iron: 4 };
    const chest = put(g, 'storage', X, Y - 1) as Storage;
    run(g, 1);
    expect(b.storeCount()).toBe(0);
    expect(chest.items.copper).toBe(10);
    expect(chest.items.iron).toBe(4);
    // Sans coffre : on récupère le minerai dans le sac depuis le panneau.
    const h = new GameState(4);
    const c = setup(h, 4);
    c.store = { copper: 5 };
    teleport(h, X - 1, Y);
    expect(h.collectBorer(c)).toBe(5);
    expect(h.inventory.count('copper')).toBe(5);
    expect(c.storeCount()).toBe(0);
  });

  it('le charbon ramené par la benne remplit la réserve de la base', () => {
    const g = new GameState(4);
    const b = setup(g, 4, ORE_BLOCK.coal, 2);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.status).toBe('done');
    // La réserve se remplit d'abord ; le surplus va dans le stock de la base.
    expect(b.fuelUnits).toBe(b.fuelMax);
    expect(b.store.coal).toBeGreaterThan(0);
  });

  it('base pleine de minerai : la foreuse attend à la base qu’on la vide', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: b.spec.store };
    b.load = { copper: b.stats.hopper };
    b.start();
    run(g, 1);
    expect(b.status).toBe('full');
    expect(b.home).toBe(true);
    teleport(g, X - 1, Y);
    expect(g.collectBorer(b)).toBeGreaterThan(0);
    run(g, 1);
    expect(b.loadCount()).toBeLessThan(b.stats.hopper);
    expect(b.home).toBe(false);
  });

  it('démontée, elle garde son niveau ; sauvegardée, sa benne et son stock aussi', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: 7 };
    b.load = { iron: 3 };
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hb = h.structures.at(X, Y) as TunnelBorer;
    expect(hb.level).toBe(4);
    expect(hb.store).toEqual({ copper: 7 });
    expect(hb.load).toEqual({ iron: 3 });
    teleport(g, X - 1, Y);
    expect(g.removeAt(X, Y)).toBe(true);
    expect(g.inventory.kitCount('borer@4')).toBe(1);
    expect(onGround(g, 'copper')).toBe(7);
    expect(onGround(g, 'iron')).toBe(3);
    const again = put(g, 'borer@4', X, Y) as TunnelBorer;
    expect(again.level).toBe(4);
    expect(again.stats.width).toBe(3);
  });
});
