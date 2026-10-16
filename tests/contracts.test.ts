import { describe, expect, it } from 'vitest';
import { CLIENTS, CONTRACTS, GOODS, rankOf } from '../src/data/contracts';
import { getResource } from '../src/data/resources';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { applyAction } from '../src/sim/actions';
import { Contracts, baseValue, type Contract, type ContractsHost, type ContractsSave, type Outcome } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import type { Market } from '../src/sim/Market';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { goTo, run, teleport } from './helpers';

// ---------------------------------------------------------------- outils

/** Hôte factice : ce que la partie fournit aux commandes, et ce qu'elle reçoit. */
function stub(over: Partial<ContractsHost> = {}) {
  const settled: { c: Contract; outcome: Outcome; paid: number }[] = [];
  const offered: Contract[] = [];
  const host: ContractsHost = {
    known: () => true,
    perks: () => ({ slots: 0, offers: 0, premium: 0 }),
    completed: () => 0,
    settle: (c, outcome, paid) => settled.push({ c, outcome, paid }),
    offered: (c) => offered.push(c),
    ...over,
  };
  return { host, settled, offered };
}

/** Marché factice : les événements en cours sont ceux qu'on lui donne. */
const quiet = { active: () => [] } as unknown as Market;
const demand = (res: string) => ({ active: () => [{ res, up: true, pct: 40, left: 90 }] }) as unknown as Market;
const glut = (res: string) => ({ active: () => [{ res, up: false, pct: -30, left: 90 }] }) as unknown as Market;

/** Fait passer le temps de jeu de `from` à `to`, de 5 s en 5 s. */
function advance(c: Contracts, from: number, to: number): void {
  for (let t = from; t <= to; t += 5) c.update(t);
}

/** Commandes qui ont déjà reçu quelques propositions. */
function stocked(seed = 7, host = stub(), market: Market = quiet) {
  const c = new Contracts(seed, host.host, market);
  advance(c, 5, 400);
  return { c, ...host };
}

/** Partie dont le joueur connaît les marchandises données. */
function game(seed = 7, ...known: string[]): GameState {
  const g = new GameState(seed);
  for (const r of known.length ? known : ['coal', 'copper']) g.stats.collected[r] = 1;
  return g;
}

/** Glisse une commande faite main dans la partie (pour ne pas dépendre des tirages). */
function give(g: GameState, lines: [string, number][], over: Partial<Contract> = {}): Contract {
  const id = 900 + g.contracts.list.length;
  const c: Contract = {
    id,
    client: 0,
    lines: lines.map(([res, qty]) => ({ res, qty, done: 0 })),
    reward: 0,
    premium: 0.4,
    hot: false,
    limit: 600,
    until: Math.ceil(g.time) + 600,
    accepted: true,
    ...over,
  };
  if (!over.reward) c.reward = Math.round(baseValue(c) * 1.4);
  g.contracts.list.push(c);
  return c;
}

/** Pose une caisse d'expédition au camp. */
function crateAt(g: GameState, x = 52, y = 9): ShippingCrate {
  g.inventory.addKit('shipping', 1);
  teleport(g, 50, 8);
  const s = g.place('shipping', x, y, 0);
  if (!s) throw new Error(g.canPlace('shipping', x, y).reason ?? 'pose impossible');
  return s as ShippingCrate;
}

// ---------------------------------------------------------------- rang

describe('commandes : rang', () => {
  it('le rang monte avec les commandes honorées', () => {
    expect(rankOf(0)).toMatchObject({ index: 0, name: 'Livreur', next: 3 });
    expect(rankOf(2).index).toBe(0);
    expect(rankOf(3)).toMatchObject({ index: 1, name: 'Fournisseur', next: 8 });
    expect(rankOf(30)).toMatchObject({ index: 4, name: 'Magnat', next: 45 });
    expect(rankOf(44).index).toBe(4);
    expect(rankOf(45)).toMatchObject({ index: 5, name: 'Baron', next: null });
    expect(rankOf(999).index).toBe(5);
  });
});

// ---------------------------------------------------------------- propositions

describe('commandes : propositions des clients', () => {
  it('rien ne se propose tant que le joueur ne connaît aucune marchandise', () => {
    const { c, offered } = stocked(7, stub({ known: () => false }));
    expect(c.offers()).toEqual([]);
    expect(offered).toEqual([]);
  });

  it('un client ne demande que ce que le joueur connaît', () => {
    const { c } = stocked(7, stub({ known: (res) => res === 'coal' || res === 'copper' }));
    expect(c.offers().length).toBeGreaterThan(0);
    for (const o of c.offers()) for (const l of o.lines) expect(['coal', 'copper']).toContain(l.res);
  });

  it('les lingots ne sont demandés qu’après le premier lingot', () => {
    let offers = 0;
    let ingots = 0;
    for (let seed = 1; seed < 15; seed++) {
      const before = stocked(seed, stub({ known: (res) => !res.endsWith('_ingot') })).c;
      for (const o of before.list) for (const l of o.lines) expect(l.res).not.toMatch(/_ingot$/);
      offers += before.list.length;
      for (const o of stocked(seed).c.list) for (const l of o.lines) if (l.res.endsWith('_ingot')) ingots++;
    }
    expect(offers).toBeGreaterThan(0);
    expect(ingots).toBeGreaterThan(0);
  });

  it('la première proposition arrive vite, puis elles s’espacent', () => {
    const { host, offered } = stub();
    const c = new Contracts(7, host, quiet);
    advance(c, 5, CONTRACTS.first[1] + 10);
    expect(offered.length).toBe(1);
    advance(c, CONTRACTS.first[1] + 15, 3000);
    expect(offered.length).toBeGreaterThan(3);
  });

  it('le Tableau n’affiche jamais plus de propositions que sa capacité, et le chantier l’agrandit', () => {
    const a = stocked(5);
    advance(a.c, 405, 3000);
    expect(a.c.offers().length).toBeLessThanOrEqual(CONTRACTS.offers);
    const b = stocked(5, stub({ perks: () => ({ slots: 0, offers: 2, premium: 0 }) }));
    advance(b.c, 405, 1000);
    expect(b.c.capacity).toBe(CONTRACTS.offers + 2);
    expect(b.c.offers().length).toBeGreaterThan(CONTRACTS.offers);
    expect(b.c.offers().length).toBeLessThanOrEqual(CONTRACTS.offers + 2);
  });

  it('une proposition qu’on laisse passer disparaît après un moment', () => {
    const { host } = stub();
    const c = new Contracts(7, host, quiet);
    advance(c, 5, 60);
    const first = c.offers()[0];
    expect(first).toBeDefined();
    c.update(first.until - 1);
    expect(c.get(first.id)).toBeDefined();
    c.update(first.until);
    expect(c.get(first.id)).toBeUndefined();
  });

  it('même graine, mêmes propositions ; une autre graine, d’autres', () => {
    const sig = (seed: number) => JSON.stringify(stocked(seed).c.serialize());
    expect(sig(11)).toBe(sig(11));
    expect(sig(11)).not.toBe(sig(12));
  });

  it('une commande est une vraie affaire : plus que le prix de base, des quantités entières, une récompense ronde', () => {
    for (let seed = 1; seed < 25; seed++) {
      const { c } = stocked(seed);
      for (const o of c.list) {
        const base = baseValue(o);
        expect(o.reward).toBeGreaterThan(base);
        expect(o.reward % CONTRACTS.roundTo).toBe(0);
        expect(o.premium).toBeGreaterThanOrEqual(CONTRACTS.premium[0]);
        expect(o.limit).toBeGreaterThanOrEqual(600);
        expect(o.limit).toBeLessThanOrEqual(2000);
        expect(o.client).toBeGreaterThanOrEqual(0);
        expect(o.client).toBeLessThan(CLIENTS.length);
        expect(o.lines.length).toBeGreaterThanOrEqual(1);
        expect(o.lines.length).toBeLessThanOrEqual(2);
        for (const l of o.lines) {
          const good = GOODS.find((g) => g.res === l.res)!;
          expect(good).toBeDefined();
          expect(Number.isInteger(l.qty) && l.qty >= good.step).toBe(true);
          expect(l.done).toBe(0);
        }
        expect(new Set(o.lines.map((l) => l.res)).size).toBe(o.lines.length);
      }
    }
  });

  it('une forte demande sur une marchandise la fait demander plus souvent, avec une prime plus grosse', () => {
    const share = (market: Market) => {
      let copper = 0;
      let total = 0;
      let hot = 0;
      for (let seed = 1; seed < 80; seed++) {
        const c = new Contracts(seed, stub({ known: (r) => r === 'coal' || r === 'copper' || r === 'iron' }).host, market);
        advance(c, 5, 60);
        for (const o of c.list) {
          total++;
          if (o.lines.some((l) => l.res === 'copper')) copper++;
          if (o.hot) hot++;
        }
      }
      return { copper: copper / total, hot };
    };
    const calm = share(quiet);
    const busy = share(demand('copper'));
    const bust = share(glut('copper'));
    expect(busy.copper).toBeGreaterThan(calm.copper);
    expect(bust.copper).toBeLessThan(calm.copper);
    expect(calm.hot).toBe(0);
    expect(bust.hot).toBe(0);
    expect(busy.hot).toBeGreaterThan(0);
    // Une commande « chaude » paie mieux : sa prime contient le bonus de demande.
    const c = new Contracts(3, stub({ known: (r) => r === 'copper' }).host, demand('copper'));
    advance(c, 5, 60);
    const o = c.list[0];
    expect(o.hot).toBe(true);
    expect(o.premium).toBeGreaterThanOrEqual(CONTRACTS.premium[0] + CONTRACTS.hotBonus - 1e-9);
  });

  it('le rang grossit les commandes et leur prime', () => {
    const qty = (completed: number) => {
      let sum = 0;
      let premium = 0;
      let n = 0;
      for (let seed = 1; seed < 40; seed++) {
        const c = new Contracts(seed, stub({ known: (r) => r === 'coal', completed: () => completed }).host, quiet);
        advance(c, 5, 60);
        for (const o of c.list) {
          sum += o.lines[0].qty;
          premium += o.premium;
          n++;
        }
      }
      return { qty: sum / n, premium: premium / n };
    };
    const rookie = qty(0);
    const magnate = qty(30);
    expect(magnate.qty).toBeGreaterThan(rookie.qty * 1.5);
    expect(magnate.premium).toBeGreaterThan(rookie.premium);
  });

  it('les primes du chantier s’ajoutent à celles des clients', () => {
    const premium = (extra: number) => {
      const c = new Contracts(4, stub({ known: (r) => r === 'coal', perks: () => ({ slots: 0, offers: 0, premium: extra }) }).host, quiet);
      advance(c, 5, 60);
      return c.list[0].premium;
    };
    expect(premium(0.2)).toBeCloseTo(premium(0) + 0.2, 6);
  });
});

// ---------------------------------------------------------------- acceptation

describe('commandes : accepter, refuser, abandonner', () => {
  it('accepter fait courir l’échéance ; on n’en accepte qu’un nombre limité à la fois', () => {
    const { c } = stocked(7);
    const ids = c.offers().map((o) => o.id);
    expect(ids.length).toBe(CONTRACTS.offers);
    expect(c.accept(ids[0], 500)).toBeNull();
    const taken = c.get(ids[0])!;
    expect(taken.accepted).toBe(true);
    expect(taken.until).toBe(Math.ceil(500 + taken.limit));
    expect(c.accept(ids[1], 500)).toBeNull();
    expect(c.slots).toBe(CONTRACTS.slots);
    expect(c.accept(ids[2], 500)).toBe('full');
    expect(c.get(ids[2])!.accepted).toBe(false);
    expect(c.accept(999999, 500)).toBe('gone');
    expect(c.accept(ids[0], 500)).toBe('gone'); // déjà acceptée
  });

  it('le chantier ajoute des commandes en parallèle', () => {
    const { c } = stocked(7, stub({ perks: () => ({ slots: 1, offers: 0, premium: 0 }) }));
    expect(c.slots).toBe(CONTRACTS.slots + 1);
    const ids = c.offers().map((o) => o.id);
    expect(ids.slice(0, 3).map((id) => c.accept(id, 500))).toEqual([null, null, null]);
  });

  it('refuser retire la proposition sans en tirer une autre tout de suite', () => {
    const { host, offered } = stub();
    const c = new Contracts(7, host, quiet);
    advance(c, 5, 1000);
    const before = offered.length;
    const id = c.offers()[0].id;
    expect(c.decline(id, 1000)).toBe(true);
    expect(c.get(id)).toBeUndefined();
    expect(c.decline(id, 1000)).toBe(false);
    c.update(1000 + CONTRACTS.gap[0] - 6);
    expect(offered.length).toBe(before); // le client attend un peu avant d'en laisser une autre
    advance(c, 1000 + CONTRACTS.gap[0], 1000 + CONTRACTS.gap[1] + 60);
    expect(offered.length).toBeGreaterThan(before);
  });

  it('on ne refuse pas une commande déjà acceptée, on l’abandonne', () => {
    const { c, settled } = stocked(7);
    const id = c.offers()[0].id;
    c.accept(id, 500);
    expect(c.decline(id, 500)).toBe(false);
    expect(c.abandon(c.offers()[0].id)).toBe(false); // une proposition n'est pas abandonnée
    expect(c.abandon(id)).toBe(true);
    expect(c.get(id)).toBeUndefined();
    expect(settled).toEqual([{ c: expect.objectContaining({ id }), outcome: 'abandoned', paid: 0 }]);
  });
});

// ---------------------------------------------------------------- livraison

describe('commandes : livraison et paiement', () => {
  const one = (): { c: Contracts; settled: ReturnType<typeof stub>['settled']; id: number; need: number; res: string } => {
    const { c, settled } = stocked(7, stub({ known: (r) => r === 'coal' }));
    const o = c.offers().find((x) => x.lines.length === 1)!;
    c.accept(o.id, 500);
    return { c, settled, id: o.id, need: o.lines[0].qty, res: o.lines[0].res };
  };

  it('livre petit à petit, et paie la récompense dès que tout est livré', () => {
    const { c, settled, id, need, res } = one();
    expect(c.wanted(res)).toBe(need);
    expect(c.deliver(res, 10)).toBe(10);
    expect(c.get(id)!.lines[0].done).toBe(10);
    expect(settled).toEqual([]);
    expect(c.deliver(res, need)).toBe(need - 10); // pas plus que demandé
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ outcome: 'done', paid: settled[0].c.reward });
    expect(c.get(id)).toBeUndefined();
    expect(c.wanted(res)).toBe(0);
  });

  it('refuse ce que personne n’attend', () => {
    const { c, id } = one();
    expect(c.deliver('diamond', 5)).toBe(0);
    expect(c.deliver('coal', 0)).toBe(0);
    expect(c.deliver('coal', -4)).toBe(0);
    expect(c.get(id)!.lines[0].done).toBe(0);
  });

  it('une proposition non acceptée ne reçoit rien', () => {
    const { c } = stocked(7, stub({ known: (r) => r === 'coal' }));
    expect(c.deliver('coal', 50)).toBe(0);
  });

  it('livre d’abord à la commande la plus pressée, ou à celle qu’on désigne', () => {
    const { host } = stub({ known: (r) => r === 'coal' });
    const c = new Contracts(7, host, quiet);
    const mk = (id: number, until: number): Contract => ({ id, client: 0, lines: [{ res: 'coal', qty: 30, done: 0 }], reward: 200, premium: 0.4, hot: false, limit: 600, until, accepted: true });
    c.list.push(mk(1, 900), mk(2, 700), mk(3, 800));
    expect(c.deliver('coal', 40)).toBe(40);
    expect(c.get(2)).toBeUndefined(); // la plus pressée est terminée (30)
    expect(c.get(3)!.lines[0].done).toBe(10); // puis la suivante
    expect(c.get(1)!.lines[0].done).toBe(0);
    expect(c.deliver('coal', 5, 1)).toBe(5); // celle qu’on désigne
    expect(c.get(1)!.lines[0].done).toBe(5);
    expect(c.get(3)!.lines[0].done).toBe(10);
  });

  it('une commande à deux lignes se règle quand les deux sont livrées', () => {
    const { host, settled } = stub();
    const c = new Contracts(7, host, quiet);
    c.list.push({ id: 1, client: 0, lines: [{ res: 'coal', qty: 10, done: 0 }, { res: 'copper', qty: 5, done: 0 }], reward: 123, premium: 0.4, hot: false, limit: 600, until: 900, accepted: true });
    c.deliver('coal', 10);
    expect(settled).toEqual([]);
    c.deliver('copper', 5);
    expect(settled).toHaveLength(1);
    expect(settled[0].paid).toBe(123);
  });

  it('à l’échéance, le client paie ce qui est livré au prix de base, sans la prime', () => {
    const { c, settled, id, res } = one();
    c.deliver(res, 12);
    const due = c.get(id)!.until;
    c.update(due - 1);
    expect(settled).toEqual([]);
    c.update(due);
    expect(settled).toEqual([{ c: expect.objectContaining({ id }), outcome: 'late', paid: 12 * getResource(res).value }]);
    expect(c.get(id)).toBeUndefined();
  });

  it('abandonner aussi : on garde la valeur de ce qui est livré', () => {
    const { c, settled, id, res } = one();
    c.deliver(res, 7);
    expect(c.abandon(id)).toBe(true);
    expect(settled[0]).toMatchObject({ outcome: 'abandoned', paid: 7 * getResource(res).value });
  });

  it('une commande en retard sans rien de livré ne rapporte rien', () => {
    const { c, settled, id } = one();
    c.update(c.get(id)!.until + 1);
    expect(settled[0]).toMatchObject({ outcome: 'late', paid: 0 });
  });
});

// ---------------------------------------------------------------- sauvegarde

describe('commandes : sauvegarde', () => {
  it('le prochain essai est toujours un nombre entier de secondes, même avec des temps à virgule (sinon la sauvegarde ne le relit pas)', () => {
    // Tableau plein : le client réessaie un peu plus tard, à un temps qui n'est pas rond.
    const full = new Contracts(7, stub().host, quiet);
    for (let t = 0.3; full.offers().length < CONTRACTS.offers; t += 7.41) full.update(t);
    full.update(full.serialize().next + 0.37);
    expect(full.offers().length).toBe(CONTRACTS.offers);
    expect(Number.isInteger(full.serialize().next)).toBe(true);
    // Rien de connu à demander : même chose.
    const none = new Contracts(7, stub({ known: () => false }).host, quiet);
    none.update(none.serialize().next + 0.37);
    expect(Number.isInteger(none.serialize().next)).toBe(true);
    // Et ce qu'on relit est exactement ce qu'on a écrit, tableau plein compris.
    const copy = new Contracts(7, stub().host, quiet);
    copy.load(JSON.parse(JSON.stringify(full.serialize())), 899.7);
    expect(copy.serialize()).toEqual(full.serialize());
  });

  it('une commande sauvegardée revient telle quelle', () => {
    const { c } = stocked(7);
    c.accept(c.offers()[0].id, 450);
    c.deliver(c.active()[0].lines[0].res, 3);
    const data = JSON.parse(JSON.stringify(c.serialize())) as ContractsSave;
    const d = new Contracts(7, stub().host, quiet);
    d.load(data, 450);
    expect(d.serialize()).toEqual(c.serialize());
    expect(d.active()).toHaveLength(1);
  });

  it('sans données (ancienne sauvegarde), le Tableau repart à vide et les clients reviennent d’ici peu', () => {
    const { host, offered } = stub();
    const c = new Contracts(7, host, quiet);
    c.load(undefined, 5000);
    expect(c.list).toEqual([]);
    c.update(5000);
    expect(offered).toEqual([]); // pas tout de suite
    advance(c, 5005, 5000 + CONTRACTS.first[1] + 10);
    expect(offered).toHaveLength(1);
  });

  it('les valeurs aberrantes sont ignorées', () => {
    const c = new Contracts(7, stub().host, quiet);
    const bad = {
      n: 'x',
      next: -5,
      list: [
        null,
        { id: 1, c: 0, l: [['diamond', 2, 0]], r: 100, p: 0.4, t: 600, u: 900 }, // bonne
        { id: 1, c: 0, l: [['coal', 2, 0]], r: 100, p: 0.4, t: 600, u: 900 }, // même numéro
        { id: 2, c: 99, l: [['unobtainium', 2, 0]], r: 100, p: 0.4, t: 600, u: 900 }, // marchandise inconnue
        { id: 3, c: 0, l: [['coal', 0, 0]], r: 100, p: 0.4, t: 600, u: 900 }, // quantité nulle
        { id: 4, c: 0, l: [['coal', 5, 9]], r: 100, p: 0.4, t: 600, u: 900 }, // plus de livré que demandé
        { id: 5, c: 0, l: [], r: 100, p: 0.4, t: 600, u: 900 }, // aucune ligne
        { id: 6, c: 0, l: [['coal', 5, 0]], r: -1, p: 0.4, t: 600, u: 900 }, // récompense négative
        { id: 7, c: 0, l: [['coal', 5, 0]], r: 100, p: 0.4, t: 0, u: 900 }, // pas de délai
        { id: 8, c: 0, l: [['coal', 5, 0]], r: 100, p: 0.4, t: 600, u: 'bientôt' },
        { id: 9, c: 0, l: [['coal', 5, 0]], r: 100, p: 0.4, t: 600, u: 1e12, a: 1 }, // échéance absurde
      ],
    } as unknown as ContractsSave;
    c.load(bad, 100);
    const ids = c.list.map((o) => o.id);
    expect(ids).toContain(1);
    expect(ids).toContain(4); // la quantité livrée est ramenée à la quantité demandée
    expect(c.get(4)!.lines[0].done).toBe(0);
    expect(c.get(9)!.until).toBeLessThan(5000); // ramenée à une échéance raisonnable
    for (const bye of [2, 3, 5, 7, 8]) expect(ids).not.toContain(bye);
    expect(c.get(6)!.reward).toBe(0);
    expect(c.get(1)!.lines[0].res).toBe('diamond');
    // Les nombres absurdes ne cassent pas la suite.
    advance(c, 105, 2000);
    expect(c.offers().length).toBeLessThanOrEqual(CONTRACTS.offers);
  });
});

// ---------------------------------------------------------------- dans la partie

describe('commandes dans la partie', () => {
  /** Partie où trois propositions attendent. */
  function board(seed = 7): GameState {
    const g = game(seed);
    for (let t = 100; t <= 1500 && g.contracts.offers().length < 3; t += 100) {
      g.time = t;
      g.contracts.update(t);
    }
    return g;
  }

  it('une proposition annonce un événement', () => {
    const g = game();
    g.time = 100;
    g.contracts.update(100);
    expect(g.events.find((e) => e.t === 'contract')).toMatchObject({ t: 'contract', kind: 'offer' });
  });

  it('accepter au Tableau, livrer son sac, être payé', () => {
    const g = board();
    const o = g.contracts.offers().find((x) => x.lines.length === 1)!;
    goTo(g, 'board');
    applyAction(g, { k: 'contractAccept', id: o.id });
    expect(g.contracts.get(o.id)!.accepted).toBe(true);
    const { res, qty } = o.lines[0];
    g.inventory.items[res] = qty + 4;
    g.events.length = 0;
    const money = g.money;
    applyAction(g, { k: 'contractDeliver', id: o.id });
    expect(g.inventory.count(res)).toBe(4); // le surplus reste dans le sac
    expect(g.money).toBe(money + o.reward);
    expect(g.stats.contracts).toBe(1);
    expect(g.stats.contractMoney).toBe(o.reward);
    expect(g.stats.earned).toBe(o.reward);
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(g.events.some((e) => e.t === 'contract' && e.kind === 'done' && e.paid === o.reward)).toBe(true);
  });

  it('loin du Tableau, rien ne se passe', () => {
    const g = board();
    const o = g.contracts.offers()[0];
    teleport(g, 50, 12 + 5);
    applyAction(g, { k: 'contractAccept', id: o.id });
    expect(g.contracts.get(o.id)!.accepted).toBe(false);
    goTo(g, 'board');
    applyAction(g, { k: 'contractAccept', id: o.id });
    g.inventory.items[o.lines[0].res] = 5;
    teleport(g, 50, 12 + 5);
    applyAction(g, { k: 'contractDeliver' });
    expect(g.inventory.count(o.lines[0].res)).toBe(5);
    applyAction(g, { k: 'contractAbandon', id: o.id });
    expect(g.contracts.get(o.id)).toBeDefined();
    applyAction(g, { k: 'contractDecline', id: g.contracts.offers()[0]?.id ?? -1 });
    expect(g.contracts.offers().length).toBeGreaterThan(0);
  });

  it('une commande acceptée en trop est refusée, avec une explication', () => {
    const g = board();
    goTo(g, 'board');
    const [a, b, c] = g.contracts.offers();
    applyAction(g, { k: 'contractAccept', id: a.id });
    applyAction(g, { k: 'contractAccept', id: b.id });
    g.events.length = 0;
    applyAction(g, { k: 'contractAccept', id: c.id });
    expect(g.contracts.get(c.id)!.accepted).toBe(false);
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'warn' });
  });

  it('livrer un sac qui ne contient rien d’utile le dit', () => {
    const g = board();
    goTo(g, 'board');
    g.events.length = 0;
    applyAction(g, { k: 'contractDeliver' });
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'info' });
  });

  it('l’échéance passée, le client paie la part livrée et la partie le sait', () => {
    const g = game();
    const c = give(g, [['coal', 40]], { accepted: true, until: 400 });
    c.lines[0].done = 10;
    g.time = 399;
    g.contracts.update(399);
    expect(g.contracts.get(c.id)).toBeDefined();
    g.events.length = 0;
    g.time = 400;
    g.contracts.update(400);
    expect(g.money).toBe(10 * getResource('coal').value);
    expect(g.stats.contracts).toBe(0); // une commande en retard n'est pas honorée
    expect(g.events.find((e) => e.t === 'contract')).toMatchObject({ kind: 'late', paid: 40 });
  });

  it('honorer des commandes fait monter le rang', () => {
    const g = game();
    for (let i = 0; i < 3; i++) {
      const c = give(g, [['coal', 5]]);
      g.contracts.deliver('coal', c.lines[0].qty);
    }
    expect(g.stats.contracts).toBe(3);
    expect(rankOf(g.stats.contracts).name).toBe('Fournisseur');
  });

  it('même graine, mêmes gestes : les deux parties restent identiques', () => {
    const a = game(5);
    const b = game(5);
    for (const g of [a, b]) {
      run(g, 130);
      teleport(g, 50, 12 + 5);
    }
    expect(a.contracts.offers().length).toBeGreaterThan(0);
    expect(stateDigest(a)).toBe(stateDigest(b));
    expect(JSON.stringify(a.contracts.serialize())).toBe(JSON.stringify(b.contracts.serialize()));
  });
});

// ---------------------------------------------------------------- caisse d'expédition

describe('caisse d’expédition réglée sur « Commandes »', () => {
  it('apporte aux commandes ce qu’elles attendent et vend le reste au marché', () => {
    const g = game();
    const c = give(g, [['coal', 30]]);
    const crate = crateAt(g);
    crate.mode = 'orders';
    crate.put('coal', 40);
    crate.put('copper', 6);
    g.events.length = 0;
    teleport(g, 50, 12 + 5);
    run(g, crate.interval + 0.5);
    expect(g.contracts.get(c.id)).toBeUndefined(); // honorée
    expect(g.stats.contracts).toBe(1);
    // 30 charbons livrés, 10 charbons et 6 cuivres vendus.
    expect(g.stats.autoSold).toBe(g.quote('coal', 10) + g.quote('copper', 6));
    expect(g.money).toBe(c.reward + g.stats.autoSold);
    expect(crate.items).toEqual({});
    expect(g.events.find((e) => e.t === 'delivered')).toMatchObject({ n: 30, to: 'orders' });
  });

  it('sans commande acceptée, tout se vend : rien ne se perd, la caisse ne se bouche pas', () => {
    const g = game();
    const crate = crateAt(g);
    crate.mode = 'orders';
    crate.put('coal', 10);
    teleport(g, 50, 12 + 5);
    run(g, crate.interval + 0.5);
    expect(g.stats.autoSold).toBe(g.quote('coal', 10));
    expect(g.events.some((e) => e.t === 'delivered')).toBe(false);
  });

  it('une proposition non acceptée ne reçoit rien', () => {
    const g = game();
    const c = give(g, [['coal', 30]], { accepted: false });
    const crate = crateAt(g);
    crate.mode = 'orders';
    crate.put('coal', 30);
    teleport(g, 50, 12 + 5);
    run(g, crate.interval + 0.5);
    expect(g.contracts.get(c.id)!.lines[0].done).toBe(0);
    expect(g.stats.autoSold).toBe(g.quote('coal', 30));
  });

  it('livre petit à petit, passage après passage', () => {
    const g = game();
    const c = give(g, [['coal', 50]]);
    const crate = crateAt(g);
    crate.mode = 'orders';
    teleport(g, 50, 12 + 5);
    crate.put('coal', 20);
    run(g, crate.interval + 0.5);
    expect(g.contracts.get(c.id)!.lines[0].done).toBe(20);
    crate.put('coal', 30);
    run(g, crate.interval);
    expect(g.contracts.get(c.id)).toBeUndefined();
    expect(g.stats.autoSold).toBe(0);
  });

  it('le réglage de la caisse est sauvegardé ; une caisse ordinaire n’écrit rien de plus', () => {
    const g = game();
    const crate = crateAt(g);
    expect(crate.serialize().mode).toBeUndefined();
    crate.mode = 'orders';
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect((h.structures.at(52, 9) as ShippingCrate).mode).toBe('orders');
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.structures.find((s: { type: string }) => s.type === 'shipping').mode = 'n’importe quoi';
    expect((deserialize(data).structures.at(52, 9) as ShippingCrate).mode).toBe('market');
  });

  it('l’action de réglage change le mode, et refuse un mode inconnu', () => {
    const g = game();
    const crate = crateAt(g);
    applyAction(g, { k: 'shipMode', x: 52, y: 9, mode: 'orders' });
    expect(crate.mode).toBe('orders');
    applyAction(g, { k: 'shipMode', x: 52, y: 9, mode: 'site' });
    expect(crate.mode).toBe('site');
    applyAction(g, { k: 'shipMode', x: 52, y: 9, mode: 'voler' });
    expect(crate.mode).toBe('site');
    applyAction(g, { k: 'shipMode', x: 52, y: 9, mode: 'market' });
    expect(crate.mode).toBe('market');
  });
});

// ---------------------------------------------------------------- sauvegarde de la partie

describe('commandes : sauvegarde de la partie', () => {
  it('les commandes, le rang et les gains survivent à la sauvegarde', () => {
    const g = game();
    const c = give(g, [['coal', 50]]);
    c.lines[0].done = 20;
    g.stats.contracts = 4;
    g.stats.contractMoney = 1234;
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.contracts.get(c.id)).toMatchObject({ accepted: true, reward: c.reward });
    expect(h.contracts.get(c.id)!.lines[0].done).toBe(20);
    expect(h.stats.contracts).toBe(4);
    expect(h.stats.contractMoney).toBe(1234);
    expect(JSON.stringify(h.contracts.serialize())).toBe(JSON.stringify(g.contracts.serialize()));
  });

  it('une ancienne sauvegarde, sans commandes, se charge', () => {
    const g = game();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.contracts;
    delete data.project;
    delete data.stats.contracts;
    delete data.stats.contractMoney;
    const h = deserialize(data);
    expect(h.contracts.list).toEqual([]);
    expect(h.stats.contracts).toBe(0);
    expect(h.stats.contractMoney).toBe(0);
    expect(h.project.phase).toBe(0);
    // Le jeu continue normalement : des clients arrivent.
    run(h, 90);
    expect(h.contracts.offers().length).toBeGreaterThan(0);
  });
});
