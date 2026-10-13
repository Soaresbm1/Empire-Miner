import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { PHASES } from '../src/data/project';
import { hasResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { applyAction } from '../src/sim/actions';
import { GameState } from '../src/sim/GameState';
import { OBJECTIVES, currentObjective } from '../src/sim/objectives';
import { Project, type ProjectSave } from '../src/sim/Project';
import { Building } from '../src/sim/structures/Building';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { goTo, run, teleport } from './helpers';

/** Livre tout ce que la phase en cours réclame, et verse tout l'argent. */
function supply(p: Project): void {
  for (const n of p.missing()) p.deliver(n.res, n.qty);
  p.fund(p.moneyLeft());
}

/** Une partie avec assez de commandes honorées pour franchir toutes les phases. */
function veteran(): GameState {
  const g = new GameState(7);
  g.stats.contracts = 99;
  return g;
}

function crateAt(g: GameState, x = 52, y = 9): ShippingCrate {
  g.inventory.addKit('shipping', 1);
  teleport(g, 50, 8);
  const s = g.place('shipping', x, y, 0);
  if (!s) throw new Error(g.canPlace('shipping', x, y).reason ?? 'pose impossible');
  return s as ShippingCrate;
}

// ---------------------------------------------------------------- données

describe('Grand Chevalement : les phases', () => {
  it('cinq phases, de plus en plus lourdes, avec des matériaux qui existent', () => {
    expect(PHASES).toHaveLength(5);
    let money = 0;
    let contracts = -1;
    for (const ph of PHASES) {
      expect(ph.name.length).toBeGreaterThan(2);
      expect(ph.blurb.length).toBeGreaterThan(10);
      expect(ph.perk.text.length).toBeGreaterThan(5);
      expect(ph.needs.length).toBeGreaterThan(0);
      for (const n of ph.needs) {
        expect(hasResource(n.res)).toBe(true);
        expect(Number.isInteger(n.qty) && n.qty > 0).toBe(true);
      }
      expect(new Set(ph.needs.map((n) => n.res)).size).toBe(ph.needs.length);
      expect(ph.money).toBeGreaterThan(money);
      expect(ph.contracts).toBeGreaterThanOrEqual(contracts);
      money = ph.money;
      contracts = ph.contracts;
    }
    expect(new Set(PHASES.map((p) => p.id)).size).toBe(5);
  });
});

// ---------------------------------------------------------------- le chantier seul

describe('Grand Chevalement : le chantier', () => {
  it('commence à zéro : tout manque', () => {
    const p = new Project();
    expect(p.phase).toBe(0);
    expect(p.done).toBe(false);
    expect(p.spec).toBe(PHASES[0]);
    expect(p.missing()).toEqual(PHASES[0].needs.map((n) => ({ res: n.res, qty: n.qty })));
    expect(p.moneyLeft()).toBe(PHASES[0].money);
    expect(p.progress()).toBe(0);
    expect(p.supplied()).toBe(false);
    expect(p.perks()).toEqual({ slots: 0, offers: 0, premium: 0 });
  });

  it('accepte les livraisons, mais pas plus que la phase en demande', () => {
    const p = new Project();
    const first = PHASES[0].needs[0];
    expect(p.deliver(first.res, 10)).toBe(10);
    expect(p.need(first.res)).toBe(first.qty - 10);
    expect(p.deliver(first.res, 10000)).toBe(first.qty - 10);
    expect(p.need(first.res)).toBe(0);
    expect(p.deliver(first.res, 5)).toBe(0);
    expect(p.deliver('diamond', 5)).toBe(0); // la phase n'en veut pas
    expect(p.deliver(first.res, 0)).toBe(0);
    expect(p.deliver(first.res, -3)).toBe(0);
    expect(p.deliver(first.res, 2.9)).toBe(0); // plus rien à livrer
  });

  it('l’argent se verse par morceaux, jamais au-delà de ce qui est réclamé', () => {
    const p = new Project();
    expect(p.fund(200)).toBe(200);
    expect(p.moneyLeft()).toBe(PHASES[0].money - 200);
    expect(p.fund(1e9)).toBe(PHASES[0].money - 200);
    expect(p.moneyLeft()).toBe(0);
    expect(p.fund(10)).toBe(0);
    expect(p.fund(-10)).toBe(0);
  });

  it('l’avancement compte chaque matériau et l’argent à parts égales', () => {
    const p = new Project();
    const needs = PHASES[0].needs;
    p.deliver(needs[0].res, needs[0].qty);
    expect(p.progress()).toBeCloseTo(1 / (needs.length + 1), 6);
    p.fund(PHASES[0].money / 2);
    expect(p.progress()).toBeCloseTo((1 + 0.5) / (needs.length + 1), 6);
    supply(p);
    expect(p.progress()).toBe(1);
  });

  it('une phase est prête quand tout est livré, payé, et assez de commandes honorées', () => {
    const p = new Project();
    p.advance(10); // phase 0 passée : on regarde la phase 1, qui demande des commandes
    const need = p.spec!.contracts;
    expect(need).toBeGreaterThan(0);
    for (const n of p.missing()) p.deliver(n.res, n.qty);
    expect(p.supplied()).toBe(false); // il manque l'argent
    p.fund(p.moneyLeft());
    expect(p.supplied()).toBe(true);
    expect(p.ready(need - 1)).toBe(false);
    expect(p.ready(need)).toBe(true);
  });

  it('terminer une phase repart à zéro et cumule les avantages', () => {
    const p = new Project();
    supply(p);
    const spec = p.advance(123);
    expect(spec).toBe(PHASES[0]);
    expect(p.phase).toBe(1);
    expect(p.doneAt).toEqual([123]);
    expect(p.delivered).toEqual({});
    expect(p.funded).toBe(0);
    expect(p.perks()).toEqual({ slots: PHASES[0].perk.slots ?? 0, offers: PHASES[0].perk.offers ?? 0, premium: PHASES[0].perk.premium ?? 0 });
    for (let i = 1; i < PHASES.length; i++) p.advance(200 + i);
    expect(p.done).toBe(true);
    expect(p.spec).toBeNull();
    expect(p.progress()).toBe(1);
    expect(p.ready(999)).toBe(false);
    expect(p.supplied()).toBe(false);
    const total = PHASES.reduce((s, ph) => ({ slots: s.slots + (ph.perk.slots ?? 0), offers: s.offers + (ph.perk.offers ?? 0), premium: s.premium + (ph.perk.premium ?? 0) }), { slots: 0, offers: 0, premium: 0 });
    expect(p.perks()).toEqual(total);
    expect(p.deliver('coal', 5)).toBe(0);
    expect(p.fund(5)).toBe(0);
    expect(p.missing()).toEqual([]);
    expect(p.moneyLeft()).toBe(0);
  });

  it('se sauvegarde et se recharge', () => {
    const p = new Project();
    supply(p);
    p.advance(50);
    p.deliver(PHASES[1].needs[0].res, 7);
    p.fund(321);
    const data = JSON.parse(JSON.stringify(p.serialize())) as ProjectSave;
    const q = new Project();
    q.load(data);
    expect(q.serialize()).toEqual(p.serialize());
  });

  it('les valeurs aberrantes sont ignorées', () => {
    const q = new Project();
    q.load({ phase: 2.5, delivered: {}, funded: 5, doneAt: [] } as ProjectSave);
    expect(q.phase).toBe(0);
    q.load({ phase: 99, delivered: { coal: 5 }, funded: 5, doneAt: [1, 'x', 3] } as unknown as ProjectSave);
    expect(q.phase).toBe(PHASES.length);
    expect(q.doneAt).toHaveLength(PHASES.length); // complétée avec des dates à zéro
    expect(q.delivered).toEqual({});
    expect(q.funded).toBe(0);
    q.load({ phase: 1, delivered: { iron_ingot: 1e9, diamond: 4, coal: -2, [PHASES[1].needs[1].res]: 'beaucoup' }, funded: 1e12, doneAt: [10] } as unknown as ProjectSave);
    expect(q.phase).toBe(1);
    expect(q.delivered).toEqual({ iron_ingot: PHASES[1].needs.find((n) => n.res === 'iron_ingot')!.qty });
    expect(q.funded).toBe(PHASES[1].money);
    q.load(undefined);
    expect(q.phase).toBe(0);
    q.load('nimporte quoi' as unknown as ProjectSave);
    expect(q.phase).toBe(0);
  });
});

// ---------------------------------------------------------------- le bâtiment

describe('Grand Chevalement : le bâtiment du camp', () => {
  it('se dresse à droite de l’Atelier, plein, non démontable', () => {
    const g = new GameState(7);
    const site = g.structures.list.find((s) => s.type === 'site') as Building;
    expect(site).toBeInstanceOf(Building);
    expect(site).toMatchObject({ x: 62, y: 5, w: 4, h: 3, solid: true, removable: false, name: 'Grand Chevalement' });
    const workshop = g.structures.list.find((s) => s.type === 'workshop')!;
    expect(site.x).toBeGreaterThan(workshop.x + workshop.w); // un passage libre entre les deux
    expect(site.y + site.h).toBeLessThan(SURFACE_ROWS);
    for (let y = site.y; y < site.y + site.h; y++) for (let x = site.x; x < site.x + site.w; x++) expect(g.structures.at(x, y)).toBe(site);
    // Le terrain est dégagé tout autour, et rien d'autre ne le recouvre.
    for (let x = site.x - 2; x < site.x + site.w + 2; x++) expect(g.world.isSolid(x, site.y + site.h)).toBe(false);
    expect(g.structures.list.filter((s) => s !== site && s.x < site.x + site.w && s.x + s.w > site.x && s.y < site.y + site.h && s.y + s.h > site.y)).toEqual([]);
  });

  it('s’ouvre depuis l’entrée du camp, et pas depuis l’Atelier ni le Tableau', () => {
    const g = new GameState(7);
    goTo(g, 'site');
    expect(g.isNear('site')).toBe(true);
    expect(g.isNear('workshop')).toBe(false);
    goTo(g, 'workshop');
    expect(g.isNear('site')).toBe(false);
    goTo(g, 'board');
    expect(g.isNear('site')).toBe(false);
  });

  it('le joueur ne traverse pas le chantier', () => {
    const g = new GameState(7);
    teleport(g, 63, 8);
    run(g, 2, { mx: 0, my: -1, mine: false, target: null });
    expect(g.player.y).toBeGreaterThan((7 + 1) * TILE - 2); // arrêté contre le bas du bâtiment (rangée 7)
  });
});

// ---------------------------------------------------------------- livraison à la main

describe('Grand Chevalement : livraison et paiement à la main', () => {
  it('on livre son sac au chantier, pas ailleurs', () => {
    const g = new GameState(7);
    const first = PHASES[0].needs[0];
    g.inventory.items[first.res] = 30;
    g.inventory.items.stone = 4; // rien de ce que le chantier attend
    teleport(g, 50, 17);
    applyAction(g, { k: 'siteDeliver' });
    expect(g.inventory.count(first.res)).toBe(30);
    goTo(g, 'site');
    g.events.length = 0;
    applyAction(g, { k: 'siteDeliver' });
    expect(g.inventory.count(first.res)).toBe(0);
    expect(g.inventory.count('stone')).toBe(4);
    expect(g.project.delivered[first.res]).toBe(30);
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'good' });
  });

  it('le surplus reste dans le sac', () => {
    const g = new GameState(7);
    const first = PHASES[0].needs[0];
    g.inventory.items[first.res] = first.qty + 25;
    goTo(g, 'site');
    applyAction(g, { k: 'siteDeliver' });
    expect(g.project.need(first.res)).toBe(0);
    expect(g.inventory.count(first.res)).toBe(25);
  });

  it('un sac sans rien d’utile le dit', () => {
    const g = new GameState(7);
    goTo(g, 'site');
    g.events.length = 0;
    applyAction(g, { k: 'siteDeliver' });
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'info' });
  });

  it('l’argent versé aux ouvriers sort de la caisse commune', () => {
    const g = new GameState(7);
    g.money = 300;
    teleport(g, 50, 17);
    applyAction(g, { k: 'siteFund' });
    expect(g.money).toBe(300);
    goTo(g, 'site');
    applyAction(g, { k: 'siteFund' });
    expect(g.money).toBe(0);
    expect(g.project.funded).toBe(300);
    expect(g.stats.spent).toBe(300);
    g.money = 1e6;
    applyAction(g, { k: 'siteFund' });
    expect(g.project.funded).toBe(PHASES[0].money);
    expect(g.money).toBe(1e6 - (PHASES[0].money - 300));
    g.events.length = 0;
    applyAction(g, { k: 'siteFund' }); // déjà payé
    expect(g.money).toBe(1e6 - (PHASES[0].money - 300));
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'info' });
  });

  it('sans un sou, on le dit', () => {
    const g = new GameState(7);
    goTo(g, 'site');
    g.events.length = 0;
    applyAction(g, { k: 'siteFund' });
    expect(g.events.find((e) => e.t === 'message')).toMatchObject({ kind: 'info' });
  });
});

// ---------------------------------------------------------------- phases

describe('Grand Chevalement : les phases s’enchaînent', () => {
  it('la phase se termine toute seule quand tout est réuni, et la tour grandit', () => {
    const g = veteran();
    supply(g.project);
    expect(g.project.phase).toBe(0);
    g.events.length = 0;
    run(g, 0.1);
    expect(g.project.phase).toBe(1);
    expect(g.project.doneAt[0]).toBeGreaterThan(0);
    expect(g.events.filter((e) => e.t === 'site')).toEqual([{ t: 'site', phase: 0, last: false }]);
  });

  it('rien ne se termine tant qu’il manque quelque chose', () => {
    const g = veteran();
    for (const n of g.project.missing().slice(1)) g.project.deliver(n.res, n.qty); // il manque le premier matériau
    g.project.fund(g.project.moneyLeft());
    run(g, 0.5);
    expect(g.project.phase).toBe(0);
    const first = PHASES[0].needs[0];
    g.project.deliver(first.res, first.qty - 1);
    run(g, 0.5);
    expect(g.project.phase).toBe(0);
    g.project.deliver(first.res, 1);
    run(g, 0.1);
    expect(g.project.phase).toBe(1);
  });

  it('les ouvriers réclament des commandes honorées avant de poursuivre', () => {
    const g = new GameState(7);
    g.stats.contracts = 0;
    supply(g.project);
    run(g, 0.1);
    expect(g.project.phase).toBe(1);
    supply(g.project);
    run(g, 0.1);
    expect(g.project.phase).toBe(1); // la phase 2 veut des commandes honorées
    g.stats.contracts = PHASES[1].contracts - 1;
    run(g, 0.1);
    expect(g.project.phase).toBe(1);
    g.stats.contracts = PHASES[1].contracts;
    run(g, 0.1);
    expect(g.project.phase).toBe(2);
  });

  it('honorer la commande qui manque termine la phase tout de suite', () => {
    const g = new GameState(7);
    g.stats.collected.coal = 1;
    g.project.advance(0); // phase 1 : deux commandes honorées
    supply(g.project);
    g.stats.contracts = PHASES[1].contracts - 1;
    g.contracts.list.push({ id: 900, client: 0, lines: [{ res: 'coal', qty: 5, done: 0 }], reward: 50, premium: 0.4, hot: false, limit: 600, until: 700, accepted: true });
    g.contracts.deliver('coal', 5);
    run(g, 0.1);
    expect(g.project.phase).toBe(2);
  });

  it('les cinq phases achèvent le monument, une seule fois', () => {
    const g = veteran();
    g.events.length = 0;
    for (let i = 0; i < PHASES.length; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    expect(g.project.done).toBe(true);
    expect(g.project.doneAt).toHaveLength(PHASES.length);
    const sites = g.events.filter((e) => e.t === 'site');
    expect(sites.map((e) => (e as { phase: number }).phase)).toEqual([0, 1, 2, 3, 4]);
    expect(sites.map((e) => (e as { last: boolean }).last)).toEqual([false, false, false, false, true]);
    run(g, 5);
    expect(g.events.filter((e) => e.t === 'site')).toHaveLength(5);
  });

  it('les phases accordent leurs avantages aux commandes', () => {
    const g = veteran();
    const base = g.contracts.slots;
    const offers = g.contracts.capacity;
    supply(g.project); // phase 0 : une commande de plus en parallèle
    run(g, 0.1);
    expect(g.contracts.slots).toBe(base + 1);
    supply(g.project); // phase 1 : une proposition de plus
    run(g, 0.1);
    expect(g.contracts.capacity).toBe(offers + 1);
  });

  it('les objectifs suivent : commande, première phase, premier produit fabriqué, monument achevé', () => {
    const ids = OBJECTIVES.map((o) => o.id);
    expect(ids.slice(-4)).toEqual(['contract', 'site', 'craft', 'crown']);
    expect(ids.indexOf('contract')).toBe(ids.indexOf('diamond') + 1); // elles viennent après la dernière du parcours guidé
    const g = new GameState(7);
    const need = (id: string) => OBJECTIVES.find((o) => o.id === id)!;
    expect(need('contract').done(g)).toBe(false);
    g.stats.contracts = 1;
    expect(need('contract').done(g)).toBe(true);
    expect(need('site').done(g)).toBe(false);
    supply(g.project);
    run(g, 0.1);
    expect(need('site').done(g)).toBe(true);
    expect(need('craft').done(g)).toBe(false);
    g.stats.crafted = 1;
    expect(need('craft').done(g)).toBe(true);
    expect(need('crown').done(g)).toBe(false);
    g.stats.contracts = 99; // assez de commandes honorées pour franchir les autres phases
    for (let i = 1; i < PHASES.length; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    expect(need('crown').done(g)).toBe(true);
    expect(currentObjective(g).objective?.id).not.toBe('crown');
  });
});

// ---------------------------------------------------------------- caisse d'expédition

describe('caisse d’expédition réglée sur « Chantier »', () => {
  it('apporte au chantier ce que la phase attend, et vend le reste', () => {
    const g = new GameState(7);
    const first = PHASES[0].needs[0];
    const crate = crateAt(g);
    crate.mode = 'site';
    crate.put(first.res, 30);
    crate.put('iron', 4);
    teleport(g, 50, 17);
    g.events.length = 0;
    run(g, crate.interval + 0.5);
    expect(g.project.delivered[first.res]).toBe(30);
    expect(g.stats.autoSold).toBe(g.quote('iron', 4));
    expect(g.money).toBe(g.stats.autoSold);
    expect(crate.items).toEqual({});
    expect(g.events.find((e) => e.t === 'delivered')).toMatchObject({ n: 30, to: 'site' });
  });

  it('une fois la phase servie, le surplus se vend : la caisse ne se bouche pas', () => {
    const g = new GameState(7);
    const first = PHASES[0].needs[0];
    const crate = crateAt(g);
    crate.mode = 'site';
    g.project.deliver(first.res, first.qty);
    crate.put(first.res, 12);
    teleport(g, 50, 17);
    run(g, crate.interval + 0.5);
    expect(g.stats.autoSold).toBe(g.quote(first.res, 12));
    expect(g.project.delivered[first.res]).toBe(first.qty);
  });

  it('le chantier achevé n’attend plus rien : tout se vend', () => {
    const g = veteran();
    for (let i = 0; i < PHASES.length; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    const crate = crateAt(g);
    crate.mode = 'site';
    crate.put('diamond', 3);
    teleport(g, 50, 17);
    run(g, crate.interval + 0.5);
    expect(g.stats.autoSold).toBe(g.quote('diamond', 3));
  });

  it('une chaîne complète : un convoyeur apporte les matériaux, la phase se termine sans le joueur', () => {
    const g = veteran();
    const crate = crateAt(g);
    crate.mode = 'site';
    g.money = 1e6;
    teleport(g, 50, 17);
    const need = PHASES[0].needs.map((n) => ({ ...n }));
    // La caisse ne contient que 120 kg : on la remplit à chaque passage.
    for (let pass = 0; pass < 40 && g.project.phase === 0; pass++) {
      for (const n of need) crate.put(n.res, Math.min(n.qty - (g.project.delivered[n.res] ?? 0), 20));
      run(g, crate.interval + 0.1);
      if (g.project.missing().length === 0) {
        teleport(g, 63, 8);
        applyAction(g, { k: 'siteFund' });
        teleport(g, 50, 17);
      }
    }
    expect(g.project.phase).toBe(1);
  });
});

// ---------------------------------------------------------------- sauvegarde

describe('Grand Chevalement : sauvegarde', () => {
  it('la phase, les livraisons et l’argent versé survivent', () => {
    const g = veteran();
    supply(g.project);
    run(g, 0.1);
    g.project.deliver(PHASES[1].needs[0].res, 11);
    g.project.fund(250);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.project.serialize()).toEqual(g.project.serialize());
    expect(h.project.phase).toBe(1);
    expect(h.contracts.slots).toBe(g.contracts.slots);
  });

  it('une ancienne sauvegarde se charge avec le chantier au camp, à zéro', () => {
    const g = new GameState(7);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.project;
    delete data.contracts;
    const h = deserialize(data);
    expect(h.project.phase).toBe(0);
    expect(h.structures.list.some((s) => s.type === 'site')).toBe(true);
  });

  it('une machine posée autrefois là où le chantier se dresse revient au stock, avec son contenu', () => {
    const g = new GameState(7);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.structures.push({ type: 'shipping', x: 63, y: 6, dir: 0, items: { coal: 3 }, timer: 5, soldTotal: 0 });
    data.structures.push({ type: 'conveyor', x: 62, y: 7, dir: 0, items: [] });
    data.structures.push({ type: 'shipping', x: 58, y: 9, dir: 0, items: {}, timer: 5, soldTotal: 0 }); // celle-ci n'est pas gênée
    const h = deserialize(data);
    expect(h.structures.at(63, 6)?.type).toBe('site');
    expect(h.structures.at(62, 7)?.type).toBe('site');
    expect(h.structures.at(58, 9)).toBeInstanceOf(ShippingCrate);
    expect(h.inventory.kitCount('shipping')).toBe(1);
    expect(h.inventory.kitTotal('conveyor')).toBe(1);
    expect(h.drops.list.some((d) => d.res === 'coal' && d.count === 3)).toBe(true);
    // Le chantier est toujours là, entier.
    expect(h.structures.list.filter((s) => s.type === 'site')).toHaveLength(1);
  });

  it('un joueur resté debout là où le chantier se dresse est remis à l’entrée du camp', () => {
    const g = new GameState(7);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.player.x = 63.5 * TILE;
    data.player.y = 6.5 * TILE;
    const h = deserialize(data);
    expect(h.player.tileX).toBe(h.layout.spawn.x);
    expect(h.player.tileY).toBe(h.layout.spawn.y);
    // Le reste du camp ne change rien.
    data.player.x = 55.5 * TILE;
    data.player.y = 9.5 * TILE;
    expect(deserialize(data).player.tileX).toBe(55);
  });
});

// ---------------------------------------------------------------- les commandes y sont liées

describe('Grand Chevalement : liens avec les commandes', () => {
  it('les commandes lisent les avantages du chantier à chaque proposition', () => {
    const first = (phases: number) => {
      const g = veteran();
      g.stats.collected.coal = 1;
      for (let i = 0; i < phases; i++) {
        supply(g.project);
        run(g, 0.1);
      }
      expect(g.project.phase).toBe(phases);
      g.time = 100;
      g.contracts.update(100);
      return g.contracts.offers()[0];
    };
    const plain = first(0);
    const built = first(3); // les trois premières phases : +10 points de prime à la phase 3
    expect(built.premium - plain.premium).toBeCloseTo(PHASES[2].perk.premium ?? 0, 3);
    expect(built.reward).toBeGreaterThan(plain.reward);
  });
});
