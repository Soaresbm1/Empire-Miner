import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Conveyor } from '../src/sim/structures/Conveyor';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { run, teleport, timeToBreak } from './helpers';

const S = SURFACE_ROWS;

describe('sauvegarde', () => {
  it('restaure fidèlement la partie (monde modifié, joueur, économie, machines)', () => {
    const g = new GameState(77);
    // Mine une roche, gagne de l'argent, améliore, construit.
    teleport(g, 50, S + 5);
    timeToBreak(g, 51, S + 5);
    g.money = 500;
    g.pickaxeLevel = 1;
    g.setBagLevel(1);
    g.inventory.add('coal', 6);
    g.world.setDeposit(51, S + 10, resourceIndex('copper'), 300);
    g.inventory.addKit('drill', 1);
    g.inventory.addKit('conveyor', 3);
    g.inventory.addKit('storage', 1);
    teleport(g, 54, S + 11);
    const drill = g.place('drill', 51, S + 10, 0) as Drill;
    g.place('conveyor', 52, S + 10, 0);
    g.place('conveyor', 53, S + 10, 0);
    g.place('storage', 54, S + 10, 0);
    g.fuelDrill(drill);
    run(g, 12);
    g.drops.spawn('iron', 2, 800, 300, false);

    const data = JSON.parse(JSON.stringify(serialize(g)));
    const h = deserialize(data);

    expect(h.world.get(51, S + 5)).toBe(g.world.get(51, S + 5));
    expect(Array.from(h.world.tiles)).toEqual(Array.from(g.world.tiles));
    expect(Array.from(h.world.explored)).toEqual(Array.from(g.world.explored));
    expect(Array.from(h.world.reserve)).toEqual(Array.from(g.world.reserve));
    expect(h.player.x).toBeCloseTo(g.player.x, 1);
    expect(h.player.y).toBeCloseTo(g.player.y, 1);
    expect(h.money).toBe(500);
    expect(h.pickaxe.name).toBe('Pioche améliorée');
    expect(h.inventory.capacity).toBe(g.inventory.capacity);
    expect(h.inventory.items).toEqual(g.inventory.items);
    expect(h.drops.list.map((d) => [d.res, d.count])).toEqual(g.drops.list.map((d) => [d.res, d.count]));

    const types = (x: GameState) => x.structures.list.map((s) => `${s.type}@${s.x},${s.y}`).sort();
    expect(types(h)).toEqual(types(g));
    const hDrill = h.structures.at(51, S + 10) as Drill;
    expect(hDrill.fuelUnits).toBe(drill.fuelUnits);
    const hBelt = h.structures.at(52, S + 10) as Conveyor;
    expect(hBelt.items.length).toBe((g.structures.at(52, S + 10) as Conveyor).items.length);
    const hStore = h.structures.at(54, S + 10) as Storage;
    expect(hStore.items).toEqual((g.structures.at(54, S + 10) as Storage).items);

    // La partie chargée continue de tourner.
    const before = hStore.items.copper ?? 0;
    run(h, 10);
    expect(hStore.items.copper ?? 0).toBeGreaterThan(before);
  });

  it('rejette un fichier qui n’est pas une sauvegarde', () => {
    expect(() => deserialize({} as never)).toThrow();
  });
});
