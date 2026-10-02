import { describe, expect, it } from 'vitest';
import { MARKET } from '../src/data/market';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { COMMODITIES, Market, commodityOf, type ActiveEvent, type MarketEvent, type MarketSave } from '../src/sim/Market';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { goTo } from './helpers';

/** Marché dont les minerais sont connus (par défaut tous), avancé jusqu'au temps de jeu `seconds`. */
function market(seed = 7, seconds = 0, known: (res: string) => boolean = () => true, announce?: (e: ActiveEvent) => void): Market {
  const m = new Market(seed, known, announce);
  m.update(seconds);
  return m;
}

/** Avance de dix secondes en dix secondes, comme la partie. */
function play(m: Market, from: number, to: number): void {
  for (let t = from; t <= to; t += MARKET.step) m.update(t);
}

const snapshot = (m: Market) => COMMODITIES.map((c) => m.mult(c));

describe('marché : minerais échangés', () => {
  it('les minerais s’échangent, pas la pierre ni les lingots, qui suivent leur minerai', () => {
    expect(COMMODITIES).toEqual(['coal', 'copper', 'iron', 'silver', 'gold', 'diamond']);
    expect(commodityOf('stone')).toBeNull();
    expect(commodityOf('copper_ingot')).toBe('copper');
    expect(commodityOf('gold_ingot')).toBe('gold');
    expect(commodityOf('diamond')).toBe('diamond');
  });

  it('un lingot suit le cours de son minerai ; la pierre ne bouge jamais', () => {
    const m = market(3, 1500);
    expect(m.mult('copper_ingot')).toBe(m.mult('copper'));
    expect(m.price('copper_ingot')).toBeCloseTo(getResource('copper_ingot').value * m.mult('copper'), 9);
    expect(m.mult('stone')).toBe(1);
    expect(m.price('stone')).toBe(getResource('stone').value);
    expect(m.trend('stone')).toBe(0);
    expect(m.history('stone')).toEqual([]);
  });
});

describe('marché : évolution des cours', () => {
  it('reste à 100 % pendant le calme du début de partie', () => {
    const m = market(5, MARKET.quiet);
    for (const c of COMMODITIES) {
      expect(m.mult(c)).toBe(1);
      expect(m.trend(c)).toBe(0);
    }
    expect(m.active()).toEqual([]);
  });

  it('puis les cours bougent, sans jamais sortir des bornes', () => {
    const m = new Market(5, () => true);
    let moved = false;
    for (let t = 10; t <= 4 * 3600; t += 10) {
      m.update(t);
      for (const c of COMMODITIES) {
        expect(m.mult(c)).toBeGreaterThanOrEqual(MARKET.min);
        expect(m.mult(c)).toBeLessThanOrEqual(MARKET.max);
        if (m.mult(c) !== 1) moved = true;
      }
    }
    expect(moved).toBe(true);
  });

  it('même graine, même marché ; une autre graine, un autre marché', () => {
    expect(snapshot(market(11, 2000))).toEqual(snapshot(market(11, 2000)));
    expect(snapshot(market(11, 2000))).not.toEqual(snapshot(market(12, 2000)));
  });

  it('avancer d’un coup ou pas à pas donne le même marché', () => {
    const a = market(21, 3000);
    const b = new Market(21, () => true);
    play(b, 10, 3000);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.history('iron')).toEqual(b.history('iron'));
  });

  it('en moyenne, un cours vaut 100 % du prix de base, avec des écarts bien visibles', () => {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = new Market(seed, () => true);
      for (let t = 10; t <= 3 * 3600; t += 10) {
        m.update(t);
        for (const c of COMMODITIES) {
          const v = m.mult(c);
          sum += v;
          sq += v * v;
          n++;
        }
      }
    }
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    expect(mean).toBeGreaterThan(0.94);
    expect(mean).toBeLessThan(1.06);
    expect(sd).toBeGreaterThan(0.1);
    expect(sd).toBeLessThan(0.3);
  });

  it('le prix d’un lot est arrondi une seule fois, au cours du moment', () => {
    const m = market(9, 1700);
    for (const c of COMMODITIES) {
      expect(m.quote(c, 10)).toBe(Math.round(getResource(c).value * m.mult(c) * 10));
      expect(Number.isInteger(m.quote(c, 7))).toBe(true);
    }
    // Calme du début : le prix de la fiche, exactement.
    const calm = market(9, 30);
    expect(calm.quote('copper', 3)).toBe(21);
    expect(calm.quote('stone', 4)).toBe(4);
  });

  it('la courbe garde dix minutes, et son dernier point est le cours du moment', () => {
    const m = market(2, 3000);
    const h = m.history('gold');
    expect(h).toHaveLength(MARKET.history);
    expect(h[h.length - 1]).toBeCloseTo(m.mult('gold'), 3);
    const young = market(2, 40);
    expect(young.history('gold')).toHaveLength(5); // le point de départ, puis un par pas
  });

  it('la tendance suit l’écart avec le cours d’il y a 30 secondes', () => {
    const m = market(8, 0);
    for (let t = 10; t <= 5000; t += 10) {
      m.update(t);
      for (const c of COMMODITIES) {
        const h = m.history(c);
        const r = h[h.length - 1] / h[Math.max(0, h.length - 4)] - 1;
        const expected = r > MARKET.trendStep ? 1 : r < -MARKET.trendStep ? -1 : 0;
        expect(m.trend(c)).toBe(expected);
      }
    }
  });
});

describe('marché : événements', () => {
  /** Tous les événements annoncés par un marché, avec le temps de jeu où ils commencent. */
  function timeline(seed: number, until: number, known: (res: string) => boolean = () => true): { t: number; e: ActiveEvent }[] {
    const seen: { t: number; e: ActiveEvent }[] = [];
    let now = 0;
    const m = new Market(seed, known, (e) => seen.push({ t: now, e }));
    for (now = 10; now <= until; now += MARKET.step) m.update(now);
    return seen;
  }

  it('le premier arrive après le calme du début, entre 150 et 250 s environ, puis d’autres suivent', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const seen = timeline(seed, 3600);
      expect(seen[0].t).toBeGreaterThanOrEqual(MARKET.events.first[0] - MARKET.step);
      expect(seen[0].t).toBeLessThanOrEqual(MARKET.events.first[1] + MARKET.step);
      expect(seen.length).toBeGreaterThanOrEqual(8);
      expect(seen.length).toBeLessThanOrEqual(26);
      // Écart entre deux événements : celui des réglages.
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i].t - seen[i - 1].t).toBeGreaterThanOrEqual(MARKET.events.gap[0] - MARKET.step);
        expect(seen[i].t - seen[i - 1].t).toBeLessThanOrEqual(MARKET.events.gap[1] + 2 * MARKET.step + 30);
      }
    }
  });

  it('il y a des hausses et des baisses, d’amplitude bornée par les réglages', () => {
    const all = [1, 2, 3, 4, 5, 6].flatMap((seed) => timeline(seed, 3 * 3600));
    const ups = all.filter((x) => x.e.up);
    const downs = all.filter((x) => !x.e.up);
    expect(ups.length).toBeGreaterThan(20);
    expect(downs.length).toBeGreaterThan(20);
    const [dLo, dHi] = MARKET.events.demand;
    const [gLo, gHi] = MARKET.events.glut;
    for (const { e } of ups) {
      expect(e.pct).toBeGreaterThanOrEqual(Math.round((Math.exp(dLo) - 1) * 100));
      expect(e.pct).toBeLessThanOrEqual(Math.round((Math.exp(dHi) - 1) * 100));
    }
    for (const { e } of downs) {
      expect(e.pct).toBeGreaterThanOrEqual(Math.round((Math.exp(gLo) - 1) * 100));
      expect(e.pct).toBeLessThanOrEqual(Math.round((Math.exp(gHi) - 1) * 100));
    }
  });

  it('ne concerne que des minerais que le joueur connaît', () => {
    const seen = timeline(4, 2 * 3600, (res) => res === 'copper' || res === 'gold');
    expect(seen.length).toBeGreaterThan(5);
    for (const { e } of seen) expect(['copper', 'gold']).toContain(e.res);
  });

  it('aucun événement tant que le joueur ne connaît aucun minerai, puis ils commencent vite', () => {
    let knows = false;
    const seen: number[] = [];
    let now = 0;
    const m = new Market(6, () => knows, () => seen.push(now));
    for (now = 10; now <= 1800; now += 10) m.update(now);
    expect(seen).toHaveLength(0);
    knows = true;
    const from = now;
    for (; now <= from + 60; now += 10) m.update(now);
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  it('au plus deux à la fois, jamais deux sur le même minerai', () => {
    for (const seed of [1, 2, 3, 4]) {
      const m = new Market(seed, () => true);
      for (let t = 10; t <= 3 * 3600; t += 10) {
        m.update(t);
        const list = m.active();
        expect(list.length).toBeLessThanOrEqual(MARKET.events.maxActive);
        expect(new Set(list.map((e) => e.res)).size).toBe(list.length);
      }
    }
  });

  it('un événement dure quelques minutes, puis il disparaît', () => {
    const m = new Market(2, () => true);
    let first: ActiveEvent | null = null;
    let started = 0;
    let ended = 0;
    for (let t = 10; t <= 3600 && !ended; t += 10) {
      m.update(t);
      const list = m.active();
      if (!first && list.length) {
        first = list[0];
        started = t;
      }
      if (first && !m.active().some((e) => e.res === first!.res)) ended = t;
    }
    expect(first).not.toBeNull();
    expect(ended - started).toBeGreaterThanOrEqual(100);
    expect(ended - started).toBeLessThanOrEqual(200);
    expect(first!.left).toBeGreaterThan(90);
  });

  it('pendant le palier, une demande fait monter le cours et une surproduction le fait chuter', () => {
    let up = 0;
    let upSum = 0;
    let down = 0;
    let downSum = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = new Market(seed, () => true);
      for (let t = 10; t <= 3 * 3600; t += 10) {
        m.update(t);
        // Au palier : plus de 30 s après le début et plus de 60 s avant la fin.
        for (const e of m.events) {
          const age = m.step - e.start;
          if (age >= e.rise + 1 && age < e.rise + e.hold) {
            if (e.amp > 0) {
              up++;
              upSum += m.mult(e.res);
            } else {
              down++;
              downSum += m.mult(e.res);
            }
          }
        }
      }
    }
    expect(upSum / up).toBeGreaterThan(1.15);
    expect(downSum / down).toBeLessThan(0.9);
  });

  it('montée, palier puis retour : la forme exacte d’un événement', () => {
    // Pendant le calme du début, rien d'autre ne fait bouger le cours : on voit l'événement seul.
    const m = new Market(1, () => true);
    const ev: MarketEvent = { n: 0, res: 'copper', start: 0, rise: 2, hold: 3, fall: 2, amp: 0.4 };
    m.load({ ...m.serialize(), k: 0, e: [ev] }, 0);
    const seen: number[] = [m.mult('copper')];
    for (let t = 10; t <= 70; t += 10) {
      m.update(t);
      seen.push(m.mult('copper'));
    }
    const expected = [0, 0.2, 0.4, 0.4, 0.4, 0.4, 0.2, 0].map((a) => Math.exp(a));
    seen.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    expect(m.mult('iron')).toBe(1); // les autres minerais ne bougent pas
  });
});

describe('marché : sauvegarde', () => {
  it('un marché sauvegardé reprend exactement où il en était', () => {
    const a = market(31, 1700);
    const data: MarketSave = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Market(31, () => true);
    b.load(data, 1700);
    expect(b.step).toBe(a.step);
    for (const c of COMMODITIES) {
      expect(b.mult(c)).toBeCloseTo(a.mult(c), 3);
      expect(b.history(c)).toEqual(a.history(c));
    }
    expect(b.events).toEqual(a.events);
    // Et la suite est la même, événements compris.
    a.update(3400);
    b.update(3400);
    for (const c of COMMODITIES) expect(b.mult(c)).toBeCloseTo(a.mult(c), 2);
    expect(b.events.map((e) => [e.res, e.amp])).toEqual(a.events.map((e) => [e.res, e.amp]));
  });

  it('une ancienne sauvegarde repart à 100 % sans rejouer le passé ni annoncer d’événement', () => {
    const seen: ActiveEvent[] = [];
    const m = new Market(3, () => true, (e) => seen.push(e));
    m.load(undefined, 5000);
    expect(m.step).toBe(500);
    for (const c of COMMODITIES) {
      expect(m.mult(c)).toBe(1);
      expect(m.history(c)).toEqual([1]);
    }
    expect(seen).toHaveLength(0);
    // Le premier événement n'arrive pas tout de suite.
    m.update(5000 + MARKET.events.first[0] - MARKET.step * 2);
    expect(seen).toHaveLength(0);
  });

  it('ignore les valeurs absurdes d’une sauvegarde abîmée', () => {
    const m = new Market(3, () => true);
    const junk = {
      k: -5,
      x: { copper: 'abc', coal: 99, iron: NaN },
      h: { copper: [Number.NaN, 0.9, 'x', 0.001, 1.1, 1.2], gold: 'pas une liste' },
      e: [
        { n: 0, res: 'inconnu', start: 0, rise: 2, hold: 3, fall: 2, amp: 0.3 },
        { n: 1, res: 'copper', start: 0, rise: 2, hold: 3, fall: 2, amp: 99 },
        { n: 2, res: 'iron', start: 0, rise: -4, hold: 3, fall: 2, amp: 0.3 },
        null,
      ],
      next: 'bientôt',
      n: 'beaucoup',
    } as unknown as MarketSave;
    expect(() => m.load(junk, 1000)).not.toThrow();
    for (const c of COMMODITIES) {
      expect(m.mult(c)).toBeGreaterThanOrEqual(MARKET.min);
      expect(m.mult(c)).toBeLessThanOrEqual(MARKET.max);
    }
    expect(m.events).toHaveLength(0);
    // Seules les valeurs valides sont gardées ; le dernier point est recalculé, pas répété.
    expect(m.history('copper')).toEqual([0.9, 1.1, 1]);
    expect(() => m.update(3000)).not.toThrow();
    expect(() => m.load(null as unknown as MarketSave, 1000)).not.toThrow();
  });
});

describe('partie : ventes au cours du marché', () => {
  /** Partie où le marché a vécu `seconds` secondes : les cours ne sont plus à 100 %. */
  function aged(seconds = 1700): GameState {
    const g = new GameState(4);
    g.time = seconds;
    g.market.update(seconds);
    return g;
  }

  it('le comptoir paie au cours du moment, pour un lot entier', () => {
    const g = aged();
    const mult = g.market.mult('copper');
    expect(mult).not.toBe(1);
    goTo(g, 'counter');
    g.inventory.add('copper', 10);
    const n = g.inventory.count('copper');
    expect(n).toBeGreaterThanOrEqual(5);
    const total = g.sell('copper', n);
    expect(total).toBe(Math.round(getResource('copper').value * mult * n));
    expect(g.money).toBe(total);
    expect(g.stats.earned).toBe(total);
    expect(g.events.some((e) => e.t === 'sold' && e.total === total)).toBe(true);
  });

  it('« tout vendre » additionne le cours de chaque minerai', () => {
    const g = aged();
    goTo(g, 'counter');
    g.inventory.add('coal', 3);
    g.inventory.add('gold', 1);
    g.inventory.add('stone', 2);
    const [coal, gold, stone] = ['coal', 'gold', 'stone'].map((r) => g.inventory.count(r));
    expect(coal + gold + stone).toBe(6);
    const expected = g.quote('coal', coal) + g.quote('gold', gold) + g.quote('stone', stone);
    expect(g.sellAll()).toBe(expected);
    expect(g.money).toBe(expected);
    expect(g.quote('stone', 5)).toBe(5); // la pierre garde son prix
  });

  it('au début de partie, les prix sont ceux de la fiche', () => {
    const g = new GameState(4);
    goTo(g, 'counter');
    g.inventory.add('copper', 3);
    expect(g.sell('copper', 3)).toBe(21);
  });

  it('la caisse d’expédition vend au cours du moment, comme le comptoir', () => {
    const g = aged();
    const crate = new ShippingCrate(5, 5, 0);
    crate.put('iron', 4);
    crate.put('copper_ingot', 2);
    const expected = g.quote('iron', 4) + g.quote('copper_ingot', 2);
    expect(crate.pendingValue((res, n) => g.quote(res, n))).toBe(expected);
    // Sans cours : le prix de la fiche.
    expect(crate.pendingValue()).toBe(getResource('iron').value * 4 + getResource('copper_ingot').value * 2);
    crate.timer = 0;
    crate.update(0.01, g);
    expect(g.money).toBe(expected);
    expect(g.stats.autoSold).toBe(expected);
    expect(crate.items).toEqual({});
  });

  it('un événement du marché est annoncé à l’interface', () => {
    const g = new GameState(4);
    g.stats.discovered = ['copper'];
    for (let t = 10; t <= 1200 && !g.events.some((e) => e.t === 'market'); t += 10) {
      g.time = t;
      g.market.update(t);
    }
    const news = g.events.find((e) => e.t === 'market');
    expect(news).toBeDefined();
    if (news?.t === 'market') {
      expect(news.res).toBe('copper');
      expect(news.pct === 0).toBe(false);
      expect(news.up).toBe(news.pct > 0);
    }
  });

  it('le marché suit le temps de la partie quand elle tourne', () => {
    const g = new GameState(4);
    for (let i = 0; i < 60 * 130; i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
    expect(g.market.step).toBe(Math.floor(g.time / MARKET.step));
    expect(g.market.step).toBeGreaterThanOrEqual(12);
    expect(g.market.mult('copper')).not.toBe(1);
  });

  it('la sauvegarde garde le marché ; une ancienne sauvegarde n’en a pas, et repart à 100 %', () => {
    const g = aged(2400);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    for (const c of COMMODITIES) {
      expect(back.market.mult(c)).toBeCloseTo(g.market.mult(c), 3);
      expect(back.market.history(c)).toEqual(g.market.history(c));
    }
    expect(back.market.step).toBe(g.market.step);

    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.market;
    const old = deserialize(data);
    expect(old.market.step).toBe(Math.floor(2400 / MARKET.step));
    for (const c of COMMODITIES) expect(old.market.mult(c)).toBe(1);
    expect(old.events.some((e) => e.t === 'market')).toBe(false);
  });
});
