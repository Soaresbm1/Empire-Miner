/**
 * Rendu du monde sur un canvas 2D : terrain (cache par blocs), machines,
 * objets, personnage, particules et éclairage. Lecture seule de l'état de jeu.
 */
import { SURFACE_ROWS, TILE, clamp } from '../core/constants';
import { DX, DY, Dir } from '../core/dir';
import { getBlock } from '../data/blocks';
import { getMachine } from '../data/machines';
import { getResource } from '../data/resources';
import { FADE_TIME } from '../sim/Drops';
import type { GameState } from '../sim/GameState';
import { Bridge } from '../sim/structures/Bridge';
import { Rail, RailStation, RailSwitch } from '../sim/structures/Rail';
import { Wagon } from '../sim/Wagons';
import { Building } from '../sim/structures/Building';
import { Conveyor } from '../sim/structures/Conveyor';
import { TunnelBorer } from '../sim/structures/Borer';
import { Drill } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import { Sorter } from '../sim/structures/Sorter';
import { Splitter } from '../sim/structures/Splitter';
import { Storage } from '../sim/structures/Storage';
import { STRUCTURE_FACTORIES } from '../sim/structures/registry';
import type { Structure } from '../sim/structures/Structure';
import { ChunkCache } from './ChunkCache';
import { Fx } from './fx';
import {
  PICK_ANGLES,
  PICK_SIZE,
  PlayerSprites,
  buildCounterSprite,
  buildCrackSprites,
  buildLanternSprite,
  buildNuggetSprites,
  buildJackhammerSprites,
  buildPickaxeSprites,
  buildPlayerSprites,
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
  readonly fx = new Fx();
  private chunks: ChunkCache | null = null;
  private state: GameState | null = null;
  private readonly player: PlayerSprites;
  private readonly picks: HTMLCanvasElement[][];
  private readonly jacks: HTMLCanvasElement[];
  private readonly nuggets: Map<string, HTMLCanvasElement>;
  private readonly cracks: HTMLCanvasElement[];
  private readonly counter: HTMLCanvasElement;
  private readonly workshop: HTMLCanvasElement;
  private readonly lantern: HTMLCanvasElement;
  private time = 0;
  private smokeTimer = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d')!;
    this.player = buildPlayerSprites();
    this.picks = buildPickaxeSprites();
    this.jacks = buildJackhammerSprites();
    this.nuggets = buildNuggetSprites();
    this.cracks = buildCrackSprites();
    this.counter = buildCounterSprite();
    this.workshop = buildWorkshopSprite();
    this.lantern = buildLanternSprite();
    this.resize();
  }

  setState(state: GameState): void {
    this.state = state;
    this.chunks = new ChunkCache(state.world);
    this.fx.particles = [];
    this.fx.texts = [];
    this.snapCamera();
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
    if (!this.state) return;
    if (follow) {
      const tx = this.state.player.x - this.viewW / 2;
      const ty = this.state.player.y - 8 - this.viewH / 2;
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
        else if (s instanceof TunnelBorer && (s.status === 'digging' || s.status === 'moving') && this.inView(s.x * TILE, s.y * TILE, 64))
          this.fx.emit('smoke', s.x * TILE + 8 - DX[s.dir] * 5, s.y * TILE + 2 - DY[s.dir] * 5, 'rgba(90,90,96,0.6)', 1, 6);
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
    for (const l of state.layout.lamps)
      if (this.inView(l.x, l.y)) list.push({ y: l.y - 8, draw: () => ctx.drawImage(this.lantern, Math.round(l.x - this.lantern.width / 2), Math.round(l.y - 4)) });
    const ent = state.layout.entrance;
    list.push({ y: ent.y * TILE, draw: () => this.drawEntrance(ent.x, ent.y, ent.w) });
    for (const w of state.wagons.list) {
      if (!this.inView(w.px(), w.py())) continue;
      // Trié juste devant le joueur à bord : le wagonnet cache ses jambes (il est assis dedans).
      list.push({ y: w.py() + 6, draw: () => this.drawWagon(w, w.px(), w.py()) });
    }
    if (showPlayer) list.push({ y: state.player.y, draw: () => this.drawPlayer() });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    // Travées des ponts : au-dessus de tout ce qui est au sol (on passe dessous).
    for (const b of state.structures.list) if (b instanceof Bridge && b.target && this.inView(b.x * TILE, b.y * TILE, 6 * TILE)) this.drawBridgeSpan(b);

    this.drawParticles();
    this.drawLighting();

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
    const left = x * TILE - 3;
    const right = (x + w) * TILE + 1;
    const top = y * TILE - 14;
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(left, top, 4, 16);
    ctx.fillRect(right, top, 4, 16);
    ctx.fillStyle = '#6e4a2c';
    ctx.fillRect(left - 2, top - 3, right - left + 8, 5);
    ctx.fillStyle = '#8a5f38';
    ctx.fillRect(left - 2, top - 3, right - left + 8, 1);
    // Panneau
    ctx.fillStyle = '#3b2616';
    ctx.fillRect(left + 6, top - 11, right - left - 8, 8);
    ctx.fillStyle = '#d8b377';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MINE', (left + right + 4) / 2, top - 6.5);
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
    const x = b.x * TILE;
    const y = b.y * TILE;
    ctx.save();
    ctx.translate(x + 8, y + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    // Châssis (orienté vers +x)
    ctx.fillStyle = '#26262c';
    ctx.fillRect(-8, -7, 16, 14);
    ctx.fillStyle = b.def.accent ?? '#6a6b74';
    ctx.fillRect(-8, -7, 16, 2);
    ctx.fillRect(-8, 5, 16, 2);
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(-8, -5, 16, 10);
    // Lattes de la bande, animées dans le sens du transport.
    const off = b.blocked && b.items.length >= b.capacity ? 0 : (this.time * b.speed * 16) % 4;
    ctx.fillStyle = '#2f2f36';
    for (let k = -3; k < 3; k++) {
      const xx = Math.round(-8 + k * 4 + off);
      if (xx >= -8 && xx < 8) ctx.fillRect(xx, -5, 1, 10);
    }
    // Chevron central indiquant la direction.
    const chev = Math.round(((this.time * b.speed * 16) % 16) - 8);
    ctx.fillStyle = b.blocked ? '#a8563c' : '#8d8e98';
    for (let r = 0; r < 3; r++) {
      const xx = (b.blocked && b.items.length >= b.capacity ? 0 : chev) + r - 1;
      if (xx >= -8 && xx < 8) {
        ctx.fillRect(xx, -3 + r, 1, 1);
        ctx.fillRect(xx, 2 - r, 1, 1);
      }
    }
    // Rouleaux aux extrémités.
    ctx.fillStyle = '#8a8b94';
    ctx.fillRect(-8, -5, 1, 10);
    ctx.fillRect(7, -5, 1, 10);
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
    for (const d of dirs) {
      ctx.save();
      ctx.translate(x + 8, y + 8);
      ctx.rotate((d * Math.PI) / 2);
      // Traverses sombres, puis deux rails d'acier bien contrastés.
      ctx.fillStyle = '#2e1f14';
      ctx.fillRect(0, -6, 3, 12);
      ctx.fillRect(5, -6, 3, 12);
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(0, -6, 3, 1);
      ctx.fillRect(5, -6, 3, 1);
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(-2, -5, 10, 1);
      ctx.fillRect(-2, 2, 10, 1);
      ctx.fillStyle = '#d0d4dc';
      ctx.fillRect(-2, -4, 10, 1);
      ctx.fillRect(-2, 3, 10, 1);
      ctx.fillStyle = '#7a808a';
      ctx.fillRect(-2, -3, 10, 1);
      ctx.fillRect(-2, 4, 10, 1);
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
    const x = Math.round(cx - 7);
    const y = Math.round(cy - 7);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + 12, 14, 3);
    // Contour sombre (lisibilité sur les rails) et roues
    ctx.fillStyle = '#120e10';
    ctx.fillRect(x - 1, y + 1, 16, 11);
    ctx.fillRect(x + 1, y + 10, 3, 3);
    ctx.fillRect(x + 10, y + 10, 3, 3);
    // Caisse
    ctx.fillStyle = '#4a4f58';
    ctx.fillRect(x, y + 2, 14, 9);
    ctx.fillStyle = '#b8bec8';
    ctx.fillRect(x, y + 2, 14, 2);
    ctx.fillStyle = '#3a3e46';
    ctx.fillRect(x, y + 9, 14, 2);
    ctx.fillStyle = '#9aa0aa';
    ctx.fillRect(x + 3, y + 5, 1, 4);
    ctx.fillRect(x + 10, y + 5, 1, 4);
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
    ctx.save();
    ctx.translate(s.x * TILE + 8, s.y * TILE + 8);
    ctx.rotate((s.dir * Math.PI) / 2);
    ctx.fillStyle = '#26262c';
    ctx.fillRect(-8, -8, 16, 16);
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(-7, -7, 14, 14);
    // Carter
    ctx.fillStyle = s.def.accent ?? '#e0b84a';
    ctx.fillRect(-3, -8, 6, 16);
    ctx.fillStyle = '#8a6a1a';
    ctx.fillRect(-3, -8, 1, 16);
    ctx.fillStyle = '#26221e';
    for (let k = -6; k <= 6; k += 4) ctx.fillRect(-1, k, 2, 2);
    ctx.restore();
    if (s instanceof Sorter) {
      // Trieur : le minerai choisi au centre, flèche verte vers l'avant, flèches grises sur les côtés.
      const [front, left, right] = s.outputs();
      this.drawArrow(s.x * TILE + 8 + DX[front] * 6, s.y * TILE + 8 + DY[front] * 6, front, s.filter ? '#7dffa0' : '#f2e6c8');
      if (s.filter) for (const d of [left, right]) this.drawArrow(s.x * TILE + 8 + DX[d] * 6, s.y * TILE + 8 + DY[d] * 6, d, '#a8957c');
      ctx.fillStyle = '#1a1418';
      ctx.fillRect(s.x * TILE + 4, s.y * TILE + 4, 8, 8);
      if (s.filter) ctx.drawImage(this.nuggets.get(s.filter)!, s.x * TILE + 4, s.y * TILE + 4);
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
    ctx.save();
    ctx.translate(b.x * TILE + 8, b.y * TILE + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    ctx.fillStyle = '#26262c';
    ctx.fillRect(-8, -7, 16, 14);
    ctx.fillStyle = '#6a6b74';
    ctx.fillRect(-8, -7, 16, 2);
    ctx.fillRect(-8, 5, 16, 2);
    // Rampe en planches, plus claire du côté haut
    const up = b.source ? -1 : 1; // sortie : la rampe descend dans le sens du transport
    for (let k = 0; k < 4; k++) {
      const shade = up > 0 ? 0.6 + k * 0.13 : 1 - k * 0.13;
      ctx.fillStyle = `rgb(${Math.round(138 * shade)},${Math.round(95 * shade)},${Math.round(56 * shade)})`;
      ctx.fillRect(-7 + k * 4, -5, 3, 10);
    }
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(up > 0 ? 5 : -7, -7, 2, 14);
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
    else if (s instanceof TunnelBorer) this.drawBorer(s);
    else if (s instanceof Storage) this.drawStorage(s);
    else if (s instanceof ShippingCrate) this.drawShipping(s);
    else if (s instanceof Building) this.drawBuilding(s);
  }

  private drawBuilding(b: Building): void {
    const img = b.type === 'counter' ? this.counter : this.workshop;
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
    const x = d.x * TILE;
    const y = d.y * TILE;
    const active = d.status === 'ok';
    const jiggle = active ? Math.round(Math.sin(this.time * 40) * 0.5) : 0;
    if (d.level > 1) this.drawDrillHeads(d);
    // Ombre et socle
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 1, y + 13, 15, 3);
    ctx.fillStyle = '#2d2e33';
    ctx.fillRect(x + 1, y + 3, 14, 12);
    // Carter jaune (face avant visible : relief)
    ctx.fillStyle = '#d9a526';
    ctx.fillRect(x + 2, y + jiggle, 12, 11);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(x + 2, y + jiggle, 12, 2);
    ctx.fillStyle = '#a57a14';
    ctx.fillRect(x + 2, y + 9 + jiggle, 12, 3);
    // Bandes de danger
    ctx.fillStyle = '#26221e';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 3 + k * 3, y + 10 + jiggle, 1, 2);
    // Engrenage rotatif
    const a = d.activeTime * 7;
    const cx = x + 8;
    const cy = y + 5 + jiggle;
    ctx.fillStyle = '#4a4b52';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
    ctx.fillStyle = '#9aa0aa';
    for (let k = 0; k < 4; k++) {
      const aa = a + (k * Math.PI) / 2;
      ctx.fillRect(Math.round(cx + Math.cos(aa) * 2.5) - 1, Math.round(cy + Math.sin(aa) * 2.5) - 1, 2, 2);
    }
    ctx.fillStyle = '#2d2e33';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    // Pot d'échappement
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(x + 11, y - 2 + jiggle, 2, 4);
    // Flèche de sortie
    this.drawArrow(x + 8 + DX[d.dir] * 6, y + 8 + DY[d.dir] * 6, d.dir, '#ffffff');
    // Jauge de combustible
    const fuel = d.fuelSeconds() / (d.fuelMax * (d.def.fuel?.secondsPerUnit ?? 1));
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fuel > 0.2 ? '#f08a24' : '#d0342c';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fuel)), 2);
    if (active && Math.random() < 0.15) this.fx.emit('dust', x + 8, y + 13, 'rgba(160,140,120,0.5)', 1, 10);
  }

  /** Foreuse de percement : caisson sur chenilles, tête de coupe rotative du côté de sa flèche. */
  private drawBorer(b: TunnelBorer): void {
    const ctx = this.ctx;
    const x = b.x * TILE;
    const y = b.y * TILE;
    const digging = b.status === 'digging';
    const working = digging || b.status === 'moving';
    const jig = digging ? Math.round(Math.sin(this.time * 45) * 0.5) : 0;
    // Ombre, chenilles (les maillons défilent quand elle avance).
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 1, y + 13, 15, 3);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 1, y + 10, 14, 5);
    ctx.fillStyle = '#5b5b63';
    const roll = b.status === 'moving' ? Math.floor(this.time * 12) % 3 : 0;
    for (let k = roll; k < 14; k += 3) ctx.fillRect(x + 1 + k, y + 13, 1, 1);
    // Caisson.
    ctx.fillStyle = '#c8472e';
    ctx.fillRect(x + 2, y + 1 + jig, 12, 10);
    ctx.fillStyle = '#e2603f';
    ctx.fillRect(x + 2, y + 1 + jig, 12, 2);
    ctx.fillStyle = '#8f2f1f';
    ctx.fillRect(x + 2, y + 9 + jig, 12, 2);
    // Cabine et bandes de danger.
    ctx.fillStyle = '#26221e';
    ctx.fillRect(x + 5, y + 3 + jig, 6, 4);
    ctx.fillStyle = working ? '#ffe28a' : '#6a6048';
    ctx.fillRect(x + 6, y + 4 + jig, 2, 1);
    ctx.fillStyle = '#f2c230';
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 3 + k * 4, y + 9 + jig, 2, 1);
    // Tête de coupe : dessinée vers l'est puis tournée d'un quart de tour (pixels nets).
    ctx.save();
    ctx.translate(x + 8, y + 8);
    ctx.rotate((b.dir * Math.PI) / 2);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(4, -7, 6, 14);
    ctx.fillStyle = '#4a4b52';
    ctx.fillRect(4, -2, 2, 4);
    const phase = working ? Math.floor(b.activeTime * 18) : 0;
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

  private drawStorage(s: Storage): void {
    const ctx = this.ctx;
    const x = s.x * TILE;
    const y = s.y * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 1, y + 13, 15, 3);
    // Dessus
    ctx.fillStyle = '#8a5f38';
    ctx.fillRect(x + 1, y - 1, 14, 10);
    ctx.fillStyle = '#a8764a';
    ctx.fillRect(x + 1, y - 1, 14, 1);
    // Face avant
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(x + 1, y + 9, 14, 6);
    ctx.fillStyle = '#4a2f1a';
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 1, y + 1 + k * 3, 14, 1);
    // Ferrures
    ctx.fillStyle = '#9aa0aa';
    ctx.fillRect(x + 1, y - 1, 2, 16);
    ctx.fillRect(x + 13, y - 1, 2, 16);
    ctx.fillStyle = '#e0b84a';
    ctx.fillRect(x + 7, y + 10, 2, 3);
    // Aperçu du contenu (minerai dominant) + jauge
    const entries = Object.entries(s.items).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      ctx.drawImage(this.nuggets.get(entries[0][0])!, x + 4, y + 1);
      if (entries[1]) ctx.drawImage(this.nuggets.get(entries[1][0])!, x + 7, y + 2);
    }
    const fill = s.weight() / s.capacity;
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 1, y + 15, 14, 2);
    ctx.fillStyle = fill > 0.9 ? '#d0342c' : '#6fcf6a';
    ctx.fillRect(x + 1, y + 15, Math.round(14 * Math.min(1, fill)), 2);
  }

  /** Caisse d'expédition : caisse verte ouverte, panneau à pièce et minuteur du transporteur. */
  private drawShipping(c: ShippingCrate): void {
    const ctx = this.ctx;
    const x = c.x * TILE;
    const y = c.y * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 1, y + 13, 15, 3);
    // Poteau et panneau « pièce »
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(x + 12, y - 7, 2, 8);
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 9, y - 13, 8, 7);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(x + 10, y - 12, 6, 5);
    ctx.fillStyle = '#a07410';
    ctx.fillRect(x + 12, y - 11, 2, 3);
    // Minuteur du transporteur (se remplit jusqu'au prochain passage)
    const t = 1 - c.timer / c.interval;
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x + 9, y - 16, 8, 2);
    ctx.fillStyle = '#6fb3ff';
    ctx.fillRect(x + 9, y - 16, Math.round(8 * Math.min(1, Math.max(0, t))), 2);
    // Caisse : dessus ouvert puis face avant
    ctx.fillStyle = '#3f8a5e';
    ctx.fillRect(x + 1, y + 1, 12, 8);
    ctx.fillStyle = '#5fae7a';
    ctx.fillRect(x + 1, y + 1, 12, 1);
    ctx.fillStyle = '#16221b';
    ctx.fillRect(x + 3, y + 3, 8, 5);
    const entries = Object.entries(c.items).sort((a, b) => b[1] - a[1]);
    entries.slice(0, 2).forEach(([res], i) => ctx.drawImage(this.nuggets.get(res)!, x + 3 + i * 3, y + 2 + i));
    ctx.fillStyle = '#2f6b4a';
    ctx.fillRect(x + 1, y + 9, 12, 6);
    ctx.fillStyle = '#244f38';
    ctx.fillRect(x + 1, y + 11, 12, 1);
    ctx.fillRect(x + 1, y + 13, 12, 1);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(x + 6, y + 10, 2, 2);
    // Jauge de remplissage
    const fill = c.weight() / c.capacity;
    ctx.fillStyle = '#1a1418';
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
      let icon: 'nofuel' | 'full' | 'stop' | null = null;
      if (s instanceof Drill && s.status !== 'ok') icon = s.status === 'nofuel' ? 'nofuel' : s.status === 'full' ? 'full' : 'stop';
      else if (s instanceof TunnelBorer && s.running)
        icon = s.status === 'nofuel' ? 'nofuel' : s.status === 'waiting' ? 'full' : s.status === 'blocked' ? 'stop' : null;
      if (!icon || !this.inView(s.x * TILE, s.y * TILE)) continue;
      const x = s.x * TILE + 8;
      const y = s.y * TILE - 9 + (blink ? 0 : -1);
      const color = icon === 'nofuel' ? '#d0342c' : icon === 'full' ? '#e0a020' : '#7a7a86';
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

  private drawPlayer(): void {
    const state = this.state!;
    const p = state.player;
    const ctx = this.ctx;
    const frames = this.player.frames[p.facing];
    const walking = p.moving && p.swingT <= 0;
    const frame = walking ? 1 + (Math.floor(p.walkTime * 8) % 2) : 0;
    const img = frames[frame];
    const bob = walking && frame === 1 ? -1 : 0;
    const x = Math.round(p.x - img.width / 2);
    const y = Math.round(p.y - img.height + 3 + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(p.x - 5), Math.round(p.y + 1), 10, 3);
    const pickBehind = p.facing === 3;
    if (pickBehind) this.drawPickaxe();
    ctx.drawImage(img, x, y);
    if (!pickBehind) this.drawPickaxe();
  }

  private drawPickaxe(): void {
    const state = this.state!;
    const p = state.player;
    // Pendant un coup, l'outil réellement utilisé (pioche de secours si le marteau n'a plus de charbon).
    const hammer = p.swingT > 0 ? p.swingTool === 'jackhammer' : state.activeTool.kind === 'jackhammer';
    if (hammer) return this.drawJackhammer();
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
    this.ctx.drawImage(img, Math.round(hx - PICK_SIZE / 2), Math.round(hy - PICK_SIZE / 2));
  }

  /** Marteau-piqueur : pointé vers la paroi et secoué pendant qu'il frappe, porté contre soi au repos. */
  private drawJackhammer(): void {
    const p = this.state!.player;
    const working = p.swingT > 0;
    const angle = working ? p.aim : p.facing === 2 ? Math.PI * 0.62 : p.facing === 0 ? Math.PI * 0.38 : p.facing === 3 ? -Math.PI * 0.5 : Math.PI * 0.5;
    const idx = ((Math.round((angle / (Math.PI * 2)) * PICK_ANGLES) % PICK_ANGLES) + PICK_ANGLES) % PICK_ANGLES;
    const jig = working ? (Math.floor(this.time * 40) % 2) * 1.2 : 0;
    const hx = p.x + (p.facing === 0 ? 3 : p.facing === 2 ? -3 : p.facing === 1 ? 4 : -4) + Math.cos(angle) * jig;
    const hy = p.y - 7 + Math.sin(angle) * jig;
    this.ctx.drawImage(this.jacks[idx], Math.round(hx - PICK_SIZE / 2), Math.round(hy - PICK_SIZE / 2));
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
      // Phare de la foreuse de percement : éclaire le front de taille.
      else if (s instanceof TunnelBorer) punch((s.x + 0.5 + DX[s.dir] * 0.8) * TILE, (s.y + 0.5 + DY[s.dir] * 0.8) * TILE, s.running ? 3.6 : 2, 0.85);
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
      if (def.rotatable) this.drawArrow(x + 8, y + 8, o.ghost.dir, o.ghost.ok ? '#7dffa0' : '#ff6b5b');
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
    const W = 28;
    const H = 40;
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
