/**
 * Rendu du monde sur un canvas 2D : terrain (cache par blocs), machines,
 * objets, personnage, particules et éclairage. Lecture seule de l'état de jeu.
 */
import { METERS_PER_TILE, SURFACE_ROWS, TILE, clamp } from '../core/constants';
import { DX, DY, Dir } from '../core/dir';
import { AIR, getBlock } from '../data/blocks';
import { CAVE_IN, GAS, HEALTH, POCKET_WATER } from '../data/hazards';
import { getMachine } from '../data/machines';
import { getResource } from '../data/resources';
import { ROPE } from '../data/tools';
import { FADE_TIME } from '../sim/Drops';
import type { GameState } from '../sim/GameState';
import { Bridge } from '../sim/structures/Bridge';
import { Rail, RailStation, RailSwitch } from '../sim/structures/Rail';
import { Wagon } from '../sim/Wagons';
import { Building } from '../sim/structures/Building';
import { Conveyor } from '../sim/structures/Conveyor';
import { TunnelBorer } from '../sim/structures/Borer';
import { Smelter } from '../sim/structures/Smelter';
import { Fan, Prop, Pump } from '../sim/structures/Safety';
import { MARKER_KINDS, type Marker } from '../sim/Markers';
import { markerShape } from './MineMap';
import { Drill } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import { Sorter } from '../sim/structures/Sorter';
import { Splitter } from '../sim/structures/Splitter';
import { Storage } from '../sim/structures/Storage';
import { STRUCTURE_FACTORIES } from '../sim/structures/registry';
import type { Structure } from '../sim/structures/Structure';
import { ChunkCache } from './ChunkCache';
import { Fx } from './fx';
import { PROFILES, Quality, QualityProfile } from './quality';
import { ROPE_LAND_TIME, landLift, ropeFrame, type RopeFrame } from './ropeAnim';
import { INK, Pen, ramp } from './art';
import {
  PICK_ANGLES,
  PICK_SIZE,
  PlayerSprites,
  buildBoardSprite,
  buildCounterSprite,
  buildCrackSprites,
  buildLanternSprite,
  buildNuggetSprites,
  buildJackhammerSprites,
  buildPickaxeSprites,
  buildPlayerSprites,
  buildScooterSprites,
  SCOOTER_LIFT,
  ScooterSprites,
  buildWorkshopSprite,
} from './sprites';

export interface Overlay {
  /** Tuile visée par la pioche. */
  target: { tx: number; ty: number; ok: boolean } | null;
  /** Aperçu de construction. */
  ghost: {
    machine: string;
    tx: number;
    ty: number;
    dir: Dir;
    ok: boolean;
    link?: { tx: number; ty: number };
    /** Foreuse améliorée : cases qu'elle forera une fois posée. */
    reach?: { x: number; y: number }[];
  } | null;
  /** Structure sous le curseur en mode construction (démontage). */
  removeHint: { tx: number; ty: number } | null;
  /** Structure avec laquelle le joueur peut interagir. */
  interact: Structure | null;
  /** Foreuse dont on montre les cases forées (proche du joueur ou visée). */
  reach?: Drill | null;
}

interface Drawable {
  y: number;
  draw: () => void;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly icons = new Map<string, string>();
  private readonly light: HTMLCanvasElement;
  private readonly lctx: CanvasRenderingContext2D;
  zoom = 3;
  zoomBias = 0;
  camX = 0;
  camY = 0;
  /** Bas de l'écran caché par l'interface (px CSS) : le joueur reste centré dans ce qui reste visible. */
  bottomInset = 0;
  readonly fx = new Fx();
  /** Réglage Qualité : nombre de particules et d'effets de détail. */
  quality: Quality = 'high';
  profile: QualityProfile = PROFILES.high;
  private chunks: ChunkCache | null = null;
  private state: GameState | null = null;
  /** Le mineur habillé : une série d'images par combinaison d'équipement (créées à la demande). */
  private readonly minerSets = new Map<string, PlayerSprites>();
  private readonly picks: HTMLCanvasElement[][];
  private readonly jacks: HTMLCanvasElement[];
  private readonly nuggets: Map<string, HTMLCanvasElement>;
  private readonly cracks: HTMLCanvasElement[];
  private readonly counter: HTMLCanvasElement;
  private readonly workshop: HTMLCanvasElement;
  private penCache: Pen | null = null;
  private readonly board: HTMLCanvasElement;
  private readonly lantern: HTMLCanvasElement;
  private readonly scooter: ScooterSprites;
  private time = 0;
  /** Dernier nuage de poussière laissé par la trottinette (temps du rendu). */
  private scooterPuff = 0;
  private smokeTimer = 0;
  /** Flash rouge après une blessure (0 à 1). */
  private hurtFlash = 0;
  /** Temps restant de la petite chute qui pose le mineur à son arrivée par la corde. */
  private landT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d')!;
    this.picks = buildPickaxeSprites();
    this.jacks = buildJackhammerSprites();
    this.nuggets = buildNuggetSprites();
    this.cracks = buildCrackSprites();
    this.counter = buildCounterSprite();
    this.workshop = buildWorkshopSprite();
    this.board = buildBoardSprite();
    this.lantern = buildLanternSprite();
    this.scooter = buildScooterSprites();
    this.resize();
  }

  setState(state: GameState): void {
    this.state = state;
    this.chunks = new ChunkCache(state.world);
    this.fx.particles = [];
    this.fx.texts = [];
    this.snapCamera();
  }

  /** Pinceau sur le contexte courant (le contexte change quand on dessine une icône). */
  private get pen(): Pen {
    if (!this.penCache || this.penCache.ctx !== this.ctx) this.penCache = new Pen(this.ctx);
    return this.penCache;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.profile = PROFILES[q];
    this.fx.density = this.profile.particles;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.light.width = Math.ceil(w / 2);
      this.light.height = Math.ceil(h / 2);
    }
    const base = Math.round(h / (TILE * 16));
    this.zoom = clamp(base + this.zoomBias, 2, 9);
  }

  adjustZoom(delta: number): void {
    this.zoomBias = clamp(this.zoomBias + delta, -2, 3);
    this.resize();
  }

  get viewW(): number {
    return this.canvas.width / this.zoom;
  }

  get viewH(): number {
    return this.canvas.height / this.zoom;
  }

  snapCamera(): void {
    if (!this.state) return;
    this.camX = this.state.player.x - this.viewW / 2;
    this.camY = this.state.player.y - 8 - this.viewH / 2;
    this.clampCamera();
  }

  private clampCamera(): void {
    if (!this.state) return;
    const ww = this.state.world.w * TILE;
    const wh = this.state.world.h * TILE;
    this.camX = this.viewW >= ww ? (ww - this.viewW) / 2 : clamp(this.camX, 0, ww - this.viewW);
    this.camY = this.viewH >= wh ? (wh - this.viewH) / 2 : clamp(this.camY, 0, wh - this.viewH);
  }

  /** Caméra libre (menu principal) : centre la vue sur un point. */
  lookAt(x: number, y: number): void {
    this.camX = x - this.viewW / 2;
    this.camY = y - this.viewH / 2;
    this.clampCamera();
  }

  update(dt: number, follow = true): void {
    this.time += dt;
    this.fx.update(dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.landT = Math.max(0, this.landT - dt);
    if (!this.state) return;
    // Plafond qui craque : poussière qui tombe et sol qui tremble.
    for (const p of this.state.hazards.pending) {
      if (!this.inView(p.x * TILE, p.y * TILE, 96)) continue;
      this.fx.shake = Math.max(this.fx.shake, 0.7);
      if (Math.random() < 0.6)
        this.fx.emit('dust', (p.x + 0.5 + (Math.random() - 0.5) * 5) * TILE, (p.y + 0.5 + (Math.random() - 0.5) * 5) * TILE, 'rgba(150,130,110,0.7)', 1, 10);
    }
    if (follow) {
      const inset = (this.bottomInset * (this.canvas.width / window.innerWidth)) / this.zoom;
      const tx = this.state.player.x - this.viewW / 2;
      const ty = this.state.player.y - 8 - (this.viewH - inset) / 2;
      const k = 1 - Math.exp(-8 * dt);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.clampCamera();
    }
    // Fumée des foreuses actives.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.35;
      for (const s of this.state.structures.list)
        if (s instanceof Drill && s.status === 'ok' && this.inView(s.x * TILE, s.y * TILE, 64))
          this.fx.emit('smoke', s.x * TILE + 11, s.y * TILE + 1, 'rgba(90,90,96,0.6)', 1, 6);
        else if (s instanceof Smelter && s.status === 'ok' && this.inView(s.x * TILE, s.y * TILE, 64)) {
          const big = s.w > 1;
          for (const cx of big ? [s.x * TILE + 7, s.x * TILE + s.w * TILE - 8] : [s.x * TILE + 11])
            this.fx.emit('smoke', cx, s.y * TILE - (big ? 26 : 16), 'rgba(80,76,80,0.6)', 1, 6);
        } else if (s instanceof TunnelBorer && (s.status === 'digging' || s.status === 'moving' || s.status === 'returning')) {
          const v = this.borerVehicleXY(s);
          if (this.inView(v.x, v.y, 64)) this.fx.emit('smoke', v.x + 8 - DX[s.dir] * 5, v.y + 2 - DY[s.dir] * 5, 'rgba(90,90,96,0.6)', 1, 6);
        }
    }
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const dpr = this.canvas.width / window.innerWidth;
    return { x: (sx * dpr) / this.zoom + this.camX, y: (sy * dpr) / this.zoom + this.camY };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const dpr = this.canvas.width / window.innerWidth;
    return { x: ((x - this.camX) * this.zoom) / dpr, y: ((y - this.camY) * this.zoom) / dpr };
  }

  private inView(x: number, y: number, margin = 32): boolean {
    return x > this.camX - margin && y > this.camY - margin && x < this.camX + this.viewW + margin && y < this.camY + this.viewH + margin;
  }

  // ------------------------------------------------------------------ rendu principal

  draw(overlay: Overlay, showPlayer = true): void {
    const { ctx, canvas } = this;
    const state = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07060a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state || !this.chunks) return;
    ctx.imageSmoothingEnabled = false;

    const shakeX = this.fx.shake > 0 ? (Math.random() - 0.5) * this.fx.shake : 0;
    const shakeY = this.fx.shake > 0 ? (Math.random() - 0.5) * this.fx.shake : 0;
    const ox = Math.round((-this.camX + shakeX) * this.zoom);
    const oy = Math.round((-this.camY + shakeY) * this.zoom);
    ctx.setTransform(this.zoom, 0, 0, this.zoom, ox, oy);

    const x0 = this.camX - TILE;
    const y0 = this.camY - TILE;
    const x1 = this.camX + this.viewW + TILE;
    const y1 = this.camY + this.viewH + TILE;

    this.chunks.sync();
    this.chunks.draw(ctx, x0, y0, x1, y1);
    this.drawCracks(state);
    this.drawGroundHazards(state, x0, y0, x1, y1);

    // Voie des wagonnets (rails et quais), au ras du sol.
    for (const s of state.structures.list) {
      if (!s.isTrack || !this.inView(s.x * TILE, s.y * TILE)) continue;
      this.drawTrack(s, this.trackMask(state, s.x, s.y));
    }

    // Convoyeurs, séparateurs et pieds de ponts (niveau du sol) puis objets transportés.
    const belts: Conveyor[] = [];
    const splitters: Splitter[] = [];
    const bridges: Bridge[] = [];
    for (const s of state.structures.list) {
      if (!s.isBelt || !this.inView(s.x * TILE, s.y * TILE)) continue;
      if (s instanceof Conveyor) belts.push(s);
      else if (s instanceof Splitter) splitters.push(s);
      else if (s instanceof Bridge) bridges.push(s);
    }
    for (const b of belts) this.drawConveyor(b);
    for (const s of splitters) this.drawSplitter(s);
    for (const b of bridges) this.drawBridgeFoot(b);
    for (const b of belts) this.drawBeltItems(b);
    for (const s of splitters) this.drawSplitterItems(s);
    for (const b of bridges) for (const res of b.out.slice(0, 2)) this.ctx.drawImage(this.nuggets.get(res)!, b.x * TILE + 4, b.y * TILE + 3);

    // Objets triés par profondeur (y).
    const list: Drawable[] = [];
    for (const d of state.drops.list) {
      if (!this.inView(d.x, d.y)) continue;
      // Un tas de pierres sur le point de s'effriter clignote, de plus en plus vite.
      const left = state.drops.lifeLeft(d);
      const alpha = left < FADE_TIME && Math.floor(this.time * (left < 2 ? 12 : 6)) % 2 ? 0.3 : 1;
      list.push({
        y: d.y,
        draw: () => {
          ctx.globalAlpha = alpha;
          this.drawDrop(d.res, d.count, d.x, d.y - d.z, d.z);
          ctx.globalAlpha = 1;
        },
      });
    }
    for (const s of state.structures.list) {
      if (s.isBelt || s.isTrack || !this.inView(s.x * TILE, s.y * TILE, 64)) continue;
      list.push({ y: (s.y + s.h) * TILE - 1, draw: () => this.drawStructure(s) });
    }
    // Foreuses de percement sorties de leur base (rangées, elles sont dessinées avec la base).
    for (const b of state.structures.borers) {
      if (b.home) continue;
      const v = this.borerVehicleXY(b);
      if (this.inView(v.x, v.y, 32)) list.push({ y: v.y + TILE - 1, draw: () => this.drawBorer(b, v.x, v.y) });
    }
    for (const l of state.layout.lamps)
      if (this.inView(l.x, l.y)) list.push({ y: l.y - 8, draw: () => ctx.drawImage(this.lantern, Math.round(l.x - this.lantern.width / 2), Math.round(l.y - 4)) });
    const ent = state.layout.entrance;
    list.push({ y: ent.y * TILE, draw: () => this.drawEntrance(ent.x, ent.y, ent.w) });
    for (const w of state.wagons.list) {
      if (!this.inView(w.px(), w.py())) continue;
      // Trié juste devant le joueur à bord : le wagonnet cache ses jambes (il est assis dedans).
      list.push({ y: w.py() + 6, draw: () => this.drawWagon(w, w.px(), w.py()) });
    }
    // Repères du joueur : un petit fanion planté au milieu de la case.
    for (const m of state.markers.list) {
      if (!this.inView((m.x + 0.5) * TILE, (m.y + 0.5) * TILE, 24)) continue;
      list.push({ y: (m.y + 0.5) * TILE + 5, draw: () => this.drawMarkerFlag(m, state.markers.tracked === m.id) });
    }
    if (showPlayer) list.push({ y: state.player.y, draw: () => this.drawPlayer() });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    // Travées des ponts : au-dessus de tout ce qui est au sol (on passe dessous).
    for (const b of state.structures.list) if (b instanceof Bridge && b.target && this.inView(b.x * TILE, b.y * TILE, 6 * TILE)) this.drawBridgeSpan(b);
    this.drawGas(state, x0, y0, x1, y1);
    this.drawCaveInWarnings(state);

    this.drawParticles();
    this.drawLighting();
    this.drawHurt(state);

    // Surcouches d'interface dans le monde (au-dessus de l'obscurité).
    ctx.setTransform(this.zoom, 0, 0, this.zoom, ox, oy);
    this.drawStatusIcons(state);
    this.drawOverlay(overlay);
    this.drawTexts(ox, oy);
  }

  // ------------------------------------------------------------------ terrain

  private drawCracks(state: GameState): void {
    const w = state.world;
    for (const [i, dmg] of w.damage) {
      const tx = i % w.w;
      const ty = (i / w.w) | 0;
      if (!this.inView(tx * TILE, ty * TILE)) continue;
      const hp = getBlock(w.tiles[i]).hp || 1;
      const stage = Math.min(3, Math.floor((dmg / hp) * 4));
      this.ctx.drawImage(this.cracks[stage], tx * TILE, ty * TILE);
    }
  }

  private drawEntrance(x: number, y: number, w: number): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const left = x * TILE - 3;
    const right = (x + w) * TILE + 1;
    const top = y * TILE - 14;
    // Montants de bois veinés, posés sur des pierres.
    for (const px of [left, right]) {
      pen.rect(px - 1, top - 1, 6, 19, INK);
      pen.rect(px, top, 4, 15, '#5a3a22');
      pen.rect(px, top, 1, 15, '#8a5f38');
      pen.rect(px + 3, top, 1, 15, '#3a2414');
      pen.px(px + 1, top + 6, '#3a2414');
      pen.px(px + 2, top + 10, '#7a4f2e');
      pen.rect(px - 1, top + 14, 6, 3, '#6f695f');
      pen.rect(px - 1, top + 14, 6, 1, '#a39b8c');
    }
    // Linteau et goussets en biais.
    pen.rect(left - 3, top - 4, right - left + 10, 7, INK);
    pen.rect(left - 2, top - 3, right - left + 8, 5, '#7a5231');
    pen.rect(left - 2, top - 3, right - left + 8, 1, '#b07a44');
    pen.rect(left - 2, top + 1, right - left + 8, 1, '#4a2f1a');
    for (let k = 0; k < 4; k++) {
      pen.px(left + 4 + k, top + 2 + k, '#5a3a22');
      pen.px(left + 4 + k, top + 1 + k, '#7a5231');
      pen.px(right - k, top + 2 + k, '#5a3a22');
      pen.px(right - k, top + 1 + k, '#7a5231');
    }
    // Panneau suspendu par deux chaînes, planche cloutée.
    const sx = left + 6;
    const sw = right - left - 8;
    pen.rect(sx + 2, top - 8, 1, 5, '#8a8e99');
    pen.rect(sx + sw - 3, top - 8, 1, 5, '#8a8e99');
    pen.rect(sx - 1, top - 13, sw + 2, 10, INK);
    pen.rect(sx, top - 12, sw, 8, '#3b2616');
    pen.rect(sx, top - 12, sw, 1, '#6a4526');
    pen.rect(sx, top - 5, sw, 1, '#22150c');
    pen.rivet(sx + 1, top - 6, '#b4b9c4');
    pen.rivet(sx + sw - 2, top - 6, '#b4b9c4');
    ctx.fillStyle = '#e8c88a';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MINE', (left + right + 4) / 2, top - 7.5);
  }

  // ------------------------------------------------------------------ objets

  private drawDrop(res: string, count: number, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    const img = this.nuggets.get(res)!;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(x - 3), Math.round(y + z + 1), 6, 2);
    const bob = z === 0 ? Math.round(Math.sin(this.time * 3 + x) * 0.6) : 0;
    const n = Math.min(3, count);
    const offs = [
      [0, 0],
      [-3, 1],
      [3, 1],
    ];
    for (let i = n - 1; i >= 0; i--) ctx.drawImage(img, Math.round(x - 3.5 + offs[i][0]), Math.round(y - 5 + offs[i][1] + bob));
  }

  private beltItemPos(b: Conveyor, p: number, from: Dir): { x: number; y: number } {
    const cx = (b.x + 0.5) * TILE;
    const cy = (b.y + 0.5) * TILE;
    if (p >= 0.5) {
      const t = (p - 0.5) * 2;
      return { x: cx + DX[b.dir] * 8 * t, y: cy + DY[b.dir] * 8 * t };
    }
    const t = 1 - p * 2;
    return { x: cx - DX[from] * 8 * t, y: cy - DY[from] * 8 * t };
  }

  private drawConveyor(b: Conveyor): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const rail = ramp(b.def.accent ?? '#7d7e89');
    const x = b.x * TILE;
    const y = b.y * TILE;
    const stuck = b.blocked && b.items.length >= b.capacity;
    ctx.save();
    ctx.translate(x + 8, y + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    // Châssis (orienté vers +x) : cadre sombre, bande creusée, deux rails biseautés.
    pen.rect(-8, -7, 16, 14, '#1b1a20');
    pen.rect(-8, -5, 16, 10, '#3a3a44');
    pen.rect(-8, -5, 16, 1, '#2a2a32'); // ombre du rail du haut sur la bande
    pen.rect(-8, 4, 16, 1, '#4a4a56'); // reflet du bord du bas
    // Lattes qui défilent : un trait sombre suivi d'un reflet.
    const off = stuck ? 0 : (this.time * b.speed * 16) % 4;
    for (let k = -3; k < 3; k++) {
      const xx = Math.round(-8 + k * 4 + off);
      if (xx >= -6 && xx < 6) {
        pen.rect(xx, -4, 1, 8, '#2b2b33');
        pen.rect(xx + 1, -4, 1, 8, '#4b4b58');
      }
    }
    // Rails latéraux à la couleur du niveau, avec rivets.
    pen.rect(-8, -7, 16, 1, rail.hi);
    pen.rect(-8, -6, 16, 1, rail.base);
    pen.rect(-8, 5, 16, 1, rail.shade);
    pen.rect(-8, 6, 16, 1, rail.dark);
    for (let k = -6; k < 8; k += 4) {
      pen.px(k, -6, rail.dark);
      pen.px(k, 5, rail.light);
    }
    // Chevron central indiquant la direction.
    const chev = Math.round(((this.time * b.speed * 16) % 16) - 8);
    ctx.fillStyle = b.blocked ? '#b8603f' : '#a9abb6';
    for (let r = 0; r < 3; r++) {
      const xx = (stuck ? 0 : chev) + r - 1;
      if (xx >= -6 && xx < 6) {
        ctx.fillRect(xx, -3 + r, 1, 1);
        ctx.fillRect(xx, 2 - r, 1, 1);
      }
    }
    // Rouleaux aux extrémités.
    pen.tube(-8, -5, 2, 10, '#8d8e99');
    pen.tube(6, -5, 2, 10, '#8d8e99');
    ctx.restore();
  }

  /** Côtés (bits 1 << dir) raccordés à une autre pièce de voie. */
  private trackMask(state: GameState, x: number, y: number): number {
    let m = 0;
    for (let d = 0; d < 4; d++) if (state.structures.at(x + DX[d], y + DY[d])?.isTrack) m |= 1 << d;
    return m;
  }

  /** Rails (traverses en bois, deux rails d'acier) raccordés à leurs voisins ; quai = plateforme colorée. */
  private drawTrack(s: Structure, mask: number): void {
    const ctx = this.ctx;
    const x = s.x * TILE;
    const y = s.y * TILE;
    if (s instanceof RailStation) {
      // Plateforme en planches, bordée de vert (chargement) ou d'orange (déchargement).
      const color = s.mode === 'load' ? '#6fcf6a' : '#f0a33a';
      ctx.fillStyle = '#6e4c2f';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#8a5f38';
      for (let k = 0; k < TILE; k += 4) ctx.fillRect(x, y + k, TILE, 3);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
      ctx.fillRect(x + TILE - 1, y, 1, TILE);
    }
    const dirs = mask ? [0, 1, 2, 3].filter((d) => mask & (1 << d)) : [0, 2];
    const pen = this.pen;
    for (const d of dirs) {
      ctx.save();
      ctx.translate(x + 8, y + 8);
      ctx.rotate((d * Math.PI) / 2);
      // Lit de gravier sombre, traverses de bois veinées, puis deux rails d'acier bien contrastés.
      pen.rect(-1, -7, 9, 14, 'rgba(24,16,12,0.28)');
      for (const sx of [0, 5]) {
        pen.rect(sx, -6, 3, 12, '#2e1f14');
        pen.rect(sx, -6, 3, 1, '#6a4526');
        pen.rect(sx, -5, 1, 10, '#4a3020');
        pen.px(sx + 1, -1, '#3a2618');
        pen.px(sx + 2, 3, '#3a2618');
      }
      pen.rect(-2, -5, 10, 1, '#1a1418');
      pen.rect(-2, 2, 10, 1, '#1a1418');
      pen.rect(-2, -4, 10, 1, '#e6e9ef');
      pen.rect(-2, 3, 10, 1, '#e6e9ef');
      pen.rect(-2, -3, 10, 1, '#7a808a');
      pen.rect(-2, 4, 10, 1, '#7a808a');
      // Crampons aux croisements traverse / rail.
      for (const sx of [1, 6]) {
        pen.px(sx, -4, '#3a3d47');
        pen.px(sx, 3, '#3a3d47');
      }
      ctx.restore();
    }
    if (s instanceof RailSwitch) this.drawSwitchMarks(s, mask);
    if (s instanceof RailStation) {
      // Pastille : flèche montante (charge) ou descendante (décharge) et jauge du tampon.
      const color = s.mode === 'load' ? '#6fcf6a' : '#f0a33a';
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(x + 10, y - 7, 7, 7);
      ctx.fillStyle = color;
      ctx.fillRect(x + 11, y - 6, 5, 5);
      ctx.fillStyle = '#1a1418';
      if (s.mode === 'load') {
        ctx.fillRect(x + 13, y - 5, 1, 3);
        ctx.fillRect(x + 12, y - 4, 3, 1);
      } else {
        ctx.fillRect(x + 13, y - 5, 1, 3);
        ctx.fillRect(x + 12, y - 3, 3, 1);
      }
      const fill = s.weight() / s.capacity;
      if (fill > 0) {
        ctx.fillStyle = '#1a1418';
        ctx.fillRect(x + 1, y + 13, 14, 2);
        ctx.fillStyle = fill > 0.9 ? '#d0342c' : color;
        ctx.fillRect(x + 1, y + 13, Math.max(1, Math.round(14 * Math.min(1, fill))), 2);
      }
    }
  }

  /** Aiguillage : repère sur la pointe, levier et flèche vers la branche que prendra le prochain wagonnet. */
  private drawSwitchMarks(s: RailSwitch, mask: number): void {
    const ctx = this.ctx;
    const cx = s.x * TILE + 8;
    const cy = s.y * TILE + 8;
    const connected = (d: Dir) => !!(mask & (1 << d));
    // Pointe : petit triangle blanc côté arrivée.
    const tip = ((s.dir + 2) % 4) as Dir;
    ctx.fillStyle = '#f2e6c8';
    ctx.save();
    ctx.translate(cx + DX[tip] * 6, cy + DY[tip] * 6);
    ctx.rotate((s.dir * Math.PI) / 2);
    ctx.fillRect(-1, -2, 1, 5);
    ctx.fillRect(0, -1, 1, 3);
    ctx.fillRect(1, 0, 1, 1);
    ctx.restore();
    // Levier (boîtier) et flèche vers la branche active.
    const next = s.nextBranch(connected);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
    ctx.fillStyle = s.setting === 'alt' ? (Math.floor(this.time * 2) % 2 ? '#f0a33a' : '#f2c230') : '#f2c230';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    if (next) this.drawArrow(cx + DX[s.side(next)] * 5, cy + DY[s.side(next)] * 5, s.side(next), '#f2c230');
  }

  /** Wagonnet : caisse d'acier sur roues, avec un tas de minerai proportionnel au chargement. */
  private drawWagon(w: Wagon | null, cx: number, cy: number): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = Math.round(cx - 7);
    const y = Math.round(cy - 7);
    pen.shadow(x, y + 12, 14, 0.35);
    // Roues (moyeu clair) puis caisse d'acier rivetée, arêtes éclairées.
    for (const wx of [x + 1, x + 10]) {
      pen.rect(wx - 1, y + 9, 5, 5, INK);
      pen.rect(wx, y + 10, 3, 3, '#3a3d47');
      pen.px(wx + 1, y + 11, '#b4b9c4');
    }
    pen.slab(x, y + 2, 14, 9, '#5d6470');
    pen.rect(x, y + 8, 14, 1, '#3f444e');
    for (const rx of [x + 2, x + 6, x + 11]) pen.px(rx, y + 5, '#2d3038');
    pen.rect(x + 3, y + 5, 1, 4, '#8a909c');
    pen.rect(x + 10, y + 5, 1, 4, '#8a909c');
    pen.rect(x - 1, y + 1, 16, 2, '#8a909c');
    pen.rect(x - 1, y + 1, 16, 1, '#d0d4dc');
    // Chargement
    if (w && !w.isEmpty()) {
      const entries = Object.entries(w.cargo).sort((a, b) => b[1] - a[1]);
      const fill = Math.min(1, w.weight() / w.capacity);
      const n = Math.max(1, Math.round(fill * 5));
      const spots = [
        [4, 0],
        [7, -1],
        [1, 1],
        [9, 1],
        [5, -3],
      ];
      for (let k = 0; k < n; k++) {
        const res = entries[k % entries.length][0];
        ctx.drawImage(this.nuggets.get(res)!, x + spots[k][0], y + spots[k][1]);
      }
    }
  }

  /** Séparateur : bande courte sous un carter jaune, flèches vers les trois sorties. */
  private drawSplitter(s: Splitter): void {
    const ctx = this.ctx;
    const pen = this.pen;
    ctx.save();
    ctx.translate(s.x * TILE + 8, s.y * TILE + 8);
    ctx.rotate((s.dir * Math.PI) / 2);
    pen.rect(-8, -8, 16, 16, '#1b1a20');
    pen.rect(-7, -7, 14, 14, '#3a3a44');
    pen.rect(-7, -7, 14, 1, '#2a2a32');
    // Carter à la couleur du modèle, boulonné, avec trois fentes de sortie.
    pen.slab(-3, -8, 6, 16, s.def.accent ?? '#e0b84a', false);
    for (let k = -6; k <= 6; k += 4) {
      pen.rect(-1, k, 2, 2, '#26221e');
      pen.px(-1, k, '#5a4a30');
    }
    pen.rivet(-2, -6, '#cfd3dc');
    pen.rivet(1, 6, '#cfd3dc');
    ctx.restore();
    if (s instanceof Sorter) {
      // Trieur : les minerais choisis au centre, flèche verte vers l'avant, flèches grises sur les côtés.
      const [front, left, right] = s.outputs();
      const chosen = s.filters.length > 0;
      this.drawArrow(s.x * TILE + 8 + DX[front] * 6, s.y * TILE + 8 + DY[front] * 6, front, chosen ? '#7dffa0' : '#f2e6c8');
      if (chosen) for (const d of [left, right]) this.drawArrow(s.x * TILE + 8 + DX[d] * 6, s.y * TILE + 8 + DY[d] * 6, d, '#a8957c');
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(s.x * TILE + 4, s.y * TILE + 4, 8, 8);
      if (s.filters.length === 1) ctx.drawImage(this.nuggets.get(s.filters[0])!, s.x * TILE + 4, s.y * TILE + 4);
      else if (chosen) this.drawSorterSwatches(s.x * TILE, s.y * TILE, s.filters);
      else {
        ctx.fillStyle = '#f2e6c8';
        ctx.fillRect(s.x * TILE + 7, s.y * TILE + 6, 2, 3);
        ctx.fillRect(s.x * TILE + 7, s.y * TILE + 10, 2, 1);
      }
      return;
    }
    // Petites flèches sur les trois sorties
    for (const d of s.outputs()) this.drawArrow(s.x * TILE + 8 + DX[d] * 6, s.y * TILE + 8 + DY[d] * 6, d, '#f2e6c8');
  }

  private drawSplitterItems(s: Splitter): void {
    const cx = (s.x + 0.5) * TILE;
    const cy = (s.y + 0.5) * TILE;
    for (const it of s.items) {
      let x: number;
      let y: number;
      if (it.p < 0.5) {
        const t = 1 - it.p * 2;
        x = cx - DX[s.dir] * 8 * t;
        y = cy - DY[s.dir] * 8 * t;
      } else {
        const out = it.out === -1 ? s.dir : it.out;
        const t = (it.p - 0.5) * 2;
        x = cx + DX[out] * 8 * t;
        y = cy + DY[out] * 8 * t;
      }
      this.ctx.drawImage(this.nuggets.get(it.res)!, Math.round(x - 3.5), Math.round(y - 4.5));
    }
  }

  /** Pied de pont : rampe qui monte (entrée) ou descend (sortie) dans le sens du transport. */
  private drawBridgeFoot(b: Bridge): void {
    const ctx = this.ctx;
    const pen = this.pen;
    ctx.save();
    ctx.translate(b.x * TILE + 8, b.y * TILE + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    pen.rect(-8, -7, 16, 14, '#1b1a20');
    pen.rect(-8, -7, 16, 1, '#a0a3ad');
    pen.rect(-8, -6, 16, 1, '#7d7e89');
    pen.rect(-8, 5, 16, 1, '#565964');
    pen.rect(-8, 6, 16, 1, '#3a3d47');
    // Rampe en planches, plus claire du côté haut
    const up = b.source ? -1 : 1; // sortie : la rampe descend dans le sens du transport
    for (let k = 0; k < 4; k++) {
      const shade = up > 0 ? 0.6 + k * 0.13 : 1 - k * 0.13;
      ctx.fillStyle = `rgb(${Math.round(138 * shade)},${Math.round(95 * shade)},${Math.round(56 * shade)})`;
      ctx.fillRect(-7 + k * 4, -5, 3, 10);
      pen.rect(-7 + k * 4, -5, 3, 1, `rgb(${Math.round(190 * shade)},${Math.round(140 * shade)},${Math.round(90 * shade)})`);
      pen.rect(-4 + k * 4, -5, 1, 10, '#2e1f14');
    }
    pen.rect(up > 0 ? 5 : -7, -7, 2, 14, '#4a3020');
    pen.rect(up > 0 ? 5 : -7, -6, 1, 12, '#6e4a2c');
    ctx.restore();
    if (!b.target && !b.source) this.drawArrow(b.x * TILE + 8 + DX[b.dir] * 5, b.y * TILE + 8 + DY[b.dir] * 5, b.dir, '#f2e6c8');
  }

  /** Travée surélevée entre un pont d'entrée et sa sortie, avec le minerai qui la parcourt. */
  private drawBridgeSpan(b: Bridge): void {
    const t = b.target!;
    const ctx = this.ctx;
    const LIFT = 6;
    const x0 = (b.x + 0.5) * TILE;
    const y0 = (b.y + 0.5) * TILE;
    const x1 = (t.x + 0.5) * TILE;
    const y1 = (t.y + 0.5) * TILE;
    const horiz = b.dir === 0 || b.dir === 2;
    const minX = Math.min(x0, x1);
    const minY = Math.min(y0, y1);
    const len = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
    // Ombre au sol
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    if (horiz) ctx.fillRect(minX, y0 - 3, len, 7);
    else ctx.fillRect(x0 - 3, minY, 7, len);
    // Tablier
    if (horiz) {
      const y = y0 - LIFT;
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(minX, y - 5, len, 10);
      ctx.fillStyle = '#8a5f38';
      for (let x = minX + 1; x < minX + len - 1; x += 3) ctx.fillRect(x, y - 4, 2, 8);
      ctx.fillStyle = '#6a6b74';
      ctx.fillRect(minX, y - 5, len, 1);
      ctx.fillRect(minX, y + 4, len, 1);
      ctx.fillStyle = '#2e1f14';
      ctx.fillRect(minX, y + 5, len, 2);
    } else {
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(x0 - 5, minY - LIFT, 10, len);
      ctx.fillStyle = '#8a5f38';
      for (let y = minY - LIFT + 1; y < minY - LIFT + len - 1; y += 3) ctx.fillRect(x0 - 4, y, 8, 2);
      ctx.fillStyle = '#6a6b74';
      ctx.fillRect(x0 - 5, minY - LIFT, 1, len);
      ctx.fillRect(x0 + 4, minY - LIFT, 1, len);
      ctx.fillStyle = '#2e1f14';
      ctx.fillRect(x0 - 5, minY - LIFT + len, 10, 2);
    }
    // Minerai en transit
    const T = b.travelTime() || 1;
    for (const it of b.transit) {
      const k = Math.min(1, it.t / T);
      const x = x0 + (x1 - x0) * k;
      const y = y0 + (y1 - y0) * k - LIFT;
      ctx.drawImage(this.nuggets.get(it.res)!, Math.round(x - 3.5), Math.round(y - 4.5));
    }
  }

  private drawBeltItems(b: Conveyor): void {
    for (const it of b.items) {
      const pos = this.beltItemPos(b, it.p, it.from);
      this.ctx.drawImage(this.nuggets.get(it.res)!, Math.round(pos.x - 3.5), Math.round(pos.y - 4.5));
    }
  }

  private drawStructure(s: Structure): void {
    if (s instanceof Drill) this.drawDrill(s);
    else if (s instanceof TunnelBorer) {
      this.drawBorerBase(s);
      if (s.home) this.drawBorer(s, s.x * TILE, s.y * TILE);
    }
    else if (s instanceof Smelter) this.drawSmelter(s);
    else if (s instanceof Prop) this.drawProp(s);
    else if (s instanceof Fan) this.drawFan(s);
    else if (s instanceof Pump) this.drawPump(s);
    else if (s instanceof Storage) this.drawStorage(s);
    else if (s instanceof ShippingCrate) this.drawShipping(s);
    else if (s instanceof Building) this.drawBuilding(s);
  }

  private drawBuilding(b: Building): void {
    const img = b.type === 'counter' ? this.counter : b.type === 'workshop' ? this.workshop : this.board;
    const x = b.x * TILE;
    const y = (b.y + b.h) * TILE - img.height;
    this.ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.ctx.fillRect(x + 2, (b.y + b.h) * TILE - 2, b.w * TILE - 2, 3);
    this.ctx.drawImage(img, x, y);
    if (b.type === 'workshop' && Math.random() < 0.04)
      this.fx.emit('smoke', x + img.width - 9, y + 1, 'rgba(120,120,130,0.5)', 1, 4);
  }

  private drawDrill(d: Drill): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = d.x * TILE;
    const y = d.y * TILE;
    const active = d.status === 'ok';
    const jig = active ? Math.round(Math.sin(this.time * 40) * 0.5) : 0;
    if (d.level > 1) this.drawDrillHeads(d);
    pen.shadow(x + 1, y + 13, 15);
    // Socle d'acier boulonné.
    pen.slab(x + 1, y + 10, 14, 5, '#3f4049');
    pen.rivet(x + 3, y + 13);
    pen.rivet(x + 12, y + 13);
    // Carter jaune : arêtes éclairées en haut à gauche, ombré en bas à droite.
    pen.slab(x + 2, y + jig, 12, 11, '#e2ac2a');
    // Bandes de danger en biais, en bas du carter.
    for (let k = 0; k < 6; k++) {
      pen.px(x + 3 + k * 2, y + 9 + jig, '#26221e');
      pen.px(x + 4 + k * 2, y + 8 + jig, '#26221e');
    }
    // Hublot du mécanisme : engrenage qui tourne, éclairé de l'intérieur quand la foreuse tourne.
    pen.rect(x + 4, y + 1 + jig, 8, 7, INK);
    pen.rect(x + 5, y + 2 + jig, 6, 5, active ? '#5a4a30' : '#3a3b42');
    const a = d.activeTime * 7;
    const cx = x + 8;
    const cy = y + 4 + jig;
    ctx.fillStyle = '#b4b9c4';
    for (let k = 0; k < 4; k++) {
      const aa = a + (k * Math.PI) / 2;
      ctx.fillRect(Math.round(cx + Math.cos(aa) * 2) - 1, Math.round(cy + Math.sin(aa) * 2) - 1, 2, 2);
    }
    pen.rect(cx - 1, cy - 1, 2, 2, '#5b5f68');
    pen.px(cx, cy, '#e3e7f0');
    // Voyant d'état : vert en marche, rouge sans charbon, orange si bloquée.
    const lamp = d.status === 'ok' ? '#6fe08a' : d.status === 'nofuel' ? '#e0483c' : '#f0a33a';
    const lit = d.status !== 'ok' || !this.profile.detail || Math.floor(this.time * 3) % 4 !== 0;
    pen.px(x + 3, y + 2 + jig, lit ? lamp : '#3a3b42');
    // Échelons d'amélioration : une pastille par niveau au-dessus du premier.
    for (let k = 1; k < d.level; k++) pen.px(x + 12 - (k - 1) * 2, y + 2 + jig, '#fff3b0');
    // Pot d'échappement chromé.
    pen.tube(x + 11, y - 3 + jig, 3, 5, '#7d818b');
    pen.rect(x + 10, y - 4 + jig, 5, 1, INK);
    pen.rect(x + 11, y - 4 + jig, 3, 1, '#b4b9c4');
    // Flèche de sortie
    this.drawArrow(x + 8 + DX[d.dir] * 6, y + 8 + DY[d.dir] * 6, d.dir, '#ffffff');
    // Jauge de combustible
    const fuel = d.fuelSeconds() / (d.fuelMax * (d.def.fuel?.secondsPerUnit ?? 1));
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fuel > 0.2 ? '#f08a24' : '#d0342c';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fuel)), 2);
    if (active) {
      if (Math.random() < 0.15) this.fx.emit('dust', x + 8, y + 13, 'rgba(160,140,120,0.5)', 1, 10);
      if (Math.random() < 0.12) this.fx.emit('smoke', x + 12.5, y - 5, 'rgba(120,120,128,0.55)', 1, 6);
    }
  }

  /** Position (coin haut gauche, unités monde) de la foreuse d'une foreuse de percement, trajet compris. */
  private borerVehicleXY(b: TunnelBorer): { x: number; y: number } {
    const k = b.vehiclePos();
    return { x: Math.round((b.x + DX[b.dir] * k) * TILE), y: Math.round((b.y + DY[b.dir] * k) * TILE) };
  }

  /**
   * Base d'une foreuse de percement : dalle d'acier avec la sortie balisée du côté de la flèche,
   * trémie à charbon à l'arrière (niveau visible) et jauge de la réserve.
   */
  private drawBorerBase(b: TunnelBorer): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = b.x * TILE;
    const y = b.y * TILE;
    pen.shadow(x, y + 14, 16, 0.3);
    // Dalle d'acier boulonnée.
    pen.slab(x + 1, y + 3, 14, 12, '#474852');
    for (const [bx, by] of [[3, 5], [12, 5], [3, 13], [12, 13]]) pen.rivet(x + bx, y + by, '#8a8e99');
    // Sortie balisée (bandes jaunes et noires) sur le bord de la flèche.
    ctx.save();
    ctx.translate(x + 8, y + 9);
    ctx.rotate((b.dir * Math.PI) / 2);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k % 2 ? '#1a1418' : '#f2c230';
      ctx.fillRect(5, -6 + k * 2, 2, 2);
    }
    // Foreuse sortie : flèche peinte au sol.
    if (!b.home) {
      ctx.fillStyle = '#b89a3a';
      ctx.fillRect(-4, -1, 6, 2);
      ctx.fillRect(1, -3, 1, 6);
      ctx.fillRect(2, -2, 1, 4);
    }
    ctx.restore();
    // Trémie à charbon, au fond de la dalle : bac d'acier, niveau visible.
    pen.slab(x + 3, y - 4, 10, 8, '#6f717c');
    pen.rect(x + 5, y - 3, 6, 4, '#25252b');
    const fill = b.fuelMax ? b.fuelUnits / b.fuelMax : 0;
    if (fill > 0) {
      const h = Math.max(1, Math.round(4 * fill));
      pen.rect(x + 5, y + 1 - h, 6, h, '#0e0d10');
      pen.px(x + 6, y + 1 - h, '#5a5a66');
      pen.px(x + 9, y + 1 - h, '#5a5a66');
    }
    // Jauge de la réserve.
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fill > 0.2 ? '#f08a24' : '#d0342c';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fill)), 2);
    // Minerai ramené par la benne : petit tas sur la dalle, du côté opposé à la sortie.
    const stored = Object.keys(b.store);
    if (stored.length) {
      const n = Math.min(5, Math.ceil((b.storeCount() / b.spec.store) * 5));
      const cx = x + 8 - DX[b.dir] * 5;
      const cy = y + 10 - DY[b.dir] * 4;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = INK;
        ctx.fillRect(cx - 3 + (k % 3) * 2, cy - Math.floor(k / 3) * 2, 3, 3);
        ctx.fillStyle = getResource(stored[k % stored.length]).color;
        ctx.fillRect(cx - 2 + (k % 3) * 2, cy + 1 - Math.floor(k / 3) * 2, 2, 1);
      }
    }
  }

  /** Foreuse de percement : caisson sur chenilles, tête de coupe rotative du côté de sa flèche. */
  private drawBorer(b: TunnelBorer, x: number, y: number): void {
    const ctx = this.ctx;
    const digging = b.status === 'digging';
    const rolling = b.status === 'moving' || b.status === 'returning';
    const working = digging || rolling;
    const jig = digging ? Math.round(Math.sin(this.time * 45) * 0.5) : 0;
    // Ombre, chenilles (les maillons défilent quand elle roule, à l'envers au retour).
    const pen = this.pen;
    pen.shadow(x + 1, y + 13, 15);
    pen.rect(x + 1, y + 9, 14, 6, INK);
    pen.rect(x + 2, y + 10, 12, 4, '#33333b');
    pen.rect(x + 2, y + 10, 12, 1, '#4a4a54');
    const roll = rolling ? (((b.status === 'returning' ? -1 : 1) * Math.floor(this.time * 12)) % 3 + 3) % 3 : 0;
    for (let k = roll; k < 12; k += 3) {
      pen.px(x + 2 + k, y + 11, '#6a6a76');
      pen.px(x + 2 + k, y + 13, '#6a6a76');
    }
    for (const wx of [3, 7, 11]) pen.rect(x + wx, y + 12, 2, 1, '#8a8e99');
    // Caisson rouge éclairé d'en haut à gauche.
    pen.slab(x + 2, y + 1 + jig, 12, 10, '#cc4a30');
    // Cabine vitrée, feu de travail, bandes de danger.
    pen.rect(x + 4, y + 2 + jig, 8, 5, INK);
    pen.rect(x + 5, y + 3 + jig, 6, 3, working ? '#5a4a26' : '#26323f');
    pen.px(x + 5, y + 3 + jig, working ? '#ffe28a' : '#6a8aaa');
    pen.px(x + 6, y + 3 + jig, working ? '#ffd060' : '#4a6a8a');
    if (working) pen.rect(x + 7, y + 5 + jig, 3, 1, '#a87a20');
    for (let k = 0; k < 6; k++) pen.px(x + 3 + k * 2, y + 9 + jig, k % 2 ? '#26221e' : '#f2c230');
    // Gyrophare qui clignote quand elle travaille.
    const beacon = working && (!this.profile.detail || Math.floor(this.time * 4) % 2 === 0);
    pen.px(x + 13, y + jig, beacon ? '#ffb040' : '#6a4a20');
    // Moteur renforcé (niveau 2+) : pot d'échappement chromé sur le caisson.
    if (b.level >= 2) {
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(x + 11, y - 3 + jig, 3, 5);
      ctx.fillStyle = '#c7ccd6';
      ctx.fillRect(x + 12, y - 3 + jig, 1, 4);
      ctx.fillStyle = '#8a8c96';
      ctx.fillRect(x + 11, y - 3 + jig, 3, 1);
    }
    // Benne à minerai (niveau 4) : bac sur le caisson, rempli de la couleur du minerai ramassé.
    if (b.stats.hopper) {
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(x + 2, y - 2 + jig, 8, 4);
      ctx.fillStyle = '#5b5d66';
      ctx.fillRect(x + 3, y - 1 + jig, 6, 2);
      const ores = Object.keys(b.load);
      const shown = Math.min(6, Math.ceil((b.loadCount() / b.stats.hopper) * 6));
      for (let k = 0; k < shown; k++) {
        ctx.fillStyle = getResource(ores[k % ores.length]).color;
        ctx.fillRect(x + 3 + k, y - 1 + jig - (k % 2), 1, 1 + (k % 2));
      }
    }
    // Tête de coupe : dessinée vers l'est puis tournée d'un quart de tour (pixels nets).
    ctx.save();
    ctx.translate(x + 8, y + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    const phase = working ? Math.floor(b.activeTime * 18) : 0;
    // Tête large (niveau 3+) : une barre porte deux fraises qui mordent dans les cases voisines.
    if (b.stats.width > 1) {
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(4, -21, 4, 42);
      ctx.fillStyle = '#4a4b52';
      ctx.fillRect(5, -20, 1, 40);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = (k + phase) % 2 ? '#c7ccd6' : '#6a6f78';
          ctx.fillRect(7 + jig, side * 11 - 5 + k * 2, 3, 2);
          if ((k + phase) % 2) ctx.fillRect(10 + jig, side * 11 - 5 + k * 2, 1, 1);
        }
      }
    }
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(4, -7, 6, 14);
    ctx.fillStyle = '#4a4b52';
    ctx.fillRect(4, -2, 2, 4);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = (k + phase) % 2 ? '#c7ccd6' : '#6a6f78';
      ctx.fillRect(6 + jig, -6 + k * 2, 3, 2);
      if ((k + phase) % 2) ctx.fillRect(9 + jig, -6 + k * 2, 1, 1); // dents
    }
    ctx.restore();
    if (digging && Math.random() < 0.3) {
      const fx = x + 8 + DX[b.dir] * 10;
      const fy = y + 8 + DY[b.dir] * 10;
      this.fx.emit('dust', fx, fy, 'rgba(160,140,120,0.5)', 1, 14);
      if (Math.random() < 0.3) this.fx.emit('spark', fx, fy, '#ffe28a', 1, 40);
    }
  }

  /**
   * Têtes de forage des niveaux 2 et 3 : un bras et un foret qui mordent dans
   * chaque case voisine couverte. Le foret tourne quand il a un gisement à forer.
   */
  private drawDrillHeads(d: Drill): void {
    const ctx = this.ctx;
    const state = this.state;
    for (const t of d.reach()) {
      if (t.side === 'under') continue;
      const ddx = t.x - d.x;
      const ddy = t.y - d.y;
      const live = !!state && d.status === 'ok' && d.canDrill(t, state);
      const phase = live ? Math.floor(d.activeTime * 14) : 0;
      ctx.save();
      // Dessiné vers l'est puis tourné d'un quart de tour : les pixels restent nets.
      ctx.translate(d.x * TILE + 8, d.y * TILE + 8);
      ctx.rotate(Math.atan2(ddy, ddx));
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(6, 1, 9, 2);
      ctx.fillStyle = '#4a4b52';
      ctx.fillRect(5, -1, 5, 3);
      ctx.fillStyle = '#6a6b72';
      ctx.fillRect(5, -1, 5, 1);
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(9, -4, 4, 8);
      ctx.fillRect(12, -3, 3, 6);
      ctx.fillRect(14, -2, 2, 4);
      const cols: [number, number][] = [[-3, 6], [-3, 6], [-2, 4], [-2, 4], [-1, 2]];
      cols.forEach(([y0, h], k) => {
        ctx.fillStyle = (k + phase) % 2 ? '#c7ccd6' : live ? '#7a808c' : '#5f646e';
        ctx.fillRect(10 + k, y0, 1, h);
      });
      ctx.restore();
      if (live && Math.random() < 0.06)
        this.fx.emit('dust', (d.x + 0.5 + ddx * 0.8) * TILE, (d.y + 0.5 + ddy * 0.8) * TILE, 'rgba(160,140,120,0.5)', 1, 10);
    }
  }

  /** Cases forées par une foreuse : coins verts si elles ont un gisement, gris sinon. */
  private drawReach(d: Drill): void {
    const state = this.state;
    if (state) this.drawReachTiles(d.reach(), (t) => d.canDrill(t, state));
  }

  /** Coins autour de chaque case ; `live` dit si la case a quelque chose à forer. */
  private drawReachTiles<T extends { x: number; y: number }>(tiles: T[], live: (t: T) => boolean): void {
    const ctx = this.ctx;
    const pulse = 0.6 + Math.sin(this.time * 5) * 0.25;
    const L = 4;
    for (const t of tiles) {
      const on = live(t);
      const x = t.x * TILE;
      const y = t.y * TILE;
      if (on) {
        ctx.fillStyle = 'rgba(125,255,160,0.1)';
        ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      }
      ctx.fillStyle = on ? `rgba(125,255,160,${pulse})` : `rgba(168,149,124,${pulse * 0.8})`;
      for (const [cx, cy, sx, sy] of [
        [x, y, 1, 1],
        [x + TILE - 1, y, -1, 1],
        [x, y + TILE - 1, 1, -1],
        [x + TILE - 1, y + TILE - 1, -1, -1],
      ]) {
        ctx.fillRect(sx > 0 ? cx : cx - L + 1, cy, L, 1);
        ctx.fillRect(cx, sy > 0 ? cy : cy - L + 1, 1, L);
      }
    }
  }

  /**
   * Plusieurs minerais choisis : une pastille de 3 × 3 pixels de la couleur de chacun (2 en rangée, 3 en
   * triangle, 4 en carré ; au-delà de 4, la quatrième est un « + »), dans le cadre sombre du trieur.
   */
  private drawSorterSwatches(x: number, y: number, chosen: string[]): void {
    const ctx = this.ctx;
    const n = chosen.length;
    const cells: [number, number][] =
      n === 2 ? [[4, 6], [8, 6]] : n === 3 ? [[4, 4], [8, 4], [6, 8]] : [[4, 4], [8, 4], [4, 8], [8, 8]];
    cells.forEach(([cx, cy], i) => {
      const px = x + cx;
      const py = y + cy;
      if (i === 3 && n > 4) {
        ctx.fillStyle = '#f2e6c8';
        ctx.fillRect(px + 1, py, 1, 3);
        ctx.fillRect(px, py + 1, 3, 1);
        return;
      }
      const r = getResource(chosen[i]);
      ctx.fillStyle = r.color;
      ctx.fillRect(px, py, 3, 3);
      ctx.fillStyle = r.light;
      ctx.fillRect(px, py, 2, 1);
      ctx.fillRect(px, py + 1, 1, 1);
      ctx.fillStyle = r.dark;
      ctx.fillRect(px + 2, py + 2, 1, 1);
    });
  }

  private drawArrow(x: number, y: number, dir: Dir, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate((dir * Math.PI) / 2);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(-1, -3, 2, 6);
    ctx.fillRect(1, -2, 1, 4);
    ctx.fillRect(2, -1, 1, 2);
    ctx.fillStyle = color;
    ctx.fillRect(-1, -2, 1, 4);
    ctx.fillRect(0, -1, 1, 2);
    ctx.restore();
  }

  /**
   * Four (1 case) et fonderie (2×2) : four de briques, bouche rougeoyante quand il fond,
   * cheminée(s), goulotte de sortie du côté de la flèche et jauge de charbon.
   */
  /** Mur de briques éclairé : joints sombres, briques de tons variés, arête claire sur chaque brique. */
  private bricks(x: number, y: number, w: number, h: number, base: string): void {
    const pen = this.pen;
    const r = ramp(base);
    pen.rect(x, y, w, h, r.dark);
    for (let row = 0, yy = y; yy < y + h; row++, yy += 3) {
      const bh = Math.min(2, y + h - yy);
      for (let xx = x - (row % 2 ? 3 : 0); xx < x + w; xx += 6) {
        const bx = Math.max(x, xx);
        const bw = Math.min(x + w, xx + 5) - bx;
        if (bw <= 0) continue;
        const tone = Math.abs(xx * 7 + yy * 13 + row) % 5;
        pen.rect(bx, yy, bw, bh, tone === 0 ? r.light : tone === 4 ? r.shade : r.base);
        pen.rect(bx, yy, bw, 1, tone === 4 ? r.base : r.light);
      }
    }
  }

  private drawSmelter(s: Smelter): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = s.x * TILE;
    const y = s.y * TILE;
    const W = s.w * TILE;
    const H = s.h * TILE;
    const big = s.w > 1;
    const hot = s.status === 'ok';
    const flicker = hot ? 0.75 + Math.sin(this.time * 17) * 0.15 + Math.sin(this.time * 7.3) * 0.1 : 0;
    const top = big ? 10 : 6; // hauteur du four au-dessus de sa case (vue de trois quarts)
    pen.shadow(x + 1, y + H - 3, W - 1);
    // Cheminées de pierre (derrière le corps), coiffées d'un anneau sombre et noircies de suie.
    const chimneys = big ? [x + 5, x + W - 10] : [x + 10];
    const cw = big ? 6 : 4;
    const chh = big ? 10 : 7;
    for (const cx of chimneys) {
      const cy = y - top - chh + 1;
      pen.slab(cx, cy, cw, chh, '#6a5a54');
      pen.slab(cx - 1, cy - 1, cw + 2, 2, '#3f3230');
      pen.rect(cx + 1, cy + 2, 1, chh - 3, '#4a3c38');
      if (hot && this.profile.detail) pen.px(cx + (cw >> 1), cy + 1, '#7a4a3a');
    }
    // Corps en briques, plaque d'acier rivetée en haut.
    pen.rect(x, y - top, W, H + top - 1, INK);
    this.bricks(x + 1, y - top + 1, W - 2, H + top - 3, '#a95a42');
    pen.rect(x + 1, y - top + 1, W - 2, big ? 3 : 2, '#5d626d');
    pen.rect(x + 1, y - top + 1, W - 2, 1, '#9aa0aa');
    for (let rx = x + 3; rx < x + W - 2; rx += 5) pen.px(rx, y - top + (big ? 3 : 2), '#2d3038');
    // Fonderie : creuset de métal en fusion sur le dessus.
    if (big) {
      pen.rect(x + 7, y - top + 4, W - 14, 5, INK);
      pen.rect(x + 8, y - top + 5, W - 16, 3, hot ? `rgb(255,${Math.round(120 + flicker * 60)},30)` : '#3f3230');
      if (hot) pen.rect(x + 8, y - top + 5, W - 16, 1, '#ffe28a');
    }
    // Bouche du four : arche de pierre, noire à l'arrêt, flammes qui dansent quand il fond.
    const mw = big ? 14 : 8;
    const mh = big ? 9 : 6;
    const mx = x + Math.round((W - mw) / 2);
    const my = y + H - mh - (big ? 5 : 3);
    pen.rect(mx - 2, my - 2, mw + 4, mh + 3, INK);
    pen.rect(mx - 1, my - 1, mw + 2, mh + 2, '#8b8175');
    pen.rect(mx - 1, my - 1, mw + 2, 1, '#c4baa8');
    pen.rect(mx, my, mw, mh, '#0e0b0d');
    if (hot) {
      pen.rect(mx, my + mh - 3, mw, 3, `rgb(255,${Math.round(90 + flicker * 70)},20)`);
      for (let i = 0; i < mw; i++) {
        const fh = 1 + Math.round(((Math.sin(this.time * 9 + i * 1.7) + 1) * (mh - 3)) / 2.4);
        pen.rect(mx + i, my + mh - 3 - Math.min(fh, mh - 3), 1, Math.min(fh, mh - 3), i % 3 === 0 ? '#ff9a30' : '#e2571c');
        if (fh > 2) pen.px(mx + i, my + mh - 3 - Math.min(fh, mh - 3), '#ffe28a');
      }
      pen.rect(mx + 1, my + mh - 1, mw - 2, 1, '#ffe28a');
      if (this.profile.glow) {
        ctx.fillStyle = `rgba(255,140,40,${0.14 + flicker * 0.08})`;
        ctx.fillRect(mx - 3, my + mh + 1, mw + 6, 3);
      }
    } else if (s.input.length) {
      pen.rect(mx + 1, my + mh - 2, mw - 2, 1, '#5a2a18'); // braises
      pen.px(mx + 2, my + mh - 2, '#a04a24');
    }
    // Goulotte de sortie du côté de la flèche, avec le lingot qui attend.
    ctx.save();
    ctx.translate(x + W / 2, y + H / 2);
    ctx.rotate((s.dir * Math.PI) / 2);
    const edge = (s.dir % 2 === 0 ? W : H) / 2;
    pen.rect(edge - 3, -4, 5, 8, INK);
    pen.rect(edge - 2, -3, 3, 6, '#7d818b');
    pen.rect(edge - 2, -3, 1, 6, '#b4b9c4');
    ctx.restore();
    if (s.output.length) {
      const img = this.nuggets.get(s.output[0]);
      if (img) ctx.drawImage(img, Math.round(x + W / 2 + DX[s.dir] * (W / 2 - 2) - img.width / 2), Math.round(y + H / 2 + DY[s.dir] * (H / 2 - 2) - img.height / 2));
    }
    this.drawArrow(x + W / 2 + DX[s.dir] * (W / 2 - 5), y + H / 2 + DY[s.dir] * (H / 2 - 5) - (s.dir % 2 ? 0 : 3), s.dir, '#ffffff');
    // Jauge de charbon.
    const fuel = s.fuelMax ? (s.fuelUnits + (s.burn > 0 ? 1 : 0)) / s.fuelMax : 0;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1, y + H - 1, W - 2, 2);
    ctx.fillStyle = fuel > 0.2 ? '#f08a24' : '#d0342c';
    ctx.fillRect(x + 1, y + H - 1, Math.round((W - 2) * Math.min(1, fuel)), 2);
    if (hot && Math.random() < (big ? 0.25 : 0.12)) this.fx.emit('spark', mx + mw / 2, my + mh / 2, '#ffb040', 1, 25);
  }

  /** Eau au sol (sous les machines et le joueur) et indices de poches sur les parois qui bordent une galerie. */
  private drawGroundHazards(state: GameState, x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx;
    const w = state.world;
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(w.w - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(w.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = w.idx(tx, ty);
        if (!w.explored[i]) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (w.tiles[i] === AIR) {
          const lvl = w.water[i];
          if (lvl <= 0) continue;
          const k = lvl / 255;
          ctx.fillStyle = `rgba(38,104,186,${0.2 + k * 0.45})`;
          ctx.fillRect(x, y, TILE, TILE);
          // Reflets qui ondulent.
          ctx.fillStyle = `rgba(170,215,255,${0.15 + k * 0.3})`;
          for (let r = 0; r < 2; r++) {
            const ph = (this.time * (0.6 + r * 0.3) + tx * 0.37 + ty * 0.61 + r * 0.5) % 1;
            ctx.fillRect(x + 1 + Math.floor(ph * 10), y + 4 + r * 7 + ((tx + ty) % 2), 4, 1);
          }
          continue;
        }
        const pocket = w.pocket[i];
        if (!pocket) continue;
        if (!(w.isOpen(tx, ty + 1) || w.isOpen(tx, ty - 1) || w.isOpen(tx + 1, ty) || w.isOpen(tx - 1, ty))) continue;
        // Indices discrets : suintements sombres (eau) ou taches jaunâtres (grisou).
        const h = (tx * 73856093) ^ (ty * 19349663);
        if (pocket === POCKET_WATER) {
          ctx.fillStyle = 'rgba(28,58,104,0.55)';
          ctx.fillRect(x + 3 + (h & 7), y + 3 + ((h >> 3) & 3), 2, 5);
          ctx.fillRect(x + 9 + ((h >> 5) & 3), y + 6 + ((h >> 7) & 3), 2, 4);
          const drip = (this.time * 0.8 + (h & 15) / 16) % 1;
          ctx.fillStyle = 'rgba(120,180,240,0.7)';
          ctx.fillRect(x + 4 + (h & 7), y + 8 + Math.floor(drip * 7), 1, 1);
        } else {
          ctx.fillStyle = 'rgba(176,190,64,0.45)';
          ctx.fillRect(x + 2 + (h & 7), y + 4 + ((h >> 3) & 3), 3, 2);
          ctx.fillRect(x + 8 + ((h >> 5) & 3), y + 9 + ((h >> 7) & 3), 2, 2);
          ctx.fillStyle = 'rgba(210,220,120,0.5)';
          ctx.fillRect(x + 11 - ((h >> 2) & 3), y + 3 + ((h >> 9) & 3), 1, 1);
        }
      }
  }

  /** Nuage de grisou : voile verdâtre et volutes, au-dessus de tout ce qui est au sol. */
  private drawGas(state: GameState, x0: number, y0: number, x1: number, y1: number): void {
    if (!state.hazards.hasGas) return;
    const ctx = this.ctx;
    const w = state.world;
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(w.w - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(w.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const lvl = w.gas[w.idx(tx, ty)];
        if (lvl <= 0) continue;
        const k = lvl / 255;
        ctx.fillStyle = `rgba(150,184,70,${0.1 + k * 0.32})`;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        for (let p = 0; p < 2; p++) {
          const a = this.time * (0.7 + p * 0.4) + tx * 1.3 + ty * 2.1 + p * 3;
          ctx.fillStyle = `rgba(196,220,120,${0.12 + k * 0.28})`;
          ctx.fillRect(Math.round(tx * TILE + 8 + Math.cos(a) * 5) - 2, Math.round(ty * TILE + 8 + Math.sin(a * 1.3) * 5) - 1, 4, 3);
        }
      }
  }

  /** Plafond qui craque : zone menacée qui clignote, avec le compte à rebours. */
  private drawCaveInWarnings(state: GameState): void {
    const ctx = this.ctx;
    const r = CAVE_IN.radius;
    for (const p of state.hazards.pending) {
      if (!this.inView(p.x * TILE, p.y * TILE, 96)) continue;
      const blink = Math.floor(this.time * (p.t < 1.5 ? 8 : 4)) % 2 === 0;
      ctx.strokeStyle = blink ? 'rgba(255,110,50,0.95)' : 'rgba(255,190,80,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect((p.x - r) * TILE + 0.5, (p.y - r) * TILE + 0.5, (2 * r + 1) * TILE - 1, (2 * r + 1) * TILE - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,110,50,0.12)';
      ctx.fillRect((p.x - r) * TILE, (p.y - r) * TILE, (2 * r + 1) * TILE, (2 * r + 1) * TILE);
    }
  }

  /** Blessure : bord de l'écran rouge (flash), et rouge persistant quand la santé est basse. */
  private drawHurt(state: GameState): void {
    const low = state.hp < HEALTH.max * 0.35 ? 0.25 + Math.sin(this.time * 5) * 0.08 : 0;
    const gas = state.hazards.gasAt(state.player.tileX, state.player.tileY) >= GAS.harmful ? 0.18 : 0;
    const a = Math.max(this.hurtFlash * 0.55, low);
    if (a <= 0 && gas <= 0) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (gas > 0) {
      ctx.fillStyle = `rgba(120,160,40,${gas})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (a > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(200,20,20,0)');
      g.addColorStop(1, `rgba(200,20,20,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Fanion d'un repère : mât, drapeau de la couleur du type, et son symbole. */
  private drawMarkerFlag(m: Marker, tracked: boolean): void {
    const ctx = this.ctx;
    const x = Math.round((m.x + 0.5) * TILE);
    const y = Math.round((m.y + 0.5) * TILE) + 4;
    const wave = Math.round(Math.sin(this.time * 4 + m.x) * 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 2, y, 5, 2);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x - 1, y - 16, 2, 17);
    ctx.fillStyle = '#c7ccd6';
    ctx.fillRect(x - 1, y - 16, 1, 17);
    const color = MARKER_KINDS[m.kind].color;
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 1, y - 16 + wave, 9, 7);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y - 15 + wave, 8, 5);
    markerShape(ctx, m.kind, x + 5, y - 12.5 + wave, 1.8, '#1a1418');
    if (tracked) {
      const pulse = (this.time * 1.2) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pulse)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 3 + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Étai : deux poteaux et une poutre de bois (on passe dessous). */
  private drawProp(s: Prop): void {
    const pen = this.pen;
    const x = s.x * TILE;
    const y = s.y * TILE;
    pen.shadow(x, y + 14, 16, 0.3);
    // Deux poteaux de bois veinés (arête claire à gauche), un chapeau et des cales en coin.
    for (const px of [x + 1, x + 12]) {
      pen.rect(px - 1, y - 6, 5, 22, INK);
      pen.rect(px, y - 6, 3, 21, '#8a5a32');
      pen.rect(px, y - 6, 1, 21, '#c08a50');
      pen.rect(px + 2, y - 6, 1, 21, '#4a2f1a');
      pen.px(px + 1, y + 1, '#6a4424');
      pen.px(px + 1, y + 8, '#6a4424');
      pen.px(px + 1, y + 4, '#a8764a');
    }
    pen.rect(x - 2, y - 10, 20, 5, INK);
    pen.rect(x - 1, y - 9, 18, 3, '#9a6a3a');
    pen.rect(x - 1, y - 9, 18, 1, '#d09a5c');
    pen.rect(x - 1, y - 7, 18, 1, '#5a3a22');
    pen.rect(x + 4, y - 6, 2, 2, '#6a4424');
    pen.rect(x + 10, y - 6, 2, 2, '#6a4424');
    pen.px(x + 4, y - 6, '#a8764a');
    pen.px(x + 10, y - 6, '#a8764a');
  }

  /** Ventilateur : hélice dans un cadre d'acier ; elle s'emballe quand il y a du grisou. */
  private drawFan(s: Fan): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = s.x * TILE;
    const y = s.y * TILE;
    pen.shadow(x + 1, y + 13, 15);
    // Cadre d'acier boulonné, puis l'hélice dans son puits sombre.
    pen.slab(x + 1, y - 3, 14, 17, '#666a75');
    pen.rivet(x + 3, y - 1, '#a0a4af');
    pen.rivet(x + 12, y - 1, '#a0a4af');
    pen.rivet(x + 3, y + 12, '#a0a4af');
    pen.rivet(x + 12, y + 12, '#a0a4af');
    pen.rect(x + 3, y + 1, 10, 10, INK);
    pen.rect(x + 4, y + 2, 8, 8, '#20222a');
    const cx = x + 8;
    const cy = y + 6;
    for (let k = 0; k < 4; k++) {
      const a = s.spin + (k * Math.PI) / 2;
      ctx.fillStyle = k % 2 ? '#c4c8d2' : '#a0a5b0';
      for (let d = 1; d <= 3; d++) ctx.fillRect(Math.round(cx + Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d) - 1, 2, 2);
    }
    pen.rect(cx - 1, cy - 1, 2, 2, '#f2c230');
    pen.px(cx - 1, cy - 1, '#fff3b0');
    if (s.active && Math.random() < 0.3) this.fx.emit('smoke', cx, cy, 'rgba(170,200,110,0.5)', 1, 14);
    // Souffle frais dans la Fournaise : de petits traits clairs qui s'échappent.
    if (s.cooling && !s.active && this.profile.detail && Math.random() < 0.08) this.fx.emit('smoke', cx, cy, 'rgba(190,225,255,0.45)', 1, 12);
  }

  /** Pompe : cylindre, balancier qui monte et descend en pompant, tuyau qui plonge dans le sol. */
  private drawPump(s: Pump): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = s.x * TILE;
    const y = s.y * TILE;
    const on = s.status === 'ok';
    const stroke = on ? Math.round(Math.sin(s.activeTime * 8) * 2) : 0;
    pen.shadow(x + 1, y + 13, 15);
    // Socle boulonné et tuyau d'eau qui plonge dans le sol.
    pen.slab(x + 1, y + 8, 14, 7, '#3f4049');
    pen.rivet(x + 3, y + 13, '#8a8e99');
    pen.tube(x + 11, y + 4, 4, 11, '#4a86ac');
    pen.rect(x + 10, y + 5, 6, 1, INK);
    pen.rect(x + 11, y + 6, 4, 1, '#9fd0ea');
    // Cylindre de cuivre patiné, avec sa bague claire.
    pen.slab(x + 2, y - 2, 8, 12, '#4d86a8');
    pen.rect(x + 3, y - 1, 6, 2, '#8cc4e2');
    pen.rect(x + 3, y + 3, 6, 1, '#356a88');
    // Tige et balancier de bois.
    pen.rect(x + 5, y - 6 + stroke, 2, 6, '#b4b9c4');
    pen.px(x + 5, y - 6 + stroke, '#ffffff');
    pen.slab(x + 1, y - 8 + stroke, 13, 3, '#8a5a33');
    if (on && Math.random() < 0.25) this.fx.emit('dust', x + 12, y + 14, 'rgba(120,180,240,0.6)', 1, 18);
    if (on && this.profile.detail && Math.floor(this.time * 6) % 2 === 0) pen.px(x + 13, y + 1, '#bfe6ff');
    void ctx;
  }

  private drawStorage(s: Storage): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = s.x * TILE;
    const y = s.y * TILE;
    pen.shadow(x + 1, y + 13, 15);
    // Dessus du coffre (planches) : contour, planches claires et joints sombres.
    pen.rect(x, y - 2, 16, 12, INK);
    pen.rect(x + 1, y - 1, 14, 10, '#96683c');
    pen.rect(x + 1, y - 1, 14, 1, '#c89058');
    for (let k = 0; k < 3; k++) {
      pen.rect(x + 1, y + 2 + k * 3, 14, 1, '#6b4526');
      pen.rect(x + 1, y + 3 + k * 3, 14, 1, '#a8764a');
    }
    // Face avant : planches verticales.
    pen.rect(x, y + 9, 16, 7, INK);
    pen.rect(x + 1, y + 10, 14, 5, '#6b4526');
    pen.rect(x + 1, y + 10, 14, 1, '#8a5a33');
    for (const k of [4, 8, 11]) pen.rect(x + k, y + 11, 1, 4, '#4a2f1a');
    // Ferrures d'acier : deux bandes verticales rivetées.
    for (const bx of [x + 1, x + 12]) {
      pen.rect(bx, y - 1, 3, 15, '#7d818b');
      pen.rect(bx, y - 1, 1, 15, '#b4b9c4');
      pen.rect(bx + 2, y - 1, 1, 15, '#565a64');
      pen.rivet(bx + 1, y + 1, '#9aa0aa');
      pen.rivet(bx + 1, y + 12, '#9aa0aa');
    }
    // Serrure de laiton.
    pen.rect(x + 6, y + 10, 4, 4, INK);
    pen.rect(x + 7, y + 11, 2, 2, '#e8c050');
    pen.px(x + 7, y + 11, '#fff3b0');
    pen.px(x + 8, y + 12, '#a07410');
    // Aperçu du contenu (minerai dominant) + jauge
    const entries = Object.entries(s.items).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      ctx.drawImage(this.nuggets.get(entries[0][0])!, x + 4, y);
      if (entries[1]) ctx.drawImage(this.nuggets.get(entries[1][0])!, x + 8, y + 1);
    }
    const fill = s.weight() / s.capacity;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fill > 0.9 ? '#d0342c' : '#6fcf6a';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fill)), 2);
  }

  /** Caisse d'expédition : caisse verte ouverte, panneau à pièce et minuteur du transporteur. */
  private drawShipping(c: ShippingCrate): void {
    const ctx = this.ctx;
    const pen = this.pen;
    const x = c.x * TILE;
    const y = c.y * TILE;
    pen.shadow(x + 1, y + 13, 15);
    // Poteau et panneau « pièce », avec un petit reflet.
    pen.rect(x + 12, y - 7, 2, 8, '#4a3020');
    pen.rect(x + 12, y - 7, 1, 8, '#6e4a2c');
    pen.rect(x + 8, y - 14, 10, 8, INK);
    pen.rect(x + 9, y - 13, 8, 6, '#f2c230');
    pen.rect(x + 9, y - 13, 8, 1, '#fff3b0');
    pen.rect(x + 9, y - 8, 8, 1, '#a07410');
    pen.rect(x + 12, y - 12, 2, 4, '#a07410');
    pen.px(x + 12, y - 12, '#fff3b0');
    // Minuteur du transporteur (se remplit jusqu'au prochain passage)
    const t = 1 - c.timer / c.interval;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 8, y - 17, 10, 3);
    ctx.fillStyle = '#2a4a6a';
    ctx.fillRect(x + 9, y - 16, 8, 1);
    ctx.fillStyle = '#6fb3ff';
    ctx.fillRect(x + 9, y - 16, Math.round(8 * Math.min(1, Math.max(0, t))), 1);
    // Caisse : dessus ouvert (creux sombre, minerai visible) puis face avant.
    pen.rect(x, y, 14, 10, INK);
    pen.rect(x + 1, y + 1, 12, 8, '#4a9a6c');
    pen.rect(x + 1, y + 1, 12, 1, '#7fd0a0');
    pen.rect(x + 1, y + 2, 1, 7, '#5fae7a');
    pen.rect(x + 3, y + 3, 8, 5, '#14201a');
    pen.rect(x + 3, y + 3, 8, 1, '#0c140f');
    const entries = Object.entries(c.items).sort((a, b) => b[1] - a[1]);
    entries.slice(0, 2).forEach(([res], i) => ctx.drawImage(this.nuggets.get(res)!, x + 3 + i * 3, y + 2 + i));
    pen.rect(x, y + 9, 14, 7, INK);
    pen.rect(x + 1, y + 10, 12, 5, '#2f7a52');
    pen.rect(x + 1, y + 10, 12, 1, '#4a9a6c');
    pen.rect(x + 1, y + 12, 12, 1, '#245f3f');
    pen.rect(x + 1, y + 14, 12, 1, '#1c4a32');
    // Plaque de laiton et rivets.
    pen.rect(x + 5, y + 10, 4, 3, INK);
    pen.rect(x + 6, y + 11, 2, 1, '#f2c230');
    pen.rivet(x + 2, y + 13, '#9aa0aa');
    pen.rivet(x + 11, y + 13, '#9aa0aa');
    // Jauge de remplissage
    const fill = c.weight() / c.capacity;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fill > 0.9 ? '#d0342c' : '#6fcf6a';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fill)), 2);
  }

  /** Effet de vente automatique au-dessus d'une caisse. */
  onShipped(tx: number, ty: number, text: string): void {
    const cx = (tx + 0.5) * TILE;
    const cy = ty * TILE;
    this.fx.text(text, cx, cy - 18, '#f2c230');
    this.fx.emit('spark', cx, cy - 4, '#f2c230', 14, 55);
  }

  private drawStatusIcons(state: GameState): void {
    const ctx = this.ctx;
    const blink = Math.floor(this.time * 2.5) % 2 === 0;
    for (const s of state.structures.list) {
      // Foreuses : plus de charbon, sortie saturée, ou arrêt (gisement épuisé, obstacle).
      // Foreuse de percement : sur sa base (sans charbon, rentrée bloquée) ou sur la foreuse qui attend.
      // Dans la Fournaise, une machine qui tourne mais que la chaleur ralentit porte un thermomètre.
      let icon: 'nofuel' | 'full' | 'stop' | 'hot' | null = null;
      let at = { x: s.x * TILE, y: s.y * TILE };
      if (s instanceof Drill) icon = s.status !== 'ok' ? (s.status === 'nofuel' ? 'nofuel' : s.status === 'full' ? 'full' : 'stop') : s.heat < 1 ? 'hot' : null;
      else if (s instanceof Smelter) {
        // Four sans charbon alors qu'il a du minerai, ou sortie saturée.
        icon = s.status === 'nofuel' ? 'nofuel' : s.status === 'full' ? 'full' : s.status === 'ok' && s.heat < 1 ? 'hot' : null;
        at = { x: s.x * TILE + (s.w - 1) * 8, y: s.y * TILE - (s.w > 1 ? 14 : 8) };
      }
      else if (s instanceof TunnelBorer) {
        icon = s.status === 'nofuel' ? 'nofuel' : s.status === 'waiting' ? 'full' : s.status === 'blocked' ? 'stop' : s.status === 'digging' && s.heat < 1 ? 'hot' : null;
        if (icon === 'full' || icon === 'hot') at = this.borerVehicleXY(s);
      }
      if (!icon || !this.inView(at.x, at.y)) continue;
      const x = at.x + 8;
      const y = at.y - (s instanceof TunnelBorer && icon !== 'full' && icon !== 'hot' ? 14 : 9) + (blink ? 0 : -1);
      const color = icon === 'nofuel' ? '#d0342c' : icon === 'full' ? '#e0a020' : icon === 'hot' ? '#e8601c' : '#7a7a86';
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(x - 4, y - 4, 9, 8);
      ctx.fillStyle = color;
      ctx.fillRect(x - 3, y - 3, 7, 6);
      ctx.fillStyle = '#fff';
      if (icon === 'nofuel') {
        ctx.fillStyle = '#1a1418';
        ctx.fillRect(x - 1, y - 2, 3, 3); // charbon
      } else if (icon === 'full') {
        ctx.fillRect(x - 2, y - 1, 5, 1);
        ctx.fillRect(x - 2, y + 1, 5, 1);
      } else if (icon === 'hot') {
        // Thermomètre : tige et bulbe.
        ctx.fillRect(x, y - 2, 1, 3);
        ctx.fillRect(x - 1, y + 1, 3, 2);
      } else {
        ctx.fillRect(x - 2, y - 2, 1, 1);
        ctx.fillRect(x + 2, y - 2, 1, 1);
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x - 2, y + 2, 1, 1);
        ctx.fillRect(x + 2, y + 2, 1, 1);
      }
    }
  }

  // ------------------------------------------------------------------ personnage

  /** Images du mineur avec l'équipement qu'il porte en ce moment. */
  private minerSprites(): PlayerSprites {
    const gear = this.state!.gear;
    const key = ['helmet', 'mask', 'boots', 'suit'].map((id) => (gear.has(id) ? '1' : '0')).join('');
    let set = this.minerSets.get(key);
    if (!set) {
      set = buildPlayerSprites({ helmet: gear.has('helmet'), mask: gear.has('mask'), boots: gear.has('boots'), suit: gear.has('suit') });
      this.minerSets.set(key, set);
    }
    return set;
  }

  private drawPlayer(): void {
    const state = this.state!;
    const p = state.player;
    const ctx = this.ctx;
    const sprites = this.minerSprites();
    const frames = sprites.frames[p.facing];
    // Suspendu à la corde de rappel : il monte avec elle (ou s'enfonce dans un trou à la descente), la trottinette est rangée.
    const dir = state.ropeT > 0 ? state.ropeDir : null;
    const anim = dir ? ropeFrame(dir, ROPE.channel - state.ropeT, ROPE.channel, p.y - this.camY + 28) : null;
    // Sur la trottinette (Maj), le mineur reste droit sur le plateau : pas de marche, pas de pioche.
    const riding = state.scootering && !anim;
    const walking = p.moving && p.swingT <= 0 && !riding;
    // Marche à quatre images : pas, passage, pas, passage (le corps se soulève au passage).
    const frame = walking ? 1 + (Math.floor(p.walkTime * 9) % 4) : 0;
    // À l'arrêt, le mineur cligne des yeux de temps en temps.
    const blink = !walking && p.swingT <= 0 && this.time % 4.6 < 0.14;
    const img = blink ? sprites.blink[p.facing] : frames[frame];
    const bob = walking && frame % 2 === 0 ? -1 : 0;
    const x = Math.round(p.x - img.width / 2);
    // Hauteur au-dessus du sol : la montée à la corde (avec un léger balancement), ou la petite chute de l'arrivée.
    const lift = anim ? anim.lift + (anim.lift > 0 ? Math.sin(this.time * 5) : 0) : landLift(this.landT);
    const y = Math.round(p.y - img.height + 3 + bob - (riding ? SCOOTER_LIFT : 0) - lift);
    // L'ombre reste au sol : elle s'efface quand le mineur s'éloigne.
    ctx.fillStyle = `rgba(0,0,0,${(0.35 * (anim ? anim.shadow : 1 - lift / 14)).toFixed(3)})`;
    const wide = riding ? (p.facing === 0 || p.facing === 2 ? 22 : 12) : 10;
    ctx.fillRect(Math.round(p.x - wide / 2), Math.round(p.y + 1), wide, 3);
    if (riding) {
      this.drawScooter(img, x, y);
      return;
    }
    if (anim && dir) {
      this.drawRoped(img, x + (dir === 'up' ? Math.round(Math.sin(this.time * 4)) : 0), y, anim, dir);
      return;
    }
    const pickBehind = p.facing === 3;
    if (pickBehind) this.drawPickaxe(-lift);
    ctx.drawImage(img, x, y);
    if (!pickBehind) this.drawPickaxe(-lift);
  }

  /**
   * Le mineur à la corde de rappel. À la montée, il est tiré vers le haut avec la corde, de plus en plus vite,
   * jusqu'à sortir de l'écran ; à la descente, il s'enfonce dans un trou ouvert à ses pieds (tout ce qui passe
   * sous le sol est coupé).
   */
  private drawRoped(img: HTMLCanvasElement, x: number, y: number, anim: RopeFrame, dir: 'up' | 'down'): void {
    const ctx = this.ctx;
    const p = this.state!.player;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (dir === 'down') {
      // Le trou : une ellipse sombre qui s'ouvre, puis le mineur y glisse (le sol coupe ce qui descend dessous).
      const w = Math.round(14 * anim.hole);
      if (w >= 2) {
        ctx.fillStyle = '#0b0809';
        ctx.fillRect(px - w / 2, py, w, 4);
        ctx.fillRect(px - w / 2 + 1, py - 1, w - 2, 1);
        ctx.fillRect(px - w / 2 + 1, py + 4, w - 2, 1);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(px - 40, py - 400, 80, 400 + 2);
      ctx.clip();
    }
    const up = dir === 'up';
    // Corde : elle monte jusqu'en haut de l'écran en se déroulant, ou s'efface au-dessus de lui à la descente.
    const from = y + 5;
    const length = (up ? Math.max(0, from + 4 - this.camY) : 78) * anim.unroll;
    for (let off = 0, i = 0; off < length; off += 3, i++) {
      ctx.globalAlpha = up ? 1 : Math.max(0, 1 - i / 28);
      ctx.fillStyle = i % 2 ? '#b89260' : '#7a5530';
      ctx.fillRect(px - 1, from - off - 3, 2, 3);
    }
    ctx.globalAlpha = 1;
    const pickBehind = p.facing === 3;
    const dy = y - Math.round(p.y - img.height + 3);
    if (pickBehind) this.drawPickaxe(dy, x - Math.round(p.x - img.width / 2));
    ctx.drawImage(img, x, y);
    if (!pickBehind) this.drawPickaxe(dy, x - Math.round(p.x - img.width / 2));
    if (dir === 'down') ctx.restore();
    // Jauge sous les pieds : où en est la manœuvre.
    this.drawRopeProgress(p.x, p.y);
  }

  /** Petite jauge sous les pieds : où en est la manœuvre (le temps restant, à l'envers). */
  private drawRopeProgress(x: number, y: number): void {
    const ctx = this.ctx;
    const ratio = Math.max(0, Math.min(1, 1 - this.state!.ropeT / ROPE.channel));
    ctx.fillStyle = '#120e10';
    ctx.fillRect(Math.round(x) - 9, Math.round(y) + 5, 18, 4);
    ctx.fillStyle = '#e8c050';
    ctx.fillRect(Math.round(x) - 8, Math.round(y) + 6, Math.round(16 * ratio), 2);
  }

  /** Mineur debout sur sa trottinette : plateau et roues dessous, guidon par-dessus quand on le voit de face. */
  private drawScooter(miner: HTMLCanvasElement, mx: number, my: number): void {
    const p = this.state!.player;
    const ctx = this.ctx;
    const moving = p.moving;
    // Les roues tournent quand on avance.
    const wheel = moving ? Math.floor(this.time * 14) % 2 : 0;
    const base = this.scooter.base[p.facing][wheel];
    const bx = Math.round(p.x - base.width / 2);
    const by = Math.round(p.y - base.height + 3);
    ctx.drawImage(base, bx, by);
    ctx.drawImage(miner, mx, my);
    if (p.facing === 1) {
      // De face, le guidon passe devant le mineur ; le bas de la colonne repose sur le plateau.
      const bars = this.scooter.bars;
      ctx.drawImage(bars, Math.round(p.x - bars.width / 2), by + 1 - (bars.height - 2));
    }
    // Poussière sous les roues arrière et petit panache du moteur, quand on roule.
    if (moving && this.time - this.scooterPuff > 0.09) {
      this.scooterPuff = this.time;
      const rx = p.x - DX[p.facing] * 9;
      const ry = p.y + 2 - DY[p.facing] * 5;
      this.fx.emit('dust', rx, ry, 'rgba(150,130,110,0.6)', 1, 12);
      if (Math.random() < 0.4) this.fx.emit('smoke', rx - DX[p.facing] * 2, ry - 6, 'rgba(90,90,96,0.5)', 1, 6);
    }
  }

  /** L'outil en main ; (dx, dy) le décale avec le mineur quand il n'est plus posé au sol (corde, arrivée). */
  private drawPickaxe(dy = 0, dx = 0): void {
    const state = this.state!;
    const p = state.player;
    // Pendant un coup, l'outil réellement utilisé (pioche de secours si le marteau n'a plus de charbon).
    const hammer = p.swingT > 0 ? p.swingTool === 'jackhammer' : state.activeTool.kind === 'jackhammer';
    if (hammer) return this.drawJackhammer(dy, dx);
    let angle: number;
    if (p.swingT > 0) {
      const t = p.swingProgress();
      // Levée (0 → 0.4) puis frappe rapide (0.4 → 0.5) et retour.
      let off: number;
      if (t < 0.4) off = -2.1 * (t / 0.4);
      else if (t < 0.5) off = -2.1 + 2.6 * ((t - 0.4) / 0.1);
      else off = 0.5 - 0.5 * ((t - 0.5) / 0.5);
      const side = Math.cos(p.aim) < 0 ? -1 : 1;
      angle = p.aim + off * side;
    } else {
      // Au repos : tenue le long du corps.
      angle = p.facing === 2 ? Math.PI * 0.72 : p.facing === 0 ? Math.PI * 0.28 : p.facing === 3 ? -Math.PI * 0.3 : Math.PI * 0.62;
    }
    const idx = ((Math.round((angle / (Math.PI * 2)) * PICK_ANGLES) % PICK_ANGLES) + PICK_ANGLES) % PICK_ANGLES;
    const img = this.picks[state.pickaxeLevel][idx];
    const hx = p.x + (p.facing === 0 ? 3 : p.facing === 2 ? -3 : p.facing === 1 ? 4 : -4);
    const hy = p.y - 7;
    this.ctx.drawImage(img, Math.round(hx - PICK_SIZE / 2) + dx, Math.round(hy - PICK_SIZE / 2) + dy);
  }

  /** Marteau-piqueur : pointé vers la paroi et secoué pendant qu'il frappe, porté contre soi au repos. */
  private drawJackhammer(dy = 0, dx = 0): void {
    const p = this.state!.player;
    const working = p.swingT > 0;
    const angle = working ? p.aim : p.facing === 2 ? Math.PI * 0.62 : p.facing === 0 ? Math.PI * 0.38 : p.facing === 3 ? -Math.PI * 0.5 : Math.PI * 0.5;
    const idx = ((Math.round((angle / (Math.PI * 2)) * PICK_ANGLES) % PICK_ANGLES) + PICK_ANGLES) % PICK_ANGLES;
    const jig = working ? (Math.floor(this.time * 40) % 2) * 1.2 : 0;
    const hx = p.x + (p.facing === 0 ? 3 : p.facing === 2 ? -3 : p.facing === 1 ? 4 : -4) + Math.cos(angle) * jig;
    const hy = p.y - 7 + Math.sin(angle) * jig;
    this.ctx.drawImage(this.jacks[idx], Math.round(hx - PICK_SIZE / 2) + dx, Math.round(hy - PICK_SIZE / 2) + dy);
  }

  // ------------------------------------------------------------------ effets

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.fx.particles) {
      const a = Math.min(1, p.life / p.max) * (p.kind === 'smoke' ? 0.8 : 1);
      ctx.globalAlpha = p.kind === 'chip' ? 1 : a;
      ctx.fillStyle = p.color;
      const s = Math.max(1, Math.round(p.size));
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - p.z - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  }

  private drawLighting(): void {
    const state = this.state!;
    const L = this.lctx;
    const W = this.light.width;
    const H = this.light.height;
    const k = W / this.viewW; // pixels d'éclairage par unité monde
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, W, H);
    // Obscurité croissante avec la profondeur.
    const surfaceY = SURFACE_ROWS * TILE;
    const toScreen = (wy: number) => (wy - this.camY) * k;
    const g = L.createLinearGradient(0, toScreen(surfaceY - TILE), 0, toScreen(state.world.h * TILE));
    const span = state.world.h * TILE - (surfaceY - TILE);
    const stop = (wy: number) => clamp((wy - (surfaceY - TILE)) / span, 0, 1);
    g.addColorStop(0, 'rgba(4,3,8,0)');
    g.addColorStop(stop(surfaceY + TILE * 2), 'rgba(4,3,8,0.6)');
    g.addColorStop(stop(surfaceY + TILE * 10), 'rgba(4,3,8,0.86)');
    g.addColorStop(1, 'rgba(4,3,8,0.95)');
    L.fillStyle = g;
    L.fillRect(0, 0, W, H);
    // Sources de lumière.
    L.globalCompositeOperation = 'destination-out';
    const punch = (wx: number, wy: number, radius: number, strength = 1) => {
      const sx = (wx - this.camX) * k;
      const sy = (wy - this.camY) * k;
      const r = radius * TILE * k;
      if (sx < -r || sy < -r || sx > W + r || sy > H + r) return;
      const rg = L.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
      rg.addColorStop(0, `rgba(0,0,0,${strength})`);
      rg.addColorStop(0.55, `rgba(0,0,0,${strength * 0.7})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = rg;
      L.fillRect(sx - r, sy - r, r * 2, r * 2);
    };
    const p = state.player;
    const flicker = 1 + Math.sin(this.time * 13) * 0.015 + Math.sin(this.time * 7.3) * 0.02;
    punch(p.x, p.y - 8, 6.5 * flicker, 1);
    for (const l of state.layout.lamps) punch(l.x, l.y, 3.6 + Math.sin(this.time * 5 + l.x) * 0.08, 0.85);
    for (const s of state.structures.list) {
      if (s instanceof Drill) punch((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, s.status === 'ok' ? 3.2 : 1.6, 0.8);
      // Four et fonderie : la bouche éclaire autour d'elle quand ils fondent.
      else if (s instanceof Smelter) punch((s.x + s.w / 2) * TILE, (s.y + s.h - 0.3) * TILE, s.status === 'ok' ? 3 + s.w : 1.4, 0.85);
      // Phare de la foreuse de percement : éclaire le front de taille, où qu'elle soit ; la base a sa lampe.
      else if (s instanceof TunnelBorer) {
        const v = this.borerVehicleXY(s);
        punch(v.x + (0.5 + DX[s.dir] * 0.8) * TILE, v.y + (0.5 + DY[s.dir] * 0.8) * TILE, s.running ? 3.6 : 2, 0.85);
        if (!s.home) punch((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, 1.6, 0.6);
      }
      else if (s instanceof Storage) punch((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, 1.3, 0.5);
    }
    L.globalCompositeOperation = 'source-over';

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    // Halo chaud des lanternes et des machines.
    ctx.globalCompositeOperation = 'lighter';
    const glow = (wx: number, wy: number, radius: number, a: number) => {
      const sx = (wx - this.camX) * this.zoom;
      const sy = (wy - this.camY) * this.zoom;
      const r = radius * TILE * this.zoom;
      if (sx < -r || sy < -r || sx > this.canvas.width + r || sy > this.canvas.height + r) return;
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      rg.addColorStop(0, `rgba(255,160,70,${a})`);
      rg.addColorStop(1, 'rgba(255,160,70,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    };
    for (const l of state.layout.lamps) glow(l.x, l.y, 2.2, 0.16);
    for (const s of state.structures.list) if (s instanceof Drill && s.status === 'ok') glow((s.x + 0.5) * TILE, (s.y + 0.4) * TILE, 1.6, 0.12);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawOverlay(o: Overlay): void {
    const ctx = this.ctx;
    const t = this.time;
    if (o.target) {
      const pulse = 0.55 + Math.sin(t * 8) * 0.25;
      ctx.strokeStyle = o.target.ok ? `rgba(255,255,255,${pulse})` : `rgba(255,80,60,${pulse})`;
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeRect(o.target.tx * TILE + 0.5, o.target.ty * TILE + 0.5, TILE - 1, TILE - 1);
      ctx.lineWidth = 1;
      ctx.strokeRect(o.target.tx * TILE - 0.5, o.target.ty * TILE - 0.5, TILE + 1, TILE + 1);
    }
    if (o.ghost) {
      const def = getMachine(o.ghost.machine);
      const x = o.ghost.tx * TILE;
      const y = o.ghost.ty * TILE;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = o.ghost.ok ? 'rgba(90,220,120,0.35)' : 'rgba(230,70,60,0.4)';
      ctx.fillRect(x, y, def.w * TILE, def.h * TILE);
      ctx.strokeStyle = o.ghost.ok ? '#7dffa0' : '#ff6b5b';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, def.w * TILE - 1, def.h * TILE - 1);
      if (def.rotatable) this.drawArrow(x + def.w * 8, y + def.h * 8, o.ghost.dir, o.ghost.ok ? '#7dffa0' : '#ff6b5b');
      const state = this.state;
      if (o.ghost.reach && state)
        this.drawReachTiles(o.ghost.reach, (t) => !!state.world.depositAt(t.x, t.y) && !(state.structures.at(t.x, t.y) instanceof Drill));
      if (o.ghost.link) {
        // Pointillés vers le pont d'entrée auquel celui-ci se reliera.
        const lx = (o.ghost.link.tx + 0.5) * TILE;
        const ly = (o.ghost.link.ty + 0.5) * TILE;
        ctx.fillStyle = '#7dffa0';
        const steps = Math.max(Math.abs(lx - (x + 8)), Math.abs(ly - (y + 8))) / 3;
        for (let k = 0; k <= steps; k += 2) {
          const px = lx + ((x + 8 - lx) * k) / steps;
          const py = ly + ((y + 8 - ly) * k) / steps;
          ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (o.reach) this.drawReach(o.reach);
    if (o.removeHint) {
      ctx.strokeStyle = `rgba(255,120,60,${0.6 + Math.sin(t * 8) * 0.3})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(o.removeHint.tx * TILE + 0.5, o.removeHint.ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
    if (o.interact) {
      const s = o.interact;
      const bx = (s.x + s.w / 2) * TILE;
      const by = s.y * TILE - (s instanceof Building ? 16 : 10) + Math.sin(t * 4) * 1.5;
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(Math.round(bx - 4), Math.round(by - 4), 9, 9);
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(Math.round(bx - 3), Math.round(by - 3), 7, 7);
      ctx.fillStyle = '#1a1418';
      ctx.font = 'bold 6px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('E', Math.round(bx) + 0.5, Math.round(by) + 0.5);
    }
  }

  private drawTexts(ox: number, oy: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const size = Math.max(11, Math.round(this.zoom * 4.2));
    ctx.font = `bold ${size}px "Pixelify Sans", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.fx.texts) {
      const a = Math.min(1, t.life / (t.max * 0.4));
      const x = t.x * this.zoom + ox;
      const y = t.y * this.zoom + oy;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#120e10';
      ctx.fillText(t.text, x + 2, y + 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
    // Noms des bâtiments.
    const state = this.state!;
    ctx.font = `bold ${Math.max(10, Math.round(this.zoom * 3.4))}px "Pixelify Sans", monospace`;
    for (const s of state.structures.list) {
      if (!(s instanceof Building)) continue;
      const x = (s.x + s.w / 2) * TILE * this.zoom + ox;
      const y = ((s.y + s.h) * TILE + 6) * this.zoom + oy;
      ctx.fillStyle = 'rgba(18,14,16,0.75)';
      const w = ctx.measureText(s.name).width + 10;
      ctx.fillRect(x - w / 2, y - 8 * (this.zoom / 3), w, 16 * (this.zoom / 3));
      ctx.fillStyle = '#f2e6c8';
      ctx.fillText(s.name, x, y);
    }
    this.drawMarkerTexts(ox, oy);
  }

  /**
   * Noms des repères visibles, et flèche au bord de l'écran vers le repère suivi quand il est
   * hors de vue (avec sa distance en mètres).
   */
  private drawMarkerTexts(ox: number, oy: number): void {
    const ctx = this.ctx;
    const state = this.state!;
    const z = this.zoom;
    ctx.font = `bold ${Math.max(10, Math.round(z * 3))}px "Pixelify Sans", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (const m of state.markers.list) {
      const x = (m.x + 0.5) * TILE * z + ox;
      const y = ((m.y + 0.5) * TILE - 16) * z + oy;
      if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
      const w = ctx.measureText(m.label).width + 8;
      ctx.fillStyle = 'rgba(18,14,16,0.7)';
      ctx.fillRect(x - w / 2, y - 7 * (z / 3) - 4, w, 14 * (z / 3));
      ctx.fillStyle = MARKER_KINDS[m.kind].color;
      ctx.fillText(m.label, x, y - 4);
    }
    const t = state.markers.trackedMarker;
    if (!t) return;
    const tx = (t.x + 0.5) * TILE * z + ox;
    const ty = (t.y + 0.5) * TILE * z + oy;
    const margin = 46;
    if (tx > margin && ty > margin && tx < W - margin && ty < H - margin) return;
    // Point du bord de l'écran sur la droite joueur → repère.
    const cx = W / 2;
    const cy = H / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
    const ex = cx + dx * k;
    const ey = cy + dy * k;
    const a = Math.atan2(dy, dx);
    const color = MARKER_KINDS[t.kind].color;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = '#1a1418';
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -13);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-7, -9);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const dist = Math.round((Math.hypot(t.x + 0.5 - state.player.x / TILE, t.y + 0.5 - state.player.y / TILE)) * METERS_PER_TILE);
    const label = `${t.label} · ${dist} m`;
    ctx.font = `bold ${Math.max(11, Math.round(z * 3.4))}px "Pixelify Sans", monospace`;
    const lw = ctx.measureText(label).width + 10;
    const lx = Math.min(W - lw / 2 - 4, Math.max(lw / 2 + 4, ex - Math.cos(a) * 36));
    const ly = Math.min(H - 14, Math.max(14, ey - Math.sin(a) * 30));
    ctx.fillStyle = 'rgba(18,14,16,0.8)';
    ctx.fillRect(lx - lw / 2, ly - 10, lw, 20);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
  }

  /**
   * Image d'une machine telle qu'elle apparaît dans le jeu (pour le magasin), en data URL.
   * Le dessin est fait avec les mêmes fonctions que la mine, puis recadré au plus juste.
   */
  machineIcon(id: string): string {
    const cached = this.icons.get(id);
    if (cached !== undefined) return cached;
    const factory = STRUCTURE_FACTORIES[id];
    if (!factory && id !== 'wagon') return '';
    const s = factory ? factory.create(0, 0, 0) : null;
    // Place pour les machines de plusieurs cases (fonderie 2×2).
    const W = 28 + ((s?.w ?? 1) - 1) * TILE;
    const H = 40 + ((s?.h ?? 1) - 1) * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ictx = canvas.getContext('2d')!;
    ictx.imageSmoothingEnabled = false;
    ictx.translate(6, 20);
    const saved = this.ctx;
    this.ctx = ictx;
    try {
      if (!s) this.drawWagon(null, 8, 8);
      else if (s instanceof Conveyor) this.drawConveyor(s);
      else if (s instanceof Splitter) this.drawSplitter(s);
      else if (s instanceof Bridge) this.drawBridgeFoot(s);
      else if (s instanceof RailSwitch) this.drawTrack(s, (1 << 0) | (1 << 1) | (1 << 2));
      else if (s instanceof Rail || s instanceof RailStation) this.drawTrack(s, (1 << 0) | (1 << 2));
      else this.drawStructure(s);
    } finally {
      this.ctx = saved;
    }
    // Recadrage sur les pixels dessinés.
    const data = ictx.getImageData(0, 0, W, H).data;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[(y * W + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    let url = '';
    if (x1 >= 0) {
      const crop = document.createElement('canvas');
      crop.width = x1 - x0 + 1;
      crop.height = y1 - y0 + 1;
      crop.getContext('2d')!.drawImage(canvas, -x0, -y0);
      url = crop.toDataURL();
    }
    this.icons.set(id, url);
    return url;
  }

  /** Effets associés aux événements de simulation. */
  onBreak(tx: number, ty: number, blockId: number): void {
    const b = getBlock(blockId);
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    this.fx.emit('chip', cx, cy, b.top, 10, 55);
    this.fx.emit('chip', cx, cy, b.side, 6, 45);
    this.fx.emit('dust', cx, cy, 'rgba(150,135,120,0.55)', 6, 25);
    this.fx.shake = Math.max(this.fx.shake, 2.2);
  }

  onHit(tx: number, ty: number, blockId: number, px: number, py: number): void {
    const b = getBlock(blockId);
    // Éclats côté joueur.
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    const ex = cx + clamp(px - cx, -7, 7);
    const ey = cy + clamp(py - 6 - cy, -7, 7);
    this.fx.emit('chip', ex, ey, b.top, 4, 35);
    this.fx.emit('dust', ex, ey, 'rgba(150,135,120,0.45)', 2, 15);
    this.fx.shake = Math.max(this.fx.shake, 1);
  }

  /** Coup de marteau-piqueur : poussière sur la case visée et légère secousse. */
  onHurt(amount: number): void {
    this.hurtFlash = Math.min(1, this.hurtFlash + (amount >= 10 ? 1 : 0.5));
  }

  /** Arrivée par la corde de rappel : le mineur se pose au sol (petite chute) après être sorti de l'écran. */
  onRopeArrive(): void {
    this.landT = ROPE_LAND_TIME;
  }

  onRumble(tx: number, ty: number): void {
    this.fx.shake = Math.max(this.fx.shake, 2);
    for (let k = 0; k < 12; k++) this.fx.emit('dust', (tx + 0.5 + (Math.random() - 0.5) * 5) * TILE, (ty + 0.5 + (Math.random() - 0.5) * 5) * TILE, 'rgba(150,130,110,0.7)', 1, 16);
  }

  onCollapse(tx: number, ty: number): void {
    this.fx.shake = Math.max(this.fx.shake, 6);
    for (let k = 0; k < 40; k++)
      this.fx.emit(k % 3 ? 'dust' : 'chip', (tx + 0.5 + (Math.random() - 0.5) * 5) * TILE, (ty + 0.5 + (Math.random() - 0.5) * 5) * TILE, k % 3 ? 'rgba(140,120,100,0.8)' : '#8a7662', 1, 40);
  }

  onGasRelease(tx: number, ty: number): void {
    this.fx.emit('smoke', (tx + 0.5) * TILE, (ty + 0.5) * TILE, 'rgba(170,200,90,0.7)', 18, 30);
  }

  onFlood(tx: number, ty: number): void {
    this.fx.emit('dust', (tx + 0.5) * TILE, (ty + 0.5) * TILE, 'rgba(110,170,240,0.8)', 24, 60);
  }

  onHammer(): void {
    const t = this.state?.player.swingTarget;
    if (t) this.fx.emit('dust', (t.tx + 0.5) * TILE, (t.ty + 0.7) * TILE, 'rgba(150,135,120,0.45)', 2, 22);
    this.fx.shake = Math.max(this.fx.shake, 0.9);
  }

  onDenied(tx: number, ty: number, px: number, py: number): void {
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    this.fx.emit('spark', cx + clamp(px - cx, -7, 7), cy + clamp(py - 6 - cy, -7, 7), '#ffe28a', 7, 70);
  }

  onPickup(res: string, n: number, x: number, y: number): void {
    const r = getResource(res);
    this.fx.text(`+${n} ${r.name}`, x, y - 10, r.light);
  }
}
