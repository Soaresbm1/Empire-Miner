import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/core/dir';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import { Sorter } from '../src/sim/structures/Sorter';
import type { Storage } from '../src/sim/structures/Storage';
import { teleport } from './helpers';

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 49, 9);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/** Trieur en (45,4) vers l'est : avant → coffre (47,4), gauche (nord) → (45,2), droite (sud) → (45,6). */
function setup(g: GameState, sides: { left?: boolean; right?: boolean } = { left: true, right: true }) {
  const src = put(g, 'conveyor', 44, 4, 0) as Conveyor;
  const so = put(g, 'sorter', 45, 4, 0) as Sorter;
  put(g, 'conveyor', 46, 4, 0);
  const front = put(g, 'storage', 47, 4) as Storage;
  let left: Storage | null = null;
  let right: Storage | null = null;
  if (sides.left) {
    put(g, 'conveyor', 45, 3, 3);
    left = put(g, 'storage', 45, 2) as Storage;
  }
  if (sides.right) {
    put(g, 'conveyor', 45, 5, 1);
    right = put(g, 'storage', 45, 6) as Storage;
  }
  return { src, so, front, left, right };
}

/** Alimente en alternant les minerais de `pattern`, `n` objets au total. */
function feed(g: GameState, belt: Conveyor, pattern: string[], n: number, seconds: number) {
  const dt = 1 / 60;
  let fed = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (fed < n && belt.accept(pattern[fed % pattern.length], 0)) fed++;
    g.update(dt, { mx: 0, my: 0, mine: false, target: null });
  }
  return fed;
}

describe('trieur', () => {
  it('envoie le minerai choisi tout droit et le reste sur les côtés', () => {
    const g = new GameState(12);
    const { src, so, front, left, right } = setup(g);
    expect(g.setSorterFilter(so, 'coal')).toBe(true);
    expect(feed(g, src, ['coal', 'copper', 'iron'], 30, 40)).toBe(30);
    expect(front.items).toEqual({ coal: 10 });
    const sides = { ...left!.items };
    for (const [k, v] of Object.entries(right!.items)) sides[k] = (sides[k] ?? 0) + v;
    expect(sides).toEqual({ copper: 10, iron: 10 });
    expect(Object.keys(left!.items).length).toBeGreaterThan(0); // les deux côtés servent
    expect(Object.keys(right!.items).length).toBeGreaterThan(0);
    expect(so.sortedFront).toBe(10);
    expect(so.sortedSides).toBe(20);
  });

  it('sans filtre, tout va tout droit', () => {
    const g = new GameState(12);
    const { src, front, left, right } = setup(g);
    feed(g, src, ['coal', 'copper'], 10, 20);
    expect(front.items).toEqual({ coal: 5, copper: 5 });
    expect(left!.items).toEqual({});
    expect(right!.items).toEqual({});
  });

  it('avec un seul côté branché, tout le reste y part', () => {
    const g = new GameState(12);
    const { src, so, front, right } = setup(g, { right: true });
    g.setSorterFilter(so, 'gold');
    feed(g, src, ['gold', 'silver', 'silver'], 12, 25);
    expect(front.items).toEqual({ gold: 4 });
    expect(right!.items).toEqual({ silver: 8 });
  });

  it('le tri reste strict quand la sortie avant est pleine', () => {
    const g = new GameState(12);
    const { src, so, front, left, right } = setup(g);
    g.setSorterFilter(so, 'coal');
    front.put('stone', 50); // coffre avant plein
    feed(g, src, ['coal', 'copper'], 20, 20);
    expect(left!.items.coal ?? 0).toBe(0);
    expect(right!.items.coal ?? 0).toBe(0);
    expect(so.blocked).toBe(true); // le charbon attend devant la sortie pleine
  });

  it('changer de filtre en cours de route ne perd rien', () => {
    const g = new GameState(12);
    const { src, so, front, left, right } = setup(g);
    g.setSorterFilter(so, 'coal');
    let fed = feed(g, src, ['coal', 'copper'], 10, 3);
    g.setSorterFilter(so, 'copper');
    fed += feed(g, src, ['coal', 'copper'], 10, 20);
    const all: Record<string, number> = {};
    for (const s of [front, left!, right!]) for (const [k, v] of Object.entries(s.items)) all[k] = (all[k] ?? 0) + v;
    const onBelts = g.structures.list.filter((s) => s.isBelt).reduce((n, s) => n + Object.values(s.contents()).reduce((a, b) => a + b, 0), 0);
    expect(fed).toBeGreaterThan(10);
    expect((all.coal ?? 0) + (all.copper ?? 0) + onBelts).toBe(fed);
    expect(front.items.copper ?? 0).toBeGreaterThan(0);
  });

  it('se règle avec E : le joueur peut interagir avec lui', () => {
    const g = new GameState(12);
    const { so } = setup(g);
    teleport(g, 45, 4); // debout sur le trieur
    expect(g.nearestInteractable()).toBe(so);
    expect(g.setSorterFilter(so, 'licorne')).toBe(false);
    expect(so.filter).toBe(null);
  });

  it('la sauvegarde conserve le filtre', () => {
    const g = new GameState(12);
    const { so } = setup(g);
    g.setSorterFilter(so, 'iron');
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const s2 = h.structures.at(45, 4);
    expect(s2).toBeInstanceOf(Sorter);
    expect((s2 as Sorter).filter).toBe('iron');
  });
});
