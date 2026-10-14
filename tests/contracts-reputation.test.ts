import { describe, expect, it } from 'vitest';
import { CLIENTS, CONTRACTS, REPUTATION, trustOf } from '../src/data/contracts';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { Contracts, baseValue, type Contract, type ContractsHost, type ContractsSave, type Outcome } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import type { Market } from '../src/sim/Market';

// ---------------------------------------------------------------- outils

type Settled = { c: Contract; outcome: Outcome; paid: number; trust: { before: number; after: number } };

function stub(over: Partial<ContractsHost> = {}) {
  const settled: Settled[] = [];
  const offered: Contract[] = [];
  const host: ContractsHost = {
    known: () => true,
    perks: () => ({ slots: 0, offers: 0, premium: 0 }),
    completed: () => 0,
    settle: (c, outcome, paid, trust) => settled.push({ c, outcome, paid, trust }),
    offered: (c) => offered.push(c),
    ...over,
  };
  return { host, settled, offered };
}

const quiet = { active: () => [] } as unknown as Market;

function advance(c: Contracts, from: number, to: number): void {
  for (let t = from; t <= to; t += 5) c.update(t);
}

/** Une commande faite main, acceptée, d'un client donné : on la livre ou on la laisse passer à volonté. */
function give(c: Contracts, client: number, over: Partial<Contract> = {}): Contract {
  const o: Contract = {
    id: 900 + c.list.length,
    client,
    lines: [{ res: 'coal', qty: 10, done: 0 }],
    reward: 100,
    premium: 0.4,
    hot: false,
    limit: 600,
    until: 5000,
    accepted: true,
    ...over,
  };
  c.list.push(o);
  return o;
}

/** Honore une commande du client `client` : tout est livré à temps. */
function honor(c: Contracts, client: number, over: Partial<Contract> = {}): void {
  const o = give(c, client, over);
  c.deliver('coal', 1000, o.id);
}

const fresh = (seed = 7, host = stub()) => ({ c: new Contracts(seed, host.host, quiet), ...host });

// ---------------------------------------------------------------- niveaux

describe('réputation : niveaux de confiance', () => {
  it('les niveaux montent avec les points', () => {
    expect(trustOf(0)).toMatchObject({ index: 0, name: 'Nouveau', premium: 0, time: 0, next: 1 });
    expect(trustOf(1)).toMatchObject({ index: 1, name: 'Connaissance' });
    expect(trustOf(2).index).toBe(1);
    expect(trustOf(3)).toMatchObject({ index: 2, name: 'Habitué', at: 3, next: 6 });
    expect(trustOf(6).index).toBe(3);
    expect(trustOf(10)).toMatchObject({ index: 4, name: 'Partenaire', next: null });
    expect(trustOf(REPUTATION.max).index).toBe(4);
  });

  it('plus la confiance monte, plus la prime et le délai en plus montent', () => {
    for (let i = 1; i < REPUTATION.levels.length; i++) {
      expect(REPUTATION.levels[i].at).toBeGreaterThan(REPUTATION.levels[i - 1].at);
      expect(REPUTATION.levels[i].premium).toBeGreaterThan(REPUTATION.levels[i - 1].premium);
      expect(REPUTATION.levels[i].time).toBeGreaterThan(REPUTATION.levels[i - 1].time);
    }
    expect(REPUTATION.levels[0]).toMatchObject({ at: 0, premium: 0, time: 0 });
  });
});

// ---------------------------------------------------------------- points

describe('réputation : points gagnés et perdus', () => {
  it('une partie neuve : personne ne vous connaît', () => {
    const { c } = fresh();
    expect(c.reputation).toEqual(CLIENTS.map(() => 0));
    expect(c.regulars()).toEqual([]);
    expect(c.trust(3).index).toBe(0);
  });

  it('une commande honorée à temps donne confiance à son client, et à lui seul', () => {
    const { c, settled } = fresh();
    honor(c, 4);
    expect(c.reputation[4]).toBe(REPUTATION.gain);
    expect(c.reputation.reduce((a, b) => a + b, 0)).toBe(REPUTATION.gain);
    expect(settled[0]).toMatchObject({ outcome: 'done', trust: { before: 0, after: 1 } });
  });

  it('le niveau change au bon seuil, et l’hôte en est prévenu', () => {
    const { c, settled } = fresh();
    for (let i = 0; i < 3; i++) honor(c, 2);
    expect(settled.map((s) => [s.trust.before, s.trust.after])).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
    ]);
  });

  it('un retard retire un point, un abandon aussi', () => {
    const { c, settled } = fresh();
    c.reputation[5] = 4;
    const late = give(c, 5, { until: 100 });
    c.update(100);
    expect(settled[0]).toMatchObject({ outcome: 'late', trust: { before: 2, after: 2 } });
    expect(c.reputation[5]).toBe(4 - REPUTATION.late);
    const o = give(c, 5);
    expect(c.abandon(o.id)).toBe(true);
    expect(c.reputation[5]).toBe(4 - REPUTATION.late - REPUTATION.abandon);
    expect(c.get(late.id)).toBeUndefined();
  });

  it('on peut passer un niveau en dessous : la confiance se perd par paliers', () => {
    const { c, settled } = fresh();
    c.reputation[1] = 3; // Habitué
    c.abandon(give(c, 1).id);
    expect(settled[0].trust).toEqual({ before: 2, after: 1 });
    expect(c.reputation[1]).toBe(2);
  });

  it('jamais sous zéro : les clients sont doux', () => {
    const { c, settled } = fresh();
    c.abandon(give(c, 6).id);
    c.abandon(give(c, 6).id);
    expect(c.reputation[6]).toBe(0);
    expect(settled.every((s) => s.trust.before === 0 && s.trust.after === 0)).toBe(true);
  });

  it('jamais au-delà du plafond', () => {
    const { c } = fresh();
    for (let i = 0; i < REPUTATION.max + 5; i++) honor(c, 7);
    expect(c.reputation[7]).toBe(REPUTATION.max);
  });

  it('la sanction ne touche pas à ce qui est payé : le client règle toujours ce qui est livré', () => {
    const { c, settled } = fresh();
    const o = give(c, 8, { lines: [{ res: 'coal', qty: 10, done: 4 }] });
    c.abandon(o.id);
    expect(settled[0].paid).toBe(Math.round(baseValue({ lines: [{ res: 'coal', qty: 10, done: 4 }] }, true)));
  });

  it('une commande exclusive honorée donne le double', () => {
    const { c } = fresh();
    honor(c, 9, { exclusive: true });
    expect(c.reputation[9]).toBe(REPUTATION.exclusiveGain);
    expect(REPUTATION.exclusiveGain).toBeGreaterThan(REPUTATION.gain);
  });

  it('les clients de confiance se classent du plus fidèle au moins fidèle', () => {
    const { c } = fresh();
    c.reputation[3] = 2;
    c.reputation[10] = 7;
    c.reputation[1] = 2;
    expect(c.regulars().map((r) => [r.client, r.points])).toEqual([
      [10, 7],
      [1, 2],
      [3, 2],
    ]);
    expect(c.regulars()[0].trust.name).toBe('Fidèle');
  });
});

// ---------------------------------------------------------------- tirages

/** Fréquence de chaque client sur de nombreuses graines, sur les premières propositions. */
function frequency(prepare: (c: Contracts) => void, seeds = 120): number[] {
  const n = CLIENTS.map(() => 0);
  for (let seed = 1; seed <= seeds; seed++) {
    const { c } = fresh(seed);
    prepare(c);
    advance(c, 5, 60);
    for (const o of c.list) n[o.client]++;
  }
  return n;
}

describe('réputation : clients récurrents', () => {
  it('un client de confiance revient plus souvent', () => {
    const base = frequency(() => {});
    const loyal = frequency((c) => (c.reputation[5] = 8));
    expect(loyal[5]).toBeGreaterThan(base[5] * 2);
    // Les autres ne disparaissent pas pour autant.
    expect(loyal.filter((n, i) => i !== 5 && n > 0).length).toBe(CLIENTS.length - 1);
  });

  it('sans réputation, le tirage ne change pas : les parties neuves restent ce qu’elles étaient', () => {
    const sig = (c: Contracts) => JSON.stringify(c.list.map((o) => [o.id, o.lines, o.reward]));
    const a = fresh(11).c;
    const b = fresh(11).c;
    advance(a, 5, 400);
    advance(b, 5, 400);
    expect(sig(a)).toBe(sig(b));
  });

  it('le Tableau montre des visages différents : jamais deux commandes du même client en même temps', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { c } = fresh(seed, stub({ perks: () => ({ slots: 0, offers: 3, premium: 0 }) }));
      c.reputation[2] = 12;
      advance(c, 5, 900);
      const who = c.list.map((o) => o.client);
      expect(new Set(who).size).toBe(who.length);
    }
  });

  it('un client de confiance paie une meilleure prime et laisse plus de temps', () => {
    const avg = (points: number) => {
      let premium = 0;
      let limit = 0;
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const { c } = fresh(seed);
        c.reputation = CLIENTS.map(() => points);
        advance(c, 5, 60);
        for (const o of c.list) {
          premium += o.premium;
          limit += o.limit;
          n++;
        }
      }
      return { premium: premium / n, limit: limit / n };
    };
    const none = avg(0);
    const top = avg(10);
    expect(top.premium - none.premium).toBeGreaterThan(0.07);
    expect(top.premium - none.premium).toBeLessThan(0.09);
    expect(top.limit).toBeGreaterThan(none.limit * 1.1);
  });

  it('la prime reste plafonnée', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { c } = fresh(seed, stub({ completed: () => 40, perks: () => ({ slots: 0, offers: 0, premium: 1 }) }));
      c.reputation = CLIENTS.map(() => REPUTATION.max);
      advance(c, 5, 200);
      for (const o of c.list) expect(o.premium).toBeLessThanOrEqual(1.5);
    }
  });
});

// ---------------------------------------------------------------- exclusives

describe('réputation : commandes exclusives', () => {
  it('une partie qui n’a pas changé de rang n’en reçoit pas', () => {
    const { c } = fresh(3);
    advance(c, 5, 1500);
    expect(c.list.some((o) => o.exclusive)).toBe(false);
  });

  it('au premier rang atteint, la prochaine proposition est une exclusive, du client le plus fidèle', () => {
    let done = 0;
    const { c } = fresh(3, stub({ completed: () => done }));
    advance(c, 5, 100);
    c.list.length = 0;
    done = 3; // rang Fournisseur
    c.reputation[6] = 5;
    c.reputation[9] = 2;
    advance(c, 105, 400);
    const ex = c.list.filter((o) => o.exclusive);
    expect(ex).toHaveLength(1);
    expect(ex[0].client).toBe(6);
  });

  it('une seule par rang : les propositions suivantes sont ordinaires', () => {
    let done = 3;
    const { c } = fresh(3, stub({ completed: () => done }));
    advance(c, 5, 3000);
    expect(c.list.filter((o) => o.exclusive).length).toBeLessThanOrEqual(1);
    // Une fois la première arrivée et refusée, aucune autre ne revient au même rang.
    const first = c.list.find((o) => o.exclusive);
    if (first) c.decline(first.id, 3000);
    advance(c, 3005, 8000);
    expect(c.list.some((o) => o.exclusive)).toBe(false);
    // Un nouveau rang en redonne une.
    done = 8;
    let arrived = 0;
    for (let t = 8005; t <= 9000; t += 5) {
      c.update(t);
      arrived = Math.max(arrived, c.list.filter((o) => o.exclusive).length);
    }
    expect(arrived).toBe(1);
  });

  it('elle est plus grosse, mieux payée, plus longue et reste plus longtemps affichée', () => {
    const ex = REPUTATION.exclusive;
    for (let seed = 1; seed < 20; seed++) {
      let done = 0;
      const { c } = fresh(seed, stub({ completed: () => done }));
      done = 3;
      c.reputation[4] = 6;
      advance(c, 5, 400);
      const e = c.list.find((o) => o.exclusive)!;
      expect(e).toBeDefined();
      expect(e.lines.length).toBe(2); // plusieurs marchandises connues : une exclusive en demande deux
      expect(e.premium).toBeGreaterThan(CONTRACTS.premium[0] + ex.premium - 1e-9);
      expect(e.until - Math.ceil(e.until - CONTRACTS.offerLife * ex.life)).toBe(Math.ceil(CONTRACTS.offerLife * ex.life));
      expect(e.limit).toBeGreaterThan(900);
    }
  });

  it('une exclusive d’un client qu’on ne connaît pas encore est confiée au hasard parmi tous', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 60; seed++) {
      let done = 0;
      const { c } = fresh(seed, stub({ completed: () => done }));
      done = 3;
      advance(c, 5, 400);
      const e = c.list.find((o) => o.exclusive)!;
      expect(e.client).toBeGreaterThanOrEqual(0);
      expect(e.client).toBeLessThan(CLIENTS.length);
      seen.add(e.client);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('elle reste dans la capacité du Tableau', () => {
    let done = 3;
    const { c } = fresh(5, stub({ completed: () => done }));
    advance(c, 5, 2000);
    expect(c.offers().length).toBeLessThanOrEqual(c.capacity);
    done = 8;
    advance(c, 2005, 4000);
    expect(c.offers().length).toBeLessThanOrEqual(c.capacity);
  });
});

// ---------------------------------------------------------------- sauvegarde

describe('réputation : sauvegarde', () => {
  it('une partie neuve n’ajoute rien à la sauvegarde', () => {
    const { c } = fresh();
    advance(c, 5, 200);
    const s = c.serialize();
    expect(s.rep).toBeUndefined();
    expect(s.x).toBeUndefined();
    expect(s.list.every((e) => e.e === undefined)).toBe(true);
  });

  it('points, rang d’exclusive et marque « exclusive » reviennent à l’identique', () => {
    let done = 0;
    const host = stub({ completed: () => done });
    const a = new Contracts(3, host.host, quiet);
    done = 3;
    a.reputation[2] = 5;
    a.reputation[11] = 12;
    advance(a, 5, 400);
    expect(a.list.some((o) => o.exclusive)).toBe(true);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as ContractsSave;
    expect(saved.rep![2]).toBe(5);
    expect(saved.x).toBe(1);
    const b = new Contracts(3, stub({ completed: () => done }).host, quiet);
    b.load(saved, 400);
    expect(b.reputation).toEqual(a.reputation);
    expect(b.serialize()).toEqual(a.serialize());
    expect(b.list.filter((o) => o.exclusive).length).toBe(a.list.filter((o) => o.exclusive).length);
    // Le rang déjà servi ne donne pas une seconde exclusive après le chargement.
    advance(b, 405, 3000);
    expect(b.list.filter((o) => o.exclusive).length).toBeLessThanOrEqual(1);
  });

  it('une vieille sauvegarde sans réputation se charge : tout le monde à zéro', () => {
    const { c } = fresh();
    advance(c, 5, 200);
    const old = JSON.parse(JSON.stringify(c.serialize())) as ContractsSave;
    delete old.rep;
    delete old.x;
    const d = new Contracts(7, stub().host, quiet);
    d.load(old, 200);
    expect(d.reputation).toEqual(CLIENTS.map(() => 0));
    expect(d.list.length).toBe(c.list.length);
  });

  it('des valeurs absurdes sont ramenées à des valeurs saines', () => {
    const { c } = fresh();
    advance(c, 5, 200);
    const bad = JSON.parse(JSON.stringify(c.serialize())) as ContractsSave;
    bad.rep = [999, -5, 'x' as unknown as number, 1.5, NaN, 3];
    bad.x = 99;
    const d = new Contracts(7, stub().host, quiet);
    d.load(bad, 200);
    expect(d.reputation).toHaveLength(CLIENTS.length);
    for (const p of d.reputation) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(REPUTATION.max);
    }
    expect(d.reputation[5]).toBe(3);
    const worse = new Contracts(7, stub().host, quiet);
    worse.load({ ...bad, rep: 'oups' as unknown as number[], x: 'non' as unknown as number }, 200);
    expect(worse.reputation).toEqual(CLIENTS.map(() => 0));
  });
});

// ---------------------------------------------------------------- partie entière

describe('réputation : dans la partie', () => {
  function game(): GameState {
    const g = new GameState(7);
    g.stats.collected.coal = 1;
    g.stats.collected.copper = 1;
    return g;
  }

  it('honorer une commande donne confiance, annoncé par un événement', () => {
    const g = game();
    g.update(0.05, [{ mx: 0, my: 0, mine: false, target: null }]);
    const o: Contract = {
      id: 950,
      client: 3,
      lines: [{ res: 'coal', qty: 5, done: 0 }],
      reward: 100,
      premium: 0.4,
      hot: false,
      limit: 600,
      until: Math.ceil(g.time) + 600,
      accepted: true,
    };
    g.contracts.list.push(o);
    g.events.length = 0;
    g.contracts.deliver('coal', 5, o.id);
    expect(g.contracts.reputation[3]).toBe(1);
    const events = g.events;
    const e = events.find((x) => x.t === 'contract') as Extract<(typeof events)[number], { t: 'contract' }>;
    expect(e).toMatchObject({ kind: 'done', trust: { level: 1, up: true } });
    expect(e.exclusive).toBeFalsy();
  });

  it('la réputation fait partie de la partie sauvegardée et du résumé de synchro', () => {
    const a = game();
    a.contracts.reputation[2] = 4;
    const b = deserialize(JSON.parse(JSON.stringify(serialize(a))));
    expect(b.contracts.reputation[2]).toBe(4);
    expect(stateDigest(b)).toBe(stateDigest(a));
    b.contracts.reputation[2] = 5;
    expect(stateDigest(b)).not.toBe(stateDigest(a));
  });
});
