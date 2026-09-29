import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/core/dir';
import { ORE_BLOCK } from '../src/data/blocks';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Bridge } from '../src/sim/structures/Bridge';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import { Splitter } from '../src/sim/structures/Splitter';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

// Terrain dégagé du camp de surface (y de 2 à 5, x de 43 à 56).
function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 49, 9);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/** Alimente `belt` avec `n` objets aussi vite que possible, puis laisse tourner. */
function feed(g: GameState, belt: { accept(res: string, d: Dir): boolean }, res: string, n: number, dir: Dir, seconds: number) {
  const dt = 1 / 60;
  let fed = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (fed < n && belt.accept(res, dir)) fed++;
    g.update(dt, { mx: 0, my: 0, mine: false, target: null });
  }
  return fed;
}

describe('séparateur', () => {
  function setup(g: GameState, withFront: boolean, withLeft: boolean, withRight: boolean) {
    const src = put(g, 'conveyor', 44, 4, 0) as Conveyor;
    const sp = put(g, 'splitter', 45, 4, 0) as Splitter; // vers l'est
    const out: Record<string, Storage | null> = { front: null, left: null, right: null };
    if (withFront) {
      put(g, 'conveyor', 46, 4, 0);
      out.front = put(g, 'storage', 47, 4) as Storage;
    }
    if (withLeft) {
      put(g, 'conveyor', 45, 3, 3); // gauche = nord
      out.left = put(g, 'storage', 45, 2) as Storage;
    }
    if (withRight) {
      put(g, 'conveyor', 45, 5, 1); // droite = sud
      out.right = put(g, 'storage', 45, 6) as Storage;
    }
    return { src, sp, out };
  }
  const count = (s: Storage | null) => (s ? (s.items.copper ?? 0) : 0);

  it('répartit à tour de rôle entre avant, gauche et droite', () => {
    const g = new GameState(11);
    const { src, out } = setup(g, true, true, true);
    const fed = feed(g, src, 'copper', 30, 0, 30);
    expect(fed).toBe(30);
    expect([count(out.front), count(out.left), count(out.right)]).toEqual([10, 10, 10]);
  });

  it('partage en deux quand seules deux sorties sont branchées', () => {
    const g = new GameState(11);
    const { src, out } = setup(g, false, true, true);
    feed(g, src, 'copper', 20, 0, 25);
    expect([count(out.left), count(out.right)]).toEqual([10, 10]);
  });

  it('une sortie pleine est sautée : le reste continue', () => {
    const g = new GameState(11);
    const { src, out } = setup(g, true, true, true);
    out.right!.put('stone', 50); // coffre plein (150 kg)
    feed(g, src, 'copper', 30, 0, 40);
    const waiting = (g.structures.at(45, 5) as Conveyor).items.length; // bouchon devant le coffre plein
    expect(count(out.right)).toBe(0);
    expect(waiting).toBe(3);
    expect(count(out.front) + count(out.left)).toBe(30 - waiting);
  });

  it("n'accepte que par l'arrière", () => {
    const g = new GameState(11);
    const sp = put(g, 'splitter', 45, 4, 0) as Splitter;
    expect(sp.canAccept('copper', 0)).toBe(true);
    expect(sp.canAccept('copper', 1)).toBe(false);
    expect(sp.canAccept('copper', 2)).toBe(false);
    expect(sp.canAccept('copper', 3)).toBe(false);
  });

  it('ne ralentit pas une ligne express', () => {
    const g = new GameState(11);
    const src = put(g, 'conveyor_express', 44, 4, 0) as Conveyor;
    put(g, 'splitter', 45, 4, 0);
    put(g, 'conveyor_express', 45, 3, 3);
    const a = put(g, 'storage', 45, 2) as Storage;
    put(g, 'conveyor_express', 45, 5, 1);
    const b = put(g, 'storage', 45, 6) as Storage;
    const dt = 1 / 60;
    let n = 0;
    for (let t = 0; t < 20; t += dt) {
      src.accept('coal', 0);
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
      if (t >= 5) n += (a.items.coal ?? 0) + (b.items.coal ?? 0);
      a.items = {};
      b.items = {};
    }
    expect(n / 15).toBeGreaterThan(7.5); // l'express seul transporte ~8,6 objets/s
  });
});

describe('pont de convoyeur', () => {
  it('deux ponts de même direction à portée se relient', () => {
    const g = new GameState(11);
    const a = put(g, 'bridge', 44, 4, 0) as Bridge;
    const b = put(g, 'bridge', 48, 4, 0) as Bridge;
    const c = put(g, 'bridge', 52, 4, 0) as Bridge; // au-delà : b est déjà une sortie
    const other = put(g, 'bridge', 46, 4, 1) as Bridge; // autre direction, sous la travée
    run(g, 0.1);
    expect(a.target).toBe(b);
    expect(b.source).toBe(a);
    expect(b.target).toBe(null);
    expect(c.source).toBe(null);
    expect(other.target).toBe(null);
    expect(a.span()).toBe(4);
  });

  it('ne se relie pas au-delà de sa portée ni à travers la roche', () => {
    const g = new GameState(11);
    const a = put(g, 'bridge', 44, 4, 0) as Bridge;
    const far = put(g, 'bridge', 50, 4, 0) as Bridge; // 6 cases
    run(g, 0.1);
    expect(a.target).toBe(null);
    expect(far.source).toBe(null);
    const x = put(g, 'bridge', 44, 3, 0) as Bridge;
    const y = put(g, 'bridge', 47, 3, 0) as Bridge;
    g.world.set(45, 3, ORE_BLOCK.copper); // un rocher entre les deux
    g.structures.invalidate();
    run(g, 0.1);
    expect(x.target).toBe(null);
    expect(y.source).toBe(null);
  });

  it('croise deux lignes sans les mélanger', () => {
    const g = new GameState(11);
    // Ligne est-ouest (cuivre) qui enjambe une ligne nord-sud (fer) en x = 48.
    const h = put(g, 'conveyor', 45, 4, 0) as Conveyor;
    put(g, 'conveyor', 46, 4, 0);
    put(g, 'bridge', 47, 4, 0);
    put(g, 'bridge', 49, 4, 0);
    put(g, 'conveyor', 50, 4, 0);
    const endH = put(g, 'storage', 51, 4) as Storage;
    const v = put(g, 'conveyor', 48, 2, 1) as Conveyor;
    put(g, 'conveyor', 48, 3, 1);
    put(g, 'conveyor', 48, 4, 1);
    put(g, 'conveyor', 48, 5, 1);
    const endV = put(g, 'storage', 48, 6) as Storage;
    const dt = 1 / 60;
    let fedH = 0;
    let fedV = 0;
    for (let t = 0; t < 30; t += dt) {
      if (fedH < 20 && h.accept('copper', 0)) fedH++;
      if (fedV < 20 && v.accept('iron', 1)) fedV++;
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(endH.items).toEqual({ copper: 20 });
    expect(endV.items).toEqual({ iron: 20 });
  });

  it('un pont seul se comporte comme une case de convoyeur', () => {
    const g = new GameState(11);
    const src = put(g, 'conveyor', 45, 4, 0) as Conveyor;
    put(g, 'bridge', 46, 4, 0);
    const end = put(g, 'storage', 47, 4) as Storage;
    feed(g, src, 'coal', 10, 0, 10);
    expect(end.items.coal).toBe(10);
  });

  it('retirer le pont de sortie ne fait rien disparaître', () => {
    const g = new GameState(11);
    const a = put(g, 'bridge', 46, 4, 0) as Bridge;
    put(g, 'bridge', 50, 4, 0);
    run(g, 0.1); // liaison
    feed(g, a, 'gold', 6, 0, 0.5); // encore en l'air (trajet : 4 cases à 3 cases/s)
    const onBridge = a.transit.length;
    expect(onBridge).toBeGreaterThan(0);
    teleport(g, 49, 9);
    const dropsBefore = g.drops.list.reduce((n, d) => n + d.count, 0);
    expect(g.removeAt(50, 4)).toBe(true);
    run(g, 0.1);
    expect(a.target).toBe(null);
    const inA = a.transit.length + a.out.length;
    const dropped = g.drops.list.reduce((n, d) => n + d.count, 0) - dropsBefore;
    expect(inA + dropped).toBeGreaterThanOrEqual(onBridge);
  });

  it('la sauvegarde conserve ponts, séparateurs et objets en transit', () => {
    const g = new GameState(11);
    const src = put(g, 'conveyor', 45, 4, 0) as Conveyor;
    put(g, 'bridge', 46, 4, 0);
    put(g, 'bridge', 50, 4, 0);
    put(g, 'splitter', 51, 4, 0);
    feed(g, src, 'silver', 4, 0, 1);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    const h = deserialize(data);
    run(h, 0.05);
    const a = h.structures.at(46, 4) as Bridge;
    expect(a).toBeInstanceOf(Bridge);
    expect(a.target).toBe(h.structures.at(50, 4));
    expect(a.transit.length).toBe((g.structures.at(46, 4) as Bridge).transit.length);
    expect(h.structures.at(51, 4)).toBeInstanceOf(Splitter);
  });
});
