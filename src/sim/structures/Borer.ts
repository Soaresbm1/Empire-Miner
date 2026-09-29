/**
 * Foreuse de percement : une base fixe, posée et chargée en charbon, et une foreuse
 * sur chenilles qui en sort pour percer un tunnel droit devant la flèche de la base.
 *
 * La foreuse emporte un plein de charbon pris dans la base et ne le brûle que pour
 * percer : rouler dans le tunnel est gratuit. Chaque case percée se comporte comme un
 * bloc miné à la pioche (gisement laissé au sol, minerais lâchés derrière elle).
 * Elle rentre toute seule à la base quand son plein est vide, quand elle ne peut plus
 * percer (roche indestructible ou trop dure, bord de la mine, machine), quand le
 * tunnel a la longueur demandée ou quand on la rappelle. Rentrée faute de charbon,
 * elle refait le plein dans la base et repart au bout du tunnel : une base alimentée
 * (convoyeur, coffre de charbon collé) la fait creuser sans intervention.
 *
 * Améliorations (achetées sur la base, foreuse rangée) : moteur renforcé (perce et
 * roule plus vite, plus de charbon emporté), tête large (tunnel de 3 cases) et benne
 * à minerai (le minerai percé est ramené à la base, qui le pousse dans un convoyeur
 * ou un coffre collé ; le charbon ramené remplit la réserve de la base).
 */
import { TILE } from '../../core/constants';
import { DX, DY, type Dir } from '../../core/dir';
import { BlockDef, getBlock } from '../../data/blocks';
import { BorerLevelSpec, BorerSpec, getMachine, MachineDef, MachineLevel } from '../../data/machines';
import { getResource } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export type BorerStatus = 'idle' | 'moving' | 'digging' | 'returning' | 'waiting' | 'nofuel' | 'full' | 'blocked' | 'done';
/** Pourquoi la foreuse rentre à la base. */
export type ReturnReason = 'fuel' | 'full' | 'blocked' | 'done' | 'recall';

const STATUSES: BorerStatus[] = ['idle', 'moving', 'digging', 'returning', 'waiting', 'nofuel', 'full', 'blocked', 'done'];
const REASONS: ReturnReason[] = ['fuel', 'full', 'blocked', 'done', 'recall'];

/** La benne ne garde pas ce qui s'effrite au sol (la pierre) : seulement le minerai. */
function worthCarrying(res: string): boolean {
  return getResource(res).groundLife === undefined;
}

function count(items: Record<string, number>): number {
  let n = 0;
  for (const k in items) n += items[k];
  return n;
}

export class TunnelBorer extends Structure {
  readonly type = 'borer';
  readonly def: MachineDef;
  /** Niveau d'amélioration (voir `def.levels`). */
  level = 1;
  /** Charbon en réserve dans la base. */
  fuelUnits = 0;
  /** Charbon emporté par la foreuse, et temps de combustion restant de l'unité entamée (s). */
  tank = 0;
  burn = 0;
  /** Mise en marche par le joueur (elle peut être en marche mais attendre du charbon). */
  running = false;
  status: BorerStatus = 'idle';
  /** Raison du dernier blocage ou de l'attente, affichée dans le panneau. */
  blockReason = '';
  /** Pourquoi elle rentre (null : elle ne rentre pas). */
  returning: ReturnReason | null = null;
  /** Longueur de tunnel demandée, comptée depuis la base (0 = sans limite). */
  length: number;
  /** Position de la foreuse, en cases depuis la base (0 = rangée dans la base). */
  dist = 0;
  /** Longueur de tunnel déjà ouverte devant la base (la plus loin où elle est allée). */
  tunnel = 0;
  /** Cases percées au total. */
  totalDug = 0;
  /** Dégâts accumulés sur la case attaquée (`workAt` : son index dans le monde). */
  work = 0;
  private workAt = -1;
  /** Progression du trajet vers la case suivante (s). */
  moveT = 0;
  /** Temps de travail cumulé (animation). */
  activeTime = 0;
  /** Benne de la foreuse (niveau 4) et minerai gardé dans la base. */
  load: Record<string, number> = {};
  store: Record<string, number> = {};
  /** Minerai ramené au total. */
  collected = 0;
  private outCursorBase = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('borer');
    this.length = this.spec.lengths[0];
  }

  get spec(): BorerSpec {
    return this.def.borer!;
  }

  get levels(): MachineLevel[] {
    return this.def.levels!;
  }

  get maxLevel(): number {
    return this.levels.length;
  }

  levelDef(level = this.level): MachineLevel {
    return this.levels[Math.max(1, Math.min(level, this.maxLevel)) - 1];
  }

  nextLevel(): MachineLevel | null {
    return this.level < this.maxLevel ? this.levelDef(this.level + 1) : null;
  }

  /** Caractéristiques de la foreuse à son niveau actuel. */
  get stats(): BorerLevelSpec {
    return this.levelDef().borer!;
  }

  /** Réserve de charbon de la base (unités). */
  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Plein de la foreuse (unités). */
  get tankMax(): number {
    return this.stats.tankUnits;
  }

  /** Rangée dans sa base (ni sortie, ni en route). */
  get home(): boolean {
    return this.dist === 0 && this.moveT === 0;
  }

  /** Case à `k` cases de la base, dans le sens de sa flèche. */
  tileAt(k: number): { x: number; y: number } {
    return { x: this.x + DX[this.dir] * k, y: this.y + DY[this.dir] * k };
  }

  /** Front de taille à `k` cases de la base : la case du tunnel, puis à gauche et à droite (tête large). */
  faceTiles(k: number): { x: number; y: number }[] {
    const c = this.tileAt(k);
    if (this.stats.width === 1) return [c];
    const l = (this.dir + 3) % 4;
    const r = (this.dir + 1) % 4;
    return [c, { x: c.x + DX[l], y: c.y + DY[l] }, { x: c.x + DX[r], y: c.y + DY[r] }];
  }

  /** Position de la foreuse en cases depuis la base, trajet en cours compris (pour le dessin). */
  vehiclePos(): number {
    const f = Math.min(1, this.moveT / this.stats.moveTime);
    return this.dist + (this.returning ? -f : f);
  }

  /** Vrai si la foreuse, sortie de sa base, occupe la case (celle où elle est, et celle où elle va). */
  occupies(x: number, y: number): boolean {
    if (this.home) return false;
    const k = DX[this.dir] ? (x - this.x) * DX[this.dir] : (y - this.y) * DY[this.dir];
    if (k <= 0 || this.tileAt(k).x !== x || this.tileAt(k).y !== y) return false;
    if (k === this.dist) return true;
    return this.moveT > 0 && k === this.dist + (this.returning ? -1 : 1);
  }

  /** Temps de travail restant, charbon de la base compris (s). */
  fuelSeconds(): number {
    return this.burn + (this.tank + this.fuelUnits) * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Le tunnel a déjà la longueur demandée. */
  get complete(): boolean {
    return this.length > 0 && this.tunnel >= this.length;
  }

  /** Morceaux dans la benne de la foreuse. */
  loadCount(): number {
    return count(this.load);
  }

  /** Morceaux gardés dans la base. */
  storeCount(): number {
    return count(this.store);
  }

  /** La benne est pleine (toujours faux sans benne). */
  get hopperFull(): boolean {
    return this.stats.hopper > 0 && this.loadCount() >= this.stats.hopper;
  }

  /** La base accepte son charbon de tous les côtés, comme une foreuse (convoyeur, coffre collé). */
  canAccept(res: string, _travel: Dir): boolean {
    return !!this.def.fuel && res === this.def.fuel.res && this.fuelUnits < this.fuelMax;
  }

  fuelWanted(): string | null {
    return this.def.fuel && this.fuelUnits < this.fuelMax ? this.def.fuel.res : null;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    this.fuelUnits++;
    return true;
  }

  /** Chargement manuel de charbon dans la base. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    return k;
  }

  /** Retire du minerai gardé dans la base (récupération par le joueur). */
  takeStored(res: string, n: number): number {
    const k = Math.min(n, this.store[res] ?? 0);
    if (k <= 0) return 0;
    this.store[res] -= k;
    if (!this.store[res]) delete this.store[res];
    return k;
  }

  /** Met la foreuse en marche (ou annule son rappel). Refusé si le tunnel est déjà fini. */
  start(): boolean {
    if (this.complete) {
      if (this.home) this.status = 'done';
      return false;
    }
    this.running = true;
    this.blockReason = '';
    if (this.returning && this.returning !== 'fuel' && this.returning !== 'full') {
      this.returning = null;
      this.moveT = 0;
    }
    if (this.home && this.status !== 'nofuel') this.status = 'moving';
    return true;
  }

  /** Rappelle la foreuse : elle rentre à la base et s'y arrête. */
  stop(): void {
    this.running = false;
    if (this.home) {
      this.status = 'idle';
      return;
    }
    if (!this.returning) this.moveT = 0; // elle faisait route vers le front : demi-tour
    if (!this.returning || this.returning === 'fuel' || this.returning === 'full') this.returning = 'recall';
    this.status = 'returning';
  }

  /** La base a été tournée : un nouveau tunnel commence (elle ne tourne que foreuse rangée). */
  turned(): void {
    this.tunnel = 0;
    this.work = 0;
    this.workAt = -1;
    if (this.status === 'done' || this.status === 'blocked') this.status = 'idle';
  }

  update(dt: number, ctx: StructureContext): void {
    this.outputStore(ctx);
    if (this.home) {
      if (this.loadCount()) this.unload();
      if (!this.running) return;
      if (this.complete) {
        this.running = false;
        this.status = 'done';
        return;
      }
      if (this.hopperFull) {
        this.status = 'full'; // la base est pleine : elle attend qu'on la vide
        return;
      }
      // Le plein se prend au départ (pas pendant qu'elle perce la case juste devant la base).
      if (this.status !== 'digging' && !this.refuel()) {
        if (this.status !== 'nofuel') ctx.emit({ t: 'message', text: 'Foreuse de percement : plus de charbon dans la base.', kind: 'warn' });
        this.status = 'nofuel';
        return;
      }
    }
    if (this.returning) this.comeBack(dt, ctx);
    else this.advance(dt, ctx);
  }

  /** Remplit le plein de la foreuse avec le charbon de la base. Vrai si elle a de quoi percer. */
  private refuel(): boolean {
    const k = Math.min(this.tankMax - this.tank, this.fuelUnits);
    if (k > 0) {
      this.tank += k;
      this.fuelUnits -= k;
    }
    return this.tank > 0 || this.burn > 0;
  }

  /** Vide la benne dans la base : le charbon dans la réserve, le reste dans le stock de minerai. */
  private unload(): void {
    const fuel = this.def.fuel?.res;
    for (const res of Object.keys(this.load)) {
      let n = this.load[res];
      if (res === fuel) n -= this.addFuel(n);
      const room = this.spec.store - this.storeCount();
      const k = Math.min(n, room);
      if (k > 0) this.store[res] = (this.store[res] ?? 0) + k;
      n -= k;
      if (n > 0) this.load[res] = n;
      else delete this.load[res];
    }
  }

  /** La base pousse son minerai dans un convoyeur ou une machine collés (pas du côté du tunnel). */
  private outputStore(ctx: StructureContext): void {
    const res = Object.keys(this.store)[0];
    if (!res) return;
    for (let k = 0; k < 4; k++) {
      const d = ((this.outCursorBase + k) % 4) as Dir;
      if (d === this.dir) continue;
      const next = ctx.structureAt(this.x + DX[d], this.y + DY[d]);
      if (next && !(next instanceof TunnelBorer) && next.accept(res, d, ctx)) {
        this.takeStored(res, 1);
        this.outCursorBase = (d + 1) % 4;
        return;
      }
    }
  }

  /** Aller : rouler jusqu'au front de taille, percer (la case du tunnel puis les côtés), puis avancer. */
  private advance(dt: number, ctx: StructureContext): void {
    if (this.length > 0 && this.dist >= this.length) return this.goHome(ctx, 'done');
    const w = ctx.world;
    const [center, ...sides] = this.faceTiles(this.dist + 1);
    const { x: nx, y: ny } = center;
    if (!w.inBounds(nx, ny)) return this.goHome(ctx, 'blocked', 'bord de la mine');
    if (ctx.structureAt(nx, ny)?.solid) return this.goHome(ctx, 'blocked', 'une machine barre le passage');
    const block = getBlock(w.get(nx, ny));
    if (w.isSolid(nx, ny)) {
      if (!block.breakable) return this.goHome(ctx, 'blocked', `${block.name.toLowerCase()} indestructible`);
      if (block.tier > this.spec.tier) return this.goHome(ctx, 'blocked', `${block.name.toLowerCase()} trop dur`);
      return this.drill(dt, ctx, nx, ny, block);
    }
    // Tête large : les côtés du front sont percés avant d'avancer (sauf roche indestructible ou trop dure).
    for (const t of sides) {
      if (!w.inBounds(t.x, t.y) || !w.isSolid(t.x, t.y)) continue;
      const b = getBlock(w.get(t.x, t.y));
      if (b.breakable && b.tier <= this.spec.tier) return this.drill(dt, ctx, t.x, t.y, b);
    }
    if (ctx.occupied(nx, ny)) return this.wait('quelqu’un est sur son chemin');
    this.status = 'moving';
    this.moveT += dt;
    if (this.moveT >= this.stats.moveTime) {
      this.moveT = 0;
      this.dist++;
      this.tunnel = Math.max(this.tunnel, this.dist);
      ctx.reveal(nx, ny);
    }
  }

  /** Perce une case du front ; rentre faire le plein quand son charbon est vide, ou vider sa benne pleine. */
  private drill(dt: number, ctx: StructureContext, tx: number, ty: number, block: BlockDef): void {
    if (this.hopperFull) return this.goHome(ctx, 'full');
    if (this.burn <= 0) {
      if (this.tank <= 0 || !this.def.fuel) return this.goHome(ctx, 'fuel');
      this.tank--;
      this.burn += this.def.fuel.secondsPerUnit;
    }
    const i = ctx.world.idx(tx, ty);
    if (this.workAt !== i) {
      this.workAt = i;
      this.work = 0;
    }
    this.status = 'digging';
    this.burn -= dt;
    this.activeTime += dt;
    this.work += this.stats.damagePerSecond * dt;
    if (this.work < block.hp) {
      ctx.world.damage.set(i, this.work); // fissures visibles sur la paroi attaquée
      return;
    }
    this.work = 0;
    this.workAt = -1;
    // Les morceaux tombent à l'arrière de la foreuse, dans le tunnel (ou dans sa benne).
    const at = this.tileAt(this.dist);
    const back = { x: (at.x + 0.5 - DX[this.dir] * 0.45) * TILE, y: (at.y + 0.5 - DY[this.dir] * 0.45) * TILE };
    const pieces = ctx.digTile(tx, ty, back);
    this.totalDug++;
    if (!this.stats.hopper) return;
    for (const d of pieces) {
      if (!worthCarrying(d.res) || this.loadCount() + d.count > this.stats.hopper) continue;
      this.load[d.res] = (this.load[d.res] ?? 0) + d.count;
      this.collected += d.count;
      ctx.drops.remove(d);
    }
  }

  /** Retour : recule jusqu'à la base (elle attend si quelqu'un ou une machine bloque le tunnel). */
  private comeBack(dt: number, ctx: StructureContext): void {
    const k = this.dist - 1;
    if (k > 0) {
      const { x, y } = this.tileAt(k);
      if (ctx.structureAt(x, y)?.solid) return this.wait('une machine bloque le retour');
      if (ctx.occupied(x, y)) return this.wait('quelqu’un est sur son chemin');
    }
    this.status = 'returning';
    this.moveT += dt;
    if (this.moveT >= this.stats.moveTime) {
      this.moveT = 0;
      this.dist--;
      if (this.dist === 0) this.dock(ctx);
    }
  }

  private wait(reason: string): void {
    this.status = 'waiting';
    this.blockReason = reason;
  }

  private goHome(ctx: StructureContext, reason: ReturnReason, why = ''): void {
    this.returning = reason;
    this.moveT = 0;
    if (reason === 'blocked') {
      this.blockReason = why;
      ctx.emit({ t: 'message', text: `Foreuse de percement : ${why}, elle rentre à la base.`, kind: 'warn' });
    }
    if (this.dist === 0) this.dock(ctx);
    else this.status = 'returning';
  }

  /** Arrivée à la base : elle vide sa benne et s'arrête, sauf si elle était venue faire le plein ou vider sa benne. */
  private dock(ctx: StructureContext): void {
    const why = this.returning;
    this.returning = null;
    this.moveT = 0;
    this.unload();
    if ((why === 'fuel' || why === 'full') && this.running) {
      this.status = 'moving'; // le plein se fait à la prochaine mise à jour, puis elle repart
      return;
    }
    this.running = false;
    this.status = why === 'done' ? 'done' : why === 'blocked' ? 'blocked' : 'idle';
    if (why === 'done') ctx.emit({ t: 'message', text: `Foreuse de percement : tunnel de ${this.tunnel} cases terminé, elle est rentrée à la base.`, kind: 'good' });
  }

  /** Charbon et minerai de la base et de la foreuse (rendus au démontage, qui se fait foreuse rangée). */
  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    const add = (res: string, n: number) => {
      if (n > 0) out[res] = (out[res] ?? 0) + n;
    };
    if (this.def.fuel) add(this.def.fuel.res, this.fuelUnits + this.tank);
    for (const [res, n] of Object.entries(this.store)) add(res, n);
    for (const [res, n] of Object.entries(this.load)) add(res, n);
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      level: this.level,
      fuelUnits: this.fuelUnits,
      tank: this.tank,
      burn: this.burn,
      running: this.running,
      status: this.status,
      blockReason: this.blockReason,
      returning: this.returning,
      length: this.length,
      dist: this.dist,
      tunnel: this.tunnel,
      totalDug: this.totalDug,
      work: this.work,
      moveT: this.moveT,
      load: { ...this.load },
      store: { ...this.store },
      collected: this.collected,
    };
  }

  /** Une ancienne sauvegarde (foreuse d'un seul bloc) devient une base à l'endroit où était la machine. */
  static load(s: StructureSave): TunnelBorer {
    const b = new TunnelBorer(s.x, s.y, s.dir);
    b.level = Math.max(1, Math.min(b.maxLevel, Math.floor(Number(s.level ?? 1)) || 1));
    b.fuelUnits = Math.min(b.fuelMax, Number(s.fuelUnits ?? 0));
    b.tank = Math.min(b.tankMax, Number(s.tank ?? 0));
    b.burn = Number(s.burn ?? 0);
    b.running = !!s.running;
    b.status = STATUSES.includes(s.status as BorerStatus) ? (s.status as BorerStatus) : 'idle';
    b.blockReason = String(s.blockReason ?? '');
    b.returning = REASONS.includes(s.returning as ReturnReason) ? (s.returning as ReturnReason) : null;
    const len = Number(s.length);
    b.length = b.spec.lengths.includes(len) ? len : b.spec.lengths[0];
    b.dist = Math.max(0, Math.floor(Number(s.dist ?? 0)));
    b.tunnel = Math.max(b.dist, Number(s.tunnel ?? 0));
    b.totalDug = Number(s.totalDug ?? 0);
    b.work = Number(s.work ?? 0);
    b.moveT = Number(s.moveT ?? 0);
    const items = (v: unknown): Record<string, number> => {
      const out: Record<string, number> = {};
      if (v && typeof v === 'object')
        for (const [res, n] of Object.entries(v as Record<string, unknown>)) if (Number(n) > 0) out[res] = Math.floor(Number(n));
      return out;
    };
    b.load = items(s.load);
    b.store = items(s.store);
    b.collected = Number(s.collected ?? 0);
    return b;
  }
}
