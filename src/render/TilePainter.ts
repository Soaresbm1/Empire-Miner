/**
 * Peintre de tuiles pixel par pixel (textures procédurales, aucun fichier image).
 *
 * Les parois sont dessinées en vue 3/4 : un dessus texturé et, si la tuile au sud
 * est ouverte, une face avant plus sombre qui donne du relief à la galerie.
 */
import { SURFACE_ROWS, TILE, depthAt } from '../core/constants';
import { fbm, hash2, valueNoise } from '../core/rng';
import { AIR, HOST_ROCKS, TREE, getBlock, hostRockIndexForDepth } from '../data/blocks';
import { RESOURCES } from '../data/resources';
import type { World } from '../sim/World';
import { RGB, hex, mix, scale } from './color';

const FACE_H = 6;

const FLOOR_STOPS: [number, RGB][] = [
  [0, hex('#4a3d33')],
  [100, hex('#3b3e46')],
  [300, hex('#40303a')],
  [460, hex('#4a2b2b')],
];

function floorColor(depth: number): RGB {
  for (let i = 1; i < FLOOR_STOPS.length; i++) {
    const [d1, c1] = FLOOR_STOPS[i];
    const [d0, c0] = FLOOR_STOPS[i - 1];
    if (depth <= d1) return mix(c0, c1, (depth - d0) / (d1 - d0));
  }
  return FLOOR_STOPS[FLOOR_STOPS.length - 1][1];
}

const GRASS = [hex('#4d7d34'), hex('#588c3b'), hex('#43702d')];
const DIRT = [hex('#8a6a45'), hex('#7c5d3c'), hex('#977652')];
const PLANK = [hex('#6e4c2f'), hex('#7b5636'), hex('#5f4028')];
const UNKNOWN = hex('#0b0a0d');

/** Couleurs de roche hôte à une position (même bruit que le générateur). */
function hostAt(world: World, x: number, y: number) {
  const jitter = (fbm(x / 10, y / 10, world.seed + 5) - 0.5) * 22;
  return HOST_ROCKS[hostRockIndexForDepth(depthAt(y) + jitter)];
}

type Put = (px: number, py: number, c: RGB) => void;

export function paintTile(world: World, tx: number, ty: number, put: Put): void {
  const i = world.idx(tx, ty);
  const id = world.tiles[i];
  if (!world.explored[i]) return paintUnknown(tx, ty, put);
  if (id === AIR) return paintFloor(world, tx, ty, put);
  if (id === TREE) {
    paintFloor(world, tx, ty, put);
    return paintTree(tx, ty, put);
  }
  paintWall(world, tx, ty, put);
}

function paintUnknown(tx: number, ty: number, put: Put): void {
  for (let py = 0; py < TILE; py++)
    for (let px = 0; px < TILE; px++) {
      const n = hash2(tx * TILE + px, ty * TILE + py, 3);
      put(px, py, n < 0.05 ? scale(UNKNOWN, 1.6) : UNKNOWN);
    }
}

function paintFloor(world: World, tx: number, ty: number, put: Put): void {
  const i = world.idx(tx, ty);
  const deco = world.floorDeco[i];
  const surface = ty < SURFACE_ROWS;
  const base = floorColor(depthAt(ty));
  const nSolid = world.isSolid(tx, ty - 1);
  const wSolid = world.isSolid(tx - 1, ty);
  const eSolid = world.isSolid(tx + 1, ty);
  const dep = world.deposit[i];
  const ore = dep ? RESOURCES[dep - 1] : null;
  const oreC = ore ? [hex(ore.color), hex(ore.light), hex(ore.dark)] : null;
  for (let py = 0; py < TILE; py++)
    for (let px = 0; px < TILE; px++) {
      const wx = tx * TILE + px;
      const wy = ty * TILE + py;
      const h = hash2(wx, wy, 11);
      let c: RGB;
      if (surface) {
        if (deco === 1) {
          c = DIRT[h < 0.2 ? 1 : h > 0.9 ? 2 : 0];
          if (h > 0.97) c = scale(c, 1.2);
        } else {
          const v = valueNoise(wx / 5, wy / 5, 21);
          c = GRASS[v > 0.62 ? 1 : v < 0.35 ? 2 : 0];
          if (h > 0.985) c = hex(h > 0.993 ? '#e8d25a' : '#e3e7f0'); // fleurs
          else if (h < 0.06) c = scale(c, 0.85);
        }
      } else if (deco === 2) {
        // Vieux plancher de la mine d'origine.
        const plank = Math.floor(py / 4);
        c = PLANK[(plank + tx) % 3];
        if (py % 4 === 3) c = scale(c, 0.65);
        if ((px + plank * 5 + tx * 3) % 11 === 0) c = scale(c, 0.75);
        if (h > 0.97) c = scale(c, 1.15);
      } else {
        const v = valueNoise(wx / 4, wy / 4, 7);
        c = scale(base, 0.9 + v * 0.2);
        if (h < 0.035) c = scale(c, 1.35);
        else if (h < 0.07) c = scale(c, 0.75);
      }
      if (oreC) {
        // Gisement : pépites éparses incrustées dans le sol, bordées d'ombre.
        const m = valueNoise(wx / 1.8, wy / 1.8, 55 + dep * 17);
        if (m > 0.7) c = m > 0.84 ? oreC[1] : oreC[0];
        else if (m > 0.64) c = scale(mix(c, oreC[2], 0.5), 0.8);
        else if (h > 0.93) c = oreC[2];
      }
      // Ombres portées des parois.
      if (nSolid && py < 4) c = scale(c, [0.45, 0.6, 0.75, 0.88][py]);
      if (wSolid && px < 2) c = scale(c, px === 0 ? 0.7 : 0.87);
      if (eSolid && px > 13) c = scale(c, px === 15 ? 0.75 : 0.9);
      put(px, py, c);
    }
}

function paintWall(world: World, tx: number, ty: number, put: Put): void {
  const block = getBlock(world.get(tx, ty));
  const host = block.kind === 'rock' || block.kind === 'bedrock' ? block : hostAt(world, tx, ty);
  const top = hex(host.top);
  const side = hex(host.side);
  const sOpen = world.inBounds(tx, ty + 1) && !world.isSolid(tx, ty + 1);
  const nOpen = world.inBounds(tx, ty - 1) && !world.isSolid(tx, ty - 1);
  const wOpen = world.inBounds(tx - 1, ty) && !world.isSolid(tx - 1, ty);
  const eOpen = world.inBounds(tx + 1, ty) && !world.isSolid(tx + 1, ty);
  const faceStart = sOpen ? TILE - FACE_H : TILE;
  const ore = block.ore ? RESOURCES.find((r) => r.id === block.ore)! : null;
  const oreC = ore ? [hex(ore.color), hex(ore.light), hex(ore.dark)] : null;
  const bedrock = block.kind === 'bedrock';
  const rubble = block.key === 'rubble';
  for (let py = 0; py < TILE; py++)
    for (let px = 0; px < TILE; px++) {
      const wx = tx * TILE + px;
      const wy = ty * TILE + py;
      const h = hash2(wx, wy, 5);
      let c: RGB;
      if (py < faceStart) {
        const v = valueNoise(wx / 3, wy / 3, 9);
        c = scale(top, 0.88 + v * 0.24);
        const crack = valueNoise(wx / 6, wy / 6, 13);
        if (crack > 0.49 && crack < 0.52) c = scale(c, 0.72);
        if (h < 0.04) c = scale(c, 1.2);
        if (bedrock && h > 0.9) c = scale(c, 0.7);
        // Éboulis : un tas de pierres bosselé.
        if (rubble) {
          const s = valueNoise(wx / 2.2, wy / 2.2, 41);
          c = scale(c, s > 0.62 ? 1.22 : s < 0.34 ? 0.66 : 0.95);
        }
        if (nOpen && py === 0) c = scale(c, 1.3);
        else if (nOpen && py === 1) c = scale(c, 1.12);
        if (wOpen && px === 0) c = scale(c, 0.8);
        if (eOpen && px === TILE - 1) c = scale(c, 0.72);
        if (sOpen && py === faceStart - 1) c = scale(c, 1.18);
      } else {
        // Face avant (relief) : stries verticales, plus sombre vers le bas.
        const col = hash2(wx, 0, 17);
        c = scale(side, (0.8 + col * 0.3) * (1 - (py - faceStart) * 0.05));
        if (py === faceStart) c = scale(c, 1.25);
        if (py === TILE - 1) c = scale(c, 0.55);
        if (h < 0.05) c = scale(c, 1.2);
        if (wOpen && px === 0) c = scale(c, 0.8);
      }
      if (oreC) {
        const m = valueNoise(wx / 2.2, wy / 2.2, 31 + block.id * 13);
        if (m > 0.6) {
          c = m > 0.8 ? oreC[1] : m > 0.65 ? oreC[0] : oreC[2];
          if (py >= faceStart) c = scale(c, 0.75);
        }
      }
      put(px, py, c);
    }
}

function paintTree(tx: number, ty: number, put: Put): void {
  const trunk = hex('#5b3a22');
  const leaf = [hex('#2f6b2c'), hex('#3f8a37'), hex('#5fae4a'), hex('#23521f')];
  for (let py = 0; py < TILE; py++)
    for (let px = 0; px < TILE; px++) {
      const dx = px - 7.5;
      const dy = py - 6.5;
      const d = Math.hypot(dx, dy * 1.1);
      if (d < 6.8) {
        const h = hash2(tx * TILE + px, ty * TILE + py, 41);
        const lit = -dx - dy;
        let c = leaf[lit > 4 ? 2 : lit > -3 ? 1 : 0];
        if (h < 0.12) c = leaf[3];
        if (d > 6) c = leaf[3];
        put(px, py, c);
      } else if (px >= 6 && px <= 9 && py >= 11 && py <= 15) {
        put(px, py, px === 6 ? scale(trunk, 1.2) : trunk);
      }
    }
}
