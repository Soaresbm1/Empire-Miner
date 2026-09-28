/**
 * Foreuse : extrait le gisement situé sous elle et pousse chaque unité vers
 * la tuile de devant (convoyeur, coffre…). Fonctionne au charbon.
 *
 * Elle accepte du charbon comme combustible depuis un convoyeur arrivant par
 * l'arrière ou les côtés : son alimentation peut donc elle-même être automatisée.
 */
import { DX, DY, Dir, opposite } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

export type DrillStatus = 'ok' | 'nofuel' | 'full' | 'depleted';

export class Drill extends Structure {
  readonly type = 'drill';
  readonly def: MachineDef;
  /** Charbon en réserve dans la machine. */
  fuelUnits = 0;
  /** Temps de combustion restant (s). */
  burn = 0;
  progress = 0;
  buffer: string[] = [];
  status: DrillStatus = 'nofuel';
  /** Temps d'activité cumulé (animation). */
  activeTime = 0;
  extracted = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('drill');
  }

  get interval(): number {
    return 1 / this.def.stats.speed;
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Temps de fonctionnement restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  canAccept(res: string, travel: Dir): boolean {
    return !!this.def.fuel && res === this.def.fuel.res && travel !== opposite(this.dir) && this.fuelUnits < this.fuelMax;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    this.fuelUnits++;
    return true;
  }

  /** Chargement manuel de combustible. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    if (k > 0 && this.status === 'nofuel') this.status = 'ok';
    return k;
  }

  update(dt: number, ctx: StructureContext): void {
    this.tryOutput(ctx);
    if (!ctx.world.depositAt(this.x, this.y)) {
      this.status = 'depleted';
      return;
    }
    if (this.buffer.length >= this.def.stats.capacity) {
      this.status = 'full';
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
    this.status = 'ok';
    this.burn -= dt;
    this.activeTime += dt;
    this.progress += dt / this.interval;
    if (this.progress >= 1) {
      this.progress -= 1;
      const res = ctx.world.takeFromDeposit(this.x, this.y);
      if (res) {
        this.buffer.push(res);
        this.extracted++;
        ctx.emit({ t: 'extract', tx: this.x, ty: this.y, res });
        this.tryOutput(ctx);
      }
    }
  }

  private tryOutput(ctx: StructureContext): void {
    if (!this.buffer.length) return;
    const next = ctx.structureAt(this.x + DX[this.dir], this.y + DY[this.dir]);
    if (next && next.accept(this.buffer[0], this.dir, ctx)) this.buffer.shift();
  }

  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.buffer) out[r] = (out[r] ?? 0) + 1;
    if (this.fuelUnits && this.def.fuel) out[this.def.fuel.res] = (out[this.def.fuel.res] ?? 0) + this.fuelUnits;
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      progress: this.progress,
      buffer: [...this.buffer],
      extracted: this.extracted,
    };
  }

  static load(s: StructureSave): Drill {
    const d = new Drill(s.x, s.y, s.dir);
    d.fuelUnits = Number(s.fuelUnits ?? 0);
    d.burn = Number(s.burn ?? 0);
    d.progress = Number(s.progress ?? 0);
    d.buffer = [...((s.buffer as string[]) ?? [])];
    d.extracted = Number(s.extracted ?? 0);
    return d;
  }
}
