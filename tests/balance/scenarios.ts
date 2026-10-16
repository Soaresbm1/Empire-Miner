/**
 * Scénarios du banc : des usines construites avec les vraies règles de pose (`GameState.place`, kits, portée), sur la carte
 * de départ régénérée depuis la graine. Seuls deux raccourcis, les mêmes que les tests : le joueur est déplacé d'un coup
 * (`teleport`) pour poser, et le gisement de la ligne est posé à la main (`setDeposit`) pour choisir son minerai et sa réserve.
 */
import { SURFACE_ROWS, TILE } from '../../src/core/constants';
import type { Dir } from '../../src/core/dir';
import { AIR } from '../../src/data/blocks';
import { getMachine } from '../../src/data/machines';
import { getResource, resourceIndex } from '../../src/data/resources';
import type { GameState } from '../../src/sim/GameState';
import { Wagon } from '../../src/sim/Wagons';
import type { Drill } from '../../src/sim/structures/Drill';
import type { ShippingCrate } from '../../src/sim/structures/ShippingCrate';
import type { Smelter } from '../../src/sim/structures/Smelter';
import type { Structure } from '../../src/sim/structures/Structure';
import { Bench, round } from './harness';

const S = SURFACE_ROWS;

export function teleport(g: GameState, tx: number, ty: number): void {
  g.player.x = (tx + 0.5) * TILE;
  g.player.y = (ty + 0.5) * TILE;
}

/** Pose une machine depuis la case `from` (portée de construction), en achetant son kit ; échoue en disant pourquoi. */
export function build(g: GameState, id: string, tx: number, ty: number, dir: Dir, from: [number, number]): Structure {
  g.inventory.addKit(id, 1);
  teleport(g, from[0], from[1]);
  const s = g.place(id, tx, ty, dir);
  if (!s) throw new Error(`${id} en ${tx},${ty} : ${g.canPlace(id, tx, ty).reason ?? 'refusé'}`);
  if (s instanceof Wagon) throw new Error(`${id} : un wagonnet n'est pas une structure fixe`);
  return s;
}

/** Machine qui brûle du combustible (foreuse, four, Manufacture…), vue par ce qu'en lisent les ravitailleurs. */
type Burner = Structure & { fuelUnits: number; fuelMax: number; addFuel(n: number): number };
const isBurner = (s: Structure): s is Burner => 'addFuel' in s && 'fuelMax' in s && 'fuelUnits' in s;

/**
 * Politique de ravitaillement d'un joueur attentif : toute machine à moitié vide est remplie. Le charbon ajouté est noté
 * dans le registre (il a un coût : on aurait pu le vendre).
 */
export function refuel(b: Bench): void {
  for (const s of b.g.structures.list) {
    if (!isBurner(s) || s.fuelUnits > s.fuelMax / 2) continue;
    const n = s.addFuel(s.fuelMax - s.fuelUnits);
    if (n) b.inject('coal', n);
  }
}

export type Chain = 'raw' | 'smelt';

export interface LineSpec {
  ore: string;
  chain: Chain;
  /** Réserve du gisement (unités). */
  reserve?: number;
  seed?: number;
}

export interface Line {
  bench: Bench;
  spec: LineSpec;
  drill: Drill;
  furnace: Smelter | null;
  crate: ShippingCrate;
  /** Prix d'achat de toutes les machines de la ligne ($). */
  investment: number;
}

/**
 * Ligne de référence (celle de tests/shipping.test.ts) : un gisement au bout de la galerie est de la mine de départ, une
 * foreuse, des convoyeurs jusqu'au puits, puis le long du puits jusqu'à une caisse d'expédition en surface, qui vend au cours
 * du marché. Variante `smelt` : un four remplace le convoyeur derrière la foreuse (le minerai sort en lingots).
 */
export function referenceLine(spec: LineSpec): Line {
  const bench = new Bench(spec.seed ?? 11);
  const g = bench.g;
  const y = S + 10;
  let investment = 0;
  const put = (id: string, tx: number, ty: number, dir: Dir, from: [number, number]): Structure => {
    investment += getMachine(id).price;
    return build(g, id, tx, ty, dir, from);
  };
  g.world.set(59, y, AIR);
  g.world.setDeposit(59, y, resourceIndex(spec.ore), spec.reserve ?? 60_000);
  const drill = put('drill', 59, y, 2, [57, y + 1]) as Drill;
  let furnace: Smelter | null = null;
  for (let x = 58; x >= 51; x--) {
    if (spec.chain === 'smelt' && x === 57) furnace = put('furnace', x, y, 2, [55, y + 1]) as Smelter;
    else put('conveyor', x, y, 2, [55, y + 1]);
  }
  for (let yy = y; yy >= S - 1; yy--) put('conveyor', 50, yy, 3, [49, Math.min(yy + 2, y)]);
  const crate = put('shipping', 50, S - 2, 0, [48, S - 2]) as ShippingCrate;
  teleport(g, 45, S + 5); // le joueur s'éloigne : la ligne tourne seule
  refuel(bench);
  return { bench, spec, drill, furnace, crate, investment };
}

export interface LineEconomics {
  ore: string;
  chain: Chain;
  /** Minerai extrait par minute. */
  extractedPerMin: number;
  /** Argent des ventes par minute, au cours du marché. */
  incomePerMin: number;
  /** Même chose au prix de base (sans les variations du marché). */
  baseIncomePerMin: number;
  /** Charbon brûlé par minute, et sa valeur au prix de base (ce qu'on aurait pu vendre). */
  coalPerMin: number;
  coalCostPerMin: number;
  /** Gain net par minute, au prix de base, charbon déduit. */
  netPerMin: number;
  investment: number;
  /** Minutes pour rembourser les machines (null : jamais). */
  paybackMin: number | null;
  /** Part du temps où la foreuse a travaillé sur la dernière minute (vue goulots). */
  drillBusy: number | null;
}

/** Fait tourner une ligne : `warmup` s de mise en route, puis `window` s de mesure. */
export function measureLine(line: Line, warmup = 120, window = 1200): LineEconomics {
  const b = line.bench;
  b.run(warmup, { every: 5, tick: refuel });
  const before = snapshot(b);
  b.run(window, { every: 5, tick: refuel, sampleEvery: 60 });
  const after = snapshot(b);
  const min = window / 60;
  const per = (k: keyof ReturnType<typeof snapshot>) => (after[k] - before[k]) / min;
  const coal = getResource('coal').value;
  const extractedPerMin = per('extracted');
  const baseIncomePerMin = per('baseSold');
  const coalPerMin = per('coal');
  const netPerMin = baseIncomePerMin - coalPerMin * coal;
  return {
    ore: line.spec.ore,
    chain: line.spec.chain,
    extractedPerMin: round(extractedPerMin, 2),
    incomePerMin: round(per('money'), 1),
    baseIncomePerMin: round(baseIncomePerMin, 1),
    coalPerMin: round(coalPerMin, 2),
    coalCostPerMin: round(coalPerMin * coal, 1),
    netPerMin: round(netPerMin, 1),
    investment: line.investment,
    paybackMin: netPerMin > 0 ? round(line.investment / netPerMin, 1) : null,
    drillBusy: line.drill.flow.share('busy'),
  };
}

function snapshot(b: Bench): { extracted: number; money: number; baseSold: number; coal: number } {
  const L = b.ledger;
  return {
    extracted: Object.values(L.extracted).reduce((a, n) => a + n, 0),
    money: L.soldMoney,
    baseSold: Object.entries(L.sold).reduce((a, [res, n]) => a + n * getResource(res).value, 0),
    coal: b.fuelBurned(),
  };
}

/**
 * Usine chargée, pour mesurer la vitesse : une salle creusée sous la mine de départ, remplie de `rows` lignes foreuse →
 * convoyeurs → coffre. Les coffres finissent par se remplir : la suite de la mesure porte sur une usine bloquée, ce qui est
 * aussi un cas réel.
 */
export function crowdedFactory(rows: number, seed = 11): Bench {
  const b = new Bench(seed);
  const g = b.g;
  const top = S + 40;
  for (let r = 0; r < rows; r++) {
    const y = top + r * 2;
    for (let x = 4; x <= 95; x++) {
      g.world.set(x, y, AIR);
      g.world.set(x, y + 1, AIR);
      g.world.explored[g.world.idx(x, y)] = 1;
      g.world.explored[g.world.idx(x, y + 1)] = 1;
    }
    for (let seg = 0; seg < 6; seg++) {
      const x0 = 5 + seg * 15;
      g.world.setDeposit(x0, y, resourceIndex(['copper', 'iron', 'coal'][(r + seg) % 3]), 5000);
      build(g, 'drill', x0, y, 0, [x0 + 2, y + 1]);
      for (let x = x0 + 1; x <= x0 + 11; x++) build(g, 'conveyor', x, y, 0, [x0 + 6, y + 1]);
      build(g, 'storage', x0 + 12, y, 0, [x0 + 10, y + 1]);
    }
  }
  teleport(g, 45, S + 5);
  refuel(b);
  return b;
}
