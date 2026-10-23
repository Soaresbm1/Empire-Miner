import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { AIR } from '../src/data/blocks';
import { CLIENTS } from '../src/data/contracts';
import { PHASES, PHASES_II } from '../src/data/project';
import { resourceIndex } from '../src/data/resources';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import type { Contract } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import { RECAP_KEYS, RECAP_MIN_SECONDS, hasNews, parseRecap, recapSince, snapshot, type Recap } from '../src/sim/Recap';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { recapPanel } from '../src/ui/recap';
import { run } from './helpers';

const empty = (): Recap => Object.fromEntries(RECAP_KEYS.map((k) => [k, 0])) as unknown as Recap;
const recap = (over: Partial<Recap>): Recap => ({ ...empty(), ...over });

describe('bilan : les chiffres', () => {
  it('le bilan est la différence des compteurs depuis le début de la session', () => {
    const g = new GameState(4);
    const base = snapshot(g);
    g.stats.earned += 500;
    g.stats.spent += 120;
    g.stats.contracts += 3;
    g.stats.tilesMined += 40;
    g.stats.playTime += 600;
    g.stats.crewStored += 25;
    g.stats.crewDelivered += 7;
    g.stats.maxDepth += 30;
    g.project.phase = 1;
    const r = recapSince(base, g);
    expect(r).toMatchObject({ seconds: 600, earned: 500, spent: 120, contracts: 3, mined: 40, crewStored: 25, crewDelivered: 7, depth: 30, phases: 1 });
    expect(r.crafted).toBe(0);
  });

  it('jamais de valeur négative : un recul ne s’affiche pas', () => {
    const g = new GameState(4);
    g.stats.earned = 900;
    const base = snapshot(g);
    g.stats.earned = 100; // sauvegarde rechargée plus ancienne
    expect(recapSince(base, g).earned).toBe(0);
  });

  it('les phases des deux actes comptent, et les clients devenus fidèles', () => {
    const g = new GameState(4);
    g.project.phase = PHASES.length;
    const base = snapshot(g);
    expect(base.phases).toBe(PHASES.length);
    g.project2.phase = 2;
    g.contracts.reputation[0] = 7;
    g.contracts.reputation[1] = 9;
    const r = recapSince(base, g);
    expect(r.phases).toBe(2);
    expect(r.faithful).toBe(2);
    expect(PHASES_II.length).toBeGreaterThan(2);
  });

  it('une valeur lue dans une sauvegarde : saine ou ignorée', () => {
    const ok = recap({ seconds: 300, earned: 1234 });
    expect(parseRecap(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(parseRecap(null)).toBeNull();
    expect(parseRecap('oups')).toBeNull();
    expect(parseRecap({})).toBeNull(); // pas de temps de jeu : rien à montrer
    expect(parseRecap({ seconds: 'x' })).toBeNull();
    const bad = parseRecap({ seconds: 10, earned: -5, spent: NaN, mined: 'beaucoup', contracts: 1e30, built: Infinity })!;
    expect(bad.earned).toBe(0);
    expect(bad.spent).toBe(0);
    expect(bad.mined).toBe(0);
    expect(bad.built).toBe(0);
    expect(bad.contracts).toBeLessThanOrEqual(1e12);
  });

  it('« hasNews » : au-delà du seul temps de jeu', () => {
    expect(hasNews(recap({ seconds: 900 }))).toBe(false);
    expect(hasNews(recap({ seconds: 900, mined: 1 }))).toBe(true);
  });
});

describe('bilan : ce que font les ouvriers', () => {
  const chest = (g: GameState) => g.structures.add(new Storage(46, 10, 1)) as Storage;

  it('un ramasseur compte les objets qu’il range', () => {
    const g = new GameState(4);
    chest(g);
    g.workers.add('picker', g);
    g.drops.spawn('copper', 4, 47.5 * 16, 10.5 * 16, false);
    run(g, 15);
    expect(g.stats.crewStored).toBe(4);
  });

  it('un ravitailleur compte le combustible qu’il apporte', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.put('coal', 20);
    const d = g.structures.add(new Drill(56, 9, 1)) as Drill;
    d.fuelUnits = 0;
    g.workers.add('refueler', g);
    run(g, 20);
    expect(g.stats.crewFueled).toBe(d.fuelMax);
  });

  it('un foreur compte les foreuses qu’il pose', () => {
    const g = new GameState(4);
    g.workers.add('driller', g);
    const S = SURFACE_ROWS;
    g.world.set(50, S + 14, AIR);
    g.world.setDeposit(50, S + 14, resourceIndex('copper'), 60);
    g.world.explored[g.world.idx(50, S + 14)] = 1;
    g.inventory.addKit('drill', 1);
    run(g, 30);
    expect(g.stats.crewPlaced).toBe(1);
  });

  it('un livreur compte les objets qu’il livre', () => {
    const g = new GameState(4);
    g.project.phase = PHASES.length;
    g.project2.phase = PHASES_II.length; // seules les commandes comptent
    const c = chest(g);
    c.put('gold', 8);
    const o: Contract = { id: 901, client: 0, lines: [{ res: 'gold', qty: 8, done: 0 }], reward: 100, premium: 0.4, hot: false, limit: 600, until: 700, accepted: true };
    g.contracts.list.push(o);
    g.workers.add('courier', g);
    run(g, 40);
    expect(g.stats.crewDelivered).toBe(8);
  });

  it('les anciennes sauvegardes (sans ces compteurs) repartent à zéro', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    for (const k of ['crewStored', 'crewFueled', 'crewPlaced', 'crewDelivered']) delete data.stats[k];
    const b = deserialize(data);
    expect(b.stats.crewStored).toBe(0);
    expect(b.stats.crewDelivered).toBe(0);
  });
});

describe('bilan : la sauvegarde', () => {
  /** Une partie ouverte depuis un moment : `seconds` de jeu depuis le début de la session. */
  function played(seconds: number): GameState {
    const g = new GameState(4);
    g.sessionBase = snapshot(g);
    g.stats.playTime += seconds;
    g.stats.earned += 777;
    g.stats.tilesMined += 12;
    return g;
  }

  it('la session en cours est écrite dans la sauvegarde si elle a duré assez, et lue à la reprise', () => {
    const g = played(RECAP_MIN_SECONDS + 60);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    expect(data.recap).toMatchObject({ seconds: RECAP_MIN_SECONDS + 60, earned: 777, mined: 12 });
    const b = deserialize(data);
    expect(b.lastSession).toMatchObject({ earned: 777, mined: 12 });
    expect(b.sessionBase).toBeNull(); // le jeu prend les compteurs de départ à l'ouverture
  });

  it('une session trop courte n’efface pas le bilan de la précédente', () => {
    const g = played(RECAP_MIN_SECONDS + 60);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    b.sessionBase = snapshot(b);
    b.stats.playTime += 20;
    b.stats.earned += 5;
    const again = JSON.parse(JSON.stringify(serialize(b)));
    expect(again.recap.earned).toBe(777); // la précédente, pas ces 20 secondes
    // Une longue session, elle, la remplace.
    b.stats.playTime += 400;
    b.stats.earned += 4000;
    expect(JSON.parse(JSON.stringify(serialize(b))).recap.earned).toBe(4005);
  });

  it('rien d’écrit quand il n’y a rien à dire (une partie neuve, ou sans session)', () => {
    expect(serialize(new GameState(4)).recap).toBeUndefined();
    expect(serialize(played(30)).recap).toBeUndefined();
  });

  it('jamais dans l’empreinte de synchronisation : deux appareils, deux sessions', () => {
    const a = new GameState(4);
    const b = new GameState(4);
    a.sessionBase = snapshot(a);
    b.lastSession = recap({ seconds: 999, earned: 1 });
    a.stats.playTime += 500;
    b.stats.playTime += 500;
    expect(stateDigest(a)).toBe(stateDigest(b));
    expect(serialize(a, { world: false }).recap).toBeUndefined();
    expect(serialize(b, { world: false }).recap).toBeUndefined();
  });

  it('une sauvegarde sans bilan, ou avec un bilan absurde, se charge', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    expect(deserialize(data).lastSession).toBeNull();
    data.recap = { seconds: -3, earned: 'beaucoup' };
    expect(deserialize(data).lastSession).toBeNull();
    data.recap = 42;
    expect(deserialize(data).lastSession).toBeNull();
  });
});

describe('bilan : l’écran', () => {
  function withSession(): GameState {
    const g = new GameState(4);
    g.lastSession = recap({ seconds: 47 * 60, earned: 12300, contracts: 5, mined: 214, crewStored: 90, crewDelivered: 12 });
    g.sessionBase = snapshot(g);
    g.stats.playTime += 600;
    g.stats.earned += 800;
    g.stats.crewFueled += 6;
    return g;
  }

  it('à la reprise : la dernière session d’abord, avec ce que les ouvriers ont fait', () => {
    const html = recapPanel(withSession(), 'resume');
    expect(html).toContain('Bon retour');
    expect(html.indexOf('Dernière session')).toBeGreaterThan(-1);
    expect(html.indexOf('Dernière session')).toBeLessThan(html.indexOf('Cette session'));
    expect(html).toContain('47 min');
    expect(html).toContain('Commandes honorées');
    expect(html).toContain('<b>90</b> objets rangés');
    expect(html).toContain('<b>12</b> objets livrés');
    expect(html).toContain('data-action="close"');
  });

  it('au menu pause : la session en cours d’abord', () => {
    const html = recapPanel(withSession(), 'now');
    expect(html).not.toContain('Bon retour');
    expect(html.indexOf('Cette session')).toBeLessThan(html.indexOf('Dernière session'));
    expect(html).toContain('10 min');
    expect(html).toContain('<b>6</b> charges de charbon apportées');
  });

  it('seul ce qui a bougé est montré', () => {
    const g = new GameState(4);
    g.sessionBase = snapshot(g);
    g.stats.playTime += 300;
    g.stats.tilesMined += 9;
    const html = recapPanel(g, 'now');
    expect(html).toContain('Blocs minés');
    expect(html).not.toContain('Lingots fondus');
    expect(html).not.toContain('Vos ouvriers');
    expect(html).not.toContain('Dernière session');
  });

  it('à surveiller : un ouvrier bloqué, une commande presque en retard, le chantier et sa prévision', () => {
    const g = new GameState(4);
    g.time = 1000;
    const w = g.workers.add('courier', g);
    w.flag = 'nogoods';
    const o: Contract = { id: 5, client: 3, lines: [{ res: 'coal', qty: 20, done: 0 }], reward: 100, premium: 0.4, hot: false, limit: 600, until: 1000 + 200, accepted: true };
    g.contracts.list.push(o);
    const html = recapPanel(g, 'now');
    expect(html).toContain('À surveiller');
    expect(html).toContain('Livreur : rien de ce qui est attendu dans les coffres');
    expect(html).toContain('Maison Bertrand &amp; Fils'); // échappé
    expect(html).not.toContain('Maison Bertrand & Fils');
    expect(html).toContain('3:20');
    expect(html).toContain('Grand Chevalement');
    expect(html).toContain('phase 1 sur');
    expect(html).toContain('Fondations');
    expect(CLIENTS[3]).toBe('Maison Bertrand & Fils');
  });

  it('une commande loin de l’échéance, ou déjà livrée en entier, n’est pas signalée', () => {
    const g = new GameState(4);
    g.time = 1000;
    g.project.phase = PHASES.length;
    g.project2.phase = PHASES_II.length;
    g.contracts.list.push({ id: 5, client: 0, lines: [{ res: 'coal', qty: 20, done: 0 }], reward: 100, premium: 0.4, hot: false, limit: 600, until: 1000 + 3000, accepted: true });
    g.contracts.list.push({ id: 6, client: 1, lines: [{ res: 'coal', qty: 20, done: 20 }], reward: 100, premium: 0.4, hot: false, limit: 600, until: 1000 + 30, accepted: true });
    const html = recapPanel(g, 'now');
    expect(html).toContain('Rien à signaler');
    expect(html).not.toContain('plus que');
  });

  it('au chantier de l’acte II, il dit lequel', () => {
    const g = new GameState(4);
    g.project.phase = PHASES.length;
    expect(recapPanel(g, 'now')).toContain('Grand Ascenseur');
  });
});
