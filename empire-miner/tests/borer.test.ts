import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
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

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 47, S + 13);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/** Foreuse de percement vers l'est, devant 30 cases de roche tendre (sans filons ni cavernes). */
function setup(g: GameState, coal = 10) {
  for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, HOST_ROCK_IDS[0]);
  const b = put(g, 'borer', X, Y, 0) as TunnelBorer;
  b.addFuel(coal);
  return b;
}

describe('foreuse de percement', () => {
  it('attend d’être démarrée', () => {
    const g = new GameState(4);
    const b = setup(g);
    run(g, 5);
    expect(b.x).toBe(X);
    expect(b.status).toBe('idle');
    expect(g.world.get(X + 1, Y)).toBe(HOST_ROCK_IDS[0]);
  });

  it('sans charbon, elle ne creuse pas', () => {
    const g = new GameState(4);
    const b = setup(g, 0);
    b.start();
    run(g, 3);
    expect(b.status).toBe('nofuel');
    expect(b.x).toBe(X);
  });

  it('creuse un tunnel droit de la longueur demandée puis s’arrête', () => {
    const g = new GameState(4);
    const b = setup(g);
    expect(g.setBorerLength(b, 10)).toBe(true);
    b.start();
    run(g, 30);
    expect(b.status).toBe('done');
    expect(b.running).toBe(false);
    expect(b.x).toBe(X + 10);
    expect(b.y).toBe(Y);
    expect(g.structures.at(X + 10, Y)).toBe(b);
    expect(g.structures.at(X, Y)).toBe(undefined);
    for (let x = X + 1; x <= X + 10; x++) {
      expect(g.world.get(x, Y)).toBe(AIR);
      expect(g.world.explored[g.world.idx(x, Y)]).toBe(1); // tunnel révélé sur la carte
    }
    expect(g.world.get(X + 11, Y)).toBe(HOST_ROCK_IDS[0]);
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('terminé'))).toBe(true);
  });

  it('va plus vite dans la roche tendre que dans le basalte', () => {
    const cases = (block: number) => {
      const g = new GameState(4);
      const b = setup(g);
      for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, block);
      g.setBorerLength(b, 0);
      b.start();
      run(g, 15);
      return b.dug;
    };
    const soft = cases(HOST_ROCK_IDS[0]);
    const basalt = cases(HOST_ROCK_IDS[2]);
    expect(soft).toBeGreaterThan(basalt * 2);
    expect(basalt).toBeGreaterThan(3);
  });

  it('laisse les gisements des filons et fait tomber les minerais derrière elle', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 1, Y, ORE_BLOCK.copper);
    b.start();
    run(g, 4);
    expect(g.world.depositAt(X + 1, Y)).toBe('copper');
    const copper = g.drops.list.filter((d) => d.res === 'copper');
    expect(copper.length).toBeGreaterThan(0);
    // Les morceaux sont dans le tunnel, derrière la machine (jamais sous elle ni dans la roche).
    for (const d of copper) {
      expect(Math.floor(d.x / TILE)).toBeLessThan(b.x);
      expect(g.world.isSolid(Math.floor(d.x / TILE), Math.floor(d.y / TILE))).toBe(false);
    }
  });

  it('s’arrête devant la roche indestructible et repart si l’obstacle disparaît', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 4, Y, BEDROCK);
    g.setBorerLength(b, 25);
    b.start();
    run(g, 15);
    expect(b.x).toBe(X + 3);
    expect(b.status).toBe('blocked');
    expect(b.blockReason).toContain('indestructible');
    expect(b.running).toBe(true);
    g.world.set(X + 4, Y, HOST_ROCK_IDS[0]);
    run(g, 3);
    expect(b.x).toBeGreaterThan(X + 3);
  });

  it('s’arrête devant une machine, patiente derrière le joueur', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 1, Y, AIR);
    g.world.set(X + 2, Y, AIR);
    teleport(g, X + 1, Y); // le joueur est sur son chemin
    b.start();
    run(g, 2);
    expect(b.status).toBe('waiting');
    expect(b.x).toBe(X);
    teleport(g, 47, S + 13);
    run(g, 1);
    expect(b.x).toBeGreaterThan(X);
    // Un coffre posé deux cases devant elle, dans le tunnel prolongé.
    g.world.set(b.x + 1, Y, AIR);
    g.world.set(b.x + 2, Y, AIR);
    g.inventory.addKit('storage', 1);
    teleport(g, b.x - 1, Y);
    const chest = g.place('storage', b.x + 2, Y, 0) as Storage;
    expect(chest).toBeTruthy();
    run(g, 3);
    expect(b.status).toBe('blocked');
    expect(b.x).toBe(chest.x - 1);
  });

  it('brûle une unité de charbon toutes les 20 s de travail', () => {
    const g = new GameState(4);
    const b = setup(g, 3);
    for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, HOST_ROCK_IDS[2]); // basalte : elle travaille tout le temps
    g.setBorerLength(b, 0);
    b.start();
    run(g, 25);
    const per = getMachine('borer').fuel!.secondsPerUnit;
    expect(b.fuelUnits).toBe(1); // deux unités entamées en 25 s
    expect(b.fuelSeconds()).toBeCloseTo(3 * per - 25, 0);
  });

  it('se dirige avec sa flèche : vers le sud, elle descend', () => {
    const g = new GameState(4);
    for (let y = Y + 2; y <= Y + 12; y++) g.world.set(50, y, HOST_ROCK_IDS[0]);
    const b = put(g, 'borer', 50, Y + 1, 1) as TunnelBorer;
    b.addFuel(5);
    g.setBorerLength(b, 10);
    b.start();
    run(g, 30);
    expect(b.x).toBe(50);
    expect(b.y).toBe(Y + 11);
    expect(g.playerDepth()).toBeLessThan(g.stats.maxDepth + 1); // le joueur n'a pas bougé
  });

  it('est sauvegardée en plein travail et se démonte comme une machine', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.setBorerLength(b, 25);
    b.start();
    run(g, 4);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hb = h.structures.at(b.x, b.y) as TunnelBorer;
    expect(hb).toBeInstanceOf(TunnelBorer);
    expect(hb.running).toBe(true);
    expect(hb.length).toBe(25);
    expect(hb.dug).toBe(b.dug);
    run(h, 3);
    expect(hb.x).toBeGreaterThan(b.x);
    teleport(h, hb.x - 2, Y);
    const coal = hb.fuelUnits;
    expect(h.removeAt(hb.x, hb.y)).toBe(true);
    expect(h.inventory.kitCount('borer')).toBe(1);
    expect(h.drops.list.filter((d) => d.res === 'coal').reduce((n, d) => n + d.count, 0)).toBe(coal);
  });
});
