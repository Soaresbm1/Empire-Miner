/**
 * Banc de simulation : fait tourner une partie sans navigateur, au pas du jeu (1/60 s), et la mesure.
 *
 * Il ne change rien au jeu. Il observe la partie en enveloppant, sur **cette instance** de `GameState` seulement, les points
 * par lesquels passe chaque objet : extraction (`countExtracted`), fonte (`countSmelted`), fabrication (`countCrafted`), vente
 * (`production.addSale`, comptoir et caisses), livraison aux commandes ou au chantier (`deliver`), tas qui s'effritent
 * (`drops.update`). Ce que le banc ajoute lui-même (charbon, kits) est noté à part (`inject`). D'où un registre complet :
 *
 *   produit (extrait + fondu + fabriqué + ajouté) − consommé (vendu + fondu + utilisé + livré + effrité) = présent
 *
 * pour chaque ressource, où « présent » est la somme de ce que contiennent les structures, le sol, le sac, les ouvriers et
 * les wagonnets. Exception : le charbon, dont le réservoir des machines se mélange à leur contenu ; sa consommation est déduite.
 */
import { performance } from 'node:perf_hooks';
import { getRecipe } from '../../src/data/recipes';
import { RESOURCES } from '../../src/data/resources';
import { stateDigest } from '../../src/net/digest';
import { deserialize, serialize, type SaveData } from '../../src/save/save';
import { stateOf } from '../../src/sim/Flow';
import { GameState, NO_INTENT, type PlayerIntent } from '../../src/sim/GameState';

export const DT = 1 / 60;
export const STEPS_PER_SECOND = 60;
/** Ressource brûlée par les machines : son registre n'est pas vérifiable (voir l'en-tête). */
export const FUEL = 'coal';

export type Tally = Record<string, number>;
const add = (t: Tally, res: string, n: number): void => {
  if (n) t[res] = (t[res] ?? 0) + n;
};
const sum = (t: Tally): number => Object.values(t).reduce((a, b) => a + b, 0);

export interface Ledger {
  /** Minerai sorti par les machines (foreuses), et par la pioche du joueur. */
  extracted: Tally;
  mined: Tally;
  smelted: Tally;
  crafted: Tally;
  injected: Tally;
  sold: Tally;
  /** Matières transformées : minerai fondu, matières d'une recette. */
  used: Tally;
  delivered: Tally;
  crumbled: Tally;
  /** Argent des ventes (comptoir et caisses). */
  soldMoney: number;
}

export interface Sample {
  /** Temps de jeu (s). */
  t: number;
  money: number;
  soldMoney: number;
  extracted: number;
  sold: number;
  structures: number;
  /** Structures mesurées par état dominant (vue goulots). */
  busy: number;
  stuck: number;
  dry: number;
  /** Coût moyen d'un pas de simulation depuis l'échantillon précédent (ms). */
  msPerStep: number;
}

export interface RunOptions {
  intent?: PlayerIntent;
  /** Appelé toutes les `every` secondes de jeu (politique du joueur simulé, ravitaillement…). */
  every?: number;
  tick?: (b: Bench) => void;
  /** Échantillonnage des indicateurs (s de jeu ; 0 : jamais). */
  sampleEvery?: number;
}

export class Bench {
  readonly g: GameState;
  readonly ledger: Ledger = { extracted: {}, mined: {}, smelted: {}, crafted: {}, injected: {}, sold: {}, used: {}, delivered: {}, crumbled: {}, soldMoney: 0 };
  readonly samples: Sample[] = [];
  /** Nombre d'événements de la simulation, par type. */
  readonly events: Tally = {};
  steps = 0;
  /** Temps de calcul passé dans `g.update` (ms). */
  cpuMs = 0;
  /** Pas le plus long observé (ms). */
  worstStepMs = 0;
  private lastSample = { steps: 0, cpuMs: 0 };

  constructor(
    readonly seed: number,
    g?: GameState,
  ) {
    this.g = g ?? new GameState(seed);
    this.instrument();
  }

  /** Enveloppe les points de passage des objets (cette instance seulement). */
  private instrument(): void {
    const g = this.g;
    const L = this.ledger;
    // Toute extraction passe par `production.addOre` : `byMachine` distingue les machines (foreuses) du joueur (pioche).
    const ore = g.production.addOre.bind(g.production);
    g.production.addOre = (res, n, byMachine) => {
      add(byMachine ? L.extracted : L.mined, res, n);
      ore(res, n, byMachine);
    };
    const smelt = g.countSmelted.bind(g);
    g.countSmelted = (ingot, from) => {
      add(L.smelted, ingot, 1);
      const ore = RESOURCES.find((r) => r.smeltsTo === ingot);
      if (ore) add(L.used, ore.id, 1);
      smelt(ingot, from);
    };
    const craft = g.countCrafted.bind(g);
    g.countCrafted = (res, from) => {
      add(L.crafted, res, 1);
      const r = getRecipe(res);
      for (const [m, n] of Object.entries(r.inputs)) add(L.used, m, n / r.yield);
      craft(res, from);
    };
    const sale = g.production.addSale.bind(g.production);
    g.production.addSale = (items, total, viaCrate) => {
      for (const [res, n] of Object.entries(items)) add(L.sold, res, n);
      L.soldMoney += total;
      sale(items, total, viaCrate);
    };
    const deliver = g.deliver.bind(g);
    g.deliver = (mode, items, from) => {
      const rest = deliver(mode, items, from);
      for (const [res, n] of Object.entries(items)) add(L.delivered, res, n - (rest[res] ?? 0));
      return rest;
    };
    const crumble = g.drops.update.bind(g.drops);
    g.drops.update = (dt, world) => {
      const gone = crumble(dt, world);
      for (const d of gone) add(L.crumbled, d.res, d.count);
      return gone;
    };
  }

  /** Note ce que le banc ajoute à la partie (charbon dans une machine, objets dans le sac…). */
  inject(res: string, n: number): void {
    add(this.ledger.injected, res, n);
  }

  /** Ce qui se trouve dans la partie en ce moment : structures, sol, sacs, ouvriers, wagonnets. */
  present(): Tally {
    const g = this.g;
    const out: Tally = {};
    for (const s of g.structures.list) for (const [res, n] of Object.entries(s.contents())) add(out, res, n);
    for (const d of g.drops.list) add(out, d.res, d.count);
    for (const slot of g.presentSlots()) g.withSlot(slot, () => {
      for (const [res, n] of Object.entries(g.inventory.items)) add(out, res, n);
    });
    for (const w of g.workers.list) for (const [res, n] of Object.entries(w.cargo)) add(out, res, n);
    for (const w of g.wagons.list) for (const [res, n] of Object.entries(w.cargo)) add(out, res, n);
    return out;
  }

  /** Écarts du registre, par ressource (hors charbon) : vide si rien n'a été créé ni perdu. */
  conservation(): Tally {
    const L = this.ledger;
    const present = this.present();
    const all = new Set([...Object.keys(present), ...Object.values(L).flatMap((t) => (typeof t === 'number' ? [] : Object.keys(t)))]);
    const gaps: Tally = {};
    for (const res of all) {
      if (res === FUEL) continue;
      const made = (L.extracted[res] ?? 0) + (L.mined[res] ?? 0) + (L.smelted[res] ?? 0) + (L.crafted[res] ?? 0) + (L.injected[res] ?? 0);
      const gone = (L.sold[res] ?? 0) + (L.used[res] ?? 0) + (L.delivered[res] ?? 0) + (L.crumbled[res] ?? 0);
      const gap = made - gone - (present[res] ?? 0);
      if (Math.abs(gap) > 1e-9) gaps[res] = gap;
    }
    return gaps;
  }

  /** Charbon brûlé depuis le début : ajouté + extrait − vendu − livré − présent (le registre du combustible). */
  fuelBurned(): number {
    const L = this.ledger;
    return (L.injected[FUEL] ?? 0) + (L.extracted[FUEL] ?? 0) + (L.mined[FUEL] ?? 0) - (L.sold[FUEL] ?? 0) - (L.delivered[FUEL] ?? 0) - (L.crumbled[FUEL] ?? 0) - (this.present()[FUEL] ?? 0);
  }

  /** Fait avancer la partie de `seconds` secondes de jeu, au pas du jeu. */
  run(seconds: number, opts: RunOptions = {}): void {
    const g = this.g;
    const intent = opts.intent ?? NO_INTENT;
    const total = Math.round(seconds * STEPS_PER_SECOND);
    const tickSteps = opts.every ? Math.max(1, Math.round(opts.every * STEPS_PER_SECOND)) : 0;
    const sampleSteps = opts.sampleEvery ? Math.max(1, Math.round(opts.sampleEvery * STEPS_PER_SECOND)) : 0;
    for (let i = 0; i < total; i++) {
      if (tickSteps && i % tickSteps === 0) opts.tick?.(this);
      const t0 = performance.now();
      g.update(DT, intent);
      const ms = performance.now() - t0;
      this.cpuMs += ms;
      if (ms > this.worstStepMs) this.worstStepMs = ms;
      this.steps++;
      if (g.events.length) {
        for (const e of g.events) add(this.events, e.t, 1);
        g.events.length = 0;
      }
      if (sampleSteps && this.steps % sampleSteps === 0) this.sample();
    }
  }

  /** Relève les indicateurs maintenant. */
  sample(): Sample {
    const g = this.g;
    const states = { busy: 0, stuck: 0, dry: 0 };
    for (const s of g.structures.list) {
      const st = stateOf(s);
      if (st) states[st]++;
    }
    const steps = this.steps - this.lastSample.steps;
    const s: Sample = {
      t: round(g.time, 2),
      money: g.money,
      soldMoney: this.ledger.soldMoney,
      extracted: sum(this.ledger.extracted),
      sold: sum(this.ledger.sold),
      structures: g.structures.list.length,
      ...states,
      msPerStep: steps ? round((this.cpuMs - this.lastSample.cpuMs) / steps, 4) : 0,
    };
    this.lastSample = { steps: this.steps, cpuMs: this.cpuMs };
    this.samples.push(s);
    return s;
  }

  /** Pas de simulation par seconde de calcul, depuis le début. */
  stepsPerSecond(): number {
    return this.cpuMs ? Math.round((this.steps / this.cpuMs) * 1000) : 0;
  }
}

/** Empreinte de la partie (celle que comparent les deux appareils du jeu à deux). */
export const digest = (g: GameState): number => stateDigest(g);

/** Sauvegarde telle qu'elle serait écrite (passage par JSON), sans l'heure d'écriture. */
export function saveOf(g: GameState): Omit<SaveData, 'savedAt'> {
  const { savedAt: _savedAt, ...rest } = JSON.parse(JSON.stringify(serialize(g))) as SaveData;
  return rest;
}

/** Recharge une partie depuis sa sauvegarde, comme le navigateur ou une resynchronisation du jeu à deux. */
export function reload(g: GameState): GameState {
  return deserialize(JSON.parse(JSON.stringify(serialize(g))) as SaveData);
}

export function round(v: number, digits = 1): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
