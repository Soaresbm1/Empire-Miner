import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { conveyorThroughput, getMachine } from '../src/data/machines';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Conveyor } from '../src/sim/structures/Conveyor';
import type { Storage } from '../src/sim/structures/Storage';
import { teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 10; // galerie est de la mine de départ
const TIERS = ['conveyor', 'conveyor_fast', 'conveyor_express'];

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 50, S + 8);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/**
 * Ligne de 6 convoyeurs alimentée à `rate` objets/s (ou au maximum). Renvoie le débit mesuré
 * en sortie une fois la ligne remplie (on ignore le temps de trajet initial).
 */
function measure(id: string, rate = Infinity, warmup = 12, T = 30) {
  const g = new GameState(6);
  const first = put(g, id, 51, Y) as Conveyor;
  for (let x = 52; x <= 56; x++) put(g, id, x, Y);
  const end = put(g, 'storage', 57, Y) as Storage;
  const dt = 1 / 60;
  let credit = 0;
  let delivered = 0;
  for (let t = 0; t < warmup + T; t += dt) {
    credit = Math.min(credit + rate * dt, 2);
    if (credit >= 1 && first.accept('coal', 0)) credit -= 1;
    g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    // Le coffre de sortie est vidé en continu pour ne jamais limiter la mesure.
    if (t >= warmup) delivered += end.items.coal ?? 0;
    end.items = {};
  }
  return { rate: delivered / T, first };
}

describe('convoyeurs plus rapides', () => {
  it('chaque niveau va plus vite et transporte plus', () => {
    const speeds = TIERS.map((id) => getMachine(id).stats.speed);
    expect(speeds[1]).toBe(speeds[0] * 2);
    expect(speeds[2]).toBe(speeds[0] * 4);
    const measured = TIERS.map((id) => measure(id).rate);
    TIERS.forEach((id, i) => {
      const max = conveyorThroughput(getMachine(id));
      expect(measured[i], id).toBeGreaterThan(max * 0.75);
      expect(measured[i], id).toBeLessThanOrEqual(max * 1.05);
    });
    expect(measured[1]).toBeGreaterThan(measured[0] * 1.7);
    expect(measured[2]).toBeGreaterThan(measured[1] * 1.7);
  });

  it('un débit qui sature le convoyeur de base passe sur un convoyeur rapide', () => {
    const rate = 3.5; // objets/s
    expect(conveyorThroughput(getMachine('conveyor'))).toBeLessThan(rate);
    const slow = measure('conveyor', rate);
    const fast = measure('conveyor_fast', rate);
    expect(slow.rate).toBeLessThan(rate * 0.8);
    expect(slow.first.items.length).toBe(slow.first.capacity); // bouchon en tête de ligne
    expect(fast.rate).toBeGreaterThan(rate * 0.9);
  });

  it('se débloquent avec les pioches', () => {
    const g = new GameState(6);
    expect(g.isUnlocked('conveyor')).toBe(true);
    expect(g.isUnlocked('conveyor_fast')).toBe(false);
    g.pickaxeLevel = 1;
    expect(g.isUnlocked('conveyor_fast')).toBe(true);
    expect(g.isUnlocked('conveyor_express')).toBe(false);
    g.pickaxeLevel = 2;
    expect(g.isUnlocked('conveyor_express')).toBe(true);
  });

  it('poser un convoyeur rapide sur un convoyeur existant l’améliore sur place', () => {
    const g = new GameState(6);
    const old = put(g, 'conveyor', 53, Y, 3) as Conveyor;
    old.accept('copper', 3);
    g.inventory.addKit('conveyor_fast', 1);
    const before = g.inventory.kitCount('conveyor');
    expect(g.canPlace('conveyor_fast', 53, Y).ok).toBe(true);
    const neo = g.place('conveyor_fast', 53, Y, 3) as Conveyor;
    expect(neo.type).toBe('conveyor_fast');
    expect(neo.dir).toBe(3);
    expect(neo.speed).toBe(getMachine('conveyor_fast').stats.speed);
    expect(neo.items.map((i) => i.res)).toEqual(['copper']);
    expect(g.structures.at(53, Y)).toBe(neo);
    expect(g.structures.list.filter((s) => s instanceof Conveyor).length).toBe(1);
    expect(g.inventory.kitCount('conveyor')).toBe(before + 1); // l'ancien revient en stock
    expect(g.inventory.kitCount('conveyor_fast')).toBe(0);
    // On ne remplace pas un convoyeur par un convoyeur identique.
    g.inventory.addKit('conveyor_fast', 1);
    expect(g.canPlace('conveyor_fast', 53, Y).ok).toBe(false);
    // Démonté, il rend le bon kit.
    expect(g.removeAt(53, Y)).toBe(true);
    expect(g.inventory.kitCount('conveyor_fast')).toBe(2);
  });

  it('la sauvegarde conserve le niveau des convoyeurs', () => {
    const g = new GameState(6);
    put(g, 'conveyor_express', 53, Y, 2);
    put(g, 'conveyor_fast', 54, Y, 2);
    put(g, 'conveyor', 55, Y, 2);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(TIERS.map((_, i) => (h.structures.at(55 - i, Y) as Conveyor).type)).toEqual(TIERS);
    expect((h.structures.at(53, Y) as Conveyor).speed).toBe(getMachine('conveyor_express').stats.speed);
  });
});
