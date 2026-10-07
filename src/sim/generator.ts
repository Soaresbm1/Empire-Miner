/**
 * Génération procédurale déterministe de la mine à partir d'une graine.
 *
 * Structure :
 *  - Surface (camp) : comptoir, atelier, entrée de la mine.
 *  - Galeries de départ creusées à la main (puits, deux galeries, une salle).
 *  - Roches hôtes de plus en plus dures avec la profondeur.
 *  - Cavernes naturelles (bruit fractal) à découvrir.
 *  - Filons de minerais placés selon la profondeur de chaque ressource.
 *  - Gisements naturels au sol de certaines cavernes.
 *
 * La Fournaise (sous LEGACY_WORLD_H) a été ajoutée plus tard : ses filons, gisements et
 * poches se tirent à part, pour que les rangées du dessus restent celles d'avant (une
 * ancienne sauvegarde s'agrandit par le bas sans que rien ne change au-dessus).
 */
import { AIR, BEDROCK, CLIFF, HOST_ROCK_IDS, ORE_BLOCK, TREE, hostRockIndexForDepth } from '../data/blocks';
import { GAS, POCKET_GAS, POCKET_WATER, WATER } from '../data/hazards';
import { RESOURCES, ResourceDef, resourceIndex } from '../data/resources';
import { LEGACY_WORLD_H, SURFACE_ROWS, TILE, WORLD_H, WORLD_W, depthAt, rowForDepth } from '../core/constants';
import { Rng, fbm } from '../core/rng';
import { World } from './World';
import { hyp } from '../core/dmath';

export interface BuildingPlacement {
  type: 'counter' | 'workshop' | 'board';
  x: number;
  y: number;
}

export interface WorldLayout {
  world: World;
  buildings: BuildingPlacement[];
  /** Tuile d'apparition du joueur. */
  spawn: { x: number; y: number };
  /** Entrée de la mine (haut du puits). */
  entrance: { x: number; y: number; w: number };
  /** Lanternes de l'ancienne mine (décor lumineux, coordonnées monde). */
  lamps: { x: number; y: number }[];
}

const S = SURFACE_ROWS;
const SHAFT_X = 49;
const START_CENTER = { x: 50, y: S + 12 };

export function generateWorld(seed: number, w = WORLD_W, h = WORLD_H): WorldLayout {
  const world = new World(w, h, seed);
  const rng = new Rng(seed);
  // Tirages de la Fournaise, à part de ceux du dessus.
  const deepRng = new Rng(seed ^ 0x51ed270b);
  // Bas des rangées d'origine : filons, gisements et poches du dessus s'arrêtent là, comme avant.
  const hl = Math.min(h, LEGACY_WORLD_H);

  // 1. Surface et roches hôtes.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < S) {
        world.tiles[world.idx(x, y)] = y < 2 || x < 2 || x >= w - 2 ? CLIFF : AIR;
      } else if (x === 0 || x === w - 1 || y === h - 1) {
        world.tiles[world.idx(x, y)] = BEDROCK;
      } else {
        const jitter = (fbm(x / 10, y / 10, seed + 5) - 0.5) * 22;
        world.tiles[world.idx(x, y)] = HOST_ROCK_IDS[hostRockIndexForDepth(depthAt(y) + jitter)];
      }
    }
  }

  // 2. Cavernes naturelles (loin de la zone de départ).
  const caveStart = rowForDepth(40);
  for (let y = caveStart; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const dStart = hyp(x - START_CENTER.x, (y - START_CENTER.y) * 1.3);
      if (dStart < 16) continue;
      const n = fbm(x / 7, y / 5.5, seed + 77, 3);
      const n2 = fbm(x / 3.5, y / 3.5, seed + 99, 2);
      if (n > 0.635 || (n > 0.6 && n2 > 0.62)) world.tiles[world.idx(x, y)] = AIR;
    }
  }

  // 3. Filons de minerais : rangées d'origine, puis Fournaise.
  for (const res of RESOURCES) {
    if (!res.vein) continue;
    const y0 = Math.max(S + 1, rowForDepth(res.minDepth));
    const y1 = Math.min(hl - 2, res.maxDepth === Infinity ? hl - 2 : rowForDepth(res.maxDepth));
    placeVeins(world, rng, res, y0, y1, res.vein.perThousand);
  }
  if (h > hl) {
    for (const res of RESOURCES) {
      if (!res.vein) continue;
      const y0 = Math.max(hl - 1, rowForDepth(res.minDepth));
      const y1 = Math.min(h - 2, res.maxDepth === Infinity ? h - 2 : rowForDepth(res.maxDepth));
      placeVeins(world, deepRng, res, y0, y1, res.vein.deepPerThousand ?? res.vein.perThousand);
    }
  }

  // 4. Gisements naturels dans les cavernes.
  placeDeposits(world, rng, caveStart, hl - 1);
  placeDeposits(world, deepRng, hl - 1, h - 1);

  // 5. Mine de départ (creusée à la main par un ancien mineur).
  carveStartMine(world);

  // 5 bis. Poches de grisou et d'eau cachées dans la roche (tirage séparé : le terrain ne change pas).
  placePockets(world, seed);

  // 6. Décor de surface : chemins et arbres.
  for (let y = 2; y < S; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = world.idx(x, y);
      const onMainPath = y >= 9 && y <= 10 && x >= 38 && x <= 62;
      const onShaftPath = x >= SHAFT_X && x <= SHAFT_X + 1 && y >= 9;
      const onFrontPath = y === 8 && ((x >= 40 && x <= 42) || (x >= 57 && x <= 59));
      if (onMainPath || onShaftPath || onFrontPath) world.floorDeco[i] = 1;
      const inCamp = x >= 33 && x <= 67;
      if (!inCamp && y >= 3 && rng.chance(0.1)) world.tiles[i] = TREE;
    }
  }

  // Toute la surface est connue dès le départ.
  for (let y = 0; y < S; y++) for (let x = 0; x < w; x++) world.explored[world.idx(x, y)] = 1;

  world.markAllDirty();
  return {
    world,
    buildings: [
      { type: 'counter', x: 40, y: 6 },
      { type: 'workshop', x: 57, y: 6 },
      // Entre les deux : x = 49 et 50, au milieu du camp.
      { type: 'board', x: 49, y: 6 },
    ],
    spawn: { x: 50, y: 9 },
    entrance: { x: SHAFT_X, y: S, w: 2 },
    lamps: [
      { x: SHAFT_X * TILE + 3, y: (S + 3) * TILE + 4 },
      { x: SHAFT_X * TILE + 3, y: (S + 9) * TILE + 4 },
      { x: 45 * TILE + 8, y: (S + 5) * TILE + 3 },
      { x: 55 * TILE + 8, y: (S + 10) * TILE + 3 },
      { x: 47 * TILE + 8, y: (S + 13) * TILE + 3 },
    ],
  };
}

/** Filons d'une ressource entre les rangées y0 et y1 (incluses). */
function placeVeins(world: World, rng: Rng, res: ResourceDef, y0: number, y1: number, perThousand: number): void {
  if (!res.vein || y1 <= y0) return;
  const w = world.w;
  const rockSet = new Set(HOST_ROCK_IDS);
  const count = Math.round((((y1 - y0) * (w - 2)) / 1000) * perThousand);
  const oreId = ORE_BLOCK[res.id];
  for (let i = 0; i < count; i++) {
    let x = rng.int(1, w - 2);
    let y = rng.int(y0, y1);
    const size = rng.int(res.vein.size[0], res.vein.size[1]);
    for (let s = 0; s < size * 2 && s < 40; s++) {
      const t = world.idx(x, y);
      if (rockSet.has(world.tiles[t])) world.tiles[t] = oreId;
      const d = rng.int(0, 3);
      x = Math.min(w - 2, Math.max(1, x + (d === 0 ? 1 : d === 2 ? -1 : 0)));
      y = Math.min(y1, Math.max(y0, y + (d === 1 ? 1 : d === 3 ? -1 : 0)));
    }
  }
}

/** Gisements au sol des cavernes, sur les rangées [y0, y1). */
function placeDeposits(world: World, rng: Rng, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = 1; x < world.w - 1; x++) {
      const i = world.idx(x, y);
      if (world.tiles[i] !== AIR || world.deposit[i]) continue;
      if (!rng.chance(0.012)) continue;
      const res = pickResourceForDepth(rng, depthAt(y));
      if (!res || !res.deposit) continue;
      const ri = resourceIndex(res.id);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!world.isOpen(nx, ny)) continue;
          if ((dx !== 0 || dy !== 0) && !rng.chance(0.45)) continue;
          world.setDeposit(nx, ny, ri, rng.range(res.deposit[0], res.deposit[1]));
        }
    }
  }
}

function pickResourceForDepth(rng: Rng, depth: number): ResourceDef | null {
  const candidates = RESOURCES.filter((r) => r.vein && depth >= r.minDepth && depth <= r.maxDepth);
  if (!candidates.length) return null;
  const total = candidates.reduce((s, r) => s + r.vein!.perThousand, 0);
  let roll = rng.float() * total;
  for (const r of candidates) {
    roll -= r.vein!.perThousand;
    if (roll <= 0) return r;
  }
  return candidates[candidates.length - 1];
}

/**
 * Poches de grisou et d'eau : petits amas de cases de roche (jamais de filon) marqués dans
 * `world.pocket`, dans leur tranche de profondeur. Elles ne se voient qu'à de légers indices
 * sur la paroi, et se libèrent quand on perce la case.
 */
export function placePockets(world: World, seed: number): void {
  const hl = Math.min(world.h, LEGACY_WORLD_H);
  pocketBand(world, new Rng(seed ^ 0x2545f491), S + 1, hl - 2);
  // Fournaise : tirage à part (les poches du dessus ne bougent pas).
  if (world.h > hl) pocketBand(world, new Rng(seed ^ 0x6c8e9cf5), hl - 1, world.h - 2);
}

function pocketBand(world: World, rng: Rng, top: number, y1: number): void {
  const rock = new Set(HOST_ROCK_IDS);
  const kinds: [number, { minDepth: number; perThousand: number; size: [number, number] }][] = [
    [POCKET_WATER, WATER],
    [POCKET_GAS, GAS],
  ];
  for (const [kind, spec] of kinds) {
    const y0 = Math.max(top, rowForDepth(spec.minDepth));
    if (y1 <= y0) continue;
    const count = Math.round((((y1 - y0) * (world.w - 2)) / 1000) * spec.perThousand);
    for (let i = 0; i < count; i++) {
      let x = rng.int(1, world.w - 2);
      let y = rng.int(y0, y1);
      const size = rng.int(spec.size[0], spec.size[1]);
      for (let k = 0; k < size; k++) {
        const j = world.idx(x, y);
        if (rock.has(world.tiles[j]) && !world.pocket[j]) world.pocket[j] = kind;
        x = Math.min(world.w - 2, Math.max(1, x + rng.int(-1, 1)));
        y = Math.min(y1, Math.max(y0, y + rng.int(-1, 1)));
      }
    }
  }
}

function carve(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = world.idx(x, y);
      world.tiles[i] = AIR;
      world.deposit[i] = 0;
      world.floorDeco[i] = 2; // vieux plancher
    }
}

function place(world: World, block: number, coords: [number, number][]): void {
  for (const [x, y] of coords) world.tiles[world.idx(x, y)] = block;
}

function carveStartMine(world: World): void {
  const soft = HOST_ROCK_IDS[0];
  // Zone de départ : uniquement de la roche tendre (pas de caverne, pas de filon aléatoire).
  for (let y = S; y <= S + 20; y++)
    for (let x = 34; x <= 66; x++) {
      const i = world.idx(x, y);
      world.tiles[i] = soft;
      world.deposit[i] = 0;
    }
  carve(world, SHAFT_X, S, SHAFT_X + 1, S + 12); // puits
  carve(world, 42, S + 5, SHAFT_X - 1, S + 6); // galerie ouest
  carve(world, SHAFT_X + 2, S + 10, 58, S + 11); // galerie est
  carve(world, 46, S + 13, 53, S + 15); // salle du fond

  const coal = ORE_BLOCK.coal;
  const copper = ORE_BLOCK.copper;
  place(world, coal, [[41, S + 5], [41, S + 6], [40, S + 5], [40, S + 6], [40, S + 4], [39, S + 6], [41, S + 4]]);
  place(world, copper, [[59, S + 10], [59, S + 11], [60, S + 10], [60, S + 11], [60, S + 9], [61, S + 11], [59, S + 12]]);
  place(world, copper, [[45, S + 13], [45, S + 14], [44, S + 14]]);
  place(world, coal, [[54, S + 14], [54, S + 15], [55, S + 14]]);
  place(world, copper, [[48, S + 16], [49, S + 16], [49, S + 17]]);
  // Un filon de fer visible mais trop dur pour la vieille pioche : premier objectif de progression.
  place(world, HOST_ROCK_IDS[1], [[51, S + 16], [52, S + 16], [52, S + 17]]);
  place(world, ORE_BLOCK.iron, [[51, S + 16], [52, S + 16]]);
}
