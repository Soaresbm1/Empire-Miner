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
 */
import { TILE } from '../../core/constants';
import { DX, DY, type Dir } from '../../core/dir';
import { BlockDef, getBlock } from '../../data/blocks';
import { BorerSpec, getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

export type BorerStatus = 'idle' | 'moving' | 'digging' | 'returning' | 'waiting' | 'nofuel' | 'blocked' | 'done';
/** Pourquoi la foreuse rentre à la base. */
export type ReturnReason = 'fuel' | 'blocked' | 'done' | 'recall';

const STATUSES: BorerStatus[] = ['idle', 'moving', 'digging', 'returning', 'waiting', 'nofuel', 'blocked', 'done'];
const REASONS: ReturnReason[] = ['fuel', 'blocked', 'done', 'recall'];

export class TunnelBorer extends Structure {
  readonly type = 'borer';
  readonly def: MachineDef;
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
  /** Dégâts accumulés sur la case devant elle. */
  work = 0;
  /** Progression du trajet vers la case suivante (s). */
  moveT = 0;
  /** Temps de travail cumulé (animation). */
  activeTime = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('borer');
    this.length = this.spec.lengths[0];
  }

  get spec(): BorerSpec {
    return this.def.borer!;
  }

  /** Réserve de charbon de la base (unités). */
  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Plein de la foreuse (unités). */
  get tankMax(): number {
    return this.spec.tankUnits;
  }

  /** Rangée dans sa base (ni sortie, ni en route). */
  get home(): boolean {
    return this.dist === 0 && this.moveT === 0;
  }

  /** Case à `k` cases de la base, dans le sens de sa flèche. */
  tileAt(k: number): { x: number; y: number } {
    return { x: this.x + DX[this.dir] * k, y: this.y + DY[this.dir] * k };
  }

  /** Position de la foreuse en cases depuis la base, trajet en cours compris (pour le dessin). */
  vehiclePos(): number {
    const f = Math.min(1, this.moveT / this.spec.moveTime);
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

  /** Met la foreuse en marche (ou annule son rappel). Refusé si le tunnel est déjà fini. */
  start(): boolean {
    if (this.complete) {
      if (this.home) this.status = 'done';
      return false;
    }
    this.running = true;
    this.blockReason = '';
    if (this.returning && this.returning !== 'fuel') {
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
    if (this.returning === 'fuel' || !this.returning) this.returning = 'recall';
    this.status = 'returning';
  }

  /** La base a été tournée : un nouveau tunnel commence (elle ne tourne que foreuse rangée). */
  turned(): void {
    this.tunnel = 0;
    this.work = 0;
    if (this.status === 'done' || this.status === 'blocked') this.status = 'idle';
  }

  update(dt: number, ctx: StructureContext): void {
    if (this.home) {
      if (!this.running) return;
      if (this.complete) {
        this.running = false;
        this.status = 'done';
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

  /** Aller : rouler jusqu'au front de taille, puis percer. */
  private advance(dt: number, ctx: StructureContext): void {
    if (this.length > 0 && this.dist >= this.length) return this.goHome(ctx, 'done');
    const w = ctx.world;
    const { x: nx, y: ny } = this.tileAt(this.dist + 1);
    if (!w.inBounds(nx, ny)) return this.goHome(ctx, 'blocked', 'bord de la mine');
    if (ctx.structureAt(nx, ny)?.solid) return this.goHome(ctx, 'blocked', 'une machine barre le passage');
    const solid = w.isSolid(nx, ny);
    const block = getBlock(w.get(nx, ny));
    if (solid && !block.breakable) return this.goHome(ctx, 'blocked', `${block.name.toLowerCase()} indestructible`);
    if (solid && block.tier > this.spec.tier) return this.goHome(ctx, 'blocked', `${block.name.toLowerCase()} trop dur`);
    if (solid) return this.drill(dt, ctx, nx, ny, block);
    if (ctx.occupied(nx, ny)) return this.wait('quelqu’un est sur son chemin');
    this.status = 'moving';
    this.moveT += dt;
    if (this.moveT >= this.spec.moveTime) {
      this.moveT = 0;
      this.dist++;
      this.tunnel = Math.max(this.tunnel, this.dist);
      ctx.reveal(nx, ny);
    }
  }

  /** Perce la case devant elle ; rentre faire le plein quand son charbon est vide. */
  private drill(dt: number, ctx: StructureContext, nx: number, ny: number, block: BlockDef): void {
    if (this.burn <= 0) {
      if (this.tank <= 0 || !this.def.fuel) return this.goHome(ctx, 'fuel');
      this.tank--;
      this.burn += this.def.fuel.secondsPerUnit;
    }
    this.status = 'digging';
    this.burn -= dt;
    this.activeTime += dt;
    this.work += this.spec.damagePerSecond * dt;
    if (this.work < block.hp) {
      ctx.world.damage.set(ctx.world.idx(nx, ny), this.work); // fissures visibles sur la paroi attaquée
      return;
    }
    this.work = 0;
    // Les morceaux tombent à l'arrière de la foreuse, dans le tunnel.
    const at = this.tileAt(this.dist);
    const back = { x: (at.x + 0.5 - DX[this.dir] * 0.45) * TILE, y: (at.y + 0.5 - DY[this.dir] * 0.45) * TILE };
    ctx.digTile(nx, ny, back);
    this.totalDug++;
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
    if (this.moveT >= this.spec.moveTime) {
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

  /** Arrivée à la base : elle s'arrête, sauf si elle était seulement venue faire le plein. */
  private dock(ctx: StructureContext): void {
    const why = this.returning;
    this.returning = null;
    this.moveT = 0;
    if (why === 'fuel' && this.running) {
      this.status = 'moving'; // le plein se fait à la prochaine mise à jour, puis elle repart
      return;
    }
    this.running = false;
    this.status = why === 'done' ? 'done' : why === 'blocked' ? 'blocked' : 'idle';
    if (why === 'done') ctx.emit({ t: 'message', text: `Foreuse de percement : tunnel de ${this.tunnel} cases terminé, elle est rentrée à la base.`, kind: 'good' });
  }

  /** Charbon de la base et de la foreuse (rendu au démontage, qui se fait foreuse rangée). */
  contents(): Record<string, number> {
    const n = this.fuelUnits + this.tank;
    return n && this.def.fuel ? { [this.def.fuel.res]: n } : {};
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
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
    };
  }

  /** Une ancienne sauvegarde (foreuse d'un seul bloc) devient une base à l'endroit où était la machine. */
  static load(s: StructureSave): TunnelBorer {
    const b = new TunnelBorer(s.x, s.y, s.dir);
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
    return b;
  }
}
