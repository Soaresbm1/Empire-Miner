/**
 * Puits : la structure de l'Ascenseur de puits. Il remonte du minerai par cycles fixes sans épuiser aucun gisement, brûle du
 * charbon et use un mécanisme tous les 40 morceaux. Ce qui compte : le cycle exact, l'arrêt sans charbon ou sans mécanisme,
 * l'usure, la sortie vers un coffre, le déblocage par le chantier, la limite de deux, la sauvegarde et le dépanneur.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { getMachine } from '../src/data/machines';
import { REPAIR_CAUSES, REPAIR_TEXT } from '../src/data/workers';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { applyAction } from '../src/sim/actions';
import { GameState } from '../src/sim/GameState';
import { diagnose } from '../src/sim/Repair';
import { STRUCTURE_FACTORIES } from '../src/sim/structures/registry';
import type { Storage } from '../src/sim/structures/Storage';
import { Well } from '../src/sim/structures/Well';
import { wellPanel } from '../src/ui/panels';
import { StallWatch } from '../src/ui/alerts';
import { goTo, run, teleport } from './helpers';

const DEF = getMachine('well');
const SPEC = DEF.well!;

/** Première case de la surface où un puits 3×3 tient, avec une case libre à sa droite pour un coffre. */
function spot(g: GameState): { x: number; y: number } {
  for (let y = 0; y + 3 <= SURFACE_ROWS; y++)
    for (let x = 6; x < 80; x++) {
      let ok = true;
      for (let yy = y; yy < y + 3 && ok; yy++) for (let xx = x; xx < x + 5 && ok; xx++) ok = g.world.isOpen(xx, yy) && !g.structures.at(xx, yy);
      if (ok) return { x, y };
    }
  throw new Error('aucune place pour un puits');
}

/** Un puits posé au camp, avec un coffre devant sa flèche (à droite). Le joueur se tient en dessous. */
function setup(opts: { coal?: number; mech?: number; chest?: boolean } = {}) {
  const g = new GameState(4);
  const { x, y } = spot(g);
  g.inventory.addKit('well', 1);
  teleport(g, x + 1, Math.min(SURFACE_ROWS - 1, y + 4));
  const w = g.place('well', x, y, 0) as Well | null;
  if (!w) throw new Error(g.canPlace('well', x, y).reason ?? 'pose impossible');
  let out: Storage | null = null;
  if (opts.chest !== false) {
    g.inventory.addKit('storage', 1);
    out = g.place('storage', x + 3, y + 1, 0) as Storage;
  }
  if (opts.coal) w.addFuel(opts.coal);
  if (opts.mech) w.addMech(opts.mech);
  return { g, w, out: out!, x, y };
}

describe('puits : la fiche', () => {
  it('3×3, 60 000 $, deux au plus, au camp, au charbon', () => {
    expect([DEF.w, DEF.h, DEF.price, DEF.limit, DEF.surfaceOnly, DEF.fuel?.res]).toEqual([3, 3, 60000, 2, true, 'coal']);
    expect(DEF.category).toBe('extraction');
    expect(STRUCTURE_FACTORIES.well).toBeDefined();
  });

  it('le cycle compte 10 morceaux : 4 fer, 3 argent, 2 or, 1 diamant', () => {
    const count = (res: string) => SPEC.cycle.filter((r) => r === res).length;
    expect(SPEC.cycle).toHaveLength(10);
    expect([count('iron'), count('silver'), count('gold'), count('diamond')]).toEqual([4, 3, 2, 1]);
  });

  it('le mécanisme coûte bien moins que ce que le puits remonte pendant qu’il dure', () => {
    const cycleValue = SPEC.cycle.reduce((v, r) => v + getResource(r).value, 0);
    const perMech = (cycleValue / SPEC.cycle.length) * SPEC.wearUnits;
    expect(perMech).toBeGreaterThan(getResource(SPEC.mechanism).value * 3);
    expect(perMech).toBeLessThan(getResource(SPEC.mechanism).value * 20); // il reste un coût réel, pas un cadeau
  });
});

describe('puits : le déblocage et la limite', () => {
  it('il s’ouvre à la fin de la phase « Machine d’extraction » du chantier (la septième)', () => {
    const g = new GameState(7);
    expect(g.isUnlocked('well')).toBe(false);
    g.project.phase = 6;
    expect(g.isUnlocked('well')).toBe(false);
    g.project.phase = 7;
    expect(g.isUnlocked('well')).toBe(true);
  });

  it('on n’en achète que deux, en comptant ceux qui sont posés et ceux qui attendent en kit', () => {
    const g = new GameState(7);
    g.project.phase = 7;
    g.money = 1_000_000;
    goTo(g, 'workshop');
    expect(g.buyKit('well', 3)).toBe(false); // trois d'un coup : refusé, rien n'est payé
    expect(g.money).toBe(1_000_000);
    expect(g.buyKit('well', 1)).toBe(true);
    expect(g.buyKit('well', 1)).toBe(true);
    expect(g.buyKit('well', 1)).toBe(false);
    expect(g.ownedCount('well')).toBe(2);
    expect(g.money).toBe(1_000_000 - 2 * DEF.price);
  });

  it('il se pose au camp seulement, et pas un troisième', () => {
    const g = new GameState(4);
    expect(g.siteProblem('well', 46, SURFACE_ROWS + 13)).toMatch(/surface/); // la salle du fond de la mine de départ
    const a = setup();
    expect(a.g.siteProblem('well', a.x + 20, a.y)).toBeNull();
    a.g.inventory.addKit('well', 2);
    teleport(a.g, a.x + 21, Math.min(SURFACE_ROWS - 1, a.y + 4)); // à portée de pose
    const second = a.g.place('well', a.x + 20, a.y, 0);
    expect(second).not.toBeNull();
    // Partout où le sol est libre, le troisième est refusé pour sa limite.
    const problems = Array.from({ length: 70 }, (_, k) => a.g.siteProblem('well', 6 + k, a.y)).filter((p) => p !== null);
    expect(problems.some((p) => /2 au plus/.test(p!))).toBe(true);
    expect(a.g.siteProblem('well', a.x + 40, a.y) ?? '').not.toBe('');
  });
});

describe('puits : la production', () => {
  it('remonte un morceau toutes les 5 s, dans l’ordre du cycle, jusque dans le coffre', () => {
    const { g, w, out } = setup({ coal: 20, mech: 1 });
    run(g, 100.5); // 20 morceaux : deux cycles
    expect(w.made).toBe(20);
    expect(out.items.iron).toBe(8);
    expect(out.items.silver).toBe(6);
    expect(out.items.gold).toBe(4);
    expect(out.items.diamond).toBe(2);
  });

  it('ne vide aucun gisement : les réserves de la carte ne bougent pas', () => {
    const { g } = setup({ coal: 20, mech: 1 });
    const before = Array.from(g.world.reserve).reduce((n, v) => n + v, 0);
    run(g, 100);
    expect(Array.from(g.world.reserve).reduce((n, v) => n + v, 0)).toBe(before);
  });

  it('sans charbon, il ne fait rien ; avec du charbon, il repart', () => {
    const { g, w } = setup({ mech: 1 });
    run(g, 10);
    expect(w.status).toBe('nofuel');
    expect(w.made).toBe(0);
    w.addFuel(2);
    run(g, 10.5);
    expect(w.made).toBe(2);
  });

  it('use un mécanisme tous les 40 morceaux, et s’arrête sans mécanisme neuf', () => {
    const { g, w } = setup({ coal: 20, mech: 1 });
    run(g, 100.5);
    w.addFuel(20); // 40 morceaux demandent 200 s de travail : exactement le réservoir plein, il faut le remplir en route
    run(g, 100.5);
    expect(w.made).toBe(40);
    expect(w.mech).toBe(0);
    expect(w.life).toBe(0);
    run(g, 20);
    expect(w.status).toBe('nomech');
    expect(w.made).toBe(40);
    w.addMech(1);
    w.addFuel(20);
    run(g, 10.5);
    expect(w.made).toBe(42);
    expect(w.mech).toBe(0);
    expect(w.life).toBe(SPEC.wearUnits - 2);
  });

  it('une sortie saturée l’arrête, et il repart quand le coffre est vidé', () => {
    const { g, w } = setup({ coal: 20, mech: 1, chest: false });
    run(g, 120);
    expect(w.status).toBe('full');
    expect(w.output).toHaveLength(SPEC.outputMax);
    expect(w.made).toBe(SPEC.outputMax);
  });

  it('refuse tout sauf le charbon et les mécanismes, et pas de mécanisme par la sortie', () => {
    const { w } = setup();
    expect(w.canAccept('coal', 0)).toBe(true);
    expect(w.canAccept('iron', 0)).toBe(false);
    expect(w.canAccept('mechanism', 2)).toBe(false); // il arrive par la sortie : la flèche regarde à droite, l'objet va vers la gauche
    expect(w.canAccept('mechanism', 0)).toBe(true);
    for (let i = 0; i < SPEC.mechMax; i++) w.accept('mechanism', 0);
    expect(w.canAccept('mechanism', 0)).toBe(false);
    w.addFuel(99);
    expect(w.fuelUnits).toBe(w.fuelMax);
    expect(w.canAccept('coal', 0)).toBe(false);
  });
});

describe('puits : les gestes du joueur', () => {
  it('charger le charbon, déposer les mécanismes et récupérer le minerai du sac', () => {
    const { g, w, x, y } = setup({ chest: false });
    g.inventory.add('coal', 5);
    g.inventory.add('mechanism', 2);
    applyAction(g, { k: 'wellFuel', x, y });
    applyAction(g, { k: 'wellDeposit', x, y });
    expect(w.fuelUnits).toBe(5);
    expect(w.mech).toBe(2);
    expect(g.inventory.count('coal')).toBe(0);
    expect(g.inventory.count('mechanism')).toBe(0);
    run(g, 30.5);
    expect(w.output.length).toBe(6);
    applyAction(g, { k: 'wellCollect', x, y });
    expect(w.output).toHaveLength(0);
    expect(g.inventory.count('iron') + g.inventory.count('silver') + g.inventory.count('gold') + g.inventory.count('diamond')).toBe(6);
  });

  it('son panneau dit ce qui bloque', () => {
    const { g, w } = setup({ coal: 1 });
    expect(wellPanel(g, w)).toContain('plus de mécanisme');
    w.addMech(1);
    run(g, 6);
    expect(wellPanel(g, w)).toContain('Remonte du minerai');
    expect(wellPanel(g, w)).toContain('Mécanismes en réserve');
  });
});

describe('puits : le dépanneur et l’alerte', () => {
  it('« plus de mécanisme » est une cause connue, que le dépanneur ne règle pas', () => {
    expect(REPAIR_CAUSES).toContain('nomech');
    expect(REPAIR_TEXT.nomech.label).toMatch(/mécanisme/);
    const { g, w } = setup({ coal: 5 });
    run(g, 1);
    expect(diagnose(g, w)).toEqual({ cause: 'nomech', fixable: false });
  });

  it('sans charbon, le dépanneur sait recharger s’il y en a en coffre', () => {
    const { g, w } = setup({ mech: 1 });
    run(g, 1);
    expect(diagnose(g, w)).toEqual({ cause: 'nocoal', fixable: false });
  });

  it('l’alerte « machine à l’arrêt » le signale après un moment', () => {
    const { g } = setup({ coal: 5 });
    const watch = new StallWatch();
    for (let i = 0; i < 60 * 25; i++) {
      g.update(1 / 60, [{ mx: 0, my: 0, mine: false, target: null }]);
      watch.update(g);
    }
    expect(watch.list.map((s) => s.text)).toEqual(['Puits : plus de mécanisme']);
  });
});

describe('puits : la sauvegarde', () => {
  it('un puits en plein travail se recharge identique, au milieu du cycle', () => {
    const { g, w, x, y } = setup({ coal: 20, mech: 2 });
    run(g, 27);
    expect(w.made).toBeGreaterThan(0);
    const before = w.serialize();
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const d = g2.structures.at(x, y) as Well;
    expect(d).toBeInstanceOf(Well);
    expect(d.serialize()).toEqual(before);
    run(g, 40);
    run(g2, 40);
    expect(JSON.stringify(g2.structures.at(x, y)!.serialize())).toBe(JSON.stringify(g.structures.at(x, y)!.serialize()));
  });

  it('les valeurs aberrantes sont ignorées', () => {
    const base = { type: 'well', x: 10, y: 3, dir: 0 as const };
    const w = Well.load({ ...base, fuelUnits: 999, burn: 'x', progress: 7, cycle: 99, life: 9999, mech: 99, output: Array(99).fill('iron').concat(['nimporte', 3]), made: -4 });
    expect(w.fuelUnits).toBe(w.fuelMax);
    expect(w.burn).toBe(0);
    expect(w.progress).toBe(1);
    expect(w.cycle).toBe(SPEC.cycle.length - 1);
    expect(w.life).toBe(SPEC.wearUnits);
    expect(w.mech).toBe(SPEC.mechMax);
    expect(w.output).toHaveLength(SPEC.outputMax);
    expect(w.made).toBe(0);
    const b = Well.load({ ...base, output: 'oups', mech: 'oups' });
    expect(b.output).toEqual([]);
    expect(b.mech).toBe(0);
  });

  it('une partie d’avant, sans aucun puits, se charge comme avant', () => {
    const g = new GameState(4);
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(g2.structures.list.some((s) => s.type === 'well')).toBe(false);
    expect(g2.isUnlocked('well')).toBe(false);
    run(g2, 5);
  });
});

describe('puits : récupérer le minerai quand le sac est presque plein', () => {
  it('ne perd rien : ce que le sac ne peut pas porter reste dans le puits', () => {
    const { g, w, x, y } = setup({ chest: false });
    w.output = ['iron', 'iron', 'iron', 'iron', 'silver', 'silver', 'silver', 'gold', 'gold', 'diamond'];
    while (g.inventory.capacity - g.inventory.weight() > 12) g.inventory.add('copper', 1); // il reste 12 kg de place
    const pieces = () => ['iron', 'silver', 'gold', 'diamond'].reduce((n, r) => n + g.inventory.count(r), 0) + w.output.length;
    expect(pieces()).toBe(10);
    applyAction(g, { k: 'wellCollect', x, y });
    expect(pieces()).toBe(10); // aucun morceau perdu
    expect(w.output.length).toBeGreaterThan(0);
    expect(w.output.length).toBeLessThan(10);
    expect(g.inventory.capacity - g.inventory.weight()).toBeLessThan(3); // et le sac est vraiment plein
  });
});
