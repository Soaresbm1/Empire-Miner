import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/core/dir';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { RailSwitch, type RailStation } from '../src/sim/structures/Rail';
import type { Storage } from '../src/sim/structures/Storage';
import type { Wagon } from '../src/sim/Wagons';
import { run, teleport } from './helpers';

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 49, 8);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/**
 * Tronc : quai de chargement (44,3) → rails (45..47,3) → aiguillage (48,3), pointe à l'ouest.
 * Branche « tout droit » : rails (49..50,3) → quai A (51,3) → coffre A (52,3).
 * Branche « à droite » (sud) : rail (48,4) → quai B (48,5) → coffre B (49,5).
 */
function network(g: GameState) {
  const load = put(g, 'rail_load', 44, 3) as RailStation;
  for (let x = 45; x <= 47; x++) put(g, 'rail', x, 3);
  const sw = put(g, 'rail_switch', 48, 3, 0) as RailSwitch;
  for (let x = 49; x <= 50; x++) put(g, 'rail', x, 3);
  put(g, 'rail_unload', 51, 3);
  const a = put(g, 'storage', 52, 3) as Storage;
  put(g, 'rail', 48, 4);
  put(g, 'rail_unload', 48, 5);
  const b = put(g, 'storage', 49, 5) as Storage;
  const wagon = put(g, 'wagon', 46, 3, 2) as Wagon;
  return { load, sw, a, b, wagon };
}

describe('aiguillages', () => {
  it('envoie les wagonnets venus de la pointe dans la branche choisie', () => {
    for (const [setting, expectA, expectB] of [
      ['straight', 10, 0],
      ['right', 0, 10],
    ] as const) {
      const g = new GameState(31);
      const { load, sw, a, b } = network(g);
      sw.setting = setting;
      load.put('copper', 10);
      run(g, 12);
      expect(a.items.copper ?? 0, setting).toBe(expectA);
      expect(b.items.copper ?? 0, setting).toBe(expectB);
    }
  });

  it('en alternance, dessert les deux branches à tour de rôle', () => {
    const g = new GameState(31);
    const { load, sw, a, b, wagon } = network(g);
    sw.setting = 'alt';
    load.put('coal', 10);
    run(g, 7);
    load.put('iron', 10);
    run(g, 8);
    expect(a.items).toEqual({ coal: 10 });
    expect(b.items).toEqual({ iron: 10 });
    expect(wagon.x).toBe(44); // revenu au quai de chargement par la pointe
  });

  it('un wagonnet qui revient par une branche repart vers la pointe', () => {
    const g = new GameState(31);
    const { load, sw, b, wagon } = network(g);
    sw.setting = 'right';
    load.put('silver', 5);
    run(g, 12);
    expect(b.items.silver).toBe(5);
    // Après avoir vidé en B, il revient au quai de chargement (et non vers la branche A).
    expect(wagon.x).toBe(44);
    expect(wagon.y).toBe(3);
  });

  it('sans aiguillage, un embranchement suit la règle par défaut (tout droit)', () => {
    const g = new GameState(31);
    const load = put(g, 'rail_load', 44, 3) as RailStation;
    for (let x = 45; x <= 50; x++) put(g, 'rail', x, 3);
    put(g, 'rail_unload', 51, 3);
    const a = put(g, 'storage', 52, 3) as Storage;
    put(g, 'rail', 48, 4);
    put(g, 'rail_unload', 48, 5);
    const b = put(g, 'storage', 49, 5) as Storage;
    put(g, 'wagon', 46, 3, 2);
    load.put('copper', 6);
    run(g, 12);
    expect(a.items.copper).toBe(6);
    expect(b.items.copper ?? 0).toBe(0);
  });

  it('se pose sur un rail existant, qui revient dans le stock', () => {
    const g = new GameState(31);
    for (let x = 45; x <= 47; x++) put(g, 'rail', x, 3);
    const before = g.inventory.kitCount('rail');
    g.inventory.addKit('rail_switch', 1);
    expect(g.canPlace('rail_switch', 46, 3).ok).toBe(true);
    const sw = g.place('rail_switch', 46, 3, 0);
    expect(sw).toBeInstanceOf(RailSwitch);
    expect(g.inventory.kitCount('rail')).toBe(before + 1);
    expect(g.structures.list.filter((s) => s.x === 46 && s.y === 3).length).toBe(1);
  });

  it('les rails simples ne proposent pas d’interaction, l’aiguillage si', () => {
    const g = new GameState(31);
    put(g, 'rail', 45, 3);
    teleport(g, 45, 3);
    expect(g.nearestInteractable()).toBe(null);
    const sw = put(g, 'rail_switch', 46, 3, 0);
    teleport(g, 46, 3);
    expect(g.nearestInteractable()).toBe(sw);
  });

  it('se tourne avec R et garde son réglage à la sauvegarde', () => {
    const g = new GameState(31);
    const { sw } = network(g);
    sw.setting = 'alt';
    teleport(g, 48, 7);
    expect(g.rotateAt(48, 3)).toBe(true);
    expect(sw.dir).toBe(1);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const s2 = h.structures.at(48, 3) as RailSwitch;
    expect(s2).toBeInstanceOf(RailSwitch);
    expect(s2.setting).toBe('alt');
    expect(s2.dir).toBe(1);
  });
});
