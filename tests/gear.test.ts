import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, rowForDepth } from '../src/core/constants';
import { AIR } from '../src/data/blocks';
import { BOOTS_WATER, GEAR, getGear } from '../src/data/gear';
import { CAVE_IN, GAS, HEALTH, HEAT, WATER } from '../src/data/hazards';
import { deserialize, serialize } from '../src/save/save';
import { GameState, PlayerIntent } from '../src/sim/GameState';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;

/** Galerie naturelle horizontale sur la rangée y, avec le joueur en son milieu. */
function gallery(g: GameState, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    g.world.set(x, y, AIR);
    g.world.setExplored(x, y);
  }
  teleport(g, Math.round((x0 + x1) / 2), y);
}

/** Niveau d'eau ou de grisou sur toute la galerie. */
function fill(g: GameState, grid: 'gas' | 'water', x0: number, x1: number, y: number, level: number): void {
  const arr = grid === 'gas' ? g.world.gas : g.world.water;
  for (let x = x0; x <= x1; x++) arr[g.world.idx(x, y)] = level;
  g.hazards.rebuild();
}

/** Tout l'équipement d'un coup (sans passer par l'Atelier). */
function wear(g: GameState, ...ids: string[]): void {
  for (const id of ids) g.gear.add(id);
}

const lost = (g: GameState, seconds: number, intent?: PlayerIntent): number => {
  const before = g.hp;
  run(g, seconds, intent);
  return before - g.hp;
};

describe('équipement : achat à l’Atelier', () => {
  it('quatre pièces, une par emplacement, chacune contre un danger différent', () => {
    expect(GEAR.map((x) => x.slot).sort()).toEqual(['body', 'feet', 'head', 'lungs']);
    expect(new Set(GEAR.map((x) => x.hazard)).size).toBe(4);
    for (const def of GEAR) {
      expect(def.absorb).toBeGreaterThan(0);
      expect(def.absorb).toBeLessThan(1);
      expect(def.price).toBeGreaterThan(0);
    }
  });

  it('s’achète à l’Atelier, une fois, et coûte son prix', () => {
    const g = new GameState(4);
    g.money = 1000;
    teleport(g, 5, S - 6); // loin de l'Atelier
    expect(g.buyGear('helmet')).toBe(false);
    expect(g.money).toBe(1000);
    goTo(g, 'workshop');
    expect(g.buyGear('helmet')).toBe(true);
    expect(g.hasGear('helmet')).toBe(true);
    expect(g.money).toBe(1000 - getGear('helmet').price);
    expect(g.events.some((e) => e.t === 'bought' && e.name === 'Casque renforcé')).toBe(true);
    // Déjà porté : pas de deuxième achat.
    expect(g.buyGear('helmet')).toBe(false);
    expect(g.money).toBe(1000 - getGear('helmet').price);
  });

  it('refuse l’achat sans assez d’argent', () => {
    const g = new GameState(4);
    goTo(g, 'workshop');
    g.money = getGear('suit').price - 1;
    expect(g.buyGear('suit')).toBe(false);
    expect(g.hasGear('suit')).toBe(false);
    expect(g.money).toBe(getGear('suit').price - 1);
  });

  it('l’équipement reste au mineur qui s’évanouit', () => {
    const g = new GameState(4);
    wear(g, 'helmet', 'mask');
    g.hurtPlayer(1000, 'grisou');
    expect(g.stats.faints).toBe(1);
    expect(g.hasGear('helmet') && g.hasGear('mask')).toBe(true);
  });
});

describe('équipement : casque contre les éboulements', () => {
  it('sans casque, l’éboulement fait ses dégâts pleins', () => {
    const g = new GameState(4);
    g.hurtPlayer(CAVE_IN.damage, 'éboulement');
    expect(g.hp).toBeCloseTo(HEALTH.max - CAVE_IN.damage, 5);
  });

  it('avec le casque, une bonne part est absorbée, et un message le dit', () => {
    const g = new GameState(4);
    wear(g, 'helmet');
    g.hurtPlayer(CAVE_IN.damage, 'éboulement');
    expect(g.hp).toBeCloseTo(HEALTH.max - CAVE_IN.damage * (1 - getGear('helmet').absorb), 5);
    expect(g.events.some((e) => e.t === 'message' && /amortit/.test(e.text))).toBe(true);
  });

  it('un véritable effondrement blesse moins avec le casque', () => {
    const hit = (helmet: boolean) => {
      const g = new GameState(4);
      if (helmet) wear(g, 'helmet');
      gallery(g, 18, 26, S + 39);
      g.hazards.collapse(22, S + 39);
      return HEALTH.max - g.hp;
    };
    expect(hit(false)).toBeCloseTo(CAVE_IN.damage, 5);
    expect(hit(true)).toBeLessThan(hit(false) / 2);
  });

  it('le casque ne protège pas du gaz', () => {
    const g = new GameState(4);
    wear(g, 'helmet');
    g.hurtPlayer(10, 'grisou');
    expect(g.hp).toBeCloseTo(HEALTH.max - 10, 5);
  });
});

describe('équipement : masque contre le grisou', () => {
  const dose = (mask: boolean) => {
    const g = new GameState(4);
    if (mask) wear(g, 'mask');
    const y = S + 45;
    gallery(g, 18, 26, y);
    fill(g, 'gas', 18, 26, y, 255);
    return lost(g, 1);
  };

  it('sans masque, le nuage fait ses dégâts par seconde', () => {
    expect(dose(false)).toBeCloseTo(GAS.dps, 1);
  });

  it('avec le masque, presque tout est absorbé', () => {
    expect(dose(true)).toBeCloseTo(GAS.dps * (1 - getGear('mask').absorb), 1);
  });
});

describe('équipement : cuissardes contre l’eau', () => {
  const y = S + 39;

  it('on marche à la même vitesse dans l’eau peu profonde', () => {
    expect(new GameState(4).hazards.speedFactor(5, 5, true)).toBe(1);
    const g = new GameState(4);
    gallery(g, 10, 40, y);
    fill(g, 'water', 10, 40, y, 100);
    expect(g.hazards.speedFactor(20, y)).toBe(WATER.slowShallow);
    expect(g.hazards.speedFactor(20, y, true)).toBe(BOOTS_WATER.shallow);
  });

  it('dans l’eau profonde, on avance moins lentement', () => {
    const g = new GameState(4);
    gallery(g, 10, 40, y);
    fill(g, 'water', 10, 40, y, 255);
    expect(g.hazards.speedFactor(20, y)).toBe(WATER.slowDeep);
    expect(g.hazards.speedFactor(20, y, true)).toBe(BOOTS_WATER.deep);
    expect(BOOTS_WATER.deep).toBeGreaterThan(WATER.slowDeep);
  });

  it('la marche en est réellement plus rapide (et sans cuissardes, l’eau freine)', () => {
    const walk = (boots: boolean, water: boolean) => {
      const g = new GameState(4);
      if (boots) wear(g, 'boots');
      gallery(g, 10, 40, y);
      teleport(g, 12, y);
      if (water) fill(g, 'water', 10, 40, y, 100);
      const x0 = g.player.x;
      run(g, 0.5, { mx: 1, my: 0, mine: false, target: null });
      return g.player.x - x0;
    };
    const dry = walk(false, false);
    expect(walk(false, true)).toBeLessThan(dry * 0.9);
    expect(walk(true, true)).toBeCloseTo(dry, 0);
  });

  it('l’eau profonde épuise moins avec les cuissardes', () => {
    const drown = (boots: boolean) => {
      const g = new GameState(4);
      if (boots) wear(g, 'boots');
      gallery(g, 10, 40, y);
      fill(g, 'water', 10, 40, y, 255);
      return lost(g, 1);
    };
    expect(drown(false)).toBeCloseTo(WATER.dps, 1);
    expect(drown(true)).toBeCloseTo(WATER.dps * (1 - getGear('boots').absorb), 1);
  });
});

describe('équipement : combinaison contre la chaleur de la Fournaise', () => {
  const fire = (depth: number, gear: string[] = [], seconds = 10) => {
    const g = new GameState(4);
    wear(g, ...gear);
    const y = rowForDepth(depth);
    gallery(g, 18, 26, y);
    return { g, y, loss: lost(g, seconds) };
  };

  it('la mine n’est pas chaude avant la Fournaise', () => {
    expect(fire(HEAT.minDepth - 40).loss).toBe(0);
  });

  it('dans la Fournaise, le mineur sans protection perd de la santé, de plus en plus au fond', () => {
    const top = fire(HEAT.minDepth + 5).loss;
    const bottom = fire(HEAT.maxDepth - 5).loss;
    expect(top).toBeGreaterThan(HEAT.hurtTop * 10 * 0.95);
    expect(top).toBeLessThan(HEAT.hurtBottom * 10);
    expect(bottom).toBeGreaterThan(top * 2);
    expect(bottom).toBeLessThanOrEqual(HEAT.hurtBottom * 10 + 0.5);
  });

  it('la combinaison ignifugée absorbe l’essentiel de la chaleur', () => {
    const bare = fire(HEAT.maxDepth - 5).loss;
    const suited = fire(HEAT.maxDepth - 5, ['suit']).loss;
    expect(suited).toBeCloseTo(bare * (1 - getGear('suit').absorb), 0);
    expect(suited).toBeLessThan(bare / 4);
  });

  it('un ventilateur à côté rend le mineur indemne, avec ou sans combinaison', () => {
    const g = new GameState(4);
    const y = rowForDepth(HEAT.maxDepth - 5);
    gallery(g, 18, 26, y);
    g.inventory.addKit('fan', 1);
    teleport(g, 20, y);
    expect(g.place('fan', 24, y, 0)).toBeTruthy();
    teleport(g, 22, y); // à 2 cases du ventilateur : au frais
    expect(lost(g, 10)).toBe(0);
    teleport(g, 18, y); // à 6 cases : trop loin, il fait chaud
    expect(lost(g, 3)).toBeGreaterThan(1);
  });

  it('le premier coup de chaleur prévient le joueur, sans le répéter à chaque image', () => {
    const { g } = fire(HEAT.minDepth + 20, [], 5);
    const warns = g.events.filter((e) => e.t === 'message' && /chaleur|Fournaise/i.test(e.text));
    expect(warns.length).toBe(1);
  });

  it('la santé remonte de nouveau une fois au frais', () => {
    const g = new GameState(4);
    const y = rowForDepth(HEAT.maxDepth - 5);
    gallery(g, 18, 26, y);
    run(g, 8);
    const hurt = g.hp;
    expect(hurt).toBeLessThan(HEALTH.max);
    teleport(g, 20, S - 3); // remonté à la surface
    run(g, HEALTH.regenDelay + 3);
    expect(g.hp).toBeGreaterThan(hurt + 10);
  });
});

describe('équipement : sauvegarde', () => {
  it('les pièces achetées se retrouvent au chargement', () => {
    const g = new GameState(4);
    wear(g, 'mask', 'suit');
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect([...back.gear].sort()).toEqual(['mask', 'suit']);
    expect(back.absorb('gas')).toBeCloseTo(getGear('mask').absorb, 5);
    expect(back.absorb('cavein')).toBe(0);
  });

  it('une ancienne sauvegarde, sans équipement, se charge avec les mains nues', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete data.gear;
    expect(deserialize(data).gear.size).toBe(0);
  });

  it('ignore les pièces inconnues d’un fichier trafiqué ou plus récent', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    data.gear = ['helmet', 'cape-invisible', 42];
    expect([...deserialize(data).gear]).toEqual(['helmet']);
  });
});
