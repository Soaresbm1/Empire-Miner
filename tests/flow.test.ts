/**
 * Rendement des lignes : le compteur de débit, sa lecture sur de vraies chaînes (foreuse, four, convoyeur, coffre) et la
 * couleur de la vue « goulots ». Ces chiffres sont de l'affichage : on vérifie aussi qu'ils ne touchent pas à la partie.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT, SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { RESOURCES, resourceIndex } from '../src/data/resources';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { FLOW_BUCKETS, FLOW_MIN, FLOW_WINDOW, Flow, saturated, stateOf, toneOf } from '../src/sim/Flow';
import { GameState, NO_INTENT } from '../src/sim/GameState';
import { Bridge } from '../src/sim/structures/Bridge';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import type { Crafter } from '../src/sim/structures/Crafter';
import type { Drill } from '../src/sim/structures/Drill';
import type { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import type { Smelter } from '../src/sim/structures/Smelter';
import type { Splitter } from '../src/sim/structures/Splitter';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
/** D'où l'on pose ce qui est au camp, à la surface. */
const SURFACE: [number, number] = [49, 9];
// Salle du fond de la mine de départ : x de 46 à 53, y de S+13 à S+15.
const Y = S + 14;

/** Pose une structure en se plaçant à portée : dans le fond de la mine (par défaut) ou, avec `from`, ailleurs. */
function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0, from: [number, number] = [47, S + 15]) {
  g.inventory.addKit(kit, 1);
  teleport(g, from[0], from[1]);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

/** Avance le compteur de `seconds` s dans l'état `state`, au pas de la simulation. */
function spend(f: Flow, seconds: number, state: 'busy' | 'stuck' | 'dry', perSecond = 0): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    f.tick(SIM_DT, state);
    if (perSecond && i % Math.round(1 / (SIM_DT * perSecond)) === 0) f.add();
  }
}

describe('compteur de débit', () => {
  it('ne dit rien tant qu’il manque de recul, puis donne des objets par minute', () => {
    const f = new Flow();
    expect(f.known).toBe(false);
    expect(f.perMinute()).toBeNull();
    expect(f.inPerMinute()).toBeNull();
    expect(f.share('busy')).toBeNull();
    expect(f.dominant()).toBeNull();
    spend(f, FLOW_MIN - 1, 'busy', 1);
    expect(f.perMinute()).toBeNull();
    spend(f, 2, 'busy', 1);
    expect(f.known).toBe(true);
    // Un objet par seconde = 60 par minute.
    expect(f.perMinute()!).toBeGreaterThan(55);
    expect(f.perMinute()!).toBeLessThan(65);
  });

  it('compte à part ce qui entre et ce qui sort', () => {
    const f = new Flow();
    spend(f, 30, 'busy');
    for (let i = 0; i < 10; i++) f.add();
    for (let i = 0; i < 4; i++) f.addIn(2);
    expect(f.out).toBe(10);
    expect(f.in).toBe(8);
    expect(f.perMinute()!).toBeCloseTo(20, 5);
    expect(f.inPerMinute()!).toBeCloseTo(16, 5);
  });

  it('ne garde que la dernière minute : les anciens objets sortent de l’anneau', () => {
    const f = new Flow();
    spend(f, 20, 'busy');
    for (let i = 0; i < 100; i++) f.add();
    expect(f.out).toBe(100);
    spend(f, FLOW_WINDOW + 1, 'busy');
    expect(f.out).toBe(0);
    expect(f.seconds).toBeLessThanOrEqual(FLOW_WINDOW + 1e-6);
    expect(f.seconds).toBeGreaterThan(FLOW_WINDOW - FLOW_WINDOW / FLOW_BUCKETS - 1e-6);
  });

  it('répartit le temps entre en marche, bloqué et à sec, et nomme celui qui domine', () => {
    const f = new Flow();
    spend(f, 12, 'busy');
    spend(f, 6, 'stuck');
    spend(f, 2, 'dry');
    expect(f.share('busy')!).toBeCloseTo(0.6, 2);
    expect(f.share('stuck')!).toBeCloseTo(0.3, 2);
    expect(f.share('dry')!).toBeCloseTo(0.1, 2);
    expect(f.dominant()).toBe('busy');
    spend(f, 30, 'stuck');
    expect(f.dominant()).toBe('stuck');
    // Le blocage passe avant le manque, et le manque avant la marche, quand les parts sont proches.
    const mixed = new Flow();
    spend(mixed, 10, 'busy');
    spend(mixed, 11, 'dry');
    expect(mixed.dominant()).toBe('dry');
    spend(mixed, 12, 'stuck');
    expect(mixed.dominant()).toBe('stuck');
  });

  it('accepte un grand pas de temps (une seule fois plusieurs tranches)', () => {
    const f = new Flow();
    f.tick(23, 'busy');
    expect(f.seconds).toBeCloseTo(23, 6);
    f.tick(100, 'dry');
    expect(f.seconds).toBeLessThanOrEqual(FLOW_WINDOW + 1e-6);
    expect(f.dominant()).toBe('dry');
  });

  it('deux compteurs qui reçoivent les mêmes pas donnent exactement les mêmes chiffres', () => {
    const a = new Flow();
    const b = new Flow();
    for (const f of [a, b])
      for (let i = 0; i < 60 * 200; i++) {
        f.tick(SIM_DT, i % 400 < 250 ? 'busy' : i % 400 < 330 ? 'stuck' : 'dry');
        if (i % 37 === 0) f.add();
        if (i % 53 === 0) f.addIn(2);
      }
    expect(a.perMinute()).toBe(b.perMinute());
    expect(a.inPerMinute()).toBe(b.inPerMinute());
    expect(a.share('stuck')).toBe(b.share('stuck'));
    expect(a.dominant()).toBe(b.dominant());
  });
});

describe('débits mesurés sur une chaîne', () => {
  /** Coffre de départ (minerai et charbon) → convoyeur → four → coffre de lingots : le four fond 20 lingots par minute. */
  function furnaceLine(ore: number, coal: number) {
    const g = new GameState(4);
    const src = put(g, 'storage', 48, Y) as Storage;
    const belt = put(g, 'conveyor', 49, Y, 0) as Conveyor;
    const furnace = put(g, 'furnace', 50, Y, 0) as Smelter;
    const out = put(g, 'storage', 51, Y) as Storage;
    // Le charbon d'abord : le coffre est limité en poids, et le minerai prendrait toute la place.
    if (coal) src.put('coal', coal);
    if (ore) src.put('copper', ore);
    teleport(g, 45, S + 15);
    return { g, src, belt, furnace, out };
  }

  it('un four saturé : 20 lingots par minute, la file derrière lui bloquée, lui-même le goulot', () => {
    const { g, src, belt, furnace, out } = furnaceLine(50, 6);
    run(g, 100);
    // Le four fond un minerai toutes les 3 s : 20 par minute, ni plus ni moins.
    expect(furnace.flow.perMinute()!).toBeGreaterThan(18);
    expect(furnace.flow.perMinute()!).toBeLessThan(22);
    expect(furnace.maxPerMinute()).toBeCloseTo(20, 5);
    expect(furnace.flow.share('busy')!).toBeGreaterThan(0.9);
    expect(out.flow.inPerMinute()!).toBeGreaterThan(17);
    expect(src.flow.perMinute()!).toBeGreaterThan(17);
    // Le convoyeur porte la même chose que le four fond, et il attend presque tout le temps.
    expect(belt.flow.perMinute()!).toBeGreaterThan(17);
    expect(belt.flow.share('stuck')!).toBeGreaterThan(0.5);
    expect(stateOf(belt)).toBe('stuck');
    expect(toneOf(belt)).toBe('bad');
    expect(toneOf(furnace)).toBe('good');
    expect(furnace.backedUp()).toBe(true); // sa file d’attente est pleine : c’est lui qui limite
  });

  it('un four sans minerai est « à sec », sans charbon il est « bloqué »', () => {
    const dry = furnaceLine(0, 4);
    run(dry.g, 30);
    expect(dry.furnace.status).toBe('idle');
    expect(stateOf(dry.furnace)).toBe('dry');
    expect(toneOf(dry.furnace)).toBe('warn');
    const cold = furnaceLine(40, 0);
    run(cold.g, 30);
    expect(cold.furnace.status).toBe('nofuel');
    expect(stateOf(cold.furnace)).toBe('stuck');
    expect(toneOf(cold.furnace)).toBe('bad');
  });

  it('un convoyeur vide ne dit rien, un coffre qui ne sert pas non plus', () => {
    const { g, belt, src, out } = furnaceLine(0, 0);
    run(g, 30);
    expect(belt.items.length).toBe(0);
    expect(toneOf(belt)).toBe('none');
    expect(toneOf(src)).toBe('none');
    expect(toneOf(out)).toBe('none');
    expect(belt.flow.perMinute()).toBe(0);
  });

  it('un convoyeur peu chargé reste vert tant que quelque chose passe, même s’il est souvent vide', () => {
    const g = new GameState(4);
    const belt = put(g, 'conveyor', 48, Y, 0) as Conveyor;
    put(g, 'storage', 49, Y);
    teleport(g, 45, S + 15);
    // Un objet toutes les 6 s : dix par minute, et le convoyeur est vide la plupart du temps.
    for (let i = 0; i < 60 * 90; i++) {
      if (i % 360 === 0) belt.accept('copper', 0);
      g.update(SIM_DT, NO_INTENT);
    }
    expect(belt.flow.perMinute()!).toBeGreaterThan(8);
    expect(belt.flow.share('dry')!).toBeGreaterThan(0.5);
    expect(stateOf(belt)).toBe('dry');
    expect(toneOf(belt)).toBe('good');
  });

  it('un convoyeur qui porte tout ce qu’il peut est ambre : il est à pleine charge', () => {
    const g = new GameState(9);
    teleport(g, 50, 8);
    g.inventory.addKit('conveyor', 1);
    g.inventory.addKit('shipping', 1);
    const belt = g.place('conveyor', 51, 9, 0) as Conveyor;
    g.place('shipping', 52, 9, 0);
    teleport(g, 50, S + 10); // le joueur est au fond de la mine, la caisse vend sans lui
    for (let i = 0; i < 60 * 90; i++) {
      belt.accept('coal', 0); // autant qu'il en prend
      g.update(SIM_DT, NO_INTENT);
    }
    expect(belt.flow.perMinute()!).toBeGreaterThan(belt.maxPerMinute() * 0.85);
    expect(saturated(belt)).toBe(true);
    expect(stateOf(belt)).not.toBe('stuck');
    expect(toneOf(belt)).toBe('warn');
  });

  it('la Manufacture : ses produits par minute sur son maximum, saturée par ses lingots', () => {
    const g = new GameState(9);
    const src = put(g, 'storage', 47, S + 13) as Storage;
    put(g, 'conveyor', 48, S + 13, 0);
    const crafter = put(g, 'crafter', 49, S + 13, 0) as Crafter;
    put(g, 'conveyor', 51, S + 13, 0);
    const out = put(g, 'storage', 52, S + 13) as Storage;
    g.stats.discovered.push('iron_ingot');
    g.setCrafterRecipe(crafter, 'steel');
    crafter.addFuel(10);
    src.put('iron_ingot', 40);
    run(g, 30);
    expect(crafter.backedUp()).toBe(true); // les lingots arrivent plus vite qu'elle ne les emploie
    run(g, 40);
    // L'acier : 2 lingots, 4 s : 15 par minute.
    expect(crafter.maxPerMinute()).toBeCloseTo(15, 5);
    expect(crafter.flow.perMinute()!).toBeGreaterThan(13);
    expect(crafter.flow.perMinute()!).toBeLessThan(17);
    expect(out.flow.inPerMinute()!).toBeGreaterThan(12);
    expect(stateOf(crafter)).toBe('busy');
    expect(toneOf(crafter)).toBe('good');
    // Sans recette, elle attend (à sec, ambre) ; sans charbon, elle est bloquée (rouge).
    g.setCrafterRecipe(crafter, null);
    expect(crafter.maxPerMinute()).toBeNull();
    run(g, 30);
    expect(stateOf(crafter)).toBe('dry');
    expect(toneOf(crafter)).toBe('warn');
    g.setCrafterRecipe(crafter, 'steel');
    crafter.addInput('iron_ingot', 6); // de quoi travailler, mais plus de charbon
    crafter.fuelUnits = 0;
    crafter.burn = 0;
    run(g, 40);
    expect(crafter.status).toBe('nofuel');
    expect(toneOf(crafter)).toBe('bad');
  });

  it('un séparateur et un pont comptent ce qu’ils font passer', () => {
    const g = new GameState(11);
    // Surface : convoyeur → séparateur → trois sorties ; et deux ponts l'un derrière l'autre.
    const src = put(g, 'conveyor', 44, 4, 0, SURFACE) as Conveyor;
    const splitter = put(g, 'splitter', 45, 4, 0, SURFACE) as Splitter;
    put(g, 'conveyor', 46, 4, 0, SURFACE);
    put(g, 'storage', 47, 4, 0, SURFACE);
    put(g, 'conveyor', 45, 3, 3, SURFACE);
    put(g, 'storage', 45, 2, 0, SURFACE);
    put(g, 'conveyor', 45, 5, 1, SURFACE);
    put(g, 'storage', 45, 6, 0, SURFACE);
    const inBridge = put(g, 'bridge', 50, 4, 0, SURFACE) as Bridge;
    const outBridge = put(g, 'bridge', 53, 4, 0, SURFACE) as Bridge;
    put(g, 'storage', 54, 4, 0, SURFACE);
    const feeder = put(g, 'conveyor', 49, 4, 0, SURFACE) as Conveyor;
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 90 === 0) {
        src.accept('copper', 0);
        feeder.accept('copper', 0);
      }
      g.update(SIM_DT, NO_INTENT);
    }
    expect(inBridge.target).toBe(outBridge);
    // Un objet toutes les 1,5 s : 40 par minute à chaque entrée.
    expect(splitter.flow.perMinute()!).toBeGreaterThan(30);
    expect(inBridge.flow.perMinute()!).toBeGreaterThan(30);
    expect(outBridge.flow.perMinute()!).toBeGreaterThan(30);
    expect(splitter.maxPerMinute()).toBeCloseTo(540, 5);
    expect(outBridge.maxPerMinute()).toBeCloseTo(540, 5);
  });

  it('une foreuse sur un gisement : sa cadence, et son convoyeur porte la même chose', () => {
    const g = new GameState(9);
    g.world.setDeposit(47, Y, resourceIndex('copper'), 5000);
    g.world.set(47, Y, 0);
    const drill = put(g, 'drill', 47, Y, 0) as Drill;
    const belt = put(g, 'conveyor', 48, Y, 0) as Conveyor;
    const out = put(g, 'storage', 49, Y) as Storage;
    g.inventory.add('coal', 12);
    g.fuelDrill(drill);
    run(g, 90);
    const max = drill.def.stats.speed * 60;
    expect(drill.maxPerMinute()).toBeCloseTo(max, 5);
    expect(drill.flow.perMinute()!).toBeGreaterThan(max * 0.85);
    expect(drill.flow.perMinute()!).toBeLessThanOrEqual(max * 1.1);
    expect(belt.flow.perMinute()!).toBeGreaterThan(max * 0.8);
    expect(out.flow.inPerMinute()!).toBeGreaterThan(max * 0.8);
    expect(toneOf(drill)).toBe('good');
    expect(toneOf(belt)).toBe('good');
    // Une file qui ne porte même pas le dixième de sa charge n’est pas « à pleine charge ».
    expect(saturated(belt)).toBe(false);
  });

  it('une foreuse dont la sortie est pleine passe au rouge', () => {
    const g = new GameState(9);
    g.world.setDeposit(47, Y, resourceIndex('copper'), 5000);
    g.world.set(47, Y, 0);
    const drill = put(g, 'drill', 47, Y, 0) as Drill; // rien devant elle : sa sortie se remplit
    g.inventory.add('coal', 12);
    g.fuelDrill(drill);
    run(g, 120);
    expect(drill.status).toBe('full');
    expect(stateOf(drill)).toBe('stuck');
    expect(toneOf(drill)).toBe('bad');
  });

  it('un coffre plein est rouge', () => {
    const { g, out } = furnaceLine(0, 0);
    for (const r of RESOURCES) out.put(r.id, 999);
    run(g, 30);
    expect(out.full).toBe(true);
    expect(toneOf(out)).toBe('bad');
  });

  it('une caisse d’expédition pleine est rouge, et le convoyeur qui l’alimente aussi', () => {
    const g = new GameState(9);
    const belt = put(g, 'conveyor', 51, 9, 0, [50, 8]) as Conveyor;
    const crate = put(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    crate.timer = 1e9; // le transporteur ne passe pas
    teleport(g, 50, S + 10);
    for (let i = 0; i < 60 * 60; i++) {
      belt.accept('iron', 0);
      g.update(SIM_DT, NO_INTENT);
    }
    expect(crate.full).toBe(true);
    expect(stateOf(crate)).toBe('stuck');
    expect(toneOf(crate)).toBe('bad');
    expect(toneOf(belt)).toBe('bad');
    expect(crate.flow.inPerMinute()!).toBeLessThan(belt.maxPerMinute());
  });

  it('une caisse qui reçoit et vend normalement est verte', () => {
    const g = new GameState(9);
    const belt = put(g, 'conveyor', 51, 9, 0, [50, 8]) as Conveyor;
    const crate = put(g, 'shipping', 52, 9, 0, [50, 8]) as ShippingCrate;
    teleport(g, 50, S + 10);
    for (let i = 0; i < 60 * 70; i++) {
      if (i % 120 === 0) belt.accept('copper', 0); // 30 par minute : le transporteur suffit
      g.update(SIM_DT, NO_INTENT);
    }
    expect(crate.full).toBe(false);
    expect(crate.flow.inPerMinute()!).toBeGreaterThan(25);
    expect(toneOf(crate)).toBe('good');
  });

  it('les structures qu’on ne mesure pas n’ont pas de débit', () => {
    const g = new GameState(4);
    for (const s of g.structures.list) expect(s.flowState()).toBeNull(); // les bâtiments du camp
    for (const s of g.structures.list) expect(toneOf(s)).toBe('none');
  });
});

describe('la mesure n’influence pas la partie', () => {
  function scene(seed: number) {
    const g = new GameState(seed);
    const src = put(g, 'storage', 48, Y) as Storage;
    put(g, 'conveyor', 49, Y, 0);
    (put(g, 'furnace', 50, Y, 0) as Smelter).addFuel(8);
    put(g, 'storage', 51, Y);
    src.put('copper', 50);
    teleport(g, 45, S + 15);
    return g;
  }

  it('ni la sauvegarde ni l’empreinte ne contiennent les débits', () => {
    const g = scene(4);
    run(g, 40);
    const text = JSON.stringify(serialize(g));
    expect(text).not.toMatch(/perMinute|"flow"|meter|cells/);
  });

  it('une partie rechargée repart avec des compteurs vides mais la même partie, et reste identique', () => {
    const a = scene(4);
    run(a, 40);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(a))));
    expect(stateDigest(b)).toBe(stateDigest(a));
    const furnaceA = a.structures.at(50, Y)!;
    const furnaceB = b.structures.at(50, Y)!;
    expect(furnaceA.flow.known).toBe(true);
    expect(furnaceB.flow.known).toBe(false); // les compteurs se remplissent à nouveau
    for (let i = 0; i < 60 * 30; i++) {
      a.update(SIM_DT, NO_INTENT);
      b.update(SIM_DT, NO_INTENT);
    }
    expect(stateDigest(b)).toBe(stateDigest(a));
    expect(furnaceB.flow.known).toBe(true);
  });

  it('deux copies de la même partie mesurent exactement les mêmes débits', () => {
    const a = scene(4);
    const b = scene(4);
    run(a, 70);
    run(b, 70);
    for (const s of a.structures.list) {
      const o = b.structures.at(s.x, s.y)!;
      expect(s.flowState()).toBe(o.flowState());
      expect(s.flow.perMinute()).toBe(o.flow.perMinute());
      expect(s.flow.inPerMinute()).toBe(o.flow.inPerMinute());
      expect(s.flow.dominant()).toBe(o.flow.dominant());
    }
  });
});
