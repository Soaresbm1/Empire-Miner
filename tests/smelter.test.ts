import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { getMachine } from '../src/data/machines';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { OBJECTIVES } from '../src/sim/objectives';
import { GameState } from '../src/sim/GameState';
import { Smelter } from '../src/sim/structures/Smelter';
import type { Storage } from '../src/sim/structures/Storage';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ : x de 46 à 53, y de S+13 à S+15.
const Y = S + 14;
const FURNACE = getMachine('furnace').smelter!;
const FOUNDRY = getMachine('foundry').smelter!;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

function onGround(g: GameState, res: string): number {
  return g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);
}

describe('four et fonderie', () => {
  it('le four fond le minerai en lingots au charbon, un toutes les 3 s', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y) as Smelter;
    expect(f.addOre('copper', 5)).toBe(5);
    f.addFuel(1);
    run(g, FURNACE.smeltTime * 2 + 0.1);
    expect(f.output).toEqual(['copper_ingot', 'copper_ingot']);
    expect(f.input.length).toBe(3);
    expect(f.status).toBe('ok');
    expect(g.stats.smelted).toBe(2);
  });

  it('sans charbon, rien ne fond ; le charbon ne brûle que pendant la fonte', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y) as Smelter;
    f.addOre('iron', 2);
    run(g, 5);
    expect(f.status).toBe('nofuel');
    expect(f.output.length).toBe(0);
    f.addFuel(1);
    run(g, FURNACE.smeltTime * 2 + 1);
    expect(f.output).toEqual(['iron_ingot', 'iron_ingot']);
    expect(f.status).toBe('idle');
    const left = f.fuelSeconds();
    run(g, 10); // plus de minerai : la réserve ne bouge plus
    expect(f.fuelSeconds()).toBeCloseTo(left, 5);
    expect(left).toBeCloseTo(getMachine('furnace').fuel!.secondsPerUnit - 2 * FURNACE.smeltTime, 0);
  });

  it('chaîne complète : coffre → convoyeur → four → coffre de lingots ; le charbon voyage avec le minerai', () => {
    const g = new GameState(4);
    const src = put(g, 'storage', 48, Y) as Storage;
    put(g, 'conveyor', 49, Y, 0);
    const f = put(g, 'furnace', 50, Y, 0) as Smelter;
    const out = put(g, 'storage', 51, Y) as Storage;
    src.put('copper', 6);
    src.put('coal', 2);
    run(g, 40);
    expect(out.items.copper_ingot).toBe(6);
    expect(f.smelted).toBe(6);
    expect(out.items.coal ?? 0).toBe(0); // le charbon est resté dans le four
    expect(src.items.copper ?? 0).toBe(0);
  });

  it('le minerai n’entre pas par la sortie ; la pierre est refusée, le charbon entre de partout', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y, 0) as Smelter; // sortie vers l'est
    expect(f.canAccept('copper', 2)).toBe(false); // arrive de l'est, en sens inverse de la flèche
    expect(f.canAccept('copper', 0)).toBe(true);
    expect(f.canAccept('copper', 1)).toBe(true);
    expect(f.canAccept('stone', 0)).toBe(false);
    expect(f.canAccept('coal', 2)).toBe(true);
    expect(f.canAccept('copper_ingot', 0)).toBe(false);
  });

  it('sortie saturée : le four s’arrête sans brûler son charbon', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y) as Smelter;
    f.addFuel(3);
    f.addOre('copper', FURNACE.inputMax);
    run(g, FURNACE.smeltTime * FURNACE.outputMax + 5);
    expect(f.output.length).toBe(FURNACE.outputMax);
    f.addOre('copper', 3); // du minerai attend, mais plus de place pour les lingots
    run(g, 1);
    expect(f.status).toBe('full');
    const left = f.fuelSeconds();
    run(g, 10);
    expect(f.fuelSeconds()).toBeCloseTo(left, 5);
  });

  it('la fonderie occupe 2×2 cases, va 6 fois plus vite et sert ses deux cases de sortie', () => {
    const g = new GameState(4);
    const d = put(g, 'foundry', 50, S + 13, 0) as Smelter; // cases (50..51, S+13..S+14), sortie vers l'est
    for (const [x, y] of [[50, S + 13], [51, S + 13], [50, S + 14], [51, S + 14]]) expect(g.structures.at(x, y)).toBe(d);
    expect(FURNACE.smeltTime / FOUNDRY.smeltTime).toBe(6);
    const a = put(g, 'storage', 52, S + 13) as Storage;
    const b = put(g, 'storage', 52, S + 14) as Storage;
    d.addFuel(2);
    d.addOre('gold', 10);
    run(g, 10 * FOUNDRY.smeltTime + 1);
    expect(d.smelted).toBe(10);
    expect(a.items.gold_ingot).toBe(5);
    expect(b.items.gold_ingot).toBe(5);
  });

  it('à la main : charbon et minerai du sac, lingots récupérés dans le sac', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y) as Smelter;
    teleport(g, 49, Y);
    g.inventory.add('coal', 3);
    g.inventory.add('copper', 2);
    g.inventory.add('stone', 2);
    expect(g.fuelSmelter(f)).toBe(3);
    expect(g.smelterDeposit(f)).toBe(2);
    expect(g.inventory.count('stone')).toBe(2); // la pierre ne se fond pas
    run(g, 2 * FURNACE.smeltTime + 0.5);
    expect(g.smelterCollect(f)).toBe(2);
    expect(g.inventory.count('copper_ingot')).toBe(2);
    expect(f.output.length).toBe(0);
  });

  it('un lingot se vend 2,5 fois le prix de son minerai au comptoir', () => {
    const g = new GameState(4);
    for (const ore of ['copper', 'iron', 'silver', 'gold']) {
      const ingot = getResource(ore).smeltsTo!;
      const ratio = getResource(ingot).value / getResource(ore).value;
      expect(ratio).toBeGreaterThanOrEqual(2.5);
      expect(ratio).toBeLessThan(2.6);
      expect(getResource(ingot).ingot).toBe(true);
    }
    goTo(g, 'counter');
    g.inventory.add('iron_ingot', 3);
    const before = g.money;
    expect(g.sell('iron_ingot', 3)).toBe(3 * getResource('iron_ingot').value);
    expect(g.money - before).toBe(120);
  });

  it('premier lingot : découverte ; 10 lingots valident l’objectif du four', () => {
    const g = new GameState(4);
    const f = put(g, 'furnace', 50, Y) as Smelter;
    f.addFuel(5);
    f.addOre('copper', 10);
    run(g, FURNACE.smeltTime + 0.1);
    expect(g.stats.discovered).toContain('copper_ingot');
    expect(g.events.some((e) => e.t === 'discover' && e.text.includes('lingot de cuivre'))).toBe(true);
    run(g, 10 * FURNACE.smeltTime);
    expect(g.stats.smelted).toBe(10);
    const smelt = OBJECTIVES.find((o) => o.id === 'smelt')!;
    expect(smelt.done(g)).toBe(true);
    expect(OBJECTIVES.indexOf(smelt)).toBe(OBJECTIVES.findIndex((o) => o.id === 'ship') + 1); // il vient après la vente automatique
  });

  it('est sauvegardé avec son minerai, ses lingots et son charbon ; démonté, tout tombe au sol', () => {
    const g = new GameState(4);
    const f = put(g, 'foundry', 50, S + 13, 1) as Smelter;
    f.addFuel(4);
    f.addOre('silver', 7);
    run(g, 2 * FOUNDRY.smeltTime + 0.1);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hf = h.structures.at(51, S + 14) as Smelter;
    expect(hf).toBeInstanceOf(Smelter);
    expect(hf.type).toBe('foundry');
    expect(hf.dir).toBe(1);
    expect(hf.input).toEqual(f.input);
    expect(hf.output).toEqual(f.output);
    expect(hf.fuelUnits).toBe(f.fuelUnits);
    expect(h.stats.smelted).toBe(g.stats.smelted);
    teleport(h, 49, S + 14);
    expect(h.removeAt(51, S + 14)).toBe(true);
    expect(h.inventory.kitCount('foundry')).toBe(1);
    expect(onGround(h, 'silver') + onGround(h, 'silver_ingot')).toBe(7);
    expect(onGround(h, 'coal')).toBe(hf.fuelUnits);
    expect(h.drops.list.every((d) => Math.floor(d.x / TILE) === 50)).toBe(true);
  });
});
