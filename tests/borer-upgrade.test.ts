import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { AIR, BEDROCK, CLIFF, HOST_ROCK_IDS, ORE_BLOCK, TREE } from '../src/data/blocks';
import { getMachine } from '../src/data/machines';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { TunnelBorer } from '../src/sim/structures/Borer';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ (x de 46 à 53, y de S+13 à S+15) ; la roche commence à x = 54.
const X = 53;
const Y = S + 14;
const SOFT = HOST_ROCK_IDS[0];
const LEVELS = getMachine('borer').levels!;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

/** Base vers l'est, devant 30 cases de roche sur 3 rangées (le tunnel et ses deux côtés). */
function setup(g: GameState, level = 1, block = SOFT, coal = 20) {
  for (let x = X + 1; x <= X + 30; x++) for (const y of [Y - 1, Y, Y + 1]) g.world.set(x, y, block);
  const b = put(g, 'borer', X, Y, 0) as TunnelBorer;
  b.level = level;
  b.addFuel(coal);
  return b;
}

/** Avance pas à pas (1/60 s) jusqu'à ce que `until` soit vrai, ou `max` secondes. */
function runUntil(g: GameState, until: () => boolean, max = 90): void {
  for (let t = 0; t < max && !until(); t += 1 / 60) run(g, 1 / 60);
}

function onGround(g: GameState, res: string): number {
  return g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);
}

describe('foreuse de percement : améliorations', () => {
  it('s’améliore sur sa base, niveau par niveau, jusqu’au niveau 5', () => {
    const g = new GameState(4);
    const b = setup(g);
    expect(b.maxLevel).toBe(5);
    g.money = 100;
    expect(g.upgradeBlocker(b)).toBe("Pas assez d'argent");
    expect(g.upgradeMachine(b)).toBe(false);
    g.money = 20_000;
    g.pickaxeLevel = 3; // le niveau 5 demande la Pioche pro en acier
    for (const l of LEVELS.slice(1)) {
      expect(g.upgradeMachine(b)).toBe(true);
      expect(b.level).toBe(l.level);
    }
    expect(g.money).toBe(20_000 - LEVELS.reduce((n, l) => n + l.price, 0));
    expect(g.upgradeBlocker(b)).toBe('Niveau maximal atteint');
    expect(g.events.some((e) => e.t === 'bought' && e.name.includes('benne à minerai'))).toBe(true);
    expect(g.events.some((e) => e.t === 'bought' && e.name.includes('tête de diamant'))).toBe(true);
  });

  it('le niveau 5 demande la Pioche pro en acier, en plus de l’argent', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    g.money = 50_000;
    g.pickaxeLevel = 2;
    expect(g.pickaxe.tier).toBeLessThan(4);
    expect(g.upgradeBlocker(b)).toBe('Nécessite la Pioche pro en acier');
    expect(g.upgradeMachine(b)).toBe(false);
    expect(b.level).toBe(4);
    g.pickaxeLevel = 3;
    expect(g.pickaxe.tier).toBe(4);
    expect(g.upgradeBlocker(b)).toBeNull();
    expect(g.upgradeMachine(b)).toBe(true);
    expect(b.level).toBe(5);
    expect(b.stats.breakAll).toBe(true);
    expect(g.money).toBe(50_000 - LEVELS[4].price);
  });

  it('ne s’améliore pas pendant que la foreuse est sortie', () => {
    const g = new GameState(4);
    const b = setup(g);
    g.money = 10_000;
    b.start();
    runUntil(g, () => b.dist >= 2);
    expect(g.upgradeBlocker(b)).toBe('Rappelez d’abord la foreuse à sa base');
    expect(g.upgradeMachine(b)).toBe(false);
    b.stop();
    runUntil(g, () => b.home);
    expect(g.upgradeMachine(b)).toBe(true);
  });

  it('niveau 2, moteur renforcé : perce bien plus vite et emporte 4 unités de charbon', () => {
    const dug = (level: number) => {
      const g = new GameState(4);
      const b = setup(g, level);
      g.setBorerLength(b, 0);
      b.start();
      run(g, 10);
      return b;
    };
    const l1 = dug(1);
    const l2 = dug(2);
    expect(l2.totalDug).toBeGreaterThan(l1.totalDug * 1.6);
    expect(l1.tankMax).toBe(2);
    expect(l2.tankMax).toBe(4);
  });

  it('niveau 3, tête large : tunnel de 3 cases, les côtés indestructibles sont épargnés', () => {
    const g = new GameState(4);
    const b = setup(g, 3);
    g.world.set(X + 5, Y - 1, BEDROCK);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.status).toBe('done');
    expect(b.tunnel).toBe(10);
    for (let x = X + 1; x <= X + 10; x++) {
      expect(g.world.get(x, Y)).toBe(AIR);
      expect(g.world.get(x, Y + 1)).toBe(AIR);
      if (x !== X + 5) expect(g.world.get(x, Y - 1)).toBe(AIR);
    }
    expect(g.world.get(X + 5, Y - 1)).toBe(BEDROCK);
    expect(g.world.get(X + 11, Y)).toBe(SOFT);
    expect(b.totalDug).toBe(29);
  });

  it('niveau 4, benne : ramène le minerai à la base et laisse la pierre au sol', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    for (let x = X + 1; x <= X + 30; x++) g.world.set(x, Y, ORE_BLOCK.copper);
    g.setBorerLength(b, 0);
    b.start();
    runUntil(g, () => b.dist >= 3 && b.loadCount() > 0);
    expect(b.load.copper).toBeGreaterThan(0);
    expect(onGround(g, 'copper')).toBe(0); // rien ne traîne : tout est dans la benne
    // Benne pleine : elle rentre la vider dans la base, puis repart.
    runUntil(g, () => b.returning === 'full');
    expect(b.loadCount()).toBe(b.stats.hopper);
    runUntil(g, () => b.home);
    expect(b.loadCount()).toBe(0);
    // Tout ce qu'elle a ramassé est dans la base (y compris la première case, percée depuis la base).
    expect(b.store.copper).toBe(b.collected);
    expect(b.collected).toBeGreaterThanOrEqual(b.stats.hopper);
    expect(b.tunnel).toBeLessThan(30); // benne pleine bien avant la fin des 30 cases préparées
    run(g, 1);
    expect(b.home).toBe(false);
    expect(b.running).toBe(true);
    // La pierre, elle, reste dans le tunnel (et s'effrite) ; le cuivre au sol n'est que le surplus d'une benne pleine.
    expect(onGround(g, 'stone')).toBeGreaterThan(0);
    expect(onGround(g, 'copper')).toBeLessThan(b.collected);
  });

  it('la base pousse le minerai ramené dans un coffre collé ; le joueur peut aussi le récupérer', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: 10, iron: 4 };
    const chest = put(g, 'storage', X, Y - 1) as Storage;
    run(g, 1);
    expect(b.storeCount()).toBe(0);
    expect(chest.items.copper).toBe(10);
    expect(chest.items.iron).toBe(4);
    // Sans coffre : on récupère le minerai dans le sac depuis le panneau.
    const h = new GameState(4);
    const c = setup(h, 4);
    c.store = { copper: 5 };
    teleport(h, X - 1, Y);
    expect(h.collectBorer(c)).toBe(5);
    expect(h.inventory.count('copper')).toBe(5);
    expect(c.storeCount()).toBe(0);
  });

  it('le charbon ramené par la benne remplit la réserve de la base', () => {
    const g = new GameState(4);
    const b = setup(g, 4, ORE_BLOCK.coal, 2);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.status).toBe('done');
    // La réserve se remplit d'abord ; le surplus va dans le stock de la base.
    expect(b.fuelUnits).toBe(b.fuelMax);
    expect(b.store.coal).toBeGreaterThan(0);
  });

  it('base pleine de minerai : la foreuse attend à la base qu’on la vide', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: b.spec.store };
    b.load = { copper: b.stats.hopper };
    b.start();
    run(g, 1);
    expect(b.status).toBe('full');
    expect(b.home).toBe(true);
    teleport(g, X - 1, Y);
    expect(g.collectBorer(b)).toBeGreaterThan(0);
    run(g, 1);
    expect(b.loadCount()).toBeLessThan(b.stats.hopper);
    expect(b.home).toBe(false);
  });

  it('démontée, elle garde son niveau ; sauvegardée, sa benne et son stock aussi', () => {
    const g = new GameState(4);
    const b = setup(g, 4);
    b.store = { copper: 7 };
    b.load = { iron: 3 };
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hb = h.structures.at(X, Y) as TunnelBorer;
    expect(hb.level).toBe(4);
    expect(hb.store).toEqual({ copper: 7 });
    expect(hb.load).toEqual({ iron: 3 });
    teleport(g, X - 1, Y);
    expect(g.removeAt(X, Y)).toBe(true);
    expect(g.inventory.kitCount('borer@4')).toBe(1);
    expect(onGround(g, 'copper')).toBe(7);
    expect(onGround(g, 'iron')).toBe(3);
    const again = put(g, 'borer@4', X, Y) as TunnelBorer;
    expect(again.level).toBe(4);
    expect(again.stats.width).toBe(3);
  });
});

describe('foreuse de percement : tête de diamant (niveau 5)', () => {
  const DIAMOND = ORE_BLOCK.diamond;

  /** Temps (s) pour que la foreuse traverse la case (X + 2, Y) posée à l'avance, en tunnel d'une case. */
  function crossing(level: number, block: number) {
    const g = new GameState(4);
    const b = setup(g, level);
    g.world.set(X + 2, Y, block);
    g.setBorerLength(b, 10);
    b.start();
    let t = 0;
    for (; t < 60 && b.status !== 'done' && b.status !== 'blocked'; t += 1 / 60) run(g, 1 / 60);
    return { g, b, t };
  }

  it('sans elle, le diamant arrête la foreuse : « trop dur »', () => {
    const { g, b } = crossing(4, DIAMOND);
    expect(b.status).toBe('blocked');
    expect(b.blockReason).toContain('trop dur');
    expect(g.world.get(X + 2, Y)).toBe(DIAMOND);
    expect(b.tunnel).toBe(1);
  });

  it('avec elle, le diamant est percé et la foreuse continue jusqu’au bout du tunnel', () => {
    const { g, b } = crossing(5, DIAMOND);
    expect(b.status).toBe('done');
    expect(b.tunnel).toBe(10);
    expect(g.world.get(X + 2, Y)).toBe(AIR);
    expect(onGround(g, 'diamond') + b.collected).toBeGreaterThan(0);
  });

  it('sans elle, la roche indestructible arrête la foreuse', () => {
    for (const block of [BEDROCK, CLIFF, TREE]) {
      const { g, b } = crossing(4, block);
      expect(b.status).toBe('blocked');
      expect(b.blockReason).toContain('indestructible');
      expect(g.world.get(X + 2, Y)).toBe(block);
    }
  });

  it('avec elle, socle rocheux, falaise et arbre se percent aussi (un peu plus lentement que la roche)', () => {
    const soft = crossing(5, SOFT).t;
    for (const block of [BEDROCK, CLIFF, TREE]) {
      const { g, b, t } = crossing(5, block);
      expect(b.status).toBe('done');
      expect(g.world.get(X + 2, Y)).toBe(AIR);
      expect(t).toBeGreaterThan(soft + 1.5);
      expect(t).toBeLessThan(soft + 6);
    }
  });

  it('le diamant est percé à la même cadence qu’une roche de même dureté (résistance 40 ; pas de pénalité cachée)', () => {
    const diamond = crossing(5, DIAMOND).t;
    const soft = crossing(5, SOFT).t;
    expect(diamond).toBeGreaterThan(soft + 2);
    expect(diamond).toBeLessThan(soft + 5);
  });

  it('la tête large perce aussi les côtés indestructibles, là où les niveaux inférieurs les épargnent', () => {
    for (const [level, cut] of [[4, false], [5, true]] as const) {
      const g = new GameState(4);
      const b = setup(g, level);
      g.world.set(X + 3, Y - 1, BEDROCK);
      g.world.set(X + 4, Y + 1, DIAMOND);
      g.setBorerLength(b, 6);
      b.start();
      runUntil(g, () => b.status === 'done');
      expect(b.status).toBe('done');
      expect(g.world.get(X + 3, Y - 1) === AIR).toBe(cut);
      expect(g.world.get(X + 4, Y + 1) === AIR).toBe(cut);
    }
  });

  it('elle va toujours tout droit : le tunnel reste sur la ligne de la base', () => {
    const g = new GameState(4);
    const b = setup(g, 5);
    g.world.set(X + 3, Y, BEDROCK);
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'done');
    expect(b.tunnel).toBe(10);
    for (let x = X + 1; x <= X + 10; x++) expect(g.world.get(x, Y)).toBe(AIR);
    // Rien au-delà du tunnel ni sur les rangées au-dessus et au-dessous de la tête large.
    expect(g.world.get(X + 11, Y)).toBe(SOFT);
    expect(g.world.get(X + 4, Y - 2)).not.toBe(AIR);
    expect(g.world.get(X + 4, Y + 2)).not.toBe(AIR);
  });

  it('le bord du monde l’arrête : la dernière rangée n’est jamais percée', () => {
    const g = new GameState(4);
    const edge = g.world.w - 1;
    const bx = edge - 5;
    for (let x = bx + 1; x < edge; x++) for (const y of [Y - 1, Y, Y + 1]) g.world.set(x, y, SOFT);
    for (const y of [Y - 1, Y, Y + 1]) g.world.set(edge, y, BEDROCK);
    for (let x = bx - 2; x <= bx; x++) for (const y of [Y - 1, Y, Y + 1]) g.world.set(x, y, AIR);
    g.inventory.addKit('borer', 1);
    teleport(g, bx - 2, Y);
    const b = g.place('borer', bx, Y, 0) as TunnelBorer;
    b.level = 5;
    b.addFuel(20);
    g.setBorerLength(b, 0);
    b.start();
    runUntil(g, () => b.status === 'blocked' || b.status === 'done');
    expect(b.status).toBe('blocked');
    expect(b.blockReason).toBe('bord de la mine');
    for (const y of [Y - 1, Y, Y + 1]) expect(g.world.get(edge, y)).toBe(BEDROCK);
    for (let x = bx + 1; x < edge; x++) expect(g.world.get(x, Y)).toBe(AIR);
  });

  it('une machine posée sur le chemin l’arrête quand même', () => {
    const g = new GameState(4);
    const b = setup(g, 5);
    g.world.set(X + 3, Y, AIR);
    g.inventory.addKit('storage', 1);
    teleport(g, 50, S + 13);
    expect(g.place('storage', X + 3, Y, 0)).toBeTruthy();
    g.setBorerLength(b, 10);
    b.start();
    runUntil(g, () => b.status === 'blocked');
    expect(b.status).toBe('blocked');
    expect(b.blockReason).toContain('machine');
  });

  it('sauvegardée, elle garde sa tête de diamant', () => {
    const g = new GameState(4);
    const b = setup(g, 5);
    expect(b.stats.breakAll).toBe(true);
    const again = deserialize(serialize(g)).structures.borers[0];
    expect(again.level).toBe(5);
    expect(again.stats.breakAll).toBe(true);
  });

  it('les niveaux 1 à 4 ne percent toujours pas tout', () => {
    for (const l of LEVELS.slice(0, 4)) expect(l.borer!.breakAll).toBeFalsy();
    expect(LEVELS[4].borer!.breakAll).toBe(true);
    expect(LEVELS[4].borer!.hopper).toBe(LEVELS[3].borer!.hopper); // elle garde la benne, la tête large, le moteur
    expect(LEVELS[4].borer!.width).toBe(3);
  });
});
