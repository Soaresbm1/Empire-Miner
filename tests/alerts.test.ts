import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/constants';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { ALERT, StallWatch, alertChip, stallToasts } from '../src/ui/alerts';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Fait avancer la partie de `s` secondes de jeu en relevant l'alerte à chaque pas ; renvoie tout ce qui a été signalé. */
function advance(g: GameState, w: StallWatch, s: number) {
  const told: string[] = [];
  for (let i = 0; i < Math.round(s / SIM_DT); i++) {
    g.update(SIM_DT, [IDLE]);
    told.push(...w.update(g).map((f) => f.text));
  }
  return told;
}

/** Une foreuse à charbon sur un gisement de surface, sans charbon pour la lancer : elle est à l'arrêt. */
function stalledDrill(g: GameState, x = 56): Drill {
  g.world.setDeposit(x, 9, 1, 60);
  return g.structures.add(new Drill(x, 9, 1)) as Drill;
}

describe('alerte : machine à l’arrêt', () => {
  it('ne signale une machine qu’après un arrêt continu, puis une seule fois', () => {
    const g = new GameState(4);
    const w = new StallWatch();
    stalledDrill(g);
    expect(advance(g, w, ALERT.delay - 5)).toEqual([]);
    expect(w.list).toHaveLength(0);
    const told = advance(g, w, 10);
    expect(told).toEqual(['Foreuse à charbon : plus de charbon, et aucun coffre n’en a']);
    expect(w.list).toHaveLength(1);
    expect(advance(g, w, 30)).toEqual([]); // pas de répétition
    expect(w.list).toHaveLength(1);
  });

  it('une machine qui repart sort de la liste, et peut être signalée de nouveau', () => {
    const g = new GameState(4);
    const w = new StallWatch();
    const d = stalledDrill(g);
    advance(g, w, ALERT.delay + 2);
    expect(w.list).toHaveLength(1);
    d.fuelUnits = 50; // du charbon : elle repart
    d.status = 'ok';
    advance(g, w, 2);
    expect(d.flowState()).not.toBe('stuck');
    expect(w.list).toHaveLength(0);
    d.fuelUnits = 0;
    d.burn = 0; // la dernière unité brûlée est finie
    d.status = 'nofuel';
    expect(advance(g, w, ALERT.delay + 2)).toHaveLength(1);
  });

  it('la cause suit le diagnostic : du charbon en coffre change le texte', () => {
    const g = new GameState(4);
    const w = new StallWatch();
    stalledDrill(g);
    (g.structures.add(new Storage(46, 10, 1)) as Storage).put('coal', 5);
    const told = advance(g, w, ALERT.delay + 2);
    expect(told).toEqual(['Foreuse à charbon : plus de charbon']);
  });

  it('une machine arrêtée n’est jamais signalée avant d’avoir été vue arrêtée assez longtemps (un nouveau jeu repart de zéro)', () => {
    const g1 = new GameState(4);
    const w = new StallWatch();
    stalledDrill(g1);
    advance(g1, w, ALERT.delay + 2);
    expect(w.list).toHaveLength(1);
    const g2 = new GameState(5);
    w.update(g2);
    expect(w.list).toHaveLength(0);
  });

  it('« aller voir » fait défiler les machines, la plus ancienne d’abord', () => {
    const g = new GameState(4);
    const w = new StallWatch();
    const a = stalledDrill(g, 56);
    advance(g, w, 3);
    const b = stalledDrill(g, 60);
    advance(g, w, ALERT.delay + 2);
    expect(w.list.map((f) => f.s)).toEqual([a, b]);
    expect(w.nextToShow()!.s).toBe(a);
    expect(w.nextToShow()!.s).toBe(b);
    expect(w.nextToShow()!.s).toBe(a);
  });

  it('la pastille compte les machines ; trop de nouveaux arrêts d’un coup font un seul message', () => {
    expect(alertChip([])).toBe('');
    const g = new GameState(4);
    const w = new StallWatch();
    stalledDrill(g, 56);
    stalledDrill(g, 60);
    stalledDrill(g, 64);
    const fresh: ReturnType<StallWatch['update']> = [];
    for (let i = 0; i < Math.round((ALERT.delay + 2) / SIM_DT); i++) {
      g.update(SIM_DT, [IDLE]);
      fresh.push(...w.update(g));
    }
    expect(alertChip(w.list)).toContain('3 machines à l’arrêt');
    expect(alertChip(w.list.slice(0, 1))).toContain('1 machine à l’arrêt');
    expect(stallToasts(fresh)).toEqual(['3 machines viennent de s’arrêter']);
    expect(stallToasts(fresh.slice(0, 2))).toHaveLength(2);
  });
});
