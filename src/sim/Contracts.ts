/**
 * Commandes : des clients proposent d'acheter une quantité précise de minerai ou de lingots, avec une prime sur le prix de
 * base, à livrer avant une échéance.
 *
 * - Toutes les minutes environ, un client laisse une proposition au Tableau d'affichage. Elle reste affichée quelques minutes.
 * - Le joueur en accepte quelques-unes à la fois (le chantier en ajoute) : l'échéance court alors, 10 à 15 minutes.
 * - On livre à la main au Tableau d'affichage, ou par une caisse d'expédition réglée sur « Commandes ». Dès que tout est livré,
 *   la récompense (fixée à la proposition) est versée. À l'échéance, ou si l'on abandonne, le client paie seulement ce qui
 *   est livré, au prix de base : rien n'est perdu, seule la prime l'est.
 * - Ce que les clients demandent suit le joueur (seulement ce qu'il connaît) et le marché : une marchandise en forte demande
 *   est demandée plus souvent, avec une prime plus grosse.
 *
 * Les tirages viennent d'un hash (graine, numéro de la proposition) : pas d'état aléatoire à sauvegarder, et les deux
 * téléphones d'une partie à deux voient exactement les mêmes propositions.
 */
import { hash2 } from '../core/rng';
import { CLIENTS, CONTRACTS, GOODS, rankOf, type GoodSpec } from '../data/contracts';
import { getResource } from '../data/resources';
import { commodityOf, type Market } from './Market';

export interface ContractLine {
  res: string;
  qty: number;
  done: number;
}

export interface Contract {
  /** Numéro unique, croissant. */
  id: number;
  /** Indice du client dans `CLIENTS`. */
  client: number;
  lines: ContractLine[];
  /** Paiement à la livraison complète ($), fixé à la proposition. */
  reward: number;
  /** Prime sur le prix de base (0,4 = +40 %). */
  premium: number;
  /** Une forte demande avait lieu sur l'une des marchandises quand la proposition est arrivée. */
  hot: boolean;
  /** Délai accordé à l'acceptation (s de jeu). */
  limit: number;
  /** Proposition : temps de jeu où elle disparaît. Commande acceptée : temps de jeu de l'échéance. */
  until: number;
  accepted: boolean;
}

export type Outcome = 'done' | 'late' | 'abandoned';

/** Ce que les commandes demandent à la partie. */
export interface ContractsHost {
  /** Le joueur connaît-il cette ressource ? (Un client ne demande que ce qu'on a déjà vu.) */
  known(res: string): boolean;
  /** Avantages accordés par le chantier. */
  perks(): { slots: number; offers: number; premium: number };
  /** Commandes honorées jusqu'ici (elles font le rang). */
  completed(): number;
  /** Une commande est réglée : `paid` ($) est à verser au joueur. */
  settle(c: Contract, outcome: Outcome, paid: number): void;
  /** Une proposition vient d'arriver. */
  offered(c: Contract): void;
}

export interface ContractsSave {
  /** Propositions déjà tirées. */
  n: number;
  /** Temps de jeu de la prochaine proposition. */
  next: number;
  list: {
    id: number;
    c: number;
    l: [string, number, number][];
    r: number;
    p: number;
    h?: 1;
    t: number;
    u: number;
    a?: 1;
  }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const GOOD = new Map<string, GoodSpec>(GOODS.map((g) => [g.res, g]));
/** Au plus autant de commandes sauvegardées : au-delà, c'est une sauvegarde abîmée. */
const MAX_LIST = 16;

/** Prix de base de ce que demande une commande (ce que paierait le comptoir sans le marché, sans prime). */
export function baseValue(c: Pick<Contract, 'lines'>, delivered = false): number {
  let v = 0;
  for (const l of c.lines) v += getResource(l.res).value * (delivered ? l.done : l.qty);
  return v;
}

export class Contracts {
  list: Contract[] = [];
  /** Propositions tirées depuis le début : numéro du prochain tirage. */
  private count = 0;
  private next = 0;

  constructor(
    private readonly seed: number,
    private readonly host: ContractsHost,
    private readonly market: Market,
  ) {
    this.reset(0);
  }

  private reset(time: number): void {
    this.list = [];
    this.count = 0;
    this.next = Math.ceil(time + lerp(CONTRACTS.first[0], CONTRACTS.first[1], hash2(0, 600, this.seed ^ 0x2c9b3a1d)));
  }

  // ------------------------------------------------------------------ lecture

  /** Propositions affichées au Tableau, dans l'ordre d'arrivée. */
  offers(): Contract[] {
    return this.list.filter((c) => !c.accepted);
  }

  /** Commandes acceptées, la plus pressée d'abord. */
  active(): Contract[] {
    return this.list.filter((c) => c.accepted).sort((a, b) => a.until - b.until || a.id - b.id);
  }

  get(id: number): Contract | undefined {
    return this.list.find((c) => c.id === id);
  }

  /** Commandes acceptées en même temps, au plus. */
  get slots(): number {
    return CONTRACTS.slots + this.host.perks().slots;
  }

  /** Propositions affichées en même temps, au plus. */
  get capacity(): number {
    return CONTRACTS.offers + this.host.perks().offers;
  }

  /** Combien d'unités de `res` les commandes acceptées attendent encore. */
  wanted(res: string): number {
    let n = 0;
    for (const c of this.list) if (c.accepted) for (const l of c.lines) if (l.res === res) n += l.qty - l.done;
    return n;
  }

  /** Les commandes acceptées attendent-elles encore quelque chose ? */
  get waiting(): boolean {
    return this.list.some((c) => c.accepted);
  }

  // ------------------------------------------------------------------ évolution

  /** Fait avancer les commandes jusqu'au temps de jeu `time` (s). */
  update(time: number): void {
    if (this.list.length) {
      for (const c of [...this.list]) {
        if (time < c.until) continue;
        if (c.accepted) this.close(c, 'late');
        else this.remove(c);
      }
    }
    if (time >= this.next) this.offer(time);
  }

  private remove(c: Contract): void {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Un client laisse une proposition (si le Tableau a de la place et que le joueur connaît de quoi la remplir). */
  private offer(time: number): void {
    // Le prochain essai est un nombre entier de secondes : c'est ce que la sauvegarde sait relire.
    if (this.offers().length >= this.capacity) {
      this.next = Math.ceil(time + 5);
      return;
    }
    const c = this.draw(time);
    if (!c) {
      this.next = Math.ceil(time + 15);
      return;
    }
    this.list.push(c);
    const r = hash2(c.id, 610, this.seed ^ 0x2c9b3a1d);
    this.next = Math.ceil(time + lerp(CONTRACTS.gap[0], CONTRACTS.gap[1], r));
    this.host.offered(c);
  }

  /** Marchandises que le joueur connaît, avec leur poids dans le tirage (le marché pèse dessus). */
  private pool(): { good: GoodSpec; weight: number; hot: boolean }[] {
    const events = this.market.active();
    return GOODS.filter((g) => this.host.known(g.res)).map((good) => {
      const ev = events.find((e) => e.res === commodityOf(good.res));
      const mult = ev ? (ev.up ? CONTRACTS.demandWeight : CONTRACTS.glutWeight) : 1;
      return { good, weight: good.weight * mult, hot: !!ev && ev.up };
    });
  }

  /** Tirage pondéré de `u` ∈ [0, 1) parmi les marchandises. */
  private pick<T extends { weight: number }>(items: T[], u: number): T {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let roll = u * total;
    for (const i of items) {
      roll -= i.weight;
      if (roll < 0) return i;
    }
    return items[items.length - 1];
  }

  /** Construit la proposition n° `count + 1`, ou null si le joueur ne connaît encore rien à demander. */
  private draw(time: number): Contract | null {
    const pool = this.pool();
    if (!pool.length) return null;
    const n = this.count++;
    const r = (j: number) => hash2(n + 1, 620 + j, this.seed ^ 0x2c9b3a1d);
    const rank = rankOf(this.host.completed());
    const perks = this.host.perks();
    const qty = (g: GoodSpec, u: number, scale = 1) => Math.max(g.step, roundTo(lerp(g.qty[0], g.qty[1], u) * (1 + rank.index * CONTRACTS.rankQty) * scale, g.step));

    const first = this.pick(pool, r(0));
    const lines: ContractLine[] = [{ res: first.good.res, qty: qty(first.good, r(1)), done: 0 }];
    let hot = first.hot;
    let time$ = first.good.time;
    if (pool.length >= 3 && r(2) < CONTRACTS.twoLines) {
      const second = this.pick(
        pool.filter((p) => p.good.res !== first.good.res),
        r(3),
      );
      lines.push({ res: second.good.res, qty: qty(second.good, r(4), 0.75), done: 0 });
      hot = hot || second.hot;
      time$ = Math.max(time$, second.good.time) + CONTRACTS.extraTime;
    }
    const premium = Math.min(
      1.5,
      lerp(CONTRACTS.premium[0], CONTRACTS.premium[1], r(5)) + rank.index * CONTRACTS.rankPremium + perks.premium + (lines.length > 1 ? CONTRACTS.twoLinesBonus : 0) + (hot ? CONTRACTS.hotBonus : 0),
    );
    const base = baseValue({ lines });
    const reward = Math.max(CONTRACTS.roundTo, roundTo(base * (1 + premium), CONTRACTS.roundTo));
    return {
      id: n + 1,
      client: Math.floor(r(6) * CLIENTS.length),
      lines,
      reward,
      premium: Math.round(premium * 1000) / 1000,
      hot,
      limit: Math.max(60, roundTo(time$ * (1 + 0.15 * rank.index), 30)),
      until: Math.ceil(time + CONTRACTS.offerLife),
      accepted: false,
    };
  }

  // ------------------------------------------------------------------ actions

  /** Accepte une proposition : l'échéance se met à courir. Renvoie pourquoi c'est impossible, sinon null. */
  accept(id: number, time: number): 'gone' | 'full' | null {
    const c = this.get(id);
    if (!c || c.accepted) return 'gone';
    if (this.active().length >= this.slots) return 'full';
    c.accepted = true;
    c.until = Math.ceil(time + c.limit);
    return null;
  }

  /** Refuse une proposition. Le client n'en laisse pas une autre tout de suite (pas de tirage en boucle). */
  decline(id: number, time: number): boolean {
    const c = this.get(id);
    if (!c || c.accepted) return false;
    this.remove(c);
    this.next = Math.max(this.next, Math.ceil(time + CONTRACTS.gap[0]));
    return true;
  }

  /** Abandonne une commande acceptée : le client paie ce qui est livré, au prix de base. */
  abandon(id: number): boolean {
    const c = this.get(id);
    if (!c || !c.accepted) return false;
    this.close(c, 'abandoned');
    return true;
  }

  /**
   * Livre jusqu'à `n` unités de `res` aux commandes acceptées, la plus pressée d'abord (ou à la seule commande `only`).
   * Renvoie la quantité prise. Une commande dont tout est livré est réglée tout de suite.
   */
  deliver(res: string, n: number, only?: number): number {
    let left = Math.floor(n);
    if (left <= 0) return 0;
    let taken = 0;
    for (const c of this.active()) {
      if (only !== undefined && c.id !== only) continue;
      for (const l of c.lines) {
        if (l.res !== res || l.done >= l.qty || left <= 0) continue;
        const k = Math.min(left, l.qty - l.done);
        l.done += k;
        left -= k;
        taken += k;
      }
      if (c.lines.every((l) => l.done >= l.qty)) this.close(c, 'done');
      if (left <= 0) break;
    }
    return taken;
  }

  private close(c: Contract, outcome: Outcome): void {
    this.remove(c);
    const paid = outcome === 'done' ? c.reward : Math.round(baseValue(c, true) * CONTRACTS.partialPay);
    this.host.settle(c, outcome, paid);
  }

  // ------------------------------------------------------------------ sauvegarde

  serialize(): ContractsSave {
    return {
      n: this.count,
      next: this.next,
      list: this.list.map((c) => ({
        id: c.id,
        c: c.client,
        l: c.lines.map((l): [string, number, number] => [l.res, l.qty, l.done]),
        r: c.reward,
        p: c.premium,
        ...(c.hot ? { h: 1 as const } : {}),
        t: c.limit,
        u: c.until,
        ...(c.accepted ? { a: 1 as const } : {}),
      })),
    };
  }

  /** Recharge des commandes sauvegardées ; les valeurs aberrantes sont ignorées. Sans données (ancienne sauvegarde), tout repart à zéro. */
  load(data: ContractsSave | undefined, time: number): void {
    this.reset(time);
    if (!data || typeof data !== 'object') return;
    const int = (v: unknown, lo: number, hi: number, fallback: number) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
    };
    this.count = int(data.n, 0, 1e7, 0);
    this.next = int(data.next, 0, Math.ceil(time) + CONTRACTS.gap[1] + CONTRACTS.first[1] + 1000, this.next);
    const seen = new Set<number>();
    for (const s of Array.isArray(data.list) ? data.list.slice(0, MAX_LIST) : []) {
      if (!s || typeof s !== 'object') continue;
      const id = int(s.id, 1, 1e7, 0);
      if (!id || seen.has(id)) continue;
      const lines: ContractLine[] = [];
      for (const l of Array.isArray(s.l) ? s.l.slice(0, 3) : []) {
        if (!Array.isArray(l) || !GOOD.has(String(l[0])) || lines.some((o) => o.res === l[0])) continue;
        const qty = int(l[1], 1, 9999, 0);
        if (!qty) continue;
        lines.push({ res: String(l[0]), qty, done: int(l[2], 0, qty, 0) });
      }
      if (!lines.length) continue;
      const limit = int(s.t, 60, 7200, 0);
      const accepted = s.a === 1;
      const until = Number(s.u);
      if (!limit || !Number.isFinite(until)) continue;
      seen.add(id);
      this.list.push({
        id,
        client: int(s.c, 0, CLIENTS.length - 1, 0),
        lines,
        reward: int(s.r, 0, 1e9, 0),
        premium: Math.min(5, Math.max(0, Number(s.p) || 0)),
        hot: s.h === 1,
        limit,
        until: Math.min(until, Math.ceil(time) + Math.max(limit, CONTRACTS.offerLife)),
        accepted,
      });
    }
  }
}
