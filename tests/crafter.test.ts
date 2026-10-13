import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { getMachine } from '../src/data/machines';
import { RECIPES, getRecipe, hasRecipe } from '../src/data/recipes';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { applyAction } from '../src/sim/actions';
import { GameState } from '../src/sim/GameState';
import { Crafter } from '../src/sim/structures/Crafter';
import type { StructureContext } from '../src/sim/structures/Structure';
import type { Storage } from '../src/sim/structures/Storage';
import { STRUCTURE_FACTORIES } from '../src/sim/structures/registry';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ : x de 46 à 53, y de S+13 à S+15.
const Y = S + 13;
const SPEC = getMachine('crafter').crafter!;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

/** Une Manufacture posée dans la salle du fond, réglée sur `recipe`, avec du charbon. */
function crafter(g: GameState, recipe: string | null, fuel = 3, x = 50, y = Y, dir: Dir = 0): Crafter {
  const c = put(g, 'crafter', x, y, dir) as Crafter;
  if (recipe) c.setRecipe(recipe);
  c.addFuel(fuel);
  return c;
}

function onGround(g: GameState, res: string): number {
  return g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);
}

describe('Manufacture : la machine', () => {
  it('occupe 2×2 cases, se tourne, se range dans le groupe Usine et se pose par son kit', () => {
    const g = new GameState(4);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    expect([c.w, c.h]).toEqual([2, 2]);
    for (const [x, y] of [[50, Y], [51, Y], [50, Y + 1], [51, Y + 1]]) expect(g.structures.at(x, y)).toBe(c);
    expect(getMachine('crafter').category).toBe('traitement');
    expect(getMachine('crafter').rotatable).toBe(true);
    expect(STRUCTURE_FACTORIES.crafter).toBeDefined();
    expect(g.rotateAt(50, Y)).toBe(true);
    expect(c.dir).toBe(1);
  });

  it('s’ouvre avec la Pioche améliorée et se démonte en rendant son kit et tout son contenu', () => {
    const g = new GameState(4);
    expect(g.isUnlocked('crafter')).toBe(false); // pioche de départ
    g.pickaxeLevel = 1;
    expect(g.isUnlocked('crafter')).toBe(true);
    const c = crafter(g, 'iron_plate', 2);
    c.addInput('iron_ingot', 4);
    c.output.push('iron_plate');
    teleport(g, 49, Y);
    expect(g.removeAt(50, Y)).toBe(true);
    expect(g.inventory.kitCount('crafter')).toBe(1);
    expect(onGround(g, 'iron_ingot')).toBe(4);
    expect(onGround(g, 'iron_plate')).toBe(1);
    expect(onGround(g, 'coal')).toBe(2);
  });
});

describe('Manufacture : la fabrication', () => {
  it('une plaque par lingot, toutes les 2 s, au charbon ; la fabrication est comptée', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate');
    expect(c.addInput('copper_ingot', 5)).toBe(5);
    run(g, getRecipe('copper_plate').time * 2 + 0.1);
    expect(c.output).toEqual(['copper_plate', 'copper_plate']);
    expect(c.input.copper_ingot).toBe(3);
    expect(c.status).toBe('ok');
    expect(c.made).toBe(2);
    expect(g.stats.crafted).toBe(2);
    expect(g.production.rates().made.copper_plate).toBeGreaterThan(0);
  });

  it('l’acier prend deux lingots de fer : un lingot seul ne suffit pas, il attend', () => {
    const g = new GameState(4);
    const c = crafter(g, 'steel');
    c.addInput('iron_ingot', 3);
    run(g, getRecipe('steel').time * 3);
    expect(c.output).toEqual(['steel']);
    expect(c.input.iron_ingot).toBe(1);
    expect(c.status).toBe('idle');
    expect(c.progress).toBe(0);
    c.addInput('iron_ingot', 1);
    run(g, getRecipe('steel').time + 0.1);
    expect(c.output).toEqual(['steel', 'steel']);
    expect(c.input.iron_ingot ?? 0).toBe(0);
  });

  it('le diamant se taille : un diamant brut donne un diamant taillé, qui vaut le double', () => {
    const g = new GameState(4);
    const c = crafter(g, 'cut_diamond');
    expect(c.addInput('diamond', 2)).toBe(2);
    run(g, getRecipe('cut_diamond').time * 2 + 0.1);
    expect(c.output).toEqual(['cut_diamond', 'cut_diamond']);
    expect(getResource('cut_diamond').value).toBe(2 * getResource('diamond').value);
  });

  it('le premier produit fabriqué rejoint le carnet (et le dit) ; les suivants ne le répètent pas', () => {
    const g = new GameState(4);
    const c = crafter(g, 'iron_plate');
    c.addInput('iron_ingot', 3);
    g.events.length = 0;
    run(g, getRecipe('iron_plate').time * 3 + 0.1);
    expect(g.stats.discovered).toContain('iron_plate');
    const news = g.events.filter((e) => e.t === 'discover' && e.text.includes('Première fabrication'));
    expect(news).toHaveLength(1);
    expect((news[0] as { text: string }).text).toContain('Plaque de fer');
  });

  it('sans recette, rien ne se fait ; sans charbon, elle s’arrête ; le charbon ne brûle que pendant le travail', () => {
    const g = new GameState(4);
    const c = crafter(g, null, 0);
    run(g, 1);
    expect(c.status).toBe('norecipe');
    c.setRecipe('copper_plate');
    c.addInput('copper_ingot', 2);
    run(g, 5);
    expect(c.status).toBe('nofuel');
    expect(c.output.length).toBe(0);
    c.addFuel(1);
    run(g, getRecipe('copper_plate').time * 2 + 1);
    expect(c.output.length).toBe(2);
    expect(c.status).toBe('idle');
    const left = c.fuelSeconds();
    run(g, 10); // plus de matières : la réserve ne bouge plus
    expect(c.fuelSeconds()).toBeCloseTo(left, 5);
    expect(left).toBeCloseTo(getMachine('crafter').fuel!.secondsPerUnit - 2 * getRecipe('copper_plate').time, 0);
  });

  it('sortie saturée : elle s’arrête sans brûler son charbon', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate', 5);
    c.addInput('copper_ingot', SPEC.inputMax);
    run(g, getRecipe('copper_plate').time * SPEC.outputMax + 5);
    expect(c.output.length).toBe(SPEC.outputMax);
    c.addInput('copper_ingot', 3);
    run(g, 1);
    expect(c.status).toBe('full');
    const left = c.fuelSeconds();
    run(g, 10);
    expect(c.fuelSeconds()).toBeCloseTo(left, 5);
  });

  it('la chaleur de la Fournaise ralentit la fabrication, sans toucher à la consommation de matières', () => {
    const ctx = { hazards: { heatFactor: () => 0.5 }, structureAt: () => undefined, countCrafted: () => {} } as unknown as StructureContext;
    const c = new Crafter(50, Y, 0);
    c.setRecipe('copper_plate');
    c.addFuel(1);
    c.addInput('copper_ingot', 2);
    c.update(1, ctx); // une seconde à demi-cadence : le quart d'une fabrication de 2 s
    expect(c.heat).toBe(0.5);
    expect(c.progress).toBeCloseTo(0.25, 5);
    expect(c.perMinute()).toBeCloseTo(15, 5);
    c.update(3, ctx);
    expect(c.made).toBe(1);
    expect(c.input.copper_ingot).toBe(1);
  });
});

describe('Manufacture : les entrées', () => {
  it('seules les matières de la recette entrent, jamais par la sortie ; le charbon entre de partout', () => {
    const g = new GameState(4);
    const c = crafter(g, 'iron_plate', 0, 50, Y, 0); // sortie vers l'est
    expect(c.canAccept('iron_ingot', 0)).toBe(true);
    expect(c.canAccept('iron_ingot', 1)).toBe(true);
    expect(c.canAccept('iron_ingot', 2)).toBe(false); // arrive de l'est, en sens inverse de la flèche
    expect(c.canAccept('copper_ingot', 0)).toBe(false); // pas dans la recette
    expect(c.canAccept('iron', 0)).toBe(false); // le minerai brut non plus
    expect(c.canAccept('stone', 0)).toBe(false);
    expect(c.canAccept('coal', 2)).toBe(true);
    expect(c.canAccept('coal', 0)).toBe(true);
  });

  it('sans recette, seul le charbon entre', () => {
    const g = new GameState(4);
    const c = crafter(g, null, 0);
    expect(c.canAccept('iron_ingot', 0)).toBe(false);
    expect(c.canAccept('copper_ingot', 0)).toBe(false);
    expect(c.canAccept('coal', 0)).toBe(true);
    expect(c.addInput('iron_ingot', 3)).toBe(0);
  });

  it('chaque matière a sa place : la machine se remplit, puis refuse', () => {
    const g = new GameState(4);
    const c = crafter(g, 'steel', 0);
    for (let i = 0; i < SPEC.inputMax; i++) expect(c.accept('iron_ingot', 0)).toBe(true);
    expect(c.canAccept('iron_ingot', 0)).toBe(false);
    expect(c.addInput('iron_ingot', 5)).toBe(0);
    c.addFuel(100);
    expect(c.fuelUnits).toBe(c.fuelMax);
    expect(c.canAccept('coal', 0)).toBe(false);
    expect(c.fuelWanted()).toBeNull();
  });

  it('chaîne complète : coffre → convoyeur → Manufacture → coffre ; le charbon voyage avec les lingots', () => {
    const g = new GameState(4);
    const src = put(g, 'storage', 48, Y) as Storage;
    put(g, 'conveyor', 49, Y, 0);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    c.setRecipe('iron_plate');
    const out = put(g, 'storage', 52, Y) as Storage;
    src.put('iron_ingot', 6);
    src.put('coal', 2);
    run(g, 40);
    expect(out.items.iron_plate).toBe(6);
    expect(c.made).toBe(6);
    expect(out.items.coal ?? 0).toBe(0); // le charbon est resté dans la machine
    expect(src.items.iron_ingot ?? 0).toBe(0);
  });

  it('un lingot que la recette n’utilise pas bloque le convoyeur, au lieu d’entrer par erreur', () => {
    const g = new GameState(4);
    const src = put(g, 'storage', 48, Y) as Storage;
    put(g, 'conveyor', 49, Y, 0);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    c.setRecipe('iron_plate');
    c.addFuel(3);
    src.put('copper_ingot', 4);
    run(g, 10);
    expect(c.inputCount()).toBe(0);
    expect(c.made).toBe(0);
    expect(src.items.copper_ingot ?? 0).toBeLessThan(4); // parti sur le convoyeur…
  });

  it('les produits sortent par les deux cases devant la flèche, à tour de rôle', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate', 2, 50, Y, 0);
    const a = put(g, 'storage', 52, Y) as Storage;
    const b = put(g, 'storage', 52, Y + 1) as Storage;
    c.addInput('copper_ingot', 8);
    run(g, getRecipe('copper_plate').time * 8 + 2);
    expect(c.made).toBe(8);
    expect(a.items.copper_plate).toBe(4);
    expect(b.items.copper_plate).toBe(4);
  });
});

describe('Manufacture : la recette', () => {
  it('changer de recette rend dans le sac les matières que la nouvelle n’utilise pas', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate');
    c.addInput('copper_ingot', 5);
    teleport(g, 49, Y);
    expect(g.setCrafterRecipe(c, 'cut_diamond')).toBe(true);
    expect(c.recipe).toBe('cut_diamond');
    expect(c.inputCount()).toBe(0);
    expect(g.inventory.count('copper_ingot')).toBe(5);
  });

  it('ce qui ne tient pas dans le sac tombe aux pieds du joueur : rien ne se perd', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate');
    c.addInput('copper_ingot', 10);
    g.inventory.add('stone', Math.floor(g.inventory.room('stone')) - 1); // sac presque plein
    teleport(g, 49, Y);
    g.setCrafterRecipe(c, 'gold_plate');
    const inBag = g.inventory.count('copper_ingot');
    expect(inBag).toBeLessThan(10);
    expect(inBag + onGround(g, 'copper_ingot')).toBe(10);
  });

  it('les matières que les deux recettes utilisent restent (fer : plaque → acier)', () => {
    const g = new GameState(4);
    const c = crafter(g, 'iron_plate');
    c.addInput('iron_ingot', 6);
    teleport(g, 49, Y);
    g.setCrafterRecipe(c, 'steel');
    expect(c.input.iron_ingot).toBe(6);
    expect(g.inventory.count('iron_ingot')).toBe(0);
  });

  it('le travail en cours repart de zéro, et une recette inconnue ou la même ne change rien', () => {
    const g = new GameState(4);
    const c = crafter(g, 'steel');
    c.addInput('iron_ingot', 4);
    run(g, 1.5);
    expect(c.progress).toBeGreaterThan(0);
    expect(g.setCrafterRecipe(c, 'steel')).toBe(false);
    expect(c.progress).toBeGreaterThan(0);
    expect(g.setCrafterRecipe(c, 'iron_plate')).toBe(true);
    expect(c.progress).toBe(0);
    expect(g.setCrafterRecipe(c, 'poudre_de_perlimpinpin')).toBe(true); // inconnue : aucune recette
    expect(c.recipe).toBeNull();
    expect(hasRecipe('steel')).toBe(true);
    expect(hasRecipe('poudre_de_perlimpinpin')).toBe(false);
    expect(hasRecipe(42)).toBe(false);
  });
});

describe('Manufacture : à la main (actions)', () => {
  it('choisir la recette, charger le charbon, déposer les matières du sac, récupérer les produits', () => {
    const g = new GameState(4);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    teleport(g, 49, Y);
    g.inventory.add('coal', 2);
    g.inventory.add('iron_ingot', 4);
    g.inventory.add('copper_ingot', 1);
    applyAction(g, { k: 'crafterDeposit', x: 50, y: Y }); // sans recette : rien ne se passe
    expect(c.inputCount()).toBe(0);
    applyAction(g, { k: 'crafterRecipe', x: 50, y: Y, recipe: 'steel' });
    expect(c.recipe).toBe('steel');
    applyAction(g, { k: 'crafterFuel', x: 50, y: Y });
    expect(c.fuelUnits).toBe(2);
    expect(g.inventory.count('coal')).toBe(0);
    applyAction(g, { k: 'crafterDeposit', x: 50, y: Y });
    expect(c.input.iron_ingot).toBe(4);
    expect(g.inventory.count('iron_ingot')).toBe(0);
    expect(g.inventory.count('copper_ingot')).toBe(1); // pas dans la recette : reste dans le sac
    run(g, getRecipe('steel').time * 2 + 0.5);
    applyAction(g, { k: 'crafterCollect', x: 50, y: Y });
    expect(g.inventory.count('steel')).toBe(2);
    expect(c.output.length).toBe(0);
  });

  it('une action sur une case qui n’est pas une Manufacture, ou avec une recette inconnue, ne fait rien', () => {
    const g = new GameState(4);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    expect(() => applyAction(g, { k: 'crafterRecipe', x: 50, y: Y, recipe: '__proto__' })).not.toThrow();
    expect(c.recipe).toBeNull();
    expect(() => applyAction(g, { k: 'crafterRecipe', x: 3, y: 3, recipe: 'steel' })).not.toThrow();
    expect(() => applyAction(g, { k: 'crafterFuel', x: 3, y: 3 })).not.toThrow();
  });

  it('récupérer les produits : ce que le sac ne peut pas porter reste dans la machine', () => {
    const g = new GameState(4);
    const c = crafter(g, 'gold_plate');
    for (let i = 0; i < 30; i++) c.output.push('gold_plate');
    c.output.length = Math.min(c.output.length, SPEC.outputMax);
    teleport(g, 49, Y);
    const n = g.crafterCollect(c);
    expect(n).toBe(Math.floor(g.bag.capacity / getResource('gold_plate').weight));
    expect(c.output.length).toBe(SPEC.outputMax - n);
  });
});

describe('Manufacture : sauvegarde', () => {
  it('une partie sauvegardée retrouve la recette, les matières, les produits et l’avancement', () => {
    const g = new GameState(4);
    const c = crafter(g, 'steel', 4);
    c.addInput('iron_ingot', 5);
    c.output.push('steel');
    run(g, 2.5);
    const before = c.serialize();
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const d = g2.structures.at(50, Y) as Crafter;
    expect(d).toBeInstanceOf(Crafter);
    expect(d.serialize()).toEqual(before);
    expect(d.recipe).toBe('steel');
    run(g, 6);
    run(g2, 6);
    expect(JSON.stringify(g2.structures.at(50, Y)!.serialize())).toBe(JSON.stringify(g.structures.at(50, Y)!.serialize()));
  });

  it('le réglage choisi survit à une sauvegarde sans rien d’autre (machine sans recette comprise)', () => {
    const g = new GameState(4);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect((g2.structures.at(50, Y) as Crafter).recipe).toBeNull();
    c.setRecipe('silver_plate');
    const g3 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect((g3.structures.at(50, Y) as Crafter).recipe).toBe('silver_plate');
  });

  it('les valeurs aberrantes sont ignorées : recette inconnue, matières hors recette, nombres absurdes', () => {
    const base = { type: 'crafter', x: 50, y: Y, dir: 0 as Dir };
    const a = Crafter.load({ ...base, recipe: 'inconnue', input: { iron_ingot: 5 }, output: ['steel', 'nimporte', 3], fuelUnits: 999, burn: 'x', progress: 7, made: -4 });
    expect(a.recipe).toBeNull();
    expect(a.inputCount()).toBe(0);
    expect(a.output).toEqual(['steel']);
    expect(a.fuelUnits).toBe(a.fuelMax);
    expect(a.burn).toBe(0);
    expect(a.progress).toBe(1);
    expect(a.made).toBe(0);
    const b = Crafter.load({ ...base, recipe: 'steel', input: { iron_ingot: 999, copper_ingot: 4, __proto__: 3 }, output: Array(99).fill('steel'), progress: -2, burn: -5 });
    expect(b.input).toEqual({ iron_ingot: SPEC.inputMax });
    expect(b.output.length).toBe(SPEC.outputMax);
    expect(b.progress).toBe(0);
    expect(b.burn).toBe(0);
    const c = Crafter.load({ ...base, recipe: 'steel', input: 'oups', output: 'oups' });
    expect(c.inputCount()).toBe(0);
    expect(c.output).toEqual([]);
  });

  it('une ancienne sauvegarde, sans aucune Manufacture ni compteur de produits, se charge comme avant', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.stats.crafted;
    for (const slot of data.production ?? []) delete slot.f;
    delete data.autoPickup.steel;
    delete data.autoPickup.cut_diamond;
    const g2 = deserialize(data);
    expect(g2.stats.crafted).toBe(0);
    expect(g2.autoPickup.steel).toBe(true); // un produit que la sauvegarde ne connaît pas se ramasse comme le reste
    expect(g2.autoPickup.cut_diamond).toBe(true);
  });
});

describe('Manufacture : le reste du jeu', () => {
  it('un ravitailleur peut la recharger : elle se présente comme une machine à charbon', () => {
    const g = new GameState(4);
    const c = crafter(g, 'steel', 0);
    expect('addFuel' in c && 'fuelUnits' in c && 'fuelMax' in c).toBe(true);
    expect(c.fuelWanted()).toBe('coal');
    c.addFuel(c.fuelMax);
    expect(c.fuelWanted()).toBeNull();
  });

  it('les produits se vendent au comptoir au cours du métal dont ils viennent', () => {
    const g = new GameState(4);
    expect(g.market.mult('copper_plate')).toBe(g.market.mult('copper'));
    expect(g.market.mult('steel')).toBe(g.market.mult('iron'));
    expect(g.market.mult('cut_diamond')).toBe(g.market.mult('diamond'));
    expect(g.quote('steel', 3)).toBe(Math.round(getResource('steel').value * g.market.mult('iron') * 3));
  });

  it('chaque recette donne un produit qui vaut plus que ses matières, et rien n’est inventé', () => {
    for (const r of RECIPES) {
      const out = getResource(r.id);
      expect(out.product).toBe(true);
      const inputs = Object.entries(r.inputs).reduce((v, [res, n]) => v + getResource(res).value * n, 0);
      expect(out.value * r.yield).toBeGreaterThan(inputs);
      expect(out.value * r.yield).toBeLessThanOrEqual(inputs * 2.5);
      expect(r.time).toBeGreaterThan(0);
      expect(Object.keys(r.inputs).length).toBeGreaterThan(0);
    }
  });

  it('la machine est solide et couvre exactement ses 2×2 cases', () => {
    const g = new GameState(4);
    const c = put(g, 'crafter', 50, Y, 0) as Crafter;
    expect(c.solid).toBe(true);
    expect(c.covers(51, Y + 1)).toBe(true);
    expect(c.covers(52, Y)).toBe(false);
  });
});
