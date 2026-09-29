import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import type { RailStation } from '../src/sim/structures/Rail';
import type { Storage } from '../src/sim/structures/Storage';
import type { Wagon } from '../src/sim/Wagons';
import { run, teleport } from './helpers';

// Terrain dégagé du camp de surface.
function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 49, 8);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

/** Ligne droite en y = 3 : quai de chargement (44), rails (45..53), quai de déchargement (54), coffre (55). */
function line(g: GameState) {
  const load = put(g, 'rail_load', 44, 3) as RailStation;
  for (let x = 45; x <= 53; x++) put(g, 'rail', x, 3);
  const unload = put(g, 'rail_unload', 54, 3) as RailStation;
  const chest = put(g, 'storage', 55, 3) as Storage;
  const wagon = put(g, 'wagon', 49, 3, 2) as Wagon; // part vers l'ouest (le quai de chargement)
  return { load, unload, chest, wagon };
}

describe('wagonnets et rails', () => {
  it('fait la navette : charge au quai de chargement, vide au quai de déchargement', () => {
    const g = new GameState(21);
    const { load, chest, wagon } = line(g);
    load.put('copper', 20);
    run(g, 30);
    expect(chest.items.copper).toBe(20);
    expect(load.count()).toBe(0);
    expect(wagon.trips).toBeGreaterThanOrEqual(2);
  });

  it('attend au quai de chargement tant qu’il n’y a rien à charger', () => {
    const g = new GameState(21);
    const { wagon } = line(g);
    run(g, 10);
    expect(wagon.stopped).toBe(true);
    expect(wagon.x).toBe(44);
    expect(wagon.isEmpty()).toBe(true);
  });

  it('repart dès qu’il est plein', () => {
    const g = new GameState(21);
    const { load, wagon } = line(g);
    run(g, 3); // arrivé au quai
    wagon.cargo = { gold: 28 }; // 98 kg sur 100
    load.put('gold', 5);
    run(g, 0.1);
    expect(wagon.stopped).toBe(false);
  });

  it('attend avec son chargement si le quai de déchargement est plein', () => {
    const g = new GameState(21);
    const { load, unload, chest, wagon } = line(g);
    g.removeAt(chest.x, chest.y); // plus rien pour vider le quai
    unload.put('stone', 20); // 60 kg : plein
    load.put('iron', 10);
    run(g, 20);
    expect(wagon.x).toBe(54);
    expect(wagon.stopped).toBe(true);
    expect(wagon.cargo.iron).toBe(10);
  });

  it('sans quai, il fait l’aller-retour d’un bout à l’autre', () => {
    const g = new GameState(21);
    for (let x = 44; x <= 50; x++) put(g, 'rail', x, 3);
    const w = put(g, 'wagon', 47, 3, 0) as Wagon;
    let min = 99;
    let max = 0;
    for (let i = 0; i < 300; i++) {
      run(g, 0.05);
      min = Math.min(min, w.x);
      max = Math.max(max, w.x);
    }
    expect(min).toBe(44);
    expect(max).toBe(50);
  });

  it('suit les virages', () => {
    const g = new GameState(21);
    const load = put(g, 'rail_load', 44, 3) as RailStation;
    for (let x = 45; x <= 48; x++) put(g, 'rail', x, 3);
    put(g, 'rail', 48, 4);
    put(g, 'rail_unload', 48, 5);
    const chest = put(g, 'storage', 48, 6) as Storage;
    put(g, 'wagon', 46, 3, 2);
    load.put('coal', 12);
    run(g, 20);
    expect(chest.items.coal).toBe(12);
  });

  it('un coffre ou un convoyeur collé alimente le quai de chargement', () => {
    const g = new GameState(21);
    const { load } = line(g);
    const src = put(g, 'storage', 43, 3) as Storage;
    src.put('silver', 6);
    run(g, 1);
    expect((load.items.silver ?? 0) + Object.values(g.wagons.list[0].cargo).reduce((a, b) => a + b, 0)).toBe(6);
    expect(src.items.silver ?? 0).toBe(0);
  });

  it('le joueur peut monter à bord, voyager puis descendre', () => {
    const g = new GameState(21);
    const { wagon } = line(g);
    run(g, 3); // le wagonnet attend au quai de chargement (x = 44)
    teleport(g, 44, 4);
    expect(g.nearestWagon()).toBe(wagon);
    g.rideWagon(wagon);
    run(g, 6); // avec un passager, il repart sans chargement
    expect(g.riding).toBe(wagon);
    expect(Math.abs(g.player.x - wagon.px())).toBeLessThan(1);
    expect(wagon.x).toBe(54);
    g.leaveWagon();
    expect(g.riding).toBe(null);
    expect(wagon.rider).toBe(false);
    const p = g.player;
    expect(g.isBlocked(p.x - p.halfW, p.y - p.halfH, p.x + p.halfW - 0.001, p.y + p.halfH - 0.001)).toBe(false);
    expect(Math.floor(p.x / TILE)).toBe(54);
  });

  it('démonter un wagonnet rend le kit et fait tomber son chargement', () => {
    const g = new GameState(21);
    const { wagon } = line(g);
    wagon.cargo = { copper: 4 };
    teleport(g, 49, 5);
    expect(g.removeAt(wagon.tileX(), wagon.tileY())).toBe(true);
    expect(g.wagons.list.length).toBe(0);
    expect(g.inventory.kitCount('wagon')).toBe(1);
    expect(g.drops.list.some((d) => d.res === 'copper' && d.count === 4)).toBe(true);
    expect(g.structures.at(49, 3)?.type).toBe('rail'); // la voie reste
  });

  it('se pose uniquement sur des rails', () => {
    const g = new GameState(21);
    g.inventory.addKit('wagon', 1);
    teleport(g, 49, 8);
    expect(g.canPlace('wagon', 47, 5).ok).toBe(false);
  });

  it('la sauvegarde conserve voie, quais, wagonnets, chargement et passager', () => {
    const g = new GameState(21);
    const { load, wagon } = line(g);
    load.put('copper', 8);
    run(g, 2.2);
    g.rideWagon(wagon);
    run(g, 0.3);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.wagons.list.length).toBe(1);
    const w2 = h.wagons.list[0];
    expect(w2.x).toBe(wagon.x);
    expect(w2.cargo).toEqual(wagon.cargo);
    expect(h.riding).toBe(w2);
    expect(h.structures.at(44, 3)?.type).toBe('rail_load');
    run(h, 20);
    expect((h.structures.at(55, 3) as Storage).items.copper).toBe(8);
  });

  it('fonctionne aussi dans la mine (puits jusqu’à la surface)', () => {
    const g = new GameState(21);
    const S = SURFACE_ROWS;
    teleport(g, 49, S + 3);
    g.inventory.addKit('rail_load', 1);
    g.inventory.addKit('rail', 20);
    g.inventory.addKit('rail_unload', 1);
    g.inventory.addKit('wagon', 1);
    const load = g.place('rail_load', 49, S + 8, 0) as RailStation;
    for (let y = S + 7; y >= S - 1; y--) g.place('rail', 49, y, 0);
    g.place('rail_unload', 49, S - 2, 0);
    g.place('wagon', 49, S + 3, 1);
    teleport(g, 48, 9);
    g.inventory.addKit('storage', 1);
    const chest = g.place('storage', 48, S - 2, 0) as Storage;
    load.put('iron', 15);
    run(g, 25);
    expect(chest.items.iron).toBe(15);
  });
});
