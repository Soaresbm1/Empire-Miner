/**
 * Foreuse de percement : un véhicule à tête rotative qui avance tout droit (dans le
 * sens de sa flèche) en perçant la roche, jusqu'à la longueur demandée.
 *
 * Chaque case percée se comporte comme un bloc miné à la pioche (gisement laissé au
 * sol, minerais lâchés), mais les morceaux tombent derrière la machine, dans le
 * tunnel. Elle brûle du charbon tant qu'elle travaille et révèle le tunnel sur la
 * carte. Elle s'arrête d'elle-même au bout, sans charbon, ou devant un obstacle
 * (roche indestructible, bord de la mine, machine) ; le joueur ou un wagonnet sur
 * son chemin la fait seulement patienter.
 */
import { TILE } from '../../core/constants';
import { DX, DY, type Dir } from '../../core/dir';
import { getBlock } from '../../data/blocks';
import { BorerSpec, getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

export type BorerStatus = 'idle' | 'digging' | 'moving' | 'waiting' | 'nofuel' | 'blocked' | 'done';

export class TunnelBorer extends Structure {
  readonly type = 'borer';
  readonly def: MachineDef;
  /** Charbon en réserve et temps de combustion restant (s). */
  fuelUnits = 0;
  burn = 0;
  /** Démarrée par le joueur (elle peut être en marche mais bloquée ou sans charbon). */
  running = false;
  status: BorerStatus = 'idle';
  /** Raison du blocage, affichée dans le panneau. */
  blockReason = '';
  /** Longueur de tunnel demandée (cases), 0 = sans limite. */
  length: number;
  /** Cases parcourues depuis le dernier démarrage, et au total. */
  dug = 0;
  totalDug = 0;
  /** Dégâts accumulés sur la case devant elle. */
  work = 0;
  /** Progression du déplacement vers la case libérée (s). */
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

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Temps de travail restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Accepte son charbon de tous les côtés, comme une foreuse (convoyeur, coffre collé). */
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

  /** Chargement manuel de charbon. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    return k;
  }

  /** Démarre (ou relance) le percement pour la longueur choisie. */
  start(): void {
    this.running = true;
    this.dug = 0;
    this.status = 'digging';
    this.blockReason = '';
  }

  stop(): void {
    this.running = false;
    this.status = 'idle';
    this.moveT = 0;
  }

  update(dt: number, ctx: StructureContext): void {
    if (!this.running) return;
    if (this.length > 0 && this.dug >= this.length) {
      this.running = false;
      this.status = 'done';
      ctx.emit({ t: 'message', text: `Foreuse de percement : tunnel de ${this.dug} cases terminé.`, kind: 'good' });
      return;
    }
    const w = ctx.world;
    const nx = this.x + DX[this.dir];
    const ny = this.y + DY[this.dir];
    if (!w.inBounds(nx, ny)) return this.block(ctx, 'bord de la mine');
    if (ctx.structureAt(nx, ny)) return this.block(ctx, 'une machine barre le passage');
    const solid = w.isSolid(nx, ny);
    const block = getBlock(w.get(nx, ny));
    if (solid && !block.breakable) return this.block(ctx, `${block.name.toLowerCase()} indestructible`);
    if (solid && block.tier > this.spec.tier) return this.block(ctx, `${block.name.toLowerCase()} trop dur`);
    if (!solid && ctx.occupied(nx, ny)) {
      this.status = 'waiting';
      return;
    }
    if (this.burn <= 0) {
      if (this.fuelUnits > 0 && this.def.fuel) {
        this.fuelUnits--;
        this.burn += this.def.fuel.secondsPerUnit;
      } else {
        this.status = 'nofuel';
        return;
      }
    }
    this.burn -= dt;
    this.activeTime += dt;
    if (solid) {
      this.status = 'digging';
      this.moveT = 0;
      this.work += this.spec.damagePerSecond * dt;
      const i = w.idx(nx, ny);
      if (this.work >= block.hp) {
        this.work = 0;
        ctx.digTile(nx, ny, { x: (this.x + 0.5) * TILE, y: (this.y + 0.5) * TILE });
      } else w.damage.set(i, this.work); // fissures visibles sur la paroi attaquée
      return;
    }
    // Case libre devant : la machine avance.
    this.status = 'moving';
    this.moveT += dt;
    if (this.moveT >= this.spec.moveTime) {
      this.moveT = 0;
      ctx.moveStructure(this, nx, ny);
      this.dug++;
      this.totalDug++;
      ctx.reveal(nx, ny);
    }
  }

  private block(ctx: StructureContext, reason: string): void {
    if (this.status !== 'blocked' || this.blockReason !== reason)
      ctx.emit({ t: 'message', text: `Foreuse de percement arrêtée : ${reason}.`, kind: 'warn' });
    this.status = 'blocked';
    this.blockReason = reason;
    this.moveT = 0;
  }

  contents(): Record<string, number> {
    return this.fuelUnits && this.def.fuel ? { [this.def.fuel.res]: this.fuelUnits } : {};
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      running: this.running,
      status: this.status,
      blockReason: this.blockReason,
      length: this.length,
      dug: this.dug,
      totalDug: this.totalDug,
      work: this.work,
    };
  }

  static load(s: StructureSave): TunnelBorer {
    const b = new TunnelBorer(s.x, s.y, s.dir);
    b.fuelUnits = Number(s.fuelUnits ?? 0);
    b.burn = Number(s.burn ?? 0);
    b.running = !!s.running;
    b.status = (s.status as BorerStatus) ?? 'idle';
    b.blockReason = String(s.blockReason ?? '');
    const len = Number(s.length);
    b.length = b.spec.lengths.includes(len) ? len : b.spec.lengths[0];
    b.dug = Number(s.dug ?? 0);
    b.totalDug = Number(s.totalDug ?? 0);
    b.work = Number(s.work ?? 0);
    return b;
  }
}
