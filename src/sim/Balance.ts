/**
 * Outils d'équilibrage (aucune règle du jeu ne les lit) : combien de matières premières demandent les chantiers, combien en
 * contient une mine, et combien de temps les commandes imposent au minimum.
 *
 * Servent aux garde-fous de `tests/balance.test.ts` et au rapport `docs/BALANCE.md` (`npm run balance`) : quand on règle
 * `PHASES` / `PHASES_II`, on voit tout de suite si une phase demande plus de diamant qu'une mine n'en cache, ou si les clients
 * fidèles se font attendre derrière les commandes.
 */
import { getBlock } from '../data/blocks';
import type { PhaseSpec } from '../data/project';
import { getRecipe, hasRecipe } from '../data/recipes';
import { RESOURCES, getResource } from '../data/resources';
import { GameState } from './GameState';
import type { World } from './World';

/** Quantités par ressource. */
export type Amounts = Record<string, number>;

const add = (to: Amounts, res: string, n: number): void => {
  to[res] = (to[res] ?? 0) + n;
};

/**
 * Matières premières (minerais) qu'il faut extraire pour obtenir `qty` unités de `res` : un produit se fabrique à partir de
 * lingots (`RECIPES`), un lingot se fond depuis un minerai (`smeltsTo`, un pour un). Le charbon qui alimente les machines n'est pas compté.
 */
export function rawOf(res: string, qty: number, out: Amounts = {}): Amounts {
  if (hasRecipe(res)) {
    const r = getRecipe(res);
    for (const [input, n] of Object.entries(r.inputs)) rawOf(input, (n * qty) / r.yield, out);
    return out;
  }
  const ore = RESOURCES.find((r) => r.smeltsTo === res);
  if (ore) return rawOf(ore.id, qty, out);
  add(out, res, qty);
  return out;
}

/** Matières premières que réclament, au total, les phases données. */
export function rawNeeds(specs: readonly PhaseSpec[]): Amounts {
  const out: Amounts = {};
  for (const ph of specs) for (const n of ph.needs) rawOf(n.res, n.qty, out);
  return out;
}

/** Valeur marchande des matériaux d'une phase ($, au prix de base, sans le cours du jour). */
export function phaseValue(ph: PhaseSpec): number {
  return ph.needs.reduce((s, n) => s + getResource(n.res).value * n.qty, 0);
}

/** Ce qu'une mine contient : unités tirées des filons (blocs de minerai) et réserves des gisements, par minerai. */
export interface Supply {
  veins: Amounts;
  deposits: Amounts;
}

export function worldSupply(world: World): Supply {
  const veins: Amounts = {};
  const deposits: Amounts = {};
  for (let i = 0; i < world.tiles.length; i++) {
    const b = getBlock(world.tiles[i]);
    if (b?.kind === 'ore' && b.drop) add(veins, b.drop.res, (b.drop.min + b.drop.max) / 2);
    const d = world.deposit[i];
    if (d) add(deposits, RESOURCES[d - 1].id, world.reserve[i]);
  }
  return { veins, deposits };
}

/** Tout ce qu'on peut en tirer au plus, filons et gisements ensemble. */
export const supplyTotal = (s: Supply, res: string): number => (s.veins[res] ?? 0) + (s.deposits[res] ?? 0);

/** Jalon de la frise des commandes : temps de jeu (s) où l'on atteint tant de commandes honorées et de clients fidèles. */
export interface OrdersMilestone {
  contracts: number;
  faithful: number;
  /** Temps (s) ; null si le jalon n'est pas atteint dans la durée simulée. */
  at: number | null;
}

/**
 * Le temps que les commandes imposent au minimum, mesuré sur le vrai `Contracts` : un joueur qui accepte toutes les
 * propositions (celles de ses clients de confiance d'abord) et les livre `delay` secondes plus tard, avec `parallel` commandes en même temps au plus (les places du jeu
 * s'y ajoutent). Avec `delay` à 0, la production n'est jamais le goulot : on ne mesure que le rythme des clients.
 */
export function ordersTimeline(seed: number, targets: { contracts: number; faithful: number }[], delay: number, maxSeconds = 12 * 3600): OrdersMilestone[] {
  const g = new GameState(seed);
  for (const r of RESOURCES) g.stats.discovered.push(r.id);
  const done = targets.map((t): OrdersMilestone => ({ ...t, at: null }));
  const due = new Map<number, number>();
  const STEP = 5;
  for (let t = STEP; t <= maxSeconds; t += STEP) {
    g.time = t;
    g.contracts.update(t);
    // Un joueur choisit ses clients : il prend d'abord les propositions de ceux qui lui font le plus confiance.
    const offers = [...g.contracts.offers()].sort((a, b) => (g.contracts.reputation[b.client] ?? 0) - (g.contracts.reputation[a.client] ?? 0) || a.id - b.id);
    for (const o of offers) if (g.contracts.accept(o.id, t) === null) due.set(o.id, t + delay);
    for (const c of g.contracts.active()) {
      const at = due.get(c.id);
      if (at === undefined || at > t) continue;
      for (const l of c.lines) g.contracts.deliver(l.res, l.qty - l.done, c.id);
      due.delete(c.id);
    }
    for (const m of done) if (m.at === null && g.stats.contracts >= m.contracts && g.contracts.faithfulCount() >= m.faithful) m.at = t;
    if (done.every((m) => m.at !== null)) break;
  }
  return done;
}
