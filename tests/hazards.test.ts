import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE, depthAt, rowForDepth } from '../src/core/constants';
import { AIR, HOST_ROCK_IDS, RUBBLE, getBlock } from '../src/data/blocks';
import { CAVE_IN, GAS, HEALTH, POCKET_GAS, POCKET_WATER, WATER } from '../src/data/hazards';
import { deserialize, serialize } from '../src/save/save';
import { GameState, NO_INTENT, PlayerIntent } from '../src/sim/GameState';
import { generateWorld } from '../src/sim/generator';
import { Pump } from '../src/sim/structures/Safety';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const ROCK = HOST_ROCK_IDS[0];
/** Zone d'essai à 100 m de profondeur, loin de la mine de départ. */
const X = 20;
const Y = S + 39;

/** Remplit un rectangle de roche tendre, sans poche, et le rend visible. */
function rock(g: GameState, x0: number, y0: number, x1: number, y1: number): void {
  const w = g.world;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      w.set(x, y, ROCK);
      w.pocket[w.idx(x, y)] = 0;
      w.dug[w.idx(x, y)] = 0;
      w.setExplored(x, y);
    }
}

/** Galerie naturelle (pas creusée à la main). */
function open(g: GameState, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.world.set(x, y, AIR);
}

/** Creuse à la main (comme la pioche) toutes les cases d'un rectangle. */
function dig(g: GameState, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.breakTile(x, y);
}

/**
 * Creuse à la main `n` cases du carré de 5 × 5 autour de (cx, cy), la case centrale exclue, rangée par rangée : aucune zone
 * examinée en route ne contient plus de `n` cases creusées. Creuser ensuite (cx, cy) en ajoute donc une de plus aux autres.
 */
function digAround(g: GameState, cx: number, cy: number, n: number): void {
  const r = CAVE_IN.radius;
  let left = n;
  for (let y = cy - r; y <= cy + r && left > 0; y++)
    for (let x = cx - r; x <= cx + r && left > 0; x++) {
      if (x === cx && y === cy) continue;
      g.breakTile(x, y);
      left--;
    }
}

/** Les cases de la poche qui contient la case `i` (cases voisines, 8 directions, de même nature). */
function pocketCells(w: GameState['world'], i: number): number[] {
  const kind = w.pocket[i];
  const seen = new Set<number>([i]);
  const stack = [i];
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % w.w;
    const cy = Math.floor(c / w.w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!w.inBounds(cx + dx, cy + dy)) continue;
        const j = w.idx(cx + dx, cy + dy);
        if (w.pocket[j] === kind && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
  }
  return [...seen];
}

function count(g: GameState, block: number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.world.get(x, y) === block) n++;
  return n;
}

describe('dangers : poches cachées', () => {
  it('grisou et eau se cachent dans la roche, en profondeur seulement, sans changer le terrain', () => {
    const g = new GameState(4);
    const w = g.world;
    const rockIds = new Set(HOST_ROCK_IDS);
    const kinds = { [POCKET_GAS]: 0, [POCKET_WATER]: 0 } as Record<number, number>;
    for (let i = 0; i < w.pocket.length; i++) {
      const p = w.pocket[i];
      if (!p) continue;
      kinds[p]++;
      const y = Math.floor(i / w.w);
      expect(rockIds.has(w.tiles[i])).toBe(true);
      expect(depthAt(y)).toBeGreaterThanOrEqual(p === POCKET_GAS ? GAS.minDepth : WATER.minDepth);
    }
    expect(kinds[POCKET_GAS]).toBeGreaterThan(8);
    expect(kinds[POCKET_WATER]).toBeGreaterThan(8);
    // Même graine, même mine (poches comprises).
    const h = new GameState(4);
    expect(Array.from(h.world.pocket)).toEqual(Array.from(w.pocket));
  });

  it('les poches sont rares : environ une pour mille cases de roche creusées (avant : une pour 150 à 160)', () => {
    const rock = new Set(HOST_ROCK_IDS);
    for (const [kind, spec] of [
      [POCKET_WATER, WATER],
      [POCKET_GAS, GAS],
    ] as const) {
      let rockCells = 0;
      let poches = 0;
      for (const seed of [1, 2, 3, 4]) {
        const w = generateWorld(seed).world;
        const seen = new Set<number>();
        for (let y = rowForDepth(spec.minDepth); y < w.h - 1; y++)
          for (let x = 1; x < w.w - 1; x++) {
            const i = w.idx(x, y);
            if (rock.has(w.tiles[i])) rockCells++;
            if (w.pocket[i] !== kind || seen.has(i)) continue;
            poches++;
            for (const j of pocketCells(w, i)) seen.add(j);
          }
      }
      // Une libération par poche (voir plus bas) : au plus 1,7 pour mille cases de roche, contre 6,8 (eau) et 6,1 (grisou) avant.
      expect(poches / rockCells).toBeLessThan(1.7 / 1000);
      expect(poches).toBeGreaterThan(10);
    }
  });
});

describe('dangers : une poche s’ouvre d’un coup', () => {
  /** Une galerie qui longe un mur de roche à 100 m ; le joueur est à l'autre bout. */
  function wall(): GameState {
    const g = new GameState(4);
    rock(g, X, Y, X + 14, Y + 5);
    open(g, X + 1, Y + 1, X + 5, Y + 1);
    teleport(g, X + 1, Y + 1);
    return g;
  }
  const gasEvents = (g: GameState) => g.events.filter((e) => e.t === 'gas').length;
  const gasMessages = (g: GameState) => g.events.filter((e) => e.t === 'message' && e.text.includes('Poche de grisou')).length;

  it('percer une case d’une poche de trois cases la vide en entier : un seul événement, les autres cases ne libèrent plus rien', () => {
    const g = wall();
    const w = g.world;
    for (const [x, y] of [[X + 6, Y + 1], [X + 7, Y + 1], [X + 7, Y + 2]]) w.pocket[w.idx(x, y)] = POCKET_GAS;
    g.breakTile(X + 6, Y + 1);
    expect(gasEvents(g)).toBe(1);
    expect(gasMessages(g)).toBe(1);
    expect(w.pocket[w.idx(X + 7, Y + 1)]).toBe(0);
    expect(w.pocket[w.idx(X + 7, Y + 2)]).toBe(0);
    // Le gaz se dissipe un peu : percer les cases voisines ne le remet pas à fond.
    run(g, 5);
    const lvl = g.hazards.gasAt(X + 5, Y + 1);
    expect(lvl).toBeLessThan(255 - 5 * GAS.decay + 1);
    g.breakTile(X + 7, Y + 1);
    g.breakTile(X + 7, Y + 2);
    expect(gasEvents(g)).toBe(1);
    expect(gasMessages(g)).toBe(1);
    expect(g.hazards.gasAt(X + 5, Y + 1)).toBeLessThanOrEqual(lvl);
  });

  it('on peut percer la poche par n’importe laquelle de ses cases', () => {
    const g = wall();
    const w = g.world;
    for (const [x, y] of [[X + 6, Y + 1], [X + 7, Y + 1], [X + 8, Y + 1]]) w.pocket[w.idx(x, y)] = POCKET_WATER;
    // Par le bout le plus loin de la galerie : c'est tout de même la poche entière qui s'ouvre, une seule fois.
    g.breakTile(X + 8, Y + 1);
    expect(g.events.filter((e) => e.t === 'flood').length).toBe(1);
    expect(w.pocket[w.idx(X + 6, Y + 1)]).toBe(0);
    expect(w.pocket[w.idx(X + 7, Y + 1)]).toBe(0);
    g.breakTile(X + 7, Y + 1);
    g.breakTile(X + 6, Y + 1);
    expect(g.events.filter((e) => e.t === 'flood').length).toBe(1);
  });

  it('deux poches séparées, ou de nature différente, restent deux poches', () => {
    const g = wall();
    const w = g.world;
    w.pocket[w.idx(X + 6, Y + 1)] = POCKET_GAS;
    w.pocket[w.idx(X + 7, Y + 1)] = POCKET_WATER; // collée à la précédente, mais c'est de l'eau
    w.pocket[w.idx(X + 6, Y + 3)] = POCKET_GAS; // à deux cases : une autre poche
    g.breakTile(X + 6, Y + 1);
    expect(gasEvents(g)).toBe(1);
    expect(w.pocket[w.idx(X + 7, Y + 1)]).toBe(POCKET_WATER);
    expect(w.pocket[w.idx(X + 6, Y + 3)]).toBe(POCKET_GAS);
    g.breakTile(X + 6, Y + 3);
    expect(gasEvents(g)).toBe(2);
  });

  it('une poche déjà ouverte ne se referme pas au chargement (les poches se recalculent depuis la graine)', () => {
    const g = new GameState(4);
    const w = g.world;
    const total = (grid: Uint8Array) => grid.reduce((n, p) => n + (p ? 1 : 0), 0);
    const before = total(w.pocket);
    // Une vraie poche de la mine, d'au moins deux cases, dont on perce une seule.
    let i = -1;
    for (let k = 0; k < w.pocket.length && i < 0; k++) if (w.pocket[k] === POCKET_GAS && pocketCells(w, k).length >= 2) i = k;
    expect(i).toBeGreaterThanOrEqual(0);
    const cells = pocketCells(w, i);
    g.breakTile(i % w.w, Math.floor(i / w.w));
    for (const c of cells) expect(w.pocket[c]).toBe(0);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    for (const c of cells) expect(h.world.pocket[c]).toBe(0);
    // Les autres poches de la mine, elles, sont toujours là.
    expect(total(h.world.pocket)).toBe(before - cells.length);
  });
});

describe('dangers : éboulements', () => {
  it('une très grande salle creusée à la main craque, puis s’effondre et blesse le joueur', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 8, Y + 8);
    teleport(g, X + 4, Y + 2);
    open(g, X + 4, Y + 2, X + 4, Y + 2); // le joueur se tient dans une niche naturelle
    digAround(g, X + 4, Y + 5, CAVE_IN.maxDug); // la zone est pleine jusqu'à la limite : encore stable
    expect(g.hazards.pending.length).toBe(0);
    g.breakTile(X + 4, Y + 5); // une de plus : au-delà de la limite
    expect(g.hazards.pending.length).toBe(1);
    expect(g.events.some((e) => e.t === 'rumble')).toBe(true);
    teleport(g, X + 4, Y + 4); // le joueur reste dans la salle qui craque
    run(g, CAVE_IN.warning + 0.1);
    expect(g.hazards.pending.length).toBe(0);
    const rubble = count(g, RUBBLE, X, Y, X + 8, Y + 8);
    expect(rubble).toBeGreaterThanOrEqual(CAVE_IN.fill[0]);
    expect(rubble).toBeLessThanOrEqual(CAVE_IN.fill[1]);
    expect(g.world.get(X + 4, Y + 4)).toBe(AIR); // jamais sur le joueur
    expect(g.hp).toBe(HEALTH.max - CAVE_IN.damage);
    expect(g.events.some((e) => e.t === 'collapse')).toBe(true);
    // Les éboulis se dégagent vite, mais ne rendent pas de poche.
    expect(getBlock(RUBBLE).breakable).toBe(true);
    expect(getBlock(RUBBLE).hp).toBeLessThan(getBlock(ROCK).hp);
  });

  it('un étai posé pendant que le plafond craque l’empêche de tomber', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 8, Y + 8);
    teleport(g, X + 4, Y + 2);
    open(g, X + 4, Y + 2, X + 4, Y + 2);
    digAround(g, X + 4, Y + 5, CAVE_IN.maxDug);
    g.breakTile(X + 4, Y + 5);
    expect(g.hazards.pending.length).toBe(1);
    run(g, 1);
    g.inventory.addKit('prop', 1);
    expect(g.place('prop', X + 4, Y + 3, 0)).toBeTruthy(); // on peut le poser sous ses pieds, on passe dessous
    run(g, CAVE_IN.warning);
    expect(count(g, RUBBLE, X, Y, X + 8, Y + 8)).toBe(0);
    expect(g.hp).toBe(HEALTH.max);
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('consolidé'))).toBe(true);
    // Désormais étayée, la salle peut s'agrandir sans craquer.
    dig(g, X + 2, Y + 5, X + 6, Y + 6);
    expect(g.hazards.pending.length).toBe(0);
  });

  it('pas d’éboulement près de la surface, ni dans un tunnel d’une case, ni dans les tunnels de la foreuse', () => {
    const g = new GameState(4);
    // Près de la surface (au-dessus de 60 m).
    rock(g, X, S + 8, X + 8, S + 16);
    dig(g, X + 2, S + 10, X + 6, S + 13);
    expect(depthAt(S + 13)).toBeLessThan(CAVE_IN.minDepth);
    expect(g.hazards.pending.length).toBe(0);
    // Un long tunnel d'une case de large, en profondeur.
    rock(g, X, Y, X + 12, Y + 2);
    dig(g, X, Y + 1, X + 12, Y + 1);
    expect(g.hazards.pending.length).toBe(0);
    // Percé par une machine (la foreuse de percement consolide) : ne compte pas.
    rock(g, X, Y + 4, X + 8, Y + 8);
    for (let y = Y + 5; y <= Y + 7; y++) for (let x = X + 1; x <= X + 7; x++) g.breakTile(x, y, { x: 0, y: 0 });
    expect(g.world.dug[g.world.idx(X + 3, Y + 6)]).toBe(0);
    expect(g.hazards.pending.length).toBe(0);
  });
});

describe('dangers : les éboulements sont rares', () => {
  /** Nombre de plafonds qui ont craqué (grondements) pendant que `fn` creuse. */
  function creaks(fn: (g: GameState) => void, h = 14): number {
    const g = new GameState(4);
    rock(g, X, Y, X + 24, Y + h);
    fn(g);
    return g.events.filter((e) => e.t === 'rumble').length;
  }

  it('un tunnel au marteau-piqueur (3 cases de large), un puits, un escalier et une salle de 8 × 8 tiennent', () => {
    // Tunnel de trois cases de large, creusé colonne par colonne comme le fait le marteau-piqueur.
    expect(creaks((g) => { for (let x = X; x < X + 24; x++) for (let y = Y + 2; y <= Y + 4; y++) g.breakTile(x, y); })).toBe(0);
    // Escalier de trois cases de large, en diagonale (onze cases dans la zone : l'ancien seuil de dix craquait cinq fois).
    expect(
      creaks((g) => {
        for (let i = 0; i < 10; i++) {
          for (let y = Y + i; y <= Y + i + 2; y++) g.breakTile(X + i, y);
          for (let y = Y + i + 2; y <= Y + i + 4; y++) g.breakTile(X + i + 1, y);
        }
      }, 18),
    ).toBe(0);
    // Une salle de 8 × 8, rangée par rangée (treize cases dans la zone : l'ancien seuil craquait dès 4 × 4).
    expect(creaks((g) => dig(g, X + 2, Y + 2, X + 9, Y + 9))).toBe(0);
  });

  it('ordre de grandeur : un trou irrégulier de 30 cases ne craque presque jamais (avant : plus d’une fois par trou)', () => {
    let total = 0;
    const RUNS = 20;
    for (let r = 0; r < RUNS; r++) {
      let seed = (r + 1) * 2654435761;
      const rnd = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      total += creaks((g) => {
        const done = new Set<string>();
        const front: [number, number][] = [[X + 12, Y + 7]];
        while (done.size < 30 && front.length) {
          const [x, y] = front.splice(Math.floor(rnd() * front.length), 1)[0];
          if (done.has(`${x},${y}`)) continue;
          done.add(`${x},${y}`);
          g.breakTile(x, y);
          front.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
          run(g, 0.3);
          g.hp = HEALTH.max;
        }
      });
    }
    expect(total / RUNS).toBeLessThan(0.3);
  });

  it('mais une galerie de six cases de large, creusée en deux passes, fait encore craquer le plafond', () => {
    expect(
      creaks((g) => {
        for (const [y0, y1] of [[Y + 2, Y + 4], [Y + 5, Y + 7]]) for (let x = X + 2; x <= X + 11; x++) for (let y = y0; y <= y1; y++) g.breakTile(x, y);
      }),
    ).toBeGreaterThan(0);
  });
});

describe('dangers : grisou', () => {
  it('une poche percée envahit la galerie ; le gaz blesse puis se dissipe, un ventilateur le chasse', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 10, Y + 4);
    open(g, X + 1, Y + 1, X + 9, Y + 3);
    const w = g.world;
    w.pocket[w.idx(X + 10, Y + 2)] = POCKET_GAS;
    teleport(g, X + 8, Y + 2);
    g.breakTile(X + 10, Y + 2);
    expect(g.events.some((e) => e.t === 'gas')).toBe(true);
    let gassy = 0;
    for (let i = 0; i < w.gas.length; i++) if (w.gas[i] > 0) gassy++;
    expect(gassy).toBe(GAS.spread);
    expect(g.hazards.gasAt(X + 8, Y + 2)).toBe(255);
    run(g, 2);
    expect(g.hp).toBeCloseTo(HEALTH.max - 2 * GAS.dps, 0);
    expect(g.hazards.gasAt(X + 8, Y + 2)).toBeCloseTo(255 - 2 * GAS.decay, 0);
    // Un ventilateur à portée : l'air redevient sain en quelques secondes.
    teleport(g, X + 2, Y + 2);
    g.inventory.addKit('fan', 1);
    expect(g.place('fan', X + 5, Y + 1, 0)).toBeTruthy();
    run(g, 4);
    expect(g.hazards.gasAt(X + 8, Y + 2)).toBe(0);
    expect(g.hazards.hasGas).toBe(false);
  });

  it('une poche percée d’éboulis ne se libère pas une seconde fois', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 4, Y + 2);
    open(g, X + 1, Y + 1, X + 3, Y + 1);
    const w = g.world;
    w.set(X + 4, Y + 1, RUBBLE);
    w.pocket[w.idx(X + 4, Y + 1)] = POCKET_GAS;
    g.breakTile(X + 4, Y + 1);
    expect(g.hazards.hasGas).toBe(false);
  });
});

describe('dangers : eau', () => {
  it('une poche d’eau inonde la galerie : on y avance à peine, l’eau profonde épuise', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 14, Y + 2);
    open(g, X + 1, Y + 1, X + 13, Y + 1);
    const w = g.world;
    w.pocket[w.idx(X + 14, Y + 1)] = POCKET_WATER;
    teleport(g, X + 2, Y + 1);
    const walk = () => {
      const x0 = g.player.x;
      run(g, 0.5, { ...NO_INTENT, mx: 1 } as PlayerIntent);
      const d = g.player.x - x0;
      teleport(g, X + 2, Y + 1);
      return d;
    };
    const dry = walk();
    g.breakTile(X + 14, Y + 1);
    expect(g.events.some((e) => e.t === 'flood')).toBe(true);
    expect(g.hazards.waterAt(X + 2, Y + 1)).toBe(255);
    const wet = walk();
    expect(wet).toBeLessThan(dry * WATER.slowDeep + 1);
    const hp = g.hp;
    run(g, 2);
    expect(g.hp).toBeCloseTo(hp - 2 * WATER.dps, 0);
  });

  it('une pompe assèche la galerie toute seule, sans charbon', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 8, Y + 2);
    open(g, X + 1, Y + 1, X + 7, Y + 1);
    const w = g.world;
    w.pocket[w.idx(X + 8, Y + 1)] = POCKET_WATER;
    g.breakTile(X + 8, Y + 1);
    teleport(g, X + 2, Y + 1);
    g.inventory.addKit('pump', 1);
    // Posée sous la galerie : de la roche creusée pour elle.
    w.set(X + 4, Y + 2, AIR);
    const pump = g.place('pump', X + 4, Y + 2, 0) as Pump;
    expect(pump).toBeInstanceOf(Pump);
    expect(g.inventory.count('coal')).toBe(0);
    run(g, 1);
    expect(pump.status).toBe('ok');
    run(g, 4);
    expect(g.hazards.hasWater).toBe(false);
    expect(pump.status).toBe('idle');
  });
});

describe('dangers : santé', () => {
  it('on récupère hors de danger ; à 0, on s’évanouit et on se réveille au camp, le sac reste au fond', () => {
    const g = new GameState(4);
    teleport(g, 50, S + 14);
    g.inventory.add('copper', 3);
    g.hurtPlayer(30, 'test');
    expect(g.hp).toBe(70);
    run(g, HEALTH.regenDelay - 0.5);
    expect(g.hp).toBe(70);
    run(g, 2);
    expect(g.hp).toBeGreaterThan(70);
    const at = { x: g.player.x, y: g.player.y };
    g.hurtPlayer(200, 'grisou');
    expect(g.hp).toBe(HEALTH.max);
    expect(g.stats.faints).toBe(1);
    expect(g.inventory.count('copper')).toBe(0);
    expect(g.player.tileY).toBeLessThan(S); // au camp
    const bag = g.drops.list.filter((d) => d.res === 'copper');
    expect(bag.reduce((n, d) => n + d.count, 0)).toBe(3);
    expect(Math.hypot(bag[0].x - at.x, bag[0].y - at.y)).toBeLessThan(TILE);
    expect(g.events.some((e) => e.t === 'faint')).toBe(true);
  });

  it('la santé, les cases creusées, le gaz, l’eau et un éboulement annoncé sont sauvegardés', () => {
    const g = new GameState(4);
    rock(g, X, Y, X + 8, Y + 8);
    teleport(g, X + 4, Y + 2);
    open(g, X + 4, Y + 2, X + 4, Y + 2);
    digAround(g, X + 4, Y + 5, CAVE_IN.maxDug);
    g.breakTile(X + 4, Y + 5);
    const w = g.world;
    w.gas[w.idx(X + 3, Y + 3)] = 120;
    w.water[w.idx(X + 5, Y + 3)] = 200;
    g.hazards.rebuild();
    g.hurtPlayer(25, 'test');
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.hp).toBe(75);
    expect(h.world.dug[h.world.idx(X + 3, Y + 3)]).toBe(1);
    expect(h.hazards.gasAt(X + 3, Y + 3)).toBe(120);
    expect(h.hazards.waterAt(X + 5, Y + 3)).toBe(200);
    expect(h.hazards.pending.length).toBe(1);
    expect(h.hazards.hasGas && h.hazards.hasWater).toBe(true);
    // Une ancienne sauvegarde n'a ni santé ni dangers : pleine santé, rien en cours.
    const old = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete old.health;
    delete old.hazards;
    const o = deserialize(old);
    expect(o.hp).toBe(HEALTH.max);
    expect(o.hazards.pending.length).toBe(0);
  });
});
