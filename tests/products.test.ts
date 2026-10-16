/**
 * Produits fabriqués (plaques, acier, diamant taillé) : leurs fiches, leur prix au marché, les commandes des clients, les
 * deux dernières phases du Grand Chevalement, la reprise d'une partie d'avant, et ce qu'en montre l'interface.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { GOODS } from '../src/data/contracts';
import { PHASES } from '../src/data/project';
import { RECIPES } from '../src/data/recipes';
import { RESOURCES, getResource, resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { COMMODITIES, commodityOf, type Market } from '../src/sim/Market';
import { Contracts, type Contract, type ContractsHost } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import { Project } from '../src/sim/Project';
import type { Crafter } from '../src/sim/structures/Crafter';
import { marketTab } from '../src/ui/market';
import { crafterPanel } from '../src/ui/panels';
import { sitePanel } from '../src/ui/site';
import { productionStats } from '../src/ui/stats';
import { DEFAULT_VIEW, workshopPanel } from '../src/ui/workshop';
import { teleport } from './helpers';

const PRODUCTS = ['copper_plate', 'iron_plate', 'silver_plate', 'gold_plate', 'steel', 'cut_diamond', 'copper_wire', 'gear', 'mechanism'];
const S = SURFACE_ROWS;

function placeCrafter(g: GameState): Crafter {
  g.inventory.addKit('crafter', 1);
  teleport(g, 47, S + 13);
  const c = g.place('crafter', 50, S + 13, 0);
  if (!c) throw new Error(g.canPlace('crafter', 50, S + 13).reason ?? 'pose impossible');
  return c as Crafter;
}

// ---------------------------------------------------------------- fiches

describe('produits fabriqués : les fiches', () => {
  it('neuf produits, après les lingots, qui ne se trouvent jamais dans la roche', () => {
    const products = RESOURCES.filter((r) => r.product);
    expect(products.map((r) => r.id)).toEqual(PRODUCTS);
    const lastIngot = Math.max(...RESOURCES.filter((r) => r.ingot).map((r) => resourceIndex(r.id)));
    for (const r of products) {
      expect(resourceIndex(r.id)).toBeGreaterThan(lastIngot);
      expect(r.vein).toBeUndefined();
      expect(r.deposit).toBeUndefined();
      expect(r.ingot).toBeUndefined();
      expect(r.resistance).toBe(0);
      expect(r.shape).toBeDefined();
      expect((r.short ?? '').length).toBeGreaterThan(2);
      expect(r.uses.length).toBeGreaterThan(0);
    }
  });

  it('les minerais gardent leur place : les gisements sauvegardés pointent toujours vers le même minerai', () => {
    expect(RESOURCES.slice(0, 7).map((r) => r.id)).toEqual(['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'diamond']);
    expect(RESOURCES.slice(7, 11).map((r) => r.id)).toEqual(['copper_ingot', 'iron_ingot', 'silver_ingot', 'gold_ingot']);
  });

  it('le marché ne cote toujours que les minerais ; un produit suit le cours de son métal', () => {
    expect(COMMODITIES).toEqual(['coal', 'copper', 'iron', 'silver', 'gold', 'diamond']);
    for (const r of RESOURCES.filter((x) => x.product)) {
      expect(COMMODITIES).toContain(r.follows);
      expect(commodityOf(r.id)).toBe(r.follows);
    }
    expect(commodityOf('steel')).toBe('iron');
    expect(commodityOf('cut_diamond')).toBe('diamond');
    expect(commodityOf('gold_plate')).toBe('gold');
  });

  it('un événement du marché sur un métal touche aussi ses plaques', () => {
    const g = new GameState(7);
    g.market.load({ ...g.market.serialize(), e: [{ n: 0, res: 'iron', start: 0, rise: 2, hold: 50, fall: 4, amp: 0.4 }] }, g.time);
    g.time = 60;
    g.market.update(60);
    expect(g.market.mult('iron_plate')).toBe(g.market.mult('iron'));
    expect(g.market.mult('steel')).toBe(g.market.mult('iron'));
    expect(g.market.price('steel')).toBeCloseTo(getResource('steel').value * g.market.mult('iron'), 6);
  });

  it('les recettes et les fiches se répondent : un produit par recette, une recette par produit', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(PRODUCTS);
    for (const id of PRODUCTS) expect(getResource(id).product).toBe(true);
  });
});

// ---------------------------------------------------------------- commandes

describe('produits fabriqués : les commandes des clients', () => {
  const quiet = { active: () => [] } as unknown as Market;
  const host = (known: (res: string) => boolean, offered: Contract[]): ContractsHost => ({
    known,
    perks: () => ({ slots: 0, offers: 0, premium: 0 }),
    completed: () => 0,
    settle: () => {},
    offered: (c) => offered.push(c),
  });
  function propose(known: (res: string) => boolean, seed: number, until = 12000): Set<string> {
    const offered: Contract[] = [];
    const c = new Contracts(seed, host(known, offered), quiet);
    for (let t = 5; t <= until; t += 5) {
      c.update(t);
      for (const o of [...c.list]) c.decline(o.id, t);
    }
    return new Set(offered.flatMap((o) => o.lines.map((l) => l.res)));
  }

  it('toutes les marchandises demandables existent, une fois chacune', () => {
    const ids = GOODS.map((g) => g.res);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GOODS) {
      expect(getResource(g.res).value).toBeGreaterThan(0);
      expect(g.qty[0]).toBeLessThanOrEqual(g.qty[1]);
    }
    for (const id of PRODUCTS) expect(ids).toContain(id);
  });

  it('avant le premier produit fabriqué, aucun client n’en demande', () => {
    const asked = propose((res) => !PRODUCTS.includes(res), 3);
    expect(asked.size).toBeGreaterThan(5);
    for (const id of PRODUCTS) expect(asked.has(id)).toBe(false);
  });

  it('dès qu’on en connaît, ils en demandent', () => {
    const asked = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) for (const r of propose(() => true, seed)) asked.add(r);
    for (const id of PRODUCTS) expect(asked.has(id)).toBe(true);
  });

  it('seuls les produits fabriqués au moins une fois comptent comme connus dans la partie', () => {
    const g = new GameState(7);
    g.stats.collected.coal = 1;
    g.stats.collected.copper = 1;
    // La partie branche `known` sur les ressources découvertes ou ramassées : un produit y entre à la première fabrication.
    const c = placeCrafter(g);
    c.setRecipe('copper_plate');
    c.addFuel(1);
    c.addInput('copper_ingot', 1);
    expect(g.stats.discovered).not.toContain('copper_plate');
    for (let i = 0; i < 200; i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
    expect(g.stats.discovered).toContain('copper_plate');
  });
});

// ---------------------------------------------------------------- chantier

describe('produits fabriqués : le Grand Chevalement', () => {
  it('seules les deux dernières phases demandent des produits : les trois premières ne bougent pas', () => {
    const isProduct = (res: string) => !!getResource(res).product;
    for (const ph of PHASES.slice(0, 3)) expect(ph.needs.some((n) => isProduct(n.res))).toBe(false);
    for (const ph of PHASES.slice(3)) expect(ph.needs.some((n) => isProduct(n.res))).toBe(true);
    expect(PHASES[3].needs.map((n) => n.res)).toEqual(['gold_plate', 'silver_ingot', 'steel']);
    expect(PHASES[4].needs.map((n) => n.res)).toEqual(['gold_plate', 'silver_ingot', 'cut_diamond']);
  });

  it('les produits se livrent comme le reste : à la main ou par une caisse réglée sur « Chantier »', () => {
    const g = new GameState(7);
    g.project.load({ phase: 3, delivered: {}, funded: 0, doneAt: [1, 2, 3] });
    expect(g.project.need('steel')).toBe(50);
    expect(g.project.deliver('steel', 20)).toBe(20);
    expect(g.project.deliver('gold_ingot', 20)).toBe(0); // un lingot d'or ne remplace plus une plaque
    expect(g.project.need('steel')).toBe(30);
  });

  it('le chantier a changé depuis la sauvegarde : ce qui a été livré en trop est rendu, jamais perdu', () => {
    const p = new Project();
    const refund = p.load({ phase: 3, delivered: { gold_ingot: 12, silver_ingot: 30, steel: 99, bidon: 5 }, funded: 100, doneAt: [1, 2, 3] });
    expect(p.delivered).toEqual({ silver_ingot: 30, steel: 50 });
    expect(refund).toEqual({ gold_ingot: 12, steel: 49 });
    expect(new Project().load(undefined)).toEqual({});
    expect(new Project().load({ phase: 0, delivered: 'oups' as never, funded: 0, doneAt: [] })).toEqual({});
  });

  it('à l’ouverture d’une partie d’avant, les lingots livrés à l’ancienne phase reviennent dans le sac, avec un message', () => {
    const g = new GameState(7);
    g.project.load({ phase: 3, delivered: { gold_ingot: 4, silver_ingot: 10 }, funded: 0, doneAt: [1, 2, 3] });
    const data = JSON.parse(JSON.stringify(serialize(g)));
    // Ce que la version d'avant avait écrit : de l'or livré en lingots à la phase 4.
    data.project.delivered = { gold_ingot: 4, silver_ingot: 10, iron_ingot: 100 };
    const g2 = deserialize(data);
    expect(g2.project.delivered).toEqual({ silver_ingot: 10 });
    const back = g2.inventory.count('gold_ingot') + g2.inventory.count('iron_ingot');
    const ground = g2.drops.list.filter((d) => d.res === 'gold_ingot' || d.res === 'iron_ingot').reduce((n, d) => n + d.count, 0);
    expect(back + ground).toBe(104); // rien ne se perd : le sac d'abord, le reste à l'entrée de la mine
    expect(g2.inventory.count('gold_ingot')).toBe(4);
    const message = g2.events.find((e) => e.t === 'message' && e.text.includes('Le chantier a changé'));
    expect(message).toBeDefined();
  });

  it('le panneau du chantier dit où se fabriquent les produits qu’il réclame, et se tait quand il n’en réclame pas', () => {
    const g = new GameState(7);
    expect(sitePanel(g)).not.toContain('Manufacture'); // première phase : charbon, cuivre, lingots de cuivre
    g.project.load({ phase: 3, delivered: {}, funded: 0, doneAt: [1, 2, 3] });
    const html = sitePanel(g);
    expect(html).toContain('Plaque d&#39;or'); // le texte est échappé pour le HTML
    expect(html).toContain('Acier');
    expect(html).toContain('Ces produits se fabriquent à la <b>Manufacture</b>');
    g.project.load({ phase: 4, delivered: {}, funded: 0, doneAt: [1, 2, 3, 4] });
    expect(sitePanel(g)).toContain('Diamant taillé');
  });

  it('une partie qui n’a pas changé de phase se charge sans message ni remboursement', () => {
    const g = new GameState(7);
    g.project.load({ phase: 1, delivered: { iron_ingot: 20 }, funded: 300, doneAt: [5] });
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(g2.project.delivered).toEqual({ iron_ingot: 20 });
    expect(g2.events.some((e) => e.t === 'message')).toBe(false);
  });
});

// ---------------------------------------------------------------- interface

describe('produits fabriqués : l’interface', () => {
  it('le panneau ne propose que les recettes dont on connaît les matières, la choisie en évidence', () => {
    const g = new GameState(7);
    const c = placeCrafter(g);
    // Rien de fondu, aucun diamant : aucune recette à proposer, et le panneau le dit.
    let html = crafterPanel(g, c);
    expect(html).toContain('Aucune recette pour l');
    expect(html).not.toContain('data-action="crafterRecipe"');
    g.stats.discovered.push('copper_ingot', 'iron_ingot');
    html = crafterPanel(g, c);
    expect(html).toContain('Choisissez ce que la Manufacture fabrique');
    for (const id of ['copper_plate', 'iron_plate', 'steel']) expect(html).toContain(`data-action="crafterRecipe" data-arg="${id}"`);
    for (const id of ['silver_plate', 'gold_plate', 'cut_diamond']) expect(html).not.toContain(`data-arg="${id}"`);
    expect(html).toContain('D&#39;autres recettes'.replace('&#39;', "'"));
    c.setRecipe('steel');
    html = crafterPanel(g, c);
    expect(html).toMatch(/btn small on" data-action="crafterRecipe" data-arg="steel"/);
    expect(html).toMatch(/btn small off" data-action="crafterRecipe" data-arg="iron_plate"/);
    expect(html).toContain('2 ×'); // l'acier prend deux lingots
  });

  it('un diamant trouvé ouvre la taille ; les boutons suivent l’état de la machine et du sac', () => {
    const g = new GameState(7);
    const c = placeCrafter(g);
    g.stats.collected.diamond = 1;
    c.setRecipe('cut_diamond');
    let html = crafterPanel(g, c);
    expect(html).toContain('data-arg="cut_diamond"');
    expect(html).toMatch(/data-action="crafterDeposit" disabled/); // pas de diamant dans le sac
    expect(html).toMatch(/data-action="crafterCollect" disabled/); // rien à récupérer
    expect(html).toMatch(/data-action="crafterFuel" disabled/); // pas de charbon dans le sac
    g.inventory.add('diamond', 2);
    g.inventory.add('coal', 1);
    c.output.push('cut_diamond');
    html = crafterPanel(g, c);
    expect(html).not.toMatch(/data-action="crafterDeposit" disabled/);
    expect(html).not.toMatch(/data-action="crafterCollect" disabled/);
    expect(html).not.toMatch(/data-action="crafterFuel" disabled/);
    expect(html).toContain('Déposer mes matières (2)');
  });

  it('le panneau annonce l’état : à l’arrêt faute de charbon, en marche avec le nom du produit', () => {
    const g = new GameState(7);
    const c = placeCrafter(g);
    g.stats.discovered.push('gold_ingot');
    c.setRecipe('gold_plate');
    c.addInput('gold_ingot', 2);
    c.update(0.1, g);
    expect(crafterPanel(g, c)).toContain("À l'arrêt : plus de charbon");
    c.addFuel(1);
    c.update(0.1, g);
    expect(crafterPanel(g, c)).toContain("Fabrique : Plaque d'or");
  });

  it('la ligne d’un minerai au Tableau d’affichage donne aussi le prix de ses lingots et de ses produits', () => {
    const g = new GameState(7);
    g.stats.collected.iron = 1;
    g.stats.discovered.push('iron_ingot', 'iron_plate', 'steel');
    const html = marketTab(g);
    expect(html).toContain('Lingot : ');
    expect(html).toContain('Plaque : ');
    expect(html).toContain('Acier : ');
    expect(html).not.toContain('Plaque de cuivre');
  });

  it('les statistiques de production comptent les produits dans la colonne « Fabriqué »', () => {
    const g = new GameState(7);
    g.time = 120;
    g.production.addMade('steel', 30);
    g.production.addIngot('iron_ingot', 30);
    const html = productionStats(g);
    expect(html).toContain('Fabriqué');
    expect(html).not.toMatch(/<th class="num">Fondu<\/th>/);
    expect(html).toContain('Acier');
    expect(html).toContain('Lingot de fer');
  });

  it('l’Atelier propose la Manufacture, rangée avec les machines de fonte', () => {
    const g = new GameState(7);
    g.pickaxeLevel = 1;
    g.money = 5000;
    const html = workshopPanel(g, 'machines', undefined, { ...DEFAULT_VIEW, cat: 'traitement' });
    expect(html).toContain('Manufacture');
    expect(html).toContain('data-action="buyKit" data-arg="crafter:1"');
    expect(html).toContain('<h4>Traitement</h4>');
    expect(html).toContain('Four');
  });
});
