/**
 * Cours du marché : le prix de vente de chaque minerai (et de son lingot) monte et descend au fil de la partie.
 *
 * - Chaque minerai a un cours, multiplicateur de son prix de base. Il dérive doucement autour de 100 % : marche
 *   aléatoire qui revient vers la moyenne, un pas toutes les 10 s.
 * - De temps en temps, un événement fait monter (« forte demande de cuivre ») ou chuter (« surproduction de
 *   charbon ») le cours d'un minerai que le joueur connaît, pendant quelques minutes.
 * - Un lingot suit le cours de son minerai ; la pierre ne s'échange pas (son prix ne bouge pas).
 * - Le comptoir et les caisses d'expédition vendent au cours du moment : on peut stocker dans un coffre et attendre.
 *
 * Les tirages viennent d'un hash (graine, pas, minerai), donc il n'y a pas d'état aléatoire à sauvegarder : la partie
 * sauvegardée reprend exactement où elle en était.
 */
import { hash2 } from '../core/rng';
import { MARKET } from '../data/market';
import { RESOURCES, getResource } from '../data/resources';

/** Minerais qui s'échangent : tout sauf la pierre et les lingots. */
export const COMMODITIES: readonly string[] = RESOURCES.filter((r) => !r.ingot && r.id !== 'stone').map((r) => r.id);

/** Pour chaque ressource, le minerai dont elle suit le cours (un lingot suit son minerai). */
const FOLLOWS = new Map<string, string>(COMMODITIES.map((id) => [id, id]));
for (const r of RESOURCES) if (r.smeltsTo) FOLLOWS.set(r.smeltsTo, r.id);

/** Minerai dont une ressource suit le cours (null : la pierre, qui ne s'échange pas). */
export function commodityOf(res: string): string | null {
  return FOLLOWS.get(res) ?? null;
}

/** Lingot d'un minerai, s'il en a un. */
export function ingotOf(ore: string): string | null {
  return RESOURCES.find((r) => r.id === ore)?.smeltsTo ?? null;
}

/** Un événement du marché : le cours d'un minerai monte (amp > 0) ou chute (amp < 0), puis revient. */
export interface MarketEvent {
  /** Numéro de l'événement (pour ses tirages). */
  n: number;
  res: string;
  /** Pas de départ. */
  start: number;
  /** Durée de la montée, du palier et du retour, en pas. */
  rise: number;
  hold: number;
  fall: number;
  /** Variation au palier, en logarithme du cours. */
  amp: number;
}

/** Un événement en cours, tel que l'interface l'affiche. */
export interface ActiveEvent {
  res: string;
  /** Vrai pour une forte demande (le cours monte), faux pour une surproduction. */
  up: boolean;
  /** Variation du cours au palier, en pourcents (+45 ou −30). */
  pct: number;
  /** Secondes de jeu avant la fin de l'événement. */
  left: number;
}

export interface MarketSave {
  /** Pas écoulés. */
  k: number;
  /** Écart de chaque minerai à son prix de base (logarithme), hors événements. */
  x: Record<string, number>;
  /** Derniers cours de chaque minerai, du plus ancien au plus récent. */
  h: Record<string, number[]>;
  e: MarketEvent[];
  /** Pas du prochain événement, et nombre d'événements déjà tirés. */
  next: number;
  n: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const LOG_MIN = Math.log(MARKET.min);
const LOG_MAX = Math.log(MARKET.max);
const seconds = (s: number) => Math.max(1, Math.round(s / MARKET.step));

/** Effet d'un événement sur le logarithme du cours, au pas `k` : montée, palier, retour. */
function effect(e: MarketEvent, k: number): number {
  const age = k - e.start;
  if (age < 0) return 0;
  if (age < e.rise) return e.amp * (age / e.rise);
  if (age < e.rise + e.hold) return e.amp;
  const out = age - e.rise - e.hold;
  return out < e.fall ? e.amp * (1 - out / e.fall) : 0;
}

const endOf = (e: MarketEvent) => e.start + e.rise + e.hold + e.fall;

export class Market {
  /** Pas écoulés depuis le début de la partie. */
  step = 0;
  events: MarketEvent[] = [];
  private readonly x: Record<string, number> = {};
  private readonly now: Record<string, number> = {};
  private readonly past: Record<string, number[]> = {};
  private nextEvent = 0;
  private eventCount = 0;

  /**
   * `known(res)` : le joueur connaît-il ce minerai ? Seuls ceux-là font l'objet d'événements.
   * `announce(e)` est appelé quand un nouvel événement commence.
   */
  constructor(
    private readonly seed: number,
    private readonly known: (res: string) => boolean,
    private readonly announce: (e: ActiveEvent) => void = () => {},
  ) {
    this.reset(0);
  }

  /** Cours à 100 %, courbe réduite au pas de départ, premier événement dans quelques minutes. */
  private reset(step: number): void {
    this.step = step;
    this.events = [];
    this.eventCount = 0;
    for (const id of COMMODITIES) {
      this.x[id] = 0;
      this.now[id] = 1;
      this.past[id] = [1];
    }
    const t = hash2(step, 77, this.seed ^ 0x2545f491);
    this.nextEvent = step + seconds(lerp(MARKET.events.first[0], MARKET.events.first[1], t));
  }

  // ------------------------------------------------------------------ lecture

  /** Cours d'une ressource (multiplicateur de son prix de base ; 1 pour la pierre). */
  mult(res: string): number {
    const c = commodityOf(res);
    return c ? this.now[c] : 1;
  }

  /** Prix de vente d'une unité au cours du moment (non arrondi). */
  price(res: string): number {
    return getResource(res).value * this.mult(res);
  }

  /** Ce que rapportent `n` unités au cours du moment ($, arrondi). */
  quote(res: string, n = 1): number {
    return Math.round(this.price(res) * n + 1e-9);
  }

  /** Tendance sur les 30 dernières secondes : 1 en hausse, −1 en baisse, 0 stable. */
  trend(res: string): -1 | 0 | 1 {
    const c = commodityOf(res);
    if (!c) return 0;
    const h = this.past[c];
    const r = h[h.length - 1] / h[Math.max(0, h.length - 4)] - 1;
    return r > MARKET.trendStep ? 1 : r < -MARKET.trendStep ? -1 : 0;
  }

  /** Derniers cours d'un minerai (jusqu'à 10 minutes), du plus ancien au plus récent. */
  history(res: string): number[] {
    const c = commodityOf(res);
    return c ? [...this.past[c]] : [];
  }

  /** Événements en cours. */
  active(): ActiveEvent[] {
    return this.events.map((e) => ({
      res: e.res,
      up: e.amp > 0,
      pct: Math.round((Math.exp(e.amp) - 1) * 100),
      left: Math.max(0, (endOf(e) - this.step) * MARKET.step),
    }));
  }

  // ------------------------------------------------------------------ évolution

  /** Fait avancer le marché jusqu'au temps de jeu `time` (s). */
  update(time: number): void {
    const target = Math.floor(time / MARKET.step);
    while (this.step < target) this.advance();
  }

  private advance(): void {
    const k = ++this.step;
    // Tant que le calme du début dure, tout reste à 100 %.
    const live = k * MARKET.step > MARKET.quiet;
    if (live) {
      COMMODITIES.forEach((id, i) => {
        const x = this.x[id] + MARKET.pull * (MARKET.drift - this.x[id]) + MARKET.noise * this.gauss(k, i);
        this.x[id] = clamp(x, LOG_MIN, LOG_MAX);
      });
      this.runEvents(k);
    }
    this.settle();
  }

  /** Tirage proche d'une loi normale réduite (somme de trois tirages uniformes). */
  private gauss(k: number, i: number): number {
    const u = (j: number) => hash2(k * 3 + j, i, this.seed ^ 0x6a09e667);
    return (u(0) + u(1) + u(2) - 1.5) * 2;
  }

  private runEvents(k: number): void {
    const ev = MARKET.events;
    this.events = this.events.filter((e) => k < endOf(e));
    if (k < this.nextEvent || this.events.length >= ev.maxActive) return;
    const free = COMMODITIES.filter((id) => this.known(id) && !this.events.some((e) => e.res === id));
    if (!free.length) {
      // Rien d'intéressant à annoncer pour l'instant : on réessaie bientôt.
      this.nextEvent = k + 3;
      return;
    }
    const n = this.eventCount++;
    const r = (j: number) => hash2(k, 1000 + n * 8 + j, this.seed ^ 0x3a7f9c15);
    const demand = r(1) < ev.demandChance;
    const [lo, hi] = demand ? ev.demand : ev.glut;
    const e: MarketEvent = {
      n,
      res: free[Math.floor(r(0) * free.length)],
      start: k,
      rise: seconds(ev.rise),
      hold: seconds(lerp(ev.hold[0], ev.hold[1], r(2))),
      fall: seconds(ev.fall),
      amp: round3(lerp(lo, hi, r(3))),
    };
    this.events.push(e);
    this.nextEvent = k + seconds(lerp(ev.gap[0], ev.gap[1], r(4)));
    this.announce({ res: e.res, up: e.amp > 0, pct: Math.round((Math.exp(e.amp) - 1) * 100), left: (endOf(e) - k) * MARKET.step });
  }

  /** Recalcule le cours de chaque minerai (dérive et événements) et l'ajoute à la courbe. */
  private settle(): void {
    for (const id of COMMODITIES) {
      let e = 0;
      for (const ev of this.events) if (ev.res === id) e += effect(ev, this.step);
      const v = clamp(Math.exp(this.x[id] + e), MARKET.min, MARKET.max);
      this.now[id] = v;
      const h = this.past[id];
      h.push(round3(v));
      if (h.length > MARKET.history) h.shift();
    }
  }

  // ------------------------------------------------------------------ sauvegarde

  serialize(): MarketSave {
    const x: Record<string, number> = {};
    const h: Record<string, number[]> = {};
    for (const id of COMMODITIES) {
      x[id] = this.x[id];
      h[id] = [...this.past[id]];
    }
    return { k: this.step, x, h, e: this.events.map((e) => ({ ...e })), next: this.nextEvent, n: this.eventCount };
  }

  /**
   * Recharge un marché sauvegardé ; les valeurs aberrantes sont ignorées. Sans données (ancienne sauvegarde), le
   * marché repart à 100 % au pas qui correspond au temps de jeu `time`, sans rejouer le passé.
   */
  load(data: MarketSave | undefined, time: number): void {
    const now = Math.floor(Math.max(0, time) / MARKET.step);
    this.reset(now);
    if (data && typeof data === 'object') this.restore(data, now);
    // La courbe reprend au pas où l'on s'est arrêté : son dernier point est recalculé, pas ajouté deux fois.
    for (const id of COMMODITIES) this.past[id].pop();
    this.settle();
  }

  private restore(data: MarketSave, now: number): void {
    const int = (v: unknown, lo: number, hi: number, fallback: number) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
    };
    this.step = int(data.k, 0, now + 1, now);
    this.eventCount = int(data.n, 0, 1e6, 0);
    this.nextEvent = int(data.next, 0, this.step + 10000, this.nextEvent);
    for (const id of COMMODITIES) {
      const x = Number(data.x?.[id]);
      this.x[id] = Number.isFinite(x) ? clamp(x, LOG_MIN, LOG_MAX) : 0;
      const hist = data.h?.[id];
      if (Array.isArray(hist)) {
        const clean = hist.map(Number).filter((v) => Number.isFinite(v) && v >= MARKET.min && v <= MARKET.max);
        if (clean.length) this.past[id] = clean.slice(-MARKET.history).map(round3);
      }
    }
    const list = Array.isArray(data.e) ? data.e : [];
    for (const e of list) {
      if (!e || !COMMODITIES.includes(e.res)) continue;
      const amp = Number(e.amp);
      const ok = Number.isFinite(amp) && Math.abs(amp) <= 1;
      const rise = int(e.rise, 1, 60, 0);
      const hold = int(e.hold, 0, 60, -1);
      const fall = int(e.fall, 1, 60, 0);
      const start = int(e.start, 0, this.step, -1);
      if (!ok || !rise || hold < 0 || !fall || start < 0 || this.events.some((o) => o.res === e.res)) continue;
      const ev: MarketEvent = { n: int(e.n, 0, 1e6, 0), res: e.res, start, rise, hold, fall, amp };
      if (this.step < endOf(ev)) this.events.push(ev);
    }
    this.events = this.events.slice(0, MARKET.events.maxActive);
  }
}
