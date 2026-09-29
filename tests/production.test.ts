import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { AIR, ORE_BLOCK } from '../src/data/blocks';
import { resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { GAIN_MINUTES, ProductionLog, RATE_SLOTS, SLOT_COUNT, SLOT_SECONDS } from '../src/sim/Production';
import type { Smelter } from '../src/sim/structures/Smelter';
import type { Storage } from '../src/sim/structures/Storage';
import { boardPanel, counterPanel, workshopPanel } from '../src/ui/panels';
import { BUILDING_INFO } from '../src/sim/structures/Building';
import { productionStats } from '../src/ui/stats';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 14;

/** Un journal dont on avance l'horloge à la main. */
function clocked(): { log: ProductionLog; at: (t: number) => void } {
  let now = 0;
  return { log: new ProductionLog(() => now), at: (t) => (now = t) };
}

function put(g: GameState, kit: string, x: number, y: number) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, 0);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

describe('journal de production', () => {
  it('les débits sont des moyennes par minute, sans s’emballer au début', () => {
    const { log, at } = clocked();
    at(5);
    log.addOre('copper', 3, false);
    log.addOre('copper', 6, true);
    log.addIngot('copper', 2);
    log.addSale({ copper: 4 }, 28, false);
    // Moins de 30 s de recul : la moyenne est calculée sur 30 s, pas sur 5.
    at(10);
    const r = log.rates();
    expect(r.minutes).toBeCloseTo(0.5);
    expect(r.ore.copper).toBeCloseTo(18);
    expect(r.machineOre).toBeCloseTo(12);
    expect(r.ingots.copper).toBeCloseTo(4);
    expect(r.sold.copper).toBeCloseTo(8);
    expect(r.counter).toBeCloseTo(56);
    expect(r.crate).toBe(0);
    // Plus tard, presque 5 minutes de recul : la même production pèse dix fois moins.
    at(290);
    const late = log.rates();
    expect(late.minutes).toBeGreaterThan(4.8);
    expect(late.ore.copper).toBeCloseTo(9 / late.minutes);
  });

  it('un créneau plus vieux que la fenêtre sort du calcul', () => {
    const { log, at } = clocked();
    at(0);
    log.addOre('coal', 50, true);
    at(RATE_SLOTS * SLOT_SECONDS + 1);
    expect(log.rates().ore.coal ?? 0).toBe(0);
    at(SLOT_COUNT * SLOT_SECONDS + 5);
    log.addOre('coal', 1, false);
    expect(log.serialize().length).toBe(1); // le vieux créneau a été oublié
  });

  it('l’histogramme des gains a une barre par minute, la plus récente à droite', () => {
    const { log, at } = clocked();
    at(3);
    log.addSale({ gold: 1 }, 100, false); // il y a 9 minutes et quelques secondes
    at(200);
    log.addSale({ gold: 1 }, 40, true);
    at(SLOT_COUNT * SLOT_SECONDS - 1);
    log.addSale({ copper: 2 }, 14, false);
    const gains = log.gains();
    expect(gains.length).toBe(GAIN_MINUTES);
    expect(gains[0]).toEqual({ counter: 100, crate: 0 });
    expect(gains[GAIN_MINUTES - 1]).toEqual({ counter: 14, crate: 0 });
    expect(gains.reduce((n, x) => n + x.crate, 0)).toBe(40);
    expect(gains[GAIN_MINUTES - 1 - Math.floor((SLOT_COUNT * SLOT_SECONDS - 1 - 200) / 60)].crate).toBe(40);
  });

  it('se sauvegarde et se recharge', () => {
    const { log, at } = clocked();
    at(42);
    log.addOre('iron', 4, true);
    log.addSale({ iron: 4 }, 64, true);
    const copy = new ProductionLog(() => 42);
    copy.load(JSON.parse(JSON.stringify(log.serialize())));
    expect(copy.rates().ore.iron).toBeCloseTo(log.rates().ore.iron);
    expect(copy.gains()).toEqual(log.gains());
    copy.load(undefined);
    expect(copy.gains().every((x) => x.counter === 0 && x.crate === 0)).toBe(true);
  });
});

describe('statistiques de production dans la partie', () => {
  it('compte le minerai miné à la main, les ventes au comptoir et les lingots', () => {
    const g = new GameState(4);
    // Une galerie avec un filon de cuivre : on le mine à la main.
    for (let x = 20; x <= 24; x++) {
      g.world.set(x, Y, AIR);
      g.world.setExplored(x, Y);
    }
    g.world.set(25, Y, ORE_BLOCK.copper);
    teleport(g, 24, Y);
    g.breakTile(25, Y);
    const r0 = g.production.rates();
    expect(r0.ore.copper ?? 0).toBeGreaterThan(0);
    expect(r0.machineOre).toBe(0);
    // Vente au comptoir.
    g.inventory.add('copper', 5);
    goTo(g, 'counter');
    const earned = g.sell('copper', 5);
    expect(earned).toBeGreaterThan(0);
    const r1 = g.production.rates();
    expect(r1.sold.copper).toBeGreaterThan(0);
    expect(r1.counter).toBeGreaterThan(0);
    expect(r1.crate).toBe(0);
    expect(g.production.gains()[GAIN_MINUTES - 1].counter).toBe(earned);
  });

  it('une foreuse à charbon compte comme une machine, un four compte ses lingots', () => {
    const g = new GameState(4);
    g.world.setDeposit(50, Y, resourceIndex('copper'), 300);
    const drill = put(g, 'drill', 50, Y) as unknown as { fuelUnits: number; extracted: number };
    drill.fuelUnits = 3;
    const furnace = put(g, 'furnace', 52, Y + 1) as Smelter;
    furnace.addOre('iron', 3);
    furnace.addFuel(2);
    run(g, 12);
    expect(drill.extracted).toBeGreaterThan(0);
    const r = g.production.rates();
    expect(r.machineOre).toBeGreaterThan(0);
    expect(r.ore.copper).toBeGreaterThan(0);
    expect(furnace.smelted).toBeGreaterThan(0);
    expect(r.ingots.iron_ingot).toBeGreaterThan(0);
  });

  it('une caisse d’expédition alimente les gains « caisses »', () => {
    const g = new GameState(4);
    g.inventory.addKit('shipping', 1);
    teleport(g, 50, S - 2);
    const crate = g.place('shipping', 50, S - 3, 0);
    expect(crate).toBeTruthy();
    (crate as unknown as { items: Record<string, number> }).items = { gold: 2 };
    run(g, 16);
    const r = g.production.rates();
    expect(r.crate).toBeGreaterThan(0);
    expect(r.sold.gold).toBeGreaterThan(0);
    expect(g.production.gains()[GAIN_MINUTES - 1].crate).toBe(g.stats.autoSold);
  });

  it('les statistiques survivent à une sauvegarde ; une ancienne sauvegarde n’en a pas', () => {
    const g = new GameState(4);
    g.inventory.add('gold', 3);
    goTo(g, 'counter');
    g.sellAll();
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.production.gains()).toEqual(g.production.gains());
    expect(h.production.rates().sold.gold).toBeCloseTo(g.production.rates().sold.gold);
    const old = JSON.parse(JSON.stringify(serialize(g)));
    delete old.production;
    expect(deserialize(old).production.gains().every((x) => x.counter === 0)).toBe(true);
  });
});

describe('panneau des statistiques', () => {
  it('est celui du tableau d’affichage, pas du comptoir ni de l’atelier', () => {
    const g = new GameState(4);
    expect(boardPanel(g)).toContain('Gains des 10 dernières minutes');
    expect(boardPanel(g)).toContain('Machines à surveiller');
    expect(counterPanel(g)).not.toContain('Gains des');
    expect(workshopPanel(g, 'tools')).not.toContain('Gains des');
    expect(workshopPanel(g, 'tools')).not.toContain('data-arg="stats"');
  });

  it('montre les chiffres, les gains et les machines à l’arrêt', () => {
    const g = new GameState(4);
    expect(productionStats(g)).toContain('Aucune vente pour l’instant');
    expect(productionStats(g)).toContain('Aucune machine posée');
    // Un coffre plein et un four sans charbon.
    const f = put(g, 'furnace', 50, Y) as Smelter;
    f.addOre('copper', 2);
    const chest = put(g, 'storage', 46, Y) as Storage;
    chest.items = { iron: 1000 };
    run(g, 1);
    const html = productionStats(g);
    expect(html).toContain('plus de charbon');
    expect(html).toContain('Coffre : plein');
    expect(html).toContain('0</b> machine');
    g.inventory.add('gold', 2);
    goTo(g, 'counter');
    g.sellAll();
    const after = productionStats(g);
    expect(after).not.toContain('Aucune vente pour l’instant');
    expect(after).toContain('pc-seg counter');
    expect(after).toMatch(/Il y a \d min|Cette dernière minute/);
  });
});

describe('tableau d’affichage du camp', () => {
  it('se dresse entre le comptoir et l’atelier, et s’ouvre comme eux', () => {
    const g = new GameState(4);
    const at = (type: string) => g.structures.list.find((s) => s.type === type)!;
    const board = at('board');
    expect(board).toBeTruthy();
    expect(board.removable).toBe(false);
    const counter = at('counter');
    const workshop = at('workshop');
    // Au milieu du camp, sur la même rangée, sans toucher les deux autres.
    expect(board.y).toBe(counter.y);
    expect(board.x).toBeGreaterThanOrEqual(counter.x + counter.w + 2);
    expect(board.x + board.w).toBeLessThanOrEqual(workshop.x - 2);
    expect((board.x + board.w / 2) * 2).toBeCloseTo(counter.x + counter.w / 2 + (workshop.x + workshop.w / 2));
    expect(BUILDING_INFO.board.name).toBe("Tableau d'affichage");
    // Devant lui, il est l'élément interactif le plus proche.
    goTo(g, 'board');
    expect(g.nearestInteractable()?.type).toBe('board');
    expect(g.isNear('counter')).toBe(false);
    goTo(g, 'counter');
    expect(g.nearestInteractable()?.type).toBe('counter');
  });

  it('ne gêne ni l’arrivée du joueur ni le chemin du puits', () => {
    const g = new GameState(4);
    const board = g.structures.list.find((s) => s.type === 'board')!;
    const { spawn, entrance } = g.layout;
    expect(spawn.y).toBeGreaterThan(board.y + board.h);
    for (let y = spawn.y; y <= entrance.y; y++) for (let x = entrance.x; x < entrance.x + entrance.w; x++) expect(g.structures.at(x, y)).toBeUndefined();
  });

  it('les anciennes sauvegardes l’ont aussi : il fait partie du décor, pas de la sauvegarde', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    expect(data.structures.some((x: { type: string }) => x.type === 'board')).toBe(false);
    expect(deserialize(data).structures.list.some((s) => s.type === 'board')).toBe(true);
  });
});
