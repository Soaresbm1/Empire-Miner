import { describe, expect, it } from 'vitest';
import { LEGACY_WORLD_H, SURFACE_ROWS, WORLD_H, depthAt, rowForDepth } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { AIR, BEDROCK, HOST_ROCK_IDS, ORE_BLOCK, RUBBLE, getBlock } from '../src/data/blocks';
import { HEAT } from '../src/data/hazards';
import { resourceIndex } from '../src/data/resources';
import { rleDecode, rleEncode } from '../src/save/codec';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { generateWorld } from '../src/sim/generator';
import { OBJECTIVES } from '../src/sim/objectives';
import type { Smelter } from '../src/sim/structures/Smelter';
import { run, teleport, timeToBreak } from './helpers';

const S = SURFACE_ROWS;

/** Ouvre une galerie horizontale (x0 à x1) sur la rangée y et y place le joueur. */
function gallery(g: GameState, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    g.world.set(x, y, AIR);
    g.world.setExplored(x, y);
  }
  teleport(g, Math.round((x0 + x1) / 2), y);
}

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, x - 2, y);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

describe('Fournaise : la mine descend jusqu’à 600 m', () => {
  it('la dernière rangée praticable passe les 600 m, au-dessus du socle', () => {
    const { world } = generateWorld(5);
    expect(world.h).toBe(WORLD_H);
    expect(depthAt(world.h - 2)).toBeGreaterThanOrEqual(600);
    for (let x = 0; x < world.w; x++) expect(world.get(x, world.h - 1)).toBe(BEDROCK);
  });

  it('les blocs et les minerais déjà sauvegardés gardent leur identifiant', () => {
    expect(HOST_ROCK_IDS.slice(0, 3)).toEqual([4, 5, 6]);
    expect(['coal', 'copper', 'iron', 'silver', 'gold'].map((r) => ORE_BLOCK[r])).toEqual([7, 8, 9, 10, 11]);
    expect(RUBBLE).toBe(12);
    expect(getBlock(HOST_ROCK_IDS[3]).key).toBe('volcanic');
    expect(ORE_BLOCK.diamond).toBeGreaterThan(RUBBLE);
    expect(['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'diamond'].map(resourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('les rangées d’avant la Fournaise sont générées comme avant', () => {
    for (const seed of [4, 1234]) {
      const before = generateWorld(seed, 100, LEGACY_WORLD_H).world;
      const now = generateWorld(seed, 100, WORLD_H).world;
      let tiles = 0;
      let pockets = 0;
      let deposits = 0;
      for (let y = S; y < LEGACY_WORLD_H - 1; y++)
        for (let x = 0; x < before.w; x++) {
          const i = before.idx(x, y);
          const a = getBlock(before.tiles[i]);
          const b = getBlock(now.tiles[i]);
          // Seule la teinte de la roche peut changer, à la lisière de la roche volcanique.
          if (a.id !== b.id && !(a.kind === 'rock' && b.kind === 'rock' && depthAt(y) >= HEAT.minDepth - 12)) tiles++;
          if (before.pocket[i] !== now.pocket[i]) pockets++;
          if (y < LEGACY_WORLD_H - 3 && before.deposit[i] !== now.deposit[i]) deposits++;
        }
      expect({ seed, tiles, pockets, deposits }).toEqual({ seed, tiles: 0, pockets: 0, deposits: 0 });
    }
  });

  it('roche volcanique, plus d’or, et des diamants seulement sous 500 m', () => {
    const { world } = generateWorld(7);
    let volcanic = 0;
    let diamonds = 0;
    const gold = { mid: 0, midRock: 0, deep: 0, deepRock: 0 };
    for (let y = S; y < world.h - 1; y++)
      for (let x = 1; x < world.w - 1; x++) {
        const b = getBlock(world.get(x, y));
        const d = depthAt(y);
        if (b.key === 'volcanic') {
          volcanic++;
          expect(d).toBeGreaterThanOrEqual(HEAT.minDepth - 12);
        }
        if (b.id === ORE_BLOCK.diamond) {
          diamonds++;
          expect(d).toBeGreaterThanOrEqual(497);
        }
        const band = d >= 300 && d < 440 ? 'mid' : d >= HEAT.minDepth ? 'deep' : null;
        if (!band || b.kind === 'air') continue;
        gold[`${band}Rock`]++;
        if (b.id === ORE_BLOCK.gold) gold[band]++;
      }
    expect(volcanic).toBeGreaterThan(1000);
    expect(diamonds).toBeGreaterThan(5);
    // L'or est plus dense dans la Fournaise qu'au-dessus.
    expect(gold.deep / gold.deepRock).toBeGreaterThan(gold.mid / gold.midRock);
  });

  it('une ancienne sauvegarde (carte de 190 rangées) s’agrandit par le bas', () => {
    const g = new GameState(4);
    const w = g.world.w;
    // Le joueur a creusé tout au fond de l'ancienne mine, sur un gisement d'or.
    const y = LEGACY_WORLD_H - 3;
    g.world.set(30, y, AIR);
    g.world.setExplored(30, y);
    g.world.setDeposit(30, y, resourceIndex('gold'), 150);
    g.money = 1234;
    const data = JSON.parse(JSON.stringify(serialize(g)));
    // Réécrit la carte comme avant la Fournaise : 190 rangées, la dernière en socle.
    const cut = (rle: string, last: number) => {
      const a = rleDecode(rle, w * g.world.h).slice(0, w * LEGACY_WORLD_H);
      a.fill(last, w * (LEGACY_WORLD_H - 1));
      return rleEncode(a);
    };
    data.world.h = LEGACY_WORLD_H;
    data.world.tiles = cut(data.world.tiles, BEDROCK);
    data.world.deposit = cut(data.world.deposit, 0);
    data.world.explored = cut(data.world.explored, 1);
    data.hazards.dug = cut(data.hazards.dug, 0);
    data.world.reserves = data.world.reserves.filter(([i]: [number, number]) => i < w * (LEGACY_WORLD_H - 1));

    const h = deserialize(data);
    expect(h.world.h).toBe(WORLD_H);
    expect(h.money).toBe(1234);
    expect(h.world.get(30, y)).toBe(AIR);
    expect(h.world.depositAt(30, y)).toBe('gold');
    expect(h.world.reserve[h.world.idx(30, y)]).toBe(150);
    // L'ancien socle laisse place au terrain neuf, et la Fournaise est là, gisements compris.
    const fresh = new GameState(4).world;
    let diff = 0;
    for (let yy = LEGACY_WORLD_H - 1; yy < WORLD_H; yy++)
      for (let x = 0; x < w; x++) {
        const i = fresh.idx(x, yy);
        if (h.world.tiles[i] !== fresh.tiles[i] || h.world.deposit[i] !== fresh.deposit[i] || h.world.reserve[i] !== fresh.reserve[i]) diff++;
      }
    expect(diff).toBe(0);
    expect(h.world.get(50, LEGACY_WORLD_H - 1)).not.toBe(BEDROCK);
    // Elle se sauvegarde ensuite à la nouvelle taille.
    expect(deserialize(JSON.parse(JSON.stringify(serialize(h)))).world.h).toBe(WORLD_H);
  });

  it('seule la pioche pro en acier taille un filon de diamant', () => {
    const g = new GameState(4);
    const y = rowForDepth(520);
    gallery(g, 20, 24, y);
    g.world.set(25, y, ORE_BLOCK.diamond);
    teleport(g, 24, y);
    g.pickaxeLevel = 2; // pioche en fer
    expect(timeToBreak(g, 25, y, 4)).toBeGreaterThanOrEqual(4);
    expect(g.world.get(25, y)).toBe(ORE_BLOCK.diamond);
    g.pickaxeLevel = 3; // pioche pro
    expect(timeToBreak(g, 25, y, 20)).toBeLessThan(20);
    run(g, 1.5, { mx: 1, my: 0, mine: false, target: null });
    expect(g.inventory.count('diamond')).toBeGreaterThan(0);
    expect(OBJECTIVES.find((o) => o.id === 'diamond')!.done(g)).toBe(true);
  });
});

describe('chaleur de la Fournaise', () => {
  it('température et cadence selon la profondeur', () => {
    const g = new GameState(4);
    const hz = g.hazards;
    const above = rowForDepth(HEAT.minDepth) - 1;
    expect(hz.temperature(above)).toBe(null);
    expect(hz.heatFactor(10, above)).toBe(1);
    expect(hz.temperature(rowForDepth(HEAT.minDepth))).toBe(HEAT.tempTop);
    expect(hz.heatFactor(10, rowForDepth(HEAT.minDepth))).toBeCloseTo(HEAT.factorTop);
    expect(hz.temperature(rowForDepth(600))).toBe(HEAT.tempBottom);
    expect(hz.heatFactor(10, rowForDepth(600))).toBeCloseTo(HEAT.factorBottom);
  });

  it('ralentit un four, sauf à portée d’un ventilateur', () => {
    const g = new GameState(4);
    const y = rowForDepth(525);
    gallery(g, 10, 30, y);
    const hot = put(g, 'furnace', 12, y) as Smelter;
    const cool = put(g, 'furnace', 26, y) as Smelter;
    put(g, 'fan', 29, y);
    for (const f of [hot, cool]) {
      f.addOre('gold', 20);
      f.addFuel(5);
    }
    run(g, 30);
    expect(g.hazards.heatFactor(hot.x, hot.y)).toBeLessThan(0.75);
    expect(cool.heat).toBe(1);
    expect(hot.heat).toBeCloseTo(g.hazards.heatFactor(hot.x, hot.y));
    expect(cool.smelted).toBeGreaterThanOrEqual(9);
    expect(hot.smelted).toBeLessThan(cool.smelted * 0.8);
    expect(hot.smelted).toBeGreaterThan(cool.smelted * 0.5);
  });

  it('ralentit une foreuse posée dans la Fournaise', () => {
    const g = new GameState(4);
    const y = rowForDepth(560);
    gallery(g, 10, 20, y);
    g.world.setDeposit(12, y, resourceIndex('gold'), 300);
    const d = put(g, 'drill', 12, y);
    (d as unknown as { fuelUnits: number }).fuelUnits = 5;
    run(g, 1);
    expect((d as unknown as { heat: number }).heat).toBeCloseTo(g.hazards.heatFactor(12, y));
    expect((d as unknown as { heat: number }).heat).toBeLessThan(0.7);
  });
});
