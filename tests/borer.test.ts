import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { AIR, BEDROCK, HOST_ROCK_IDS, ORE_BLOCK } from '../src/data/blocks';
import { getMachine } from '../src/data/machines';
import { deserialize, serialize } from '../src/save/save';
import { GameState, NO_INTENT } from '../src/sim/GameState';
import { TunnelBorer } from '../src/sim/structures/Borer';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ (x de 46 à 53, y de S+13 à S+15) ; la roche commence à x = 54.
const X = 53;
const Y = S + 14;
const SOFT = HOST_ROCK_IDS[0];
const BASALT = HOST_ROCK_IDS[2];
const PER = getMachine('borer').fuel!.secondsPerUnit;

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 47, S + 13);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/** Base de foreuse de percement tournée vers l'est, devant 30 cases de roche (sans filons ni cavernes). */
function setup(g: GameState, coal = 10, block = SOFT) {
  for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, block);
  const b = put(g, 'borer', X, Y, 0) as TunnelBorer;
  b.addFuel(coal);
  return b;
}

/** Avance pas à pas (1/60 s) jusqu'à ce que `until` soit vrai (ou `max` secondes). */
function runUntil(g: GameState, until: () => boolean, max = 60): number {
  let t = 0;
  while (!until() && t < max) {
    run(g, 1 / 60);
    t += 1 / 60;
  }
  return t;
}

describe('foreuse de percement : base fixe et foreuse qui sort', () => {
  it('attend d’être démarrée, rangée dans sa base', () => {
    const g = new GameState(4);
    const b = setup(g);
    run(g, 5);
    expect(b.home).toBe(true);
    expect(b.status).toBe('idle');
    expect(g.world.get(X + 1, Y)).toBe(SOFT);
  });

  it('sans charbon dans la base, elle ne sort pas', () => {
    const g = new GameState(4);
    const b = setup(g, 0);
    b.start();
    run(g, 3);
    expect(b.status).toBe('nofuel');
    expect(b.home).toBe(true);
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('plus de charbon'))).toBe(true);
  });

  it('la base reste en place : la foreuse sort percer le tunnel, puis rentre quand il est fini', () => {
    const g = new GameState(4);
    const b = setup(g);
    expect(g.setBorerLength(b, 10)).toBe(true);
    b.start();
    run(g, 4);
    expect(b.dist).toBeGreaterThan(0); // sortie
    expect(b.x).toBe(X); // la base ne bouge pas
    expect(g.structures.at(X, Y)).toBe(b);
    expect(g.borerAt(X + b.dist, Y)).toBe(b);
    runUntil(g, () => b.status === 'done');
    expect(b.status).toBe('done');
    expect(b.home).toBe(true);
    expect(b.running).toBe(false);
    expect(b.tunnel).toBe(10);
    expect(g.borerAt(X + 5, Y)).toBe(null);
    for (let x = X + 1; x <= X + 10; x++) {
      expect(g.world.get(x, Y)).toBe(AIR);
      expect(g.world.explored[g.world.idx(x, Y)]).toBe(1); // tunnel révélé sur la carte
    }
    expect(g.world.get(X + 11, Y)).toBe(SOFT);
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('terminé'))).toBe(true);
    // Relancée sur la même longueur, elle refuse : le tunnel est déjà fait.
    expect(b.start()).toBe(false);
    // Plus long : elle roule jusqu'au bout du tunnel et reprend le perçage.
    g.setBorerLength(b, 25);
    expect(b.start()).toBe(true);
    runUntil(g, () => b.status === 'done');
    expect(b.tunnel).toBe(25);
    expect(b.totalDug).toBe(25);
  });

  it('va plus vite dans la roche tendre que dans le basalte', () => {
    const dug = (block: number) => {
      const g = new GameState(4);
      const b = setup(g, 10, block);
      g.setBorerLength(b, 0);
      b.start();
      run(g, 15);
      return b.totalDug;
    };
    const soft = dug(SOFT);
    const basalt = dug(BASALT);
    expect(soft).toBeGreaterThan(basalt * 2);
    expect(basalt).toBeGreaterThan(3);
  });

  it('laisse les gisements des filons et fait tomber les minerais derrière elle', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 1, Y, ORE_BLOCK.copper);
    g.world.set(X + 3, Y, ORE_BLOCK.copper);
    b.start();
    run(g, 5);
    expect(g.world.depositAt(X + 1, Y)).toBe('copper');
    expect(g.world.depositAt(X + 3, Y)).toBe('copper');
    const copper = g.drops.list.filter((d) => d.res === 'copper');
    expect(copper.length).toBeGreaterThan(0);
    // Les morceaux sont derrière la foreuse (jamais devant ni dans la roche).
    for (const d of copper) {
      expect(Math.floor(d.x / TILE)).toBeLessThan(X + b.dist);
      expect(g.world.isSolid(Math.floor(d.x / TILE), Math.floor(d.y / TILE))).toBe(false);
    }
  });

  it('rentre à sa base devant la roche indestructible, et repart si on la relance', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 4, Y, BEDROCK);
    g.setBorerLength(b, 25);
    b.start();
    runUntil(g, () => b.status === 'blocked');
    expect(b.home).toBe(true);
    expect(b.running).toBe(false);
    expect(b.tunnel).toBe(3);
    expect(b.blockReason).toContain('indestructible');
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('rentre à la base'))).toBe(true);
    g.world.set(X + 4, Y, SOFT);
    expect(b.start()).toBe(true);
    run(g, 6);
    expect(b.tunnel).toBeGreaterThan(3);
  });

  it('rentre faire le plein quand son charbon est vide, puis repart au bout du tunnel', () => {
    const g = new GameState(4);
    const b = setup(g, 3, BASALT); // basalte : elle perce tout le temps
    g.setBorerLength(b, 0);
    b.start();
    run(g, 1);
    expect(b.tank).toBe(1); // plein de 2 unités pris dans la base, une entamée
    expect(b.fuelUnits).toBe(1);
    runUntil(g, () => b.returning === 'fuel');
    const front = b.dist;
    expect(front).toBeGreaterThan(3);
    runUntil(g, () => b.home);
    // À la base : elle reprend la dernière unité et repart d'elle-même.
    runUntil(g, () => b.dist >= front);
    expect(b.fuelUnits).toBe(0);
    expect(b.running).toBe(true);
    // Plus rien dans la base : elle rentre et attend du charbon.
    runUntil(g, () => b.home && b.status === 'nofuel', 120);
    expect(b.status).toBe('nofuel');
    expect(b.running).toBe(true);
    const tunnel = b.tunnel;
    // Du charbon arrive dans la base (ici à la main) : elle repart toute seule.
    b.addFuel(1);
    run(g, 1);
    expect(b.home).toBe(false);
    runUntil(g, () => b.tunnel > tunnel, 60);
    expect(b.tunnel).toBeGreaterThan(tunnel);
  });

  it('ne brûle du charbon que pour percer : rouler dans le tunnel est gratuit', () => {
    const g = new GameState(4);
    const b = setup(g, 3, BASALT);
    g.setBorerLength(b, 0);
    b.start();
    let drilling = 0;
    for (let k = 0; k < 25 * 60; k++) {
      g.update(1 / 60, NO_INTENT);
      if (b.status === 'digging') drilling += 1 / 60;
    }
    expect(drilling).toBeGreaterThan(18);
    expect(drilling).toBeLessThan(24); // elle a aussi roulé
    expect(b.fuelSeconds()).toBeCloseTo(3 * PER - drilling, 1);
    // Tunnel déjà ouvert sur 10 cases : l'aller ne coûte rien.
    const h = new GameState(4);
    const c = setup(h, 1);
    for (let x = X + 1; x <= X + 10; x++) h.world.set(x, Y, AIR);
    h.setBorerLength(c, 25);
    c.start();
    runUntil(h, () => c.dist >= 10);
    expect(c.status).not.toBe('digging');
    expect(c.fuelSeconds()).toBeCloseTo(PER, 1);
  });

  it('attend quand le joueur est sur son chemin, à l’aller comme au retour', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.world.set(X + 1, Y, AIR);
    g.world.set(X + 2, Y, AIR);
    teleport(g, X + 1, Y); // le joueur est dans le tunnel, devant la base
    b.start();
    run(g, 2);
    expect(b.status).toBe('waiting');
    expect(b.home).toBe(true);
    teleport(g, 47, S + 13);
    g.setBorerLength(b, 0);
    runUntil(g, () => b.dist >= 4);
    // Rappelée, elle recule vers la base mais le joueur lui barre la route.
    b.stop();
    teleport(g, X + 1, Y);
    run(g, 4);
    expect(b.status).toBe('waiting');
    expect(b.returning).toBe('recall');
    expect(b.dist).toBe(2);
    teleport(g, 47, S + 13);
    runUntil(g, () => b.home);
    expect(b.status).toBe('idle');
    expect(b.running).toBe(false);
  });

  it('rentre devant une machine posée dans le tunnel', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.setBorerLength(b, 0);
    b.start();
    runUntil(g, () => b.dist >= 2);
    // Un coffre posé deux cases devant elle, dans le tunnel prolongé.
    const ahead = X + b.dist;
    g.world.set(ahead + 1, Y, AIR);
    g.world.set(ahead + 2, Y, AIR);
    g.inventory.addKit('storage', 1);
    teleport(g, ahead + 2, Y - 1);
    g.world.set(ahead + 2, Y - 1, AIR);
    const chest = g.place('storage', ahead + 2, Y, 0) as Storage;
    expect(chest).toBeTruthy();
    teleport(g, 47, S + 13);
    runUntil(g, () => b.status === 'blocked');
    expect(b.home).toBe(true);
    expect(b.blockReason).toContain('machine');
    expect(b.tunnel).toBe(chest.x - 1 - X);
  });

  it('la foreuse sortie est un obstacle : on ne la traverse pas, on ne construit pas dessus, E l’ouvre', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.setBorerLength(b, 0);
    b.start();
    runUntil(g, () => b.dist >= 4 && b.status === 'digging');
    const vx = X + b.dist;
    expect(g.isBlocked(vx * TILE + 2, Y * TILE + 2, vx * TILE + 6, Y * TILE + 6)).toBe(true);
    g.inventory.addKit('storage', 1);
    teleport(g, vx - 1, Y);
    expect(g.canPlace('storage', vx, Y)).toEqual({ ok: false, reason: 'La foreuse de percement passe ici' });
    expect(g.nearestInteractable()).toBe(b);
    // Ni démontage ni rotation tant qu'elle est dehors.
    teleport(g, X - 1, Y);
    expect(g.removeAt(X, Y)).toBe(false);
    expect(g.rotateAt(X, Y)).toBe(false);
    expect(g.structures.at(X, Y)).toBe(b);
  });

  it('se dirige avec sa flèche : vers le sud, elle perce vers le bas', () => {
    const g = new GameState(4);
    for (let y = Y + 2; y <= Y + 12; y++) g.world.set(50, y, SOFT);
    const b = put(g, 'borer', 50, Y + 1, 1) as TunnelBorer;
    b.addFuel(5);
    g.setBorerLength(b, 10);
    const px = g.player.x;
    const py = g.player.y;
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.home).toBe(true);
    expect(b.y).toBe(Y + 1);
    for (let y = Y + 2; y <= Y + 11; y++) expect(g.world.get(50, y)).toBe(AIR);
    expect(g.world.get(50, Y + 12)).toBe(SOFT);
    expect([g.player.x, g.player.y]).toEqual([px, py]); // le joueur n'a pas bougé
  });

  it('tourner la base (foreuse rangée) commence un nouveau tunnel', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    teleport(g, X - 1, Y);
    expect(g.rotateAt(X, Y)).toBe(true);
    expect(b.dir).toBe(1);
    expect(b.tunnel).toBe(0);
    expect(b.status).toBe('idle');
  });

  it('est sauvegardée foreuse sortie, et se démonte une fois rappelée', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.setBorerLength(b, 25);
    b.start();
    run(g, 4);
    expect(b.home).toBe(false);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hb = h.structures.at(X, Y) as TunnelBorer;
    expect(hb).toBeInstanceOf(TunnelBorer);
    expect(h.structures.borers).toEqual([hb]);
    expect(hb.running).toBe(true);
    expect(hb.length).toBe(25);
    expect(hb.dist).toBe(b.dist);
    expect(hb.tunnel).toBe(b.tunnel);
    expect(hb.tank).toBe(b.tank);
    expect(h.borerAt(X + hb.dist, Y)).toBe(hb);
    run(h, 3);
    expect(hb.tunnel).toBeGreaterThan(b.tunnel);
    teleport(h, X - 1, Y);
    expect(h.removeAt(X, Y)).toBe(false); // sortie : pas de démontage
    hb.stop();
    runUntil(h, () => hb.home);
    const coal = hb.fuelUnits + hb.tank;
    expect(h.removeAt(X, Y)).toBe(true);
    expect(h.inventory.kitCount('borer')).toBe(1);
    expect(h.structures.borers).toEqual([]);
    expect(h.drops.list.filter((d) => d.res === 'coal').reduce((n, d) => n + d.count, 0)).toBe(coal);
  });

  it('une ancienne sauvegarde (foreuse d’un seul bloc) devient une base rangée', () => {
    const g = new GameState(4);
    const b = setup(g, 7);
    b.start();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    const saved = data.structures.find((s: { type: string }) => s.type === 'borer');
    for (const k of ['tank', 'dist', 'tunnel', 'returning', 'moveT']) delete saved[k];
    saved.dug = 4;
    const h = deserialize(data);
    const hb = h.structures.at(X, Y) as TunnelBorer;
    expect(hb.home).toBe(true);
    expect(hb.fuelUnits).toBe(7);
    expect(hb.running).toBe(true);
    run(h, 3);
    expect(hb.tunnel).toBeGreaterThan(0);
  });
});
