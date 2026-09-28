import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { getMachine } from '../src/data/machines';
import { getResource, resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Conveyor } from '../src/sim/structures/Conveyor';
import type { Drill } from '../src/sim/structures/Drill';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const INTERVAL = getMachine('shipping').shipping!.interval;

/** Pose une structure en se plaçant à côté (portée de construction). */
function build(g: GameState, id: string, tx: number, ty: number, dir: Dir, from: [number, number]) {
  g.inventory.addKit(id, 1);
  teleport(g, from[0], from[1]);
  const s = g.place(id, tx, ty, dir);
  if (!s) throw new Error(`${id} @${tx},${ty} : ${g.canPlace(id, tx, ty).reason ?? 'kit manquant'}`);
  return s;
}

describe("caisse d'expédition", () => {
  it('ne se pose qu’en surface', () => {
    const g = new GameState(9);
    g.inventory.addKit('shipping', 1);
    teleport(g, 50, S + 8);
    expect(g.world.isOpen(49, S + 5)).toBe(true); // puits de la mine
    expect(g.canPlace('shipping', 49, S + 5).ok).toBe(false);
    expect(g.canPlace('shipping', 49, S + 5).reason).toMatch(/surface/);
    teleport(g, 50, 9);
    expect(g.canPlace('shipping', 52, 9).ok).toBe(true);
  });

  it('vend automatiquement ce que lui livre un convoyeur, sans le joueur', () => {
    const g = new GameState(9);
    const belt = build(g, 'conveyor', 51, 9, 0, [50, 8]) as Conveyor;
    const crate = build(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    teleport(g, 50, S + 10); // le joueur est au fond de la mine
    const dt = 1 / 60;
    let fed = 0;
    for (let t = 0; t < 8; t += dt) {
      if (belt.accept('copper', 0)) fed++;
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(g.money).toBe(0); // pas encore de passage du transporteur
    run(g, INTERVAL);
    const copper = getResource('copper').value;
    expect(g.money).toBeGreaterThan(0);
    expect(g.money % copper).toBe(0);
    expect(g.stats.autoSold).toBe(g.money);
    expect(crate.soldTotal).toBe(g.money);
    expect(g.events.some((e) => e.t === 'shipped')).toBe(true);
    expect(fed).toBeGreaterThanOrEqual(g.money / copper);
  });

  it('a une capacité limitée : pleine, elle bloque le convoyeur', () => {
    const g = new GameState(9);
    const belt = build(g, 'conveyor', 51, 9, 0, [50, 8]) as Conveyor;
    const crate = build(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    crate.timer = 1e9; // le transporteur ne passe pas
    const dt = 1 / 60;
    for (let t = 0; t < 60; t += dt) {
      belt.accept('iron', 0);
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(crate.weight()).toBeLessThanOrEqual(crate.capacity);
    expect(crate.room('iron')).toBe(0);
    expect(belt.blocked).toBe(true);
  });

  it('le joueur peut y vider son sac', () => {
    const g = new GameState(9);
    const crate = build(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    g.inventory.add('coal', 6);
    expect(g.shipDepositAll(crate)).toBe(6);
    expect(g.inventory.isEmpty()).toBe(true);
    run(g, INTERVAL + 0.1);
    expect(g.money).toBe(6 * getResource('coal').value);
  });

  it('chaîne complète : foreuse au fond de la mine → convoyeurs dans le puits → vente en surface', () => {
    const g = new GameState(9);
    const y = S + 10;
    g.world.setDeposit(59, y, resourceIndex('copper'), 1000);
    g.world.set(59, y, 0);
    const drill = build(g, 'drill', 59, y, 2, [57, y + 1]) as Drill;
    for (let x = 58; x >= 51; x--) build(g, 'conveyor', x, y, 2, [55, y + 1]);
    for (let yy = y; yy >= S - 1; yy--) build(g, 'conveyor', 50, yy, 3, [49, Math.min(yy + 2, y)]);
    build(g, 'shipping', 50, S - 2, 0, [48, S - 2]);
    g.inventory.add('coal', 10);
    g.fuelDrill(drill);
    teleport(g, 45, S + 5); // loin de tout
    run(g, 75);
    expect(drill.extracted).toBeGreaterThan(20);
    expect(g.stats.autoSold).toBeGreaterThan(0);
    expect(g.money).toBe(g.stats.autoSold);
  });

  it('la sauvegarde conserve la caisse, son contenu et le minuteur', () => {
    const g = new GameState(9);
    const crate = build(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    crate.put('gold', 2);
    crate.timer = 7.5;
    crate.soldTotal = 300;
    g.stats.autoSold = 300;
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const c = h.structures.at(52, 9) as ShippingCrate;
    expect(c).toBeInstanceOf(ShippingCrate);
    expect(c.items).toEqual({ gold: 2 });
    expect(c.timer).toBeCloseTo(7.5);
    expect(c.soldTotal).toBe(300);
    expect(h.stats.autoSold).toBe(300);
  });

  it('les anciennes sauvegardes (sans vente auto) se chargent', () => {
    const g = new GameState(9);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.stats.autoSold;
    expect(deserialize(data).stats.autoSold).toBe(0);
  });
});
