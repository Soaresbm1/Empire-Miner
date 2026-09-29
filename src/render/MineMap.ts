/**
 * Carte de la mine : une vignette dans le coin de l'écran, centrée sur le joueur,
 * et une carte complète (touche M) cadrée sur tout ce qui a été exploré.
 *
 * Seul ce que le joueur a déjà vu est dessiné. Le terrain est rendu dans une image
 * d'un pixel par tuile, refaite quelques fois par seconde ; machines, wagonnets et
 * joueur sont dessinés par-dessus à chaque image.
 */
import { SURFACE_ROWS, TILE, depthAt, rowForDepth } from '../core/constants';
import { DX, DY } from '../core/dir';
import { AIR, BEDROCK, CLIFF, HOST_ROCKS, TREE, getBlock } from '../data/blocks';
import { RESOURCES } from '../data/resources';
import type { GameState } from '../sim/GameState';
import { Building } from '../sim/structures/Building';
import type { Structure } from '../sim/structures/Structure';
import type { World } from '../sim/World';
import { RGB, hex, mix, scale } from './color';

/** Fond des zones inconnues. */
export const MAP_BG = '#0b0a0d';

/** Couleurs des éléments posés sur la carte (reprises par la légende). */
export const MAP_COLORS = {
  player: '#ffffff',
  drill: '#f2c230',
  borer: '#ff5a3c',
  belt: '#a9b0bc',
  storage: '#c08a4a',
  shipping: '#e8792a',
  track: '#c0673a',
  wagon: '#f2ead8',
  building: '#e8dcc0',
  gallery: '#9a8266',
  rock: '#3a322c',
};

/** Galeries : plus claires que la roche, teintées par zone de profondeur. */
const FLOOR_STOPS: [number, RGB][] = [
  [0, hex('#9a8266')],
  [100, hex('#7f8696')],
  [300, hex('#8a6f80')],
];
const GRASS = hex('#4d7d34');
const DIRT = hex('#9a7a52');
const PLANK = hex('#a07448');
const TREE_C = hex('#2b5424');

function floorAt(depth: number): RGB {
  for (let i = 1; i < FLOOR_STOPS.length; i++) {
    const [d1, c1] = FLOOR_STOPS[i];
    const [d0, c0] = FLOOR_STOPS[i - 1];
    if (depth <= d1) return mix(c0, c1, (depth - d0) / (d1 - d0));
  }
  return FLOOR_STOPS[FLOOR_STOPS.length - 1][1];
}

/**
 * Couleur d'une tuile sur la carte, ou null si le joueur ne l'a pas encore vue.
 * Filons (dans la paroi) à la couleur du minerai, gisements (au sol, pour les
 * foreuses) en plus clair, galeries claires, roche sombre.
 */
export function mapTileColor(world: World, x: number, y: number): RGB | null {
  const i = world.idx(x, y);
  if (!world.explored[i]) return null;
  const id = world.tiles[i];
  if (id === AIR) {
    const dep = world.deposit[i];
    if (dep) return hex(RESOURCES[dep - 1].light);
    if (y < SURFACE_ROWS) return world.floorDeco[i] === 1 ? DIRT : GRASS;
    return world.floorDeco[i] === 2 ? PLANK : floorAt(depthAt(y));
  }
  if (id === TREE) return TREE_C;
  if (id === BEDROCK) return hex('#19161b');
  const b = getBlock(id);
  if (b.ore) return hex(b.top);
  if (id === CLIFF) return scale(hex(b.top), 0.75);
  return scale(hex(b.top), 0.5);
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Rectangle (en tuiles) qui contient tout ce qui a été exploré à partir de la rangée `fromRow`, ou null. */
export function exploredBounds(world: World, fromRow = 0): Bounds | null {
  let x0 = world.w;
  let y0 = world.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = fromRow; y < world.h; y++)
    for (let x = 0; x < world.w; x++)
      if (world.explored[y * world.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Cadre de la carte complète : la mine explorée et, au-dessus, le camp (comptoir,
 * atelier, entrée). La surface, connue d'emblée sur toute sa largeur, ne compte pas :
 * sinon la carte resterait dézoomée tant que la mine est petite.
 */
export function mapFrame(g: GameState): Bounds {
  const mine = exploredBounds(g.world, SURFACE_ROWS);
  const camp = g.structures.list.filter((s) => s instanceof Building);
  const e = g.layout.entrance;
  let x0 = Math.min(e.x, ...camp.map((s) => s.x));
  let x1 = Math.max(e.x + e.w - 1, ...camp.map((s) => s.x + s.w - 1));
  let y1 = SURFACE_ROWS;
  if (mine) {
    x0 = Math.min(x0, mine.x0);
    x1 = Math.max(x1, mine.x1);
    y1 = Math.max(y1, mine.y1);
  }
  return { x0, y0: 0, x1, y1 };
}

function structureColor(s: Structure): string {
  if (s instanceof Building) return MAP_COLORS.building;
  if (s.type === 'drill') return MAP_COLORS.drill;
  if (s.type === 'borer') return MAP_COLORS.borer;
  if (s.isTrack) return MAP_COLORS.track;
  if (s.isBelt) return MAP_COLORS.belt;
  if (s.type === 'shipping') return MAP_COLORS.shipping;
  return MAP_COLORS.storage;
}

/** Vue : tuile en haut à gauche et taille d'une tuile, en pixels du canvas. */
interface View {
  x0: number;
  y0: number;
  cell: number;
  ox: number;
  oy: number;
}

export class MineMap {
  private terrain: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private frame: Bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private timer = 0;

  /** Refait l'image du terrain quelques fois par seconde (le monde change peu d'une image à l'autre). */
  update(g: GameState, dt: number, force = false): void {
    this.timer -= dt;
    if (!force && this.timer > 0 && this.terrain) return;
    this.timer = 0.25;
    const w = g.world;
    if (!this.terrain || this.terrain.width !== w.w || this.terrain.height !== w.h) {
      this.terrain = document.createElement('canvas');
      this.terrain.width = w.w;
      this.terrain.height = w.h;
      this.image = new ImageData(w.w, w.h);
    }
    const data = this.image!.data;
    for (let y = 0; y < w.h; y++)
      for (let x = 0; x < w.w; x++) {
        const c = mapTileColor(w, x, y);
        const k = (y * w.w + x) * 4;
        if (!c) {
          data[k + 3] = 0;
          continue;
        }
        data[k] = c[0];
        data[k + 1] = c[1];
        data[k + 2] = c[2];
        data[k + 3] = 255;
      }
    this.terrain.getContext('2d')!.putImageData(this.image!, 0, 0);
    this.frame = mapFrame(g);
  }

  /** Vignette du HUD : une fenêtre de la mine centrée sur le joueur. */
  drawMini(canvas: HTMLCanvasElement, g: GameState, time: number): void {
    const ctx = this.prepare(canvas);
    if (!ctx || !this.terrain) return;
    const dpr = window.devicePixelRatio || 1;
    const cell = 4 * dpr;
    const cols = canvas.width / cell;
    const rows = canvas.height / cell;
    const view: View = { x0: g.player.x / TILE - cols / 2, y0: g.player.y / TILE - rows / 2, cell, ox: 0, oy: 0 };
    this.drawTerrain(ctx, view, cols, rows);
    this.drawThings(ctx, g, view, cols, rows, time, 2 * dpr);
  }

  /** Carte complète : cadrée sur la mine explorée et le camp, avec les zones de profondeur. */
  drawFull(canvas: HTMLCanvasElement, g: GameState, time: number): void {
    const ctx = this.prepare(canvas);
    if (!ctx || !this.terrain) return;
    const dpr = window.devicePixelRatio || 1;
    const f = this.frame;
    const pad = 4;
    const fw = f.x1 - f.x0 + 1 + pad * 2;
    const fh = f.y1 - f.y0 + 1 + pad;
    // Zoom qui fait tenir le cadre, puis vue centrée dessus qui remplit tout le canvas.
    const cell = Math.min(canvas.width / fw, canvas.height / fh, 10 * dpr);
    const vw = canvas.width / cell;
    const vh = canvas.height / cell;
    // Centrée sur le cadre sans sortir du monde ; si le monde est plus étroit que la vue, il est centré.
    const W = g.world.w;
    const vx0 = vw >= W ? (W - vw) / 2 : Math.min(Math.max((f.x0 + f.x1 + 1) / 2 - vw / 2, 0), W - vw);
    const view: View = { x0: vx0, y0: f.y0, cell, ox: 0, oy: 0 };
    this.drawTerrain(ctx, view, vw, vh);
    // Zones de profondeur : surface, roche dure, basalte.
    ctx.font = `${Math.round(11 * dpr)}px "Pixelify Sans", monospace`;
    ctx.textBaseline = 'bottom';
    const marks: [number, string][] = [[SURFACE_ROWS, '0 m · entrée de la mine']];
    for (const r of HOST_ROCKS) if (r.minDepth > 0) marks.push([rowForDepth(r.minDepth), `${r.minDepth} m · ${r.name.toLowerCase()}`]);
    for (const [row, label] of marks) {
      if (row < view.y0 || row > view.y0 + vh) continue;
      const y = Math.round(view.oy + (row - view.y0) * cell) + 0.5;
      ctx.strokeStyle = 'rgba(232,121,42,0.75)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(view.ox, y);
      ctx.lineTo(view.ox + vw * cell, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#000';
      ctx.fillText(label, view.ox + 4 * dpr + dpr, y - 2 * dpr + dpr);
      ctx.fillStyle = '#f0a33a';
      ctx.fillText(label, view.ox + 4 * dpr, y - 2 * dpr);
    }
    this.drawThings(ctx, g, view, vw, vh, time, Math.max(2 * dpr, cell * 0.6));
  }

  private prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = MAP_BG;
    ctx.fillRect(0, 0, w, h);
    return ctx;
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, v: View, cols: number, rows: number): void {
    const t = this.terrain!;
    // Partie de l'image dans la carte (la vignette peut déborder du monde près des bords).
    const sx0 = Math.max(0, v.x0);
    const sy0 = Math.max(0, v.y0);
    const sx1 = Math.min(t.width, v.x0 + cols);
    const sy1 = Math.min(t.height, v.y0 + rows);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    ctx.drawImage(t, sx0, sy0, sx1 - sx0, sy1 - sy0, v.ox + (sx0 - v.x0) * v.cell, v.oy + (sy0 - v.y0) * v.cell, (sx1 - sx0) * v.cell, (sy1 - sy0) * v.cell);
  }

  /** Machines, wagonnets et joueur. `dot` : taille minimale d'un point (px). */
  private drawThings(ctx: CanvasRenderingContext2D, g: GameState, v: View, cols: number, rows: number, time: number, dot: number): void {
    const inView = (x: number, y: number, w = 1, h = 1) => x + w >= v.x0 && y + h >= v.y0 && x <= v.x0 + cols && y <= v.y0 + rows;
    const px = (x: number) => v.ox + (x - v.x0) * v.cell;
    const py = (y: number) => v.oy + (y - v.y0) * v.cell;
    for (const s of g.structures.list) {
      if (!inView(s.x, s.y, s.w, s.h)) continue;
      ctx.fillStyle = structureColor(s);
      const inset = s instanceof Building || s.isBelt || s.isTrack ? 0 : v.cell * 0.12;
      ctx.fillRect(px(s.x) + inset, py(s.y) + inset, Math.max(dot, s.w * v.cell - inset * 2), Math.max(dot, s.h * v.cell - inset * 2));
    }
    // Foreuse de percement sortie de sa base : un point au bout de son tunnel.
    for (const b of g.structures.borers) {
      if (b.home) continue;
      const k = b.vehiclePos();
      const bx = b.x + DX[b.dir] * k + 0.5;
      const by = b.y + DY[b.dir] * k + 0.5;
      if (!inView(bx, by)) continue;
      const r = Math.max(dot, v.cell * 0.8);
      ctx.fillStyle = MAP_COLORS.borer;
      ctx.fillRect(px(bx) - r / 2, py(by) - r / 2, r, r);
    }
    for (const w of g.wagons.list) {
      const wx = w.px() / TILE;
      const wy = w.py() / TILE;
      if (!inView(wx, wy)) continue;
      const r = Math.max(dot, v.cell * 0.7);
      ctx.fillStyle = MAP_COLORS.wagon;
      ctx.fillRect(px(wx) - r / 2, py(wy) - r / 2, r, r);
    }
    // Joueur : point blanc cerclé de noir, avec une onde qui pulse.
    const cx = px(g.player.x / TILE);
    const cy = py(g.player.y / TILE);
    const r = Math.max(dot * 1.3, v.cell * 0.6);
    const pulse = (time * 1.4) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pulse)})`;
    ctx.lineWidth = Math.max(1, r * 0.35);
    ctx.beginPath();
    ctx.arc(cx, cy, r + pulse * r * 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.max(1, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MAP_COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
