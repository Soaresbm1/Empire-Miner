import { describe, expect, it } from 'vitest';
import { REPUTATION } from '../src/data/contracts';
import { FAITHFUL_LEVEL, PHASES, PHASES_II } from '../src/data/project';
import { getResource } from '../src/data/resources';
import { WORKERS, WORKER_JOBS } from '../src/data/workers';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Project } from '../src/sim/Project';
import { Storage } from '../src/sim/structures/Storage';
import { sitePanel, siteNews, siteTitle, workName } from '../src/ui/site';
import { goTo, run } from './helpers';

const IDLE = { mx: 0, my: 0, mine: false, target: null };

/** Une partie dont le Grand Chevalement est achevé : l'acte II est ouvert. */
function actTwo(): GameState {
  const g = new GameState(7);
  g.project.phase = PHASES.length;
  g.project.doneAt = PHASES.map((_, i) => 100 * (i + 1));
  g.stats.contracts = 100;
  return g;
}

/** Livre tout ce que la phase en cours du chantier attend et verse les salaires. */
function supply(g: GameState): void {
  const p = g.work;
  for (const n of p.missing()) p.deliver(n.res, n.qty);
  p.fund(p.moneyLeft());
}

/** `n` clients vous font confiance au niveau « Fidèle ». */
function faithful(g: GameState, n: number): void {
  for (let i = 0; i < n; i++) g.contracts.reputation[i] = REPUTATION.levels[FAITHFUL_LEVEL].at;
}

describe('acte II : les données', () => {
  it('cinq phases, plus dures que l’acte I, avec des exigences qui montent', () => {
    expect(PHASES_II).toHaveLength(5);
    expect(new Set(PHASES_II.map((p) => p.id)).size).toBe(5);
    const last = PHASES[PHASES.length - 1];
    let contracts = last.contracts;
    let money = 0;
    let loyal = 0;
    for (const ph of PHASES_II) {
      expect(ph.contracts).toBeGreaterThan(contracts);
      expect(ph.faithful ?? 0).toBeGreaterThanOrEqual(loyal);
      expect(ph.money).toBeGreaterThan(money);
      contracts = ph.contracts;
      money = ph.money;
      loyal = ph.faithful ?? 0;
      expect(ph.needs.length).toBeGreaterThan(0);
      for (const n of ph.needs) {
        expect(getResource(n.res)).toBeDefined();
        expect(n.qty).toBeGreaterThan(0);
        expect(getResource(n.res).product).toBeTruthy(); // l'acte II réclame des produits de la Manufacture
      }
    }
    expect(PHASES_II[0].money).toBeGreaterThan(last.money / 4);
    expect(PHASES_II.every((p) => (p.faithful ?? 0) <= 16)).toBe(true); // il y a seize clients
  });

  it('les places d’équipe gagnées font passer de 9 à 12, sans dépasser les trois par métier', () => {
    const crew = PHASES_II.reduce((n, p) => n + (p.perk.crew ?? 0), 0);
    expect(WORKERS.max + crew).toBe(12);
    expect(WORKERS.hardMax).toBe(12);
    expect(WORKER_JOBS.length * WORKERS.perJob).toBe(12);
    expect(WORKERS.prices.length).toBeGreaterThanOrEqual(12);
    expect(WORKERS.prices.every((p, i) => i === 0 || p > WORKERS.prices[i - 1])).toBe(true);
  });

  it('un client est « fidèle » au niveau Fidèle de la réputation', () => {
    expect(REPUTATION.levels[FAITHFUL_LEVEL].name).toBe('Fidèle');
  });
});

describe('acte II : le chantier en cours', () => {
  it('au début, c’est le Grand Chevalement ; une fois achevé, le Grand Ascenseur', () => {
    const g = new GameState(7);
    expect(g.work).toBe(g.project);
    expect(g.worksDone).toBe(false);
    g.project.phase = PHASES.length;
    expect(g.work).toBe(g.project2);
    expect(g.work.spec!.id).toBe(PHASES_II[0].id);
    g.project2.phase = PHASES_II.length;
    expect(g.worksDone).toBe(true);
    expect(g.work.done).toBe(true);
  });

  it('les livraisons du joueur vont au chantier en cours', () => {
    const g = actTwo();
    g.inventory.items = { steel: 30, coal: 5 };
    goTo(g, 'site');
    expect(g.deliverToSite()).toBe(30);
    expect(g.project2.delivered.steel).toBe(30);
    expect(g.project.delivered).toEqual({});
    g.money = 5000;
    expect(g.fundSite()).toBe(5000);
    expect(g.project2.funded).toBe(5000);
  });

  it('une caisse d’expédition réglée sur « Chantier » livre à l’acte II', () => {
    const g = actTwo();
    const left = g.deliver('site', { steel: 10, coal: 4 }, g.structures.list[0]);
    expect(left).toEqual({ coal: 4 });
    expect(g.project2.delivered.steel).toBe(10);
  });

  it('les avantages des deux chantiers s’additionnent', () => {
    const g = actTwo();
    const base = g.perks();
    g.project2.phase = 3; // cage (+1 équipe), contrepoids (+1 commande), machinerie (+1 équipe, +5 points)
    const after = g.perks();
    expect(after.crew).toBe(base.crew + 2);
    expect(after.slots).toBe(base.slots + 1);
    expect(after.premium).toBeCloseTo(base.premium + 0.05, 9);
  });
});

describe('acte II : les phases avancent', () => {
  it('la fin de l’acte I annonce l’acte 1, puis l’acte II commence sans événement de fin', () => {
    const g = new GameState(7);
    g.stats.contracts = 99;
    for (let i = 0; i < PHASES.length; i++) {
      supply(g);
      g.update(0.1, [IDLE]);
    }
    const sites = g.events.filter((e) => e.t === 'site');
    expect(sites).toHaveLength(PHASES.length);
    expect(sites.every((e) => e.t === 'site' && e.act === 1)).toBe(true);
    expect(sites.map((e) => e.t === 'site' && e.last)).toEqual([false, false, false, false, true]);
    expect(g.project2.phase).toBe(0);
  });

  it('une phase de l’acte II attend aussi des clients fidèles', () => {
    const g = actTwo();
    supply(g);
    g.update(0.1, [IDLE]);
    expect(g.project2.phase).toBe(0); // personne ne vous fait encore confiance
    expect(g.contracts.faithfulCount()).toBe(0);
    faithful(g, PHASES_II[0].faithful! - 1 + 1);
    g.update(0.1, [IDLE]);
    expect(g.project2.phase).toBe(1);
    expect(g.events.some((e) => e.t === 'site' && e.act === 2 && e.phase === 0 && !e.last)).toBe(true);
  });

  it('pas assez de commandes honorées : elle attend, même avec des clients fidèles', () => {
    const g = actTwo();
    g.stats.contracts = PHASES_II[0].contracts - 1;
    faithful(g, 16);
    supply(g);
    g.update(0.1, [IDLE]);
    expect(g.project2.phase).toBe(0);
    g.stats.contracts = PHASES_II[0].contracts;
    g.update(0.1, [IDLE]);
    expect(g.project2.phase).toBe(1);
  });

  it('un client qui perd la confiance ne compte plus', () => {
    const g = actTwo();
    faithful(g, 2);
    expect(g.contracts.faithfulCount()).toBe(2);
    g.contracts.reputation[0] = REPUTATION.levels[FAITHFUL_LEVEL].at - 1;
    expect(g.contracts.faithfulCount()).toBe(1);
  });

  it('les cinq phases d’affilée : l’acte II s’achève, dernier événement marqué', () => {
    const g = actTwo();
    g.stats.contracts = 999;
    faithful(g, 16);
    for (let i = 0; i < PHASES_II.length; i++) {
      supply(g);
      g.update(0.1, [IDLE]);
    }
    expect(g.project2.done).toBe(true);
    expect(g.worksDone).toBe(true);
    const sites = g.events.filter((e) => e.t === 'site');
    expect(sites).toHaveLength(PHASES_II.length);
    expect(sites.every((e) => e.t === 'site' && e.act === 2)).toBe(true);
    expect(sites[sites.length - 1].t === 'site' && sites[sites.length - 1].last).toBe(true);
    expect(g.project2.doneAt).toHaveLength(PHASES_II.length);
  });

  it('Project : `ready` sans nombre de clients ne les exige pas (rétrocompatible)', () => {
    const p = new Project(PHASES_II);
    for (const n of p.missing()) p.deliver(n.res, n.qty);
    p.fund(p.moneyLeft());
    expect(p.ready(999)).toBe(true);
    expect(p.ready(999, 0)).toBe(false);
    expect(p.ready(999, PHASES_II[0].faithful!)).toBe(true);
    expect(p.ready(PHASES_II[0].contracts - 1, 99)).toBe(false);
  });
});

describe('acte II : l’équipe d’ouvriers passe à douze', () => {
  function workshop(): GameState {
    const g = actTwo();
    g.money = 1e6;
    g.pickaxeLevel = 3;
    goTo(g, 'workshop');
    return g;
  }

  it('sans le Grand Ascenseur, neuf ouvriers au plus, et le message dit comment en avoir plus', () => {
    const g = workshop();
    for (let i = 0; i < 9; i++) expect(g.hireWorker(WORKER_JOBS[i % 4].id)).toBe(true);
    expect(g.maxWorkers).toBe(9);
    expect(g.nextWorkerPrice).toBeNull();
    expect(g.workerHireBlocker('courier')).toContain('Grand Ascenseur');
    expect(g.hireWorker('courier')).toBe(false);
  });

  it('chaque place gagnée s’ouvre, jusqu’à douze, trois par métier', () => {
    const g = workshop();
    for (let i = 0; i < 9; i++) g.hireWorker(WORKER_JOBS[i % 4].id);
    for (let phase = 1; phase <= PHASES_II.length; phase++) {
      g.project2.phase = phase;
      const crew = PHASES_II.slice(0, phase).reduce((n, p) => n + (p.perk.crew ?? 0), 0);
      expect(g.maxWorkers).toBe(9 + crew);
      expect(g.workerSlots).toBe(9 + crew);
      while (g.workers.count < 9 + crew) expect(g.hireWorker(WORKER_JOBS[g.workers.count % 4].id)).toBe(true);
      expect(g.hireWorker('picker')).toBe(false);
    }
    expect(g.workers.count).toBe(12);
    for (const j of WORKER_JOBS) expect(g.workerCount(j.id)).toBe(3);
    expect(g.workerHireBlocker('picker')).toBe('Équipe complète');
  });

  it('les prix continuent de monter au-delà du neuvième ouvrier', () => {
    const g = workshop();
    g.project2.phase = PHASES_II.length;
    const paid: number[] = [];
    while (g.workers.count < 12) {
      const before = g.money;
      expect(g.hireWorker(WORKER_JOBS[g.workers.count % 4].id)).toBe(true);
      paid.push(before - g.money);
    }
    expect(paid).toEqual(WORKERS.prices.slice(0, 12));
  });
});

describe('acte II : sauvegarde', () => {
  it('l’acte II est sauvegardé et retrouvé, avec les ouvriers de plus', () => {
    const g = actTwo();
    g.project2.phase = 3;
    g.project2.doneAt = [10, 20, 30];
    g.project2.delivered = { gold_plate: 12 };
    g.project2.funded = 777;
    for (let i = 0; i < 11; i++) g.workers.add(WORKER_JOBS[i % 4].id, g);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(b.project2.serialize()).toEqual(g.project2.serialize());
    expect(b.workers.count).toBe(11); // 9 + 2 places gagnées (phases 1 et 3 de l'acte II)
    expect(stateDigest(b)).toBe(stateDigest(g));
  });

  it('une ancienne partie dont le monument est achevé reçoit l’acte II, à zéro', () => {
    const g = actTwo();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.project2;
    const b = deserialize(data);
    expect(b.project.done).toBe(true);
    expect(b.project2.phase).toBe(0);
    expect(b.work).toBe(b.project2);
    expect(b.project2.spec!.id).toBe(PHASES_II[0].id);
  });

  it('une ancienne partie en plein acte I n’est pas touchée', () => {
    const g = new GameState(7);
    g.project.phase = 2;
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.project2;
    const b = deserialize(data);
    expect(b.project.phase).toBe(2);
    expect(b.work).toBe(b.project);
  });

  it('des valeurs absurdes sont ramenées à des valeurs saines', () => {
    const g = actTwo();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.project2 = { phase: 99, delivered: { steel: 'beaucoup', bidon: 5 }, funded: -4, doneAt: ['x'] };
    const b = deserialize(data);
    expect(b.project2.phase).toBe(PHASES_II.length);
    expect(b.project2.doneAt).toHaveLength(PHASES_II.length);
    expect(b.worksDone).toBe(true);
  });

  it('plus d’ouvriers que de places dans une sauvegarde : l’équipe est plafonnée à ce que le chantier permet', () => {
    const g = new GameState(7);
    for (let i = 0; i < 12; i++) g.workers.add(WORKER_JOBS[i % 4].id, g);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(b.workers.count).toBe(9);
  });

  it('ce qui avait été livré à une phase qui a changé est rendu', () => {
    const g = actTwo();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.project2 = { phase: 0, delivered: { copper: 30, steel: 10 }, funded: 0, doneAt: [] };
    const b = deserialize(data);
    expect(b.project2.delivered).toEqual({ steel: 10 });
    expect(b.inventory.count('copper') + b.drops.list.reduce((n, d) => n + (d.res === 'copper' ? d.count : 0), 0)).toBeGreaterThanOrEqual(30);
  });
});

describe('acte II : les livreurs', () => {
  it('un livreur apporte à l’acte II ce que la phase en cours attend', () => {
    const g = actTwo();
    const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
    c.put('steel', 20);
    g.workers.add('courier', g);
    run(g, 60);
    expect(g.project2.delivered.steel).toBe(20);
    expect(g.project.delivered).toEqual({});
  });

  it('tout achevé, ils n’ont plus rien à livrer au chantier', () => {
    const g = actTwo();
    g.project2.phase = PHASES_II.length;
    const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
    c.put('steel', 20);
    const w = g.workers.add('courier', g);
    run(g, 10);
    expect(c.items.steel).toBe(20);
    expect(w.cargo).toEqual({});
  });
});

describe('acte II : l’interface', () => {
  it('le titre et le nom du chantier suivent l’acte', () => {
    const g = new GameState(7);
    expect(siteTitle(g)).toBe('Grand Chevalement');
    g.project.phase = PHASES.length;
    expect(siteTitle(g)).toBe('Grand Ascenseur');
    expect(siteTitle(g, 'victory')).toBe('Grand Chevalement'); // l'écran de fin de l'acte qui vient de s'achever
    expect(siteTitle(g, 'victory1')).toBe('Grand Chevalement');
    g.project2.phase = PHASES_II.length;
    expect(siteTitle(g, 'victory')).toBe('Grand Ascenseur');
    expect(workName(1)).toBe('Grand Chevalement');
    expect(workName(2)).toBe('Grand Ascenseur');
  });

  it('le panneau de l’acte II : bandeau, phase, frise, clients fidèles, récompense', () => {
    const g = actTwo();
    const html = sitePanel(g);
    expect(html).toContain('Acte II');
    expect(html).toContain(`Phase 1 sur ${PHASES_II.length}`);
    expect(html).toContain(PHASES_II[0].name);
    expect((html.match(/<li class="(done|now|next)"/g) ?? []).length).toBe(PHASES_II.length);
    for (const n of PHASES_II[0].needs) expect(html).toContain(`0 / ${n.qty}`);
    expect(html).toContain('Clients fidèles');
    expect(html).toContain(`0 / ${PHASES_II[0].faithful}`);
    expect(html).toContain(PHASES_II[0].perk.text);
    expect(html).toContain('data-arg="victory1"'); // revoir l'acte I
    expect(html).toContain('data-action="siteDeliver"');
    // Les avantages de l'acte I sont des « acquis ».
    expect(html).toContain(PHASES[0].perk.text);
  });

  it('l’acte I n’a pas de ligne « Clients fidèles » ni de bandeau d’acte', () => {
    const html = sitePanel(new GameState(7));
    expect(html).not.toContain('Clients fidèles');
    expect(html).not.toContain('Acte II');
  });

  it('tout est livré mais personne n’est fidèle : le panneau dit qu’on attend des clients', () => {
    const g = actTwo();
    supply(g);
    expect(sitePanel(g)).toContain('vous fasse confiance');
    expect(sitePanel(g)).toContain('0 pour l');
    faithful(g, 1);
    expect(sitePanel(g)).not.toContain('vous fasse confiance');
  });

  it('les clients fidèles comptés sont ceux qui ont la confiance voulue', () => {
    const g = actTwo();
    faithful(g, 1);
    expect(sitePanel(g)).toContain(`1 / ${PHASES_II[0].faithful}`);
  });

  it('les écrans de fin : acte I (vers l’acte II) puis acte II (continuer à jouer)', () => {
    const g = new GameState(7);
    g.project.phase = PHASES.length;
    const one = sitePanel(g, 'victory');
    expect(one).toContain('Empereur de la mine');
    expect(one).toContain('Ouvrir le Grand Ascenseur');
    expect(one).toContain('12 ouvriers');
    expect(one).not.toContain('data-action="close"');
    expect(sitePanel(g, 'victory1')).toContain('Empereur de la mine');
    g.project2.phase = PHASES_II.length;
    const two = sitePanel(g);
    expect(two).toContain('Roi des profondeurs');
    expect(two).toContain('Continuer à jouer');
    expect(two).not.toContain('Ouvrir le Grand Ascenseur');
  });

  it('les annonces disent de quel chantier il s’agit', () => {
    expect(siteNews(0, false, 1)).toContain('Grand Chevalement');
    expect(siteNews(0, false, 2)).toContain('Grand Ascenseur');
    expect(siteNews(0, false, 2)).toContain(PHASES_II[0].name);
    expect(siteNews(4, true, 1)).toContain('Grand Ascenseur vous attend');
    expect(siteNews(4, true, 2)).toContain('Roi des profondeurs');
    expect(siteNews(99, false, 2)).toContain('Grand Ascenseur');
  });
});

describe('acte II : deux appareils', () => {
  it('deux copies qui avancent ensemble restent identiques, y compris après une resynchronisation', () => {
    const make = () => {
      const g = actTwo();
      faithful(g, 3);
      supply(g);
      return g;
    };
    const a = make();
    const b = make();
    run(a, 2);
    run(b, 2);
    expect(a.project2.phase).toBe(1);
    expect(stateDigest(a)).toBe(stateDigest(b));
    const c = deserialize(JSON.parse(JSON.stringify(serialize(a))));
    run(a, 5);
    run(c, 5);
    expect(stateDigest(a)).toBe(stateDigest(c));
  });
});
