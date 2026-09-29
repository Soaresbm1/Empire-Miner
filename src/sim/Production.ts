/**
 * Statistiques de production : ce que la mine extrait, fond et vend, minute après minute.
 *
 * Le temps de simulation est découpé en créneaux de 10 s, gardés pendant 10 minutes. Les débits
 * affichés sont des moyennes sur les 5 dernières minutes, l'histogramme des gains montre les
 * 10 dernières minutes, une barre par minute glissante.
 */
export const SLOT_SECONDS = 10;
/** Créneaux gardés : 10 minutes. */
export const SLOT_COUNT = 60;
/** Créneaux d'une minute, et de la fenêtre des débits (5 minutes). */
export const SLOTS_PER_MINUTE = 6;
export const RATE_SLOTS = 30;
/** Nombre de barres de l'histogramme des gains. */
export const GAIN_MINUTES = SLOT_COUNT / SLOTS_PER_MINUTE;

/** Quantités par ressource. */
export type Tally = Record<string, number>;

interface Slot {
  /** Numéro du créneau (temps de simulation / 10 s). */
  i: number;
  /** Minerai sorti de la roche (à la main ou par une machine). */
  ore: Tally;
  /** Part de ce minerai extraite par des machines (foreuses à charbon, foreuse de percement). */
  machineOre: number;
  /** Lingots sortis des fours et fonderies. */
  ingots: Tally;
  /** Ressources vendues, au comptoir ou par les caisses d'expédition. */
  sold: Tally;
  /** Argent des ventes au comptoir et des caisses d'expédition. */
  counter: number;
  crate: number;
}

export type SlotSave = { i: number; o: Tally; m: number; g: Tally; s: Tally; c: number; a: number };

/** Débits moyens par minute. */
export interface Rates {
  ore: Tally;
  machineOre: number;
  ingots: Tally;
  sold: Tally;
  counter: number;
  crate: number;
  /** Minutes réellement couvertes par la moyenne (5 au plus). */
  minutes: number;
}

/** Gains d'une minute glissante. */
export interface MinuteGain {
  counter: number;
  crate: number;
}

const emptySlot = (i: number): Slot => ({ i, ore: {}, machineOre: 0, ingots: {}, sold: {}, counter: 0, crate: 0 });

function add(t: Tally, res: string, n: number): void {
  t[res] = (t[res] ?? 0) + n;
}

function merge(into: Tally, from: Tally, scale = 1): void {
  for (const [res, n] of Object.entries(from)) add(into, res, n * scale);
}

export class ProductionLog {
  private slots: Slot[] = [];

  /** `clock` donne le temps de simulation (s). */
  constructor(private readonly clock: () => number) {}

  private get index(): number {
    return Math.floor(this.clock() / SLOT_SECONDS);
  }

  /** Créneau en cours (créé au besoin) ; les créneaux de plus de 10 minutes sont oubliés. */
  private current(): Slot {
    const i = this.index;
    let s = this.slots[this.slots.length - 1];
    if (!s || s.i !== i) {
      s = emptySlot(i);
      this.slots.push(s);
      while (this.slots.length && this.slots[0].i <= i - SLOT_COUNT) this.slots.shift();
    }
    return s;
  }

  /** Minerai sorti de la roche : `byMachine` pour une foreuse, sinon à la main. */
  addOre(res: string, n: number, byMachine: boolean): void {
    if (n <= 0) return;
    const s = this.current();
    add(s.ore, res, n);
    if (byMachine) s.machineOre += n;
  }

  addIngot(res: string, n = 1): void {
    add(this.current().ingots, res, n);
  }

  /** Une vente : ce qui est parti (`items`) et l'argent obtenu, au comptoir ou par une caisse. */
  addSale(items: Tally, total: number, viaCrate: boolean): void {
    const s = this.current();
    merge(s.sold, items);
    if (viaCrate) s.crate += total;
    else s.counter += total;
  }

  /** Créneaux de la fenêtre [first, index]. */
  private since(first: number): Slot[] {
    return this.slots.filter((s) => s.i >= first);
  }

  /** Débits moyens par minute sur les 5 dernières minutes (au moins 30 s de recul, pour ne pas s'emballer au début). */
  rates(): Rates {
    const now = this.clock();
    const first = Math.max(0, this.index - RATE_SLOTS + 1);
    const minutes = Math.max(30, now - first * SLOT_SECONDS) / 60;
    const r: Rates = { ore: {}, machineOre: 0, ingots: {}, sold: {}, counter: 0, crate: 0, minutes };
    for (const s of this.since(first)) {
      merge(r.ore, s.ore, 1 / minutes);
      merge(r.ingots, s.ingots, 1 / minutes);
      merge(r.sold, s.sold, 1 / minutes);
      r.machineOre += s.machineOre / minutes;
      r.counter += s.counter / minutes;
      r.crate += s.crate / minutes;
    }
    return r;
  }

  /** Gains des 10 dernières minutes, de la plus ancienne à la plus récente (la dernière barre finit maintenant). */
  gains(): MinuteGain[] {
    const cur = this.index;
    const out: MinuteGain[] = Array.from({ length: GAIN_MINUTES }, () => ({ counter: 0, crate: 0 }));
    for (const s of this.slots) {
      const age = cur - s.i;
      if (age < 0 || age >= SLOT_COUNT) continue;
      const bar = GAIN_MINUTES - 1 - Math.floor(age / SLOTS_PER_MINUTE);
      out[bar].counter += s.counter;
      out[bar].crate += s.crate;
    }
    return out;
  }

  serialize(): SlotSave[] {
    return this.slots.map((s) => ({ i: s.i, o: { ...s.ore }, m: s.machineOre, g: { ...s.ingots }, s: { ...s.sold }, c: s.counter, a: s.crate }));
  }

  load(data: SlotSave[] | undefined): void {
    this.slots = [];
    if (!Array.isArray(data)) return;
    for (const d of data) {
      if (!d || !Number.isFinite(d.i)) continue;
      this.slots.push({ i: d.i, ore: { ...d.o }, machineOre: Number(d.m) || 0, ingots: { ...d.g }, sold: { ...d.s }, counter: Number(d.c) || 0, crate: Number(d.a) || 0 });
    }
    this.slots.sort((a, b) => a.i - b.i);
  }
}
