import { describe, expect, it } from 'vitest';
import { TILE } from '../src/core/constants';
import { COURIER_CAPACITY, WORKERS, capacityOf, getJob } from '../src/data/workers';
import { PHASES, PHASES_II } from '../src/data/project';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { stateDigest } from '../src/net/digest';
import { baseValue, type Contract } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import { Storage } from '../src/sim/structures/Storage';
import { cargoWeight, walkable } from '../src/sim/Workers';
import { workerStatus, workerTooltip, stuckWorkers } from '../src/ui/crew';
import { run } from './helpers';

const chest = (g: GameState, tx = 46, ty = 10) => g.structures.add(new Storage(tx, ty, 1)) as Storage;

/** `n` coffres posés sur des cases libres du camp, accessibles à pied. */
function chests(g: GameState, n: number): Storage[] {
  const out: Storage[] = [];
  for (let x = 30; x < 80 && out.length < n; x++) {
    const ty = 10;
    if (g.world.isSolid(x, ty) || g.structures.at(x, ty) || !walkable(g, x - 1, ty) || !walkable(g, x + 1, ty)) continue;
    out.push(chest(g, x, ty));
    x++; // un coffre sur deux : on peut passer entre
  }
  expect(out).toHaveLength(n);
  return out;
}

let ids = 900;
/** Glisse une commande faite main dans la partie (acceptée par défaut). */
function order(g: GameState, lines: [string, number][], over: Partial<Contract> = {}): Contract {
  const c: Contract = {
    id: ids++,
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
  c.reward = Math.round(baseValue(c) * 1.4);
  g.contracts.list.push(c);
  return c;
}

function game(): GameState {
  const g = new GameState(7);
  g.stats.collected.coal = 1;
  g.stats.collected.copper = 1;
  return g;
}

const need = (res: string) => PHASES[0].needs.find((n) => n.res === res)!.qty;

describe('livreur : le métier', () => {
  it('un quatrième métier, avec sa couleur, et une charge double', () => {
    const j = getJob('courier');
    expect(j.name).toBe('Livreur');
    expect(j.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(['picker', 'refueler', 'driller', 'courier'].map((id) => getJob(id as 'picker').color)).size).toBe(4);
    expect(capacityOf('courier')).toBe(COURIER_CAPACITY);
    expect(COURIER_CAPACITY).toBe(2 * WORKERS.capacity);
    expect(capacityOf('picker')).toBe(WORKERS.capacity);
  });

  it('trois livreurs au plus, comme les autres métiers', () => {
    const g = new GameState(4);
    g.money = 100_000;
    g.pickaxeLevel = 3;
    g.player.x = (g.structures.list.find((s) => s.type === 'workshop')!.x + 1) * TILE;
    g.player.y = (g.structures.list.find((s) => s.type === 'workshop')!.y + 3) * TILE;
    for (let i = 0; i < 3; i++) expect(g.hireWorker('courier')).toBe(true);
    expect(g.workerHireBlocker('courier')).toMatch(/livreurs au plus/);
    expect(g.workerCount('courier')).toBe(3);
  });
});

describe('livreur : le chantier', () => {
  it('prend dans un coffre ce que la phase attend et le livre au chantier', () => {
    const g = game();
    const c = chest(g);
    c.put('coal', 40);
    const w = g.workers.add('courier', g);
    run(g, 40);
    expect(g.project.delivered.coal).toBe(40);
    expect(c.items.coal ?? 0).toBe(0);
    expect(w.flag).toBe('nogoods'); // le charbon ne suffit pas : il manque du cuivre et des lingots
  });

  it('ne livre jamais plus que ce que la phase attend, et le reste du coffre reste au coffre', () => {
    const g = game();
    const c = chest(g);
    const stocked = c.put('coal', 100); // un coffre ne prend pas plus de 100 charbons
    g.workers.add('courier', g);
    run(g, 120);
    expect(g.project.delivered.coal).toBe(need('coal'));
    expect(c.items.coal).toBe(stocked - need('coal'));
  });

  it('ne touche à rien de ce que personne n’attend', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 5);
    c.put('silver_ingot', 5);
    const w = g.workers.add('courier', g);
    run(g, 20);
    expect(c.items).toEqual({ gold: 5, silver_ingot: 5 });
    expect(w.cargo).toEqual({});
    // Le chantier attend du charbon, du cuivre… que ce coffre n'a pas : il le dit, il ne vole pas autre chose.
    expect(w.flag).toBe('nogoods');
  });

  it('plusieurs trajets quand la charge ne suffit pas, 30 kg à la fois', () => {
    const g = game();
    const [a, b] = chests(g, 2);
    a.put('copper', 50);
    b.put('copper', 50); // un coffre ne contient pas plus de 50 cuivres
    const w = g.workers.add('courier', g);
    let heaviest = 0;
    for (let t = 0; t < 400 && (g.project.delivered.copper ?? 0) < need('copper'); t += 1 / 20) {
      run(g, 1 / 20);
      heaviest = Math.max(heaviest, cargoWeight(w.cargo));
    }
    expect(g.project.delivered.copper).toBe(need('copper'));
    expect(heaviest).toBeGreaterThan(WORKERS.capacity); // il porte plus qu'un ramasseur
    expect(heaviest).toBeLessThanOrEqual(COURIER_CAPACITY + 1e-6);
  });

  it('la phase se termine toute seule quand il apporte le dernier matériau', () => {
    const g = game();
    g.money = 5000;
    g.stats.contracts = 3;
    const [a, b, d, e] = chests(g, 4);
    a.put('coal', 80);
    b.put('copper', 50);
    d.put('copper', 50);
    e.put('copper_ingot', 30);
    g.workers.add('courier', g);
    g.workers.add('courier', g);
    // L'argent des ouvriers se verse au chantier : on le fait à la main, c'est le seul geste qui reste au joueur.
    g.project.fund(PHASES[0].money);
    run(g, 500);
    expect(g.project.phase).toBeGreaterThanOrEqual(1);
  });
});

describe('livreur : les commandes', () => {
  it('apporte au Tableau d’affichage ce qu’une commande acceptée attend : elle est honorée et payée', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 12);
    const o = order(g, [['gold', 8]]);
    const money = g.money;
    g.workers.add('courier', g);
    run(g, 40);
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(g.money - money).toBe(o.reward);
    expect(g.stats.contracts).toBe(1);
    expect(c.items.gold).toBe(4);
  });

  it('une simple proposition (pas encore acceptée) ne l’intéresse pas', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 12);
    order(g, [['gold', 8]], { accepted: false });
    const w = g.workers.add('courier', g);
    run(g, 20);
    expect(c.items.gold).toBe(12);
    expect(w.cargo).toEqual({});
  });

  it('une commande à deux lignes : il apporte les deux', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 3);
    c.put('silver', 6);
    const o = order(g, [['gold', 3], ['silver', 6]]);
    g.workers.add('courier', g);
    run(g, 60);
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(g.stats.contracts).toBe(1);
  });

  it('la commande la plus pressée passe avant le chantier', () => {
    const g = game();
    const c = chest(g);
    // Un seul voyage possible : 30 kg. Le charbon (3 kg) du chantier et l'or (3,5 kg) de la commande tiennent pas tous ensemble.
    c.put('coal', 30);
    c.put('gold', 8);
    const o = order(g, [['gold', 8]]);
    const w = g.workers.add('courier', g);
    // Après la première prise, la charge contient d'abord l'or de la commande.
    let first: Record<string, number> = {};
    for (let t = 0; t < 30 && !Object.keys(first).length; t += 1 / 30) {
      run(g, 1 / 30);
      if (cargoWeight(w.cargo) > 0) first = { ...w.cargo };
    }
    expect(first.gold).toBe(8);
    run(g, 60);
    expect(g.contracts.get(o.id)).toBeUndefined();
  });

  it('une charge dont plus personne ne veut retourne au coffre', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 8);
    const o = order(g, [['gold', 8]]);
    const w = g.workers.add('courier', g);
    // Il part chercher l'or ; la commande est abandonnée avant la livraison.
    for (let t = 0; t < 30 && !(w.cargo.gold > 0); t += 1 / 30) run(g, 1 / 30);
    expect(w.cargo.gold).toBe(8);
    g.contracts.abandon(o.id);
    run(g, 40);
    expect(w.cargo).toEqual({});
    expect(c.items.gold).toBe(8);
  });

  it('l’échéance passe pendant la tournée : même retour au coffre', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 8);
    const o = order(g, [['gold', 8]], { until: Math.ceil(g.time) + 4 });
    const w = g.workers.add('courier', g);
    run(g, 60);
    expect(g.contracts.get(o.id)).toBeUndefined();
    // Soit livrée à temps, soit remise au coffre : rien ne reste sur lui, rien n'est perdu.
    expect(w.cargo).toEqual({});
    expect(o.lines[0].done + (c.items.gold ?? 0)).toBe(8);
  });
});

describe('livreur : plusieurs livreurs', () => {
  it('deux livreurs ne portent jamais plus que ce qui est attendu', () => {
    const g = game();
    const c = chest(g);
    c.put('gold', 40);
    const o = order(g, [['gold', 10]]);
    const a = g.workers.add('courier', g);
    const b = g.workers.add('courier', g);
    let most = 0;
    for (let t = 0; t < 60 && g.contracts.get(o.id); t += 1 / 30) {
      run(g, 1 / 30);
      most = Math.max(most, (a.cargo.gold ?? 0) + (b.cargo.gold ?? 0));
    }
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(most).toBeLessThanOrEqual(10);
    run(g, 20);
    expect((c.items.gold ?? 0) + (a.cargo.gold ?? 0) + (b.cargo.gold ?? 0)).toBe(30);
  });

  it('chantier et commande en même temps : tout arrive, sans doublon', () => {
    const g = game();
    const c = chest(g);
    const [, d] = chests(g, 2);
    const stocked = c.put('coal', 100);
    d.put('gold', 12);
    const o = order(g, [['gold', 12]]);
    g.workers.add('courier', g);
    g.workers.add('courier', g);
    run(g, 200);
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(g.project.delivered.coal).toBe(need('coal'));
    expect(c.items.coal).toBe(stocked - need('coal'));
  });
});

describe('livreur : blocages', () => {
  it('rien dans les coffres de ce qui est attendu : « nogoods », puis il repart dès que le joueur dépose ce qu’il faut', () => {
    const g = game();
    const c = chest(g);
    g.project.phase = PHASES.length; // les chantiers n'attendent rien : seule la commande compte
    g.project2.phase = PHASES_II.length;
    const o = order(g, [['gold', 4]]);
    const w = g.workers.add('courier', g);
    run(g, 6);
    expect(w.flag).toBe('nogoods');
    expect(workerStatus(g, w).tone).toBe('warn');
    expect(stuckWorkers(g).some((s) => s.text.startsWith('Livreur'))).toBe(true);
    expect(workerTooltip(g, w)).toContain('coffre');
    c.put('gold', 4);
    run(g, 40);
    expect(g.contracts.get(o.id)).toBeUndefined();
    expect(w.flag).toBeNull();
  });

  it('un coffre qui a ce qu’on attend mais qu’on ne peut pas approcher : « lost », pas « nogoods »', () => {
    const g = game();
    g.project.phase = PHASES.length;
    g.project2.phase = PHASES_II.length;
    const buried = chest(g, 46, 40); // en pleine roche, aucune case libre autour
    expect(g.world.isSolid(46, 40)).toBe(true);
    buried.put('gold', 6);
    const o = order(g, [['gold', 4]]);
    const w = g.workers.add('courier', g);
    run(g, 10);
    expect(w.flag).toBe('lost');
    expect(workerStatus(g, w).tone).toBe('warn');
    expect(g.contracts.get(o.id)).toBeDefined();
  });

  it('au repos quand il n’y a rien à livrer : pas de blocage', () => {
    const g = new GameState(4);
    g.project.phase = PHASES.length; // monuments achevés, aucune commande : rien n'est attendu
    g.project2.phase = PHASES_II.length;
    const w = g.workers.add('courier', g);
    run(g, 5);
    expect(w.flag).toBeNull();
    expect(w.task).toBeNull();
    expect(workerStatus(g, w).tone).toBe('idle');
  });

  it('le monument achevé : plus de chantier à livrer', () => {
    const g = game();
    g.project.phase = PHASES.length;
    g.project2.phase = PHASES_II.length;
    const c = chest(g);
    c.put('coal', 20);
    const w = g.workers.add('courier', g);
    run(g, 10);
    expect(c.items.coal).toBe(20);
    expect(w.cargo).toEqual({});
  });
});

describe('livreur : sauvegarde et jeu à deux', () => {
  it('le métier et la charge (jusqu’à 30 kg) sont sauvegardés', () => {
    const g = game();
    const w = g.workers.add('courier', g);
    w.cargo = { gold: 8 }; // 28 kg : possible pour un livreur, pas pour un autre ouvrier
    expect(cargoWeight(w.cargo)).toBeGreaterThan(WORKERS.capacity);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const b = back.workers.list[0];
    expect(b.job).toBe('courier');
    expect(b.cargo).toEqual({ gold: 8 });
  });

  it('une charge de livreur trop lourde est refusée au chargement', () => {
    const g = game();
    g.workers.add('courier', g);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.workers[0].cargo = { gold: Math.ceil(COURIER_CAPACITY / getResource('gold').weight) + 1 };
    expect(deserialize(data).workers.list[0].cargo).toEqual({});
  });

  it('un ramasseur ne garde pas une charge de livreur', () => {
    const g = game();
    g.workers.add('picker', g);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.workers[0].cargo = { gold: 8 };
    expect(deserialize(data).workers.list[0].cargo).toEqual({});
  });

  it('deux copies de la partie, un livreur au travail : toujours identiques, y compris après resynchronisation', () => {
    const make = () => {
      const g = game();
      const c = chest(g);
      c.put('coal', 60);
      c.put('gold', 12);
      order(g, [['gold', 12]], { id: 950 });
      g.workers.add('courier', g);
      return g;
    };
    const a = make();
    const b = make();
    run(a, 12);
    run(b, 12);
    expect(stateDigest(a)).toBe(stateDigest(b));
    const mid = deserialize(JSON.parse(JSON.stringify(serialize(a))));
    run(a, 30);
    run(b, 30);
    expect(stateDigest(a)).toBe(stateDigest(b));
    expect(JSON.stringify(a.contracts.serialize())).toBe(JSON.stringify(b.contracts.serialize()));
    expect(mid.workers.list[0].job).toBe('courier');
  });
});
