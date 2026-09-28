import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { conveyorThroughput, getMachine } from '../src/data/machines';
import { resourceIndex } from '../src/data/resources';
import { GameState } from '../src/sim/GameState';
import { Conveyor } from '../src/sim/structures/Conveyor';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;

/** Galerie est de la mine de départ : y = S+10, x de 51 à 58. */
function setupLine(g: GameState, belts: number) {
  const y = S + 10;
  g.world.setDeposit(51, y, resourceIndex('copper'), 1000);
  g.inventory.addKit('drill', 1);
  g.inventory.addKit('conveyor', belts);
  g.inventory.addKit('storage', 1);
  teleport(g, 54, S + 11);
  const drill = g.place('drill', 51, y, 0) as Drill;
  const convs: Conveyor[] = [];
  for (let i = 0; i < belts; i++) convs.push(g.place('conveyor', 52 + i, y, 0) as Conveyor);
  const storage = g.place('storage', 52 + belts, y, 0) as Storage;
  return { drill, convs, storage };
}

describe('automatisation', () => {
  it('foreuse → convoyeur → coffre : le minerai voyage physiquement jusqu’au stockage', () => {
    const g = new GameState(5);
    const { drill, convs, storage } = setupLine(g, 4);
    expect(drill && storage && convs.every(Boolean)).toBe(true);
    expect(drill.status).not.toBe('ok');
    g.inventory.add('coal', 5);
    expect(g.fuelDrill(drill)).toBe(5);

    run(g, 4);
    // Des minerais sont en transit sur les convoyeurs.
    const onBelts = convs.reduce((s, c) => s + c.items.length, 0);
    expect(onBelts).toBeGreaterThan(0);

    run(g, 30);
    expect(storage.items.copper ?? 0).toBeGreaterThan(5);
    expect(g.stats.delivered).toBe(storage.items.copper);
    // La foreuse brûle du charbon.
    expect(drill.fuelUnits).toBeLessThan(5);
  });

  it('sans charbon, la foreuse s’arrête', () => {
    const g = new GameState(5);
    const { drill, storage } = setupLine(g, 2);
    run(g, 10);
    expect(drill.status).toBe('nofuel');
    expect(storage.items.copper ?? 0).toBe(0);
  });

  it('un convoyeur a un débit limité et peut saturer', () => {
    const g = new GameState(5);
    const { convs } = setupLine(g, 3);
    // On retire le coffre : la chaîne n’a plus de sortie.
    g.removeAt(55, S + 10);
    const belt = convs[0];
    for (let i = 0; i < 20; i++) belt.accept('copper', 0);
    expect(belt.items.length).toBeLessThanOrEqual(belt.capacity);
    // Alimentation continue plus rapide que ce que la sortie peut absorber.
    const dt = 1 / 60;
    for (let t = 0; t < 30; t += dt) {
      belt.accept('copper', 0);
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    // Chaque tuile est pleine et le convoyeur de tête est bloqué.
    expect(convs[2].blocked).toBe(true);
    expect(convs.every((c) => c.items.length === c.capacity)).toBe(true);
  });

  it('le débit mesuré correspond aux statistiques du convoyeur', () => {
    const g = new GameState(5);
    const y = S + 10;
    g.inventory.addKit('conveyor', 6);
    g.inventory.addKit('storage', 1);
    teleport(g, 54, S + 11);
    const first = g.place('conveyor', 51, y, 0) as Conveyor;
    for (let x = 52; x <= 56; x++) g.place('conveyor', x, y, 0);
    const storage = g.place('storage', 57, y, 0) as Storage;
    storage.items = {};
    const dt = 1 / 60;
    const T = 40;
    for (let t = 0; t < T; t += dt) {
      first.accept('coal', 0); // source infinie
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    const rate = (storage.items.coal ?? 0) / T;
    const max = conveyorThroughput(getMachine('conveyor'));
    expect(rate).toBeGreaterThan(max * 0.75);
    expect(rate).toBeLessThanOrEqual(max * 1.05);
  });

  it('démonter une machine rend le kit et fait tomber son contenu au sol', () => {
    const g = new GameState(5);
    const { storage } = setupLine(g, 2);
    storage.put('copper', 3);
    const before = g.drops.list.length;
    expect(g.removeAt(storage.x, storage.y)).toBe(true);
    expect(g.inventory.kitCount('storage')).toBe(1);
    expect(g.drops.list.length).toBe(before + 1);
  });

  it('une foreuse doit être posée sur un gisement', () => {
    const g = new GameState(5);
    g.inventory.addKit('drill', 1);
    teleport(g, 54, S + 11);
    expect(g.canPlace('drill', 53, S + 10).ok).toBe(false);
  });
});
