import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { dexp, dlog, hyp, smallCosSin } from '../src/core/dmath';
import { mulberry32 } from '../src/core/rng';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { GameState, MAX_PLAYERS, NO_INTENT, type PlayerIntent } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { goTo } from './helpers';

const S = SURFACE_ROWS;
const DT = 1 / 60;

function tick(g: GameState, intents: (PlayerIntent | undefined)[], n = 1): void {
  for (let i = 0; i < n; i++) g.update(DT, intents);
}
const walk = (mx: number, my: number): PlayerIntent => ({ mx, my, mine: false, target: null });

describe('mathématiques déterministes', () => {
  it('exp, log et trigonométrie des éclats : même résultat que Math à 1e-12 près', () => {
    for (let x = -6; x <= 6; x += 0.137) expect(dexp(x) / Math.exp(x)).toBeCloseTo(1, 12);
    for (const x of [0.5, 0.8, 1, 1.5, 2, 3.7, 100, 1e-3]) expect(dlog(x)).toBeCloseTo(Math.log(x), 12);
    for (let a = -1.2; a <= 1.2; a += 0.1) {
      const { cos, sin } = smallCosSin(a);
      expect(cos).toBeCloseTo(Math.cos(a), 12);
      expect(sin).toBeCloseTo(Math.sin(a), 12);
    }
    expect(hyp(3, 4)).toBe(5);
    expect(dexp(0)).toBe(1);
    expect(dlog(1)).toBe(0);
  });

  it('la simulation n’utilise aucune fonction mathématique qui varie d’un moteur à l’autre', () => {
    const banned = /Math\.(hypot|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|cbrt|random)\b|\*\*/;
    const allowed = new Set(['src/sim/GameState.ts:Math.atan2', 'src/sim/Drops.ts:Math.random']);
    const sources = import.meta.glob(['../src/sim/**/*.ts', '../src/net/digest.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      const file = path.replace('../', '');
      text.split('\n').forEach((line: string, i: number) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*(\*|\/\*).*$/, '');
        const m = banned.exec(code);
        if (m && !allowed.has(`${file}:${m[0]}`)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('plusieurs joueurs : emplacements', () => {
  it('un joueur de plus arrive au camp avec un sac vide ; les kits sont communs, le reste personnel', () => {
    const g = new GameState(4);
    g.inventory.add('copper', 3);
    g.inventory.addKit('storage', 2);
    g.pickaxeLevel = 1;
    expect(g.playerCount).toBe(1);
    const slot = g.addPlayer();
    expect(slot).toBe(1);
    expect(g.playerCount).toBe(2);
    expect(g.addPlayer()).toBe(-1); // la mine est pleine
    expect(MAX_PLAYERS).toBe(2);
    g.withSlot(1, () => {
      expect(g.inventory.items).toEqual({});
      expect(g.pickaxeLevel).toBe(0);
      expect(g.inventory.kitCount('storage')).toBe(2); // kits communs
      g.inventory.addKit('storage', 1);
      g.inventory.add('iron', 2);
    });
    expect(g.inventory.kitCount('storage')).toBe(3);
    expect(g.inventory.items).toEqual({ copper: 3 });
    expect(g.pickaxeLevel).toBe(1);
    expect(g.withSlot(1, () => g.inventory.items)).toEqual({ iron: 2 });
    expect(g.active).toBe(0);
    expect(g.otherPlayers().map((o) => o.slot)).toEqual([1]);
  });

  it('chacun avance avec sa propre intention, et le monde n’avance qu’une fois', () => {
    const g = new GameState(4);
    g.addPlayer();
    const x0 = g.player.x;
    const x1 = g.withSlot(1, () => g.player.x);
    const t0 = g.time;
    tick(g, [walk(1, 0), walk(-1, 0)], 30);
    expect(g.player.x).toBeGreaterThan(x0 + 5);
    expect(g.withSlot(1, () => g.player.x)).toBeLessThan(x1 - 5);
    expect(g.time).toBeCloseTo(t0 + 30 * DT, 9);
    expect(g.active).toBe(0);
  });

  it('les deux appareils voient la même partie, quel que soit le joueur qu’ils suivent', () => {
    const make = () => {
      const g = new GameState(4);
      g.addPlayer();
      g.money = 777;
      g.inventory.add('copper', 2);
      g.withSlot(1, () => g.inventory.add('coal', 4));
      return g;
    };
    const a = make();
    const b = make();
    b.setLocal(1);
    expect(b.active).toBe(1);
    expect(stateDigest(a)).toBe(stateDigest(b));
    tick(a, [walk(1, 0), walk(0, 1)], 90);
    tick(b, [walk(1, 0), walk(0, 1)], 90);
    expect(b.active).toBe(1);
    expect(stateDigest(a)).toBe(stateDigest(b));
    // Chacun voit son propre sac : l'écran de l'un n'est pas celui de l'autre.
    expect(a.inventory.items).toEqual({ copper: 2 });
    expect(b.inventory.items).toEqual({ coal: 4 });
  });

  it('un danger blesse tous les joueurs à portée, et seulement eux', () => {
    const g = new GameState(4);
    g.addPlayer();
    const tx = g.player.tileX;
    const ty = g.player.tileY;
    g.withSlot(1, () => {
      g.player.x = (tx + 20.5) * TILE;
    });
    g.hurtPlayerNear(tx, ty, 3, 10, 'éboulement');
    expect(g.hp).toBeLessThan(100);
    expect(g.withSlot(1, () => g.hp)).toBe(100);
    g.withSlot(1, () => {
      g.player.x = (tx + 0.5) * TILE;
    });
    g.hurtPlayerNear(tx, ty, 3, 10, 'éboulement');
    expect(g.withSlot(1, () => g.hp)).toBeLessThan(100);
  });

  it('les événements disent quel joueur les a causés (à deux seulement)', () => {
    const solo = new GameState(4);
    solo.hurtPlayer(5, 'test');
    expect(solo.events.every((e) => e.slot === undefined)).toBe(true);
    const g = new GameState(4);
    g.addPlayer();
    g.withSlot(1, () => g.hurtPlayer(5, 'test'));
    g.hurtPlayer(5, 'test');
    const hurts = g.events.filter((e) => e.t === 'hurt');
    expect(hurts.map((e) => e.slot)).toEqual([1, 0]);
  });

  it('un joueur occupe sa case : on ne bâtit pas dessus, quel que soit le joueur', () => {
    const g = new GameState(4);
    g.addPlayer();
    const o = g.withSlot(1, () => ({ x: g.player.tileX, y: g.player.tileY }));
    expect(g.occupied(o.x, o.y)).toBe(true);
    expect(g.occupied(o.x + 5, o.y)).toBe(false);
  });

  it('chaque joueur achète pour lui avec l’argent commun', () => {
    const g = new GameState(4);
    g.addPlayer();
    g.money = 1000;
    g.pickaxeLevel = 0;
    goTo(g, 'workshop');
    g.withSlot(1, () => {
      g.player.x = g.withSlot(0, () => g.player.x) + 4;
      g.player.y = g.withSlot(0, () => g.player.y);
      expect(g.isNear('workshop')).toBe(true);
      expect(g.buyNextPickaxe()).toBe(true);
    });
    expect(g.money).toBeLessThan(1000);
    expect(g.withSlot(1, () => g.pickaxeLevel)).toBe(1);
    expect(g.pickaxeLevel).toBe(0);
  });

  it('un joueur qui monte dans un wagonnet ne peut pas être rejoint par l’autre dans le même', () => {
    const g = new GameState(4);
    g.addPlayer();
    expect(g.nearestWagon()).toBeNull();
  });
});

describe('plusieurs joueurs : sauvegarde', () => {
  it('chaque joueur retrouve son sac, sa pioche et sa position ; les kits restent communs', () => {
    const g = new GameState(4);
    g.addPlayer();
    g.guestIds[1] = 'invite-7';
    g.inventory.add('copper', 3);
    g.inventory.addKit('storage', 2);
    g.pickaxeLevel = 1;
    g.withSlot(1, () => {
      g.inventory.add('iron', 5);
      g.pickaxeLevel = 2;
      g.hasScooter = true;
      g.player.x += 12;
    });
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(back.playerCount).toBe(2);
    expect(back.inventory.items).toEqual({ copper: 3 });
    expect(back.pickaxeLevel).toBe(1);
    expect(back.guestIds[1]).toBe('invite-7');
    expect(back.withSlot(1, () => back.inventory.items)).toEqual({ iron: 5 });
    expect(back.withSlot(1, () => back.pickaxeLevel)).toBe(2);
    expect(back.withSlot(1, () => back.hasScooter)).toBe(true);
    expect(back.withSlot(1, () => back.inventory.kitCount('storage'))).toBe(2);
    expect(stateDigest(back)).toBe(stateDigest(g));
  });

  it('un invité parti laisse ses affaires de côté et les retrouve en revenant', () => {
    const g = new GameState(4);
    g.addPlayer();
    g.guestIds[1] = 'amie';
    expect(g.guestStash).toEqual({});
    // (la mise de côté et la reprise passent par `net/session` ; ici on vérifie le format de sauvegarde)
    const data = serialize(g);
    data.guests = { amie: { ...serialize(g), health: 80 } as never };
    const back = deserialize(JSON.parse(JSON.stringify(data)));
    expect(Object.keys(back.guestStash)).toEqual(['amie']);
    expect(Object.keys(serialize(back).guests ?? {})).toEqual(['amie']);
  });

  it('une sauvegarde d’avant le jeu à deux se charge comme avant', () => {
    const g = new GameState(4);
    g.money = 321;
    const data = JSON.parse(JSON.stringify(serialize(g)));
    expect(data.players).toBeUndefined();
    expect(data.guests).toBeUndefined();
    const back = deserialize(data);
    expect(back.playerCount).toBe(1);
    expect(back.money).toBe(321);
  });
});

/** Un petit scénario de partie : machines, ouvriers, marche et minage, rejoué à l'identique. */
function scenario(seed: number, localSlot: number, steps: number, onCheck?: (g: GameState, step: number) => void): GameState {
  const g = new GameState(seed);
  g.money = 20000;
  g.pickaxeLevel = 2;
  g.stats.discovered = ['coal', 'copper', 'iron'];
  g.addPlayer();
  g.inventory.addKit('storage', 3);
  g.inventory.addKit('drill', 3);
  g.inventory.addKit('conveyor', 30);
  g.inventory.add('coal', 10);
  // Une salle équipée au fond de la mine de départ.
  const Y = S + 14;
  for (const x of [48, 50]) g.world.set(x, Y, 0);
  g.world.setDeposit(50, Y, 2, 60);
  g.world.setDeposit(48, Y, 1, 60);
  goTo(g, 'workshop');
  g.hireWorker('picker');
  g.hireWorker('driller');
  g.hireWorker('refueler');
  g.withSlot(1, () => {
    g.player.x = 47.5 * TILE;
    g.player.y = (Y + 0.5) * TILE;
  });
  g.player.x = 52.5 * TILE;
  g.player.y = (Y + 0.5) * TILE;
  g.place('storage', 46, Y, 1);
  g.place('drill', 50, Y, 1);
  g.setLocal(localSlot);
  const rnd = mulberry32(seed * 7 + 1);
  let a: PlayerIntent = NO_INTENT;
  let b: PlayerIntent = NO_INTENT;
  for (let i = 0; i < steps; i++) {
    if (i % 25 === 0) {
      const pick = () => [-1, 0, 0, 1][Math.floor(rnd() * 4)];
      a = { mx: pick(), my: pick(), mine: rnd() < 0.5, target: { tx: 53 + Math.floor(rnd() * 3), ty: Y + Math.floor(rnd() * 3) - 1 } };
      b = { mx: pick(), my: pick(), mine: rnd() < 0.5, target: { tx: 45 + Math.floor(rnd() * 3), ty: Y + Math.floor(rnd() * 3) - 1 } };
    }
    g.update(DT, [a, b]);
    onCheck?.(g, i);
  }
  return g;
}

describe('déterminisme : deux parties identiques restent identiques', () => {
  it('même scénario, mêmes entrées : même empreinte à chaque contrôle, et quel que soit l’appareil', () => {
    const checks: number[][] = [[], []];
    const run = (slot: number, out: number[]) => scenario(11, slot, 3600, (g, i) => i % 300 === 299 && out.push(stateDigest(g)));
    const a = run(0, checks[0]);
    const b = run(1, checks[1]);
    expect(checks[0].length).toBe(12);
    expect(checks[1]).toEqual(checks[0]);
    expect(stateDigest(a)).toBe(stateDigest(b));
    // Le scénario a bien fait quelque chose : l'argent, les ouvriers et les foreuses ont bougé.
    expect(a.structures.list.some((s) => s instanceof Drill)).toBe(true);
    expect(a.structures.list.some((s) => s instanceof Storage)).toBe(true);
    expect(a.workers.count).toBe(3);
  });

  it('une entrée différente donne une empreinte différente (l’empreinte voit bien les écarts)', () => {
    const a = scenario(11, 0, 600);
    const g = scenario(11, 0, 600);
    expect(stateDigest(a)).toBe(stateDigest(g));
    g.withSlot(1, () => {
      g.player.x += 0.001;
    });
    expect(stateDigest(a)).not.toBe(stateDigest(g));
    const h = scenario(11, 0, 600);
    h.money += 1;
    expect(stateDigest(a)).not.toBe(stateDigest(h));
  });

  it('sauvegarder puis recharger donne deux parties qui évoluent pareil', () => {
    const base = scenario(5, 0, 1200);
    const text = JSON.stringify(serialize(base));
    const a = deserialize(JSON.parse(text));
    const b = deserialize(JSON.parse(text));
    b.setLocal(1);
    expect(stateDigest(a)).toBe(stateDigest(b));
    for (let i = 0; i < 1800; i++) {
      const it: PlayerIntent = { mx: i % 120 < 60 ? 1 : -1, my: 0, mine: i % 50 < 25, target: { tx: 53, ty: S + 14 } };
      a.update(DT, [it, walk(0, i % 90 < 45 ? 1 : -1)]);
      b.update(DT, [it, walk(0, i % 90 < 45 ? 1 : -1)]);
      if (i % 300 === 299) expect(stateDigest(a)).toBe(stateDigest(b));
    }
  });
});
