/**
 * Composants (fil de cuivre, engrenage, mécanisme) : des recettes à plusieurs étages. Ce qui compte : la chaîne de
 * Manufactures qui se passent leurs produits, une recette à trois matières différentes, l'ordre dans lequel elles apparaissent,
 * et qu'une partie d'avant (sans aucun composant) se recharge comme avant.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { getMachine } from '../src/data/machines';
import { RECIPES, getRecipe } from '../src/data/recipes';
import { RESOURCES, getResource, resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Crafter } from '../src/sim/structures/Crafter';
import type { Storage } from '../src/sim/structures/Storage';
import { crafterPanel } from '../src/ui/panels';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 13; // salle du fond de la mine de départ : x de 46 à 53
const SPEC = getMachine('crafter').crafter!;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 53, S + 15); // hors du passage des quatre machines en ligne (x de 46 à 52)
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

const crafter = (g: GameState, recipe: string, x: number): Crafter => {
  const c = put(g, 'crafter', x, Y, 0) as Crafter;
  c.setRecipe(recipe);
  c.addFuel(c.fuelMax);
  return c;
};

describe('composants : les fiches et les recettes', () => {
  it('trois produits ajoutés à la fin : les index sauvegardés ne bougent pas', () => {
    const ids = RESOURCES.map((r) => r.id);
    expect(ids.slice(-3)).toEqual(['copper_wire', 'gear', 'mechanism']);
    expect(ids.slice(0, 7)).toEqual(['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'diamond']);
    expect(resourceIndex('mechanism')).toBe(ids.length - 1);
  });

  it('une matière de recette peut être le produit d’une autre : trois étages du lingot au mécanisme', () => {
    expect(getRecipe('copper_wire').inputs).toEqual({ copper_plate: 1 });
    expect(getRecipe('gear').inputs).toEqual({ iron_plate: 1 });
    expect(getRecipe('mechanism').inputs).toEqual({ gear: 2, steel: 1, copper_wire: 3 });
    expect(getRecipe('copper_wire').yield).toBe(2);
    // Chaque matière de chaque recette est une ressource qui existe, et la plus grande tient dans la file d'attente de la machine.
    for (const r of RECIPES) for (const [res, n] of Object.entries(r.inputs)) {
      expect(getResource(res)).toBeDefined();
      expect(n).toBeLessThanOrEqual(SPEC.inputMax);
    }
  });

  it('le mécanisme vaut environ 1,4 fois ses matières, ni un cadeau ni une perte', () => {
    const inputs = Object.entries(getRecipe('mechanism').inputs).reduce((v, [res, n]) => v + getResource(res).value * n, 0);
    const ratio = getResource('mechanism').value / inputs;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.6);
  });
});

describe('composants : la Manufacture à trois matières', () => {
  it('chaque matière a sa propre file d’attente : une pleine ne bloque pas les autres, et un lingot est refusé', () => {
    const g = new GameState(4);
    const c = crafter(g, 'mechanism', 50);
    expect(c.addInput('gear', 99)).toBe(SPEC.inputMax);
    expect(c.canAccept('gear', 0)).toBe(false);
    expect(c.canAccept('steel', 0)).toBe(true);
    expect(c.canAccept('copper_wire', 0)).toBe(true);
    expect(c.canAccept('iron_ingot', 0)).toBe(false);
  });

  it('elle ne travaille qu’avec les trois matières, et les consomme ensemble', () => {
    const g = new GameState(4);
    const c = crafter(g, 'mechanism', 50);
    c.addInput('gear', 2);
    c.addInput('steel', 1);
    c.addInput('copper_wire', 2); // il en manque un
    run(g, 10);
    expect(c.made).toBe(0);
    expect(c.status).toBe('idle');
    c.addInput('copper_wire', 1);
    run(g, getRecipe('mechanism').time + 0.5);
    expect(c.output).toEqual(['mechanism']);
    expect(c.inputCount()).toBe(0);
  });

  it('chaîne à trois étages : lingots de cuivre → plaques → fils → mécanismes, avec engrenages et acier déposés', () => {
    const g = new GameState(4);
    const plates = crafter(g, 'copper_plate', 46);
    const wires = crafter(g, 'copper_wire', 48);
    const mech = crafter(g, 'mechanism', 50);
    const out = put(g, 'storage', 52, Y) as Storage;
    plates.addInput('copper_ingot', 3); // 3 plaques → 6 fils → 2 mécanismes
    mech.addInput('gear', 4);
    mech.addInput('steel', 2);
    run(g, 80);
    expect(plates.made).toBe(3);
    expect(wires.made).toBe(6);
    expect(mech.made).toBe(2);
    expect(out.items.mechanism).toBe(2);
    expect(g.stats.discovered).toEqual(expect.arrayContaining(['copper_plate', 'copper_wire', 'mechanism']));
  });
});

describe('composants : l’apparition des recettes', () => {
  it('le mécanisme ne se montre qu’une fois ses trois matières connues, le fil dès qu’on a fait une plaque', () => {
    const g = new GameState(4);
    const c = crafter(g, 'copper_plate', 50);
    let html = crafterPanel(g, c);
    expect(html).not.toContain('Fil de cuivre');
    g.stats.discovered.push('copper_plate');
    html = crafterPanel(g, c);
    expect(html).toContain('Fil de cuivre');
    expect(html).not.toContain('Mécanisme');
    g.stats.discovered.push('steel', 'gear', 'copper_wire');
    html = crafterPanel(g, c);
    expect(html).toContain('Mécanisme');
  });
});

describe('composants : sauvegarde', () => {
  it('une Manufacture en plein mécanisme se recharge identique, avec ses trois files d’attente', () => {
    const g = new GameState(4);
    const c = crafter(g, 'mechanism', 50);
    c.addInput('gear', 3);
    c.addInput('steel', 1);
    c.addInput('copper_wire', 2);
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const d = g2.structures.at(50, Y) as Crafter;
    expect(d.recipe).toBe('mechanism');
    expect(d.input).toEqual({ gear: 3, steel: 1, copper_wire: 2 });
    expect(d.serialize()).toEqual(c.serialize());
  });

  it('une partie d’avant, sans composant dans ses compteurs, se charge ; les nouveaux produits se ramassent par défaut', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    for (const id of ['copper_wire', 'gear', 'mechanism']) delete data.autoPickup[id];
    const g2 = deserialize(data);
    for (const id of ['copper_wire', 'gear', 'mechanism']) expect(g2.autoPickup[id]).toBe(true);
    run(g2, 5);
  });
});
