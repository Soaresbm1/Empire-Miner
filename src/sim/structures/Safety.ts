/**
 * Sécurité de la mine : étai (consolide le plafond), ventilateur (chasse le grisou) et
 * pompe (assèche les galeries inondées, au charbon).
 */
import type { Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

/** Étai de bois : on passe dessous ; il empêche les éboulements autour de lui. */
export class Prop extends Structure {
  readonly type = 'prop';
  readonly inert = true;

  constructor(x: number, y: number) {
    super(x, y, 0);
    this.solid = false;
  }
}

/** Ventilateur : tourne tout seul et dissipe très vite le grisou autour de lui. */
export class Fan extends Structure {
  readonly type = 'fan';
  readonly inert = true;
  /** Il y a du gaz à chasser (animation). */
  active = false;
  spin = 0;

  update(dt: number, ctx: StructureContext): void {
    this.active = ctx.hazards.ventilate(this.x, this.y, dt);
    this.spin += dt * (this.active ? 14 : 3);
  }
}

export type PumpStatus = 'idle' | 'ok' | 'nofuel';

/** Pompe : retire l'eau autour d'elle, en brûlant du charbon seulement quand elle pompe. */
export class Pump extends Structure {
  readonly type = 'pump';
  readonly def: MachineDef;
  fuelUnits = 0;
  burn = 0;
  status: PumpStatus = 'idle';
  /** Temps de pompage cumulé (animation). */
  activeTime = 0;

  constructor(x: number, y: number, dir: Dir = 0) {
    super(x, y, dir);
    this.def = getMachine('pump');
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  canAccept(res: string): boolean {
    return !!this.def.fuel && res === this.def.fuel.res && this.fuelUnits < this.fuelMax;
  }

  accept(res: string): boolean {
    if (!this.canAccept(res)) return false;
    this.fuelUnits++;
    return true;
  }

  fuelWanted(): string | null {
    return this.def.fuel && this.fuelUnits < this.fuelMax ? this.def.fuel.res : null;
  }

  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    return k;
  }

  update(dt: number, ctx: StructureContext): void {
    if (!ctx.hazards.waterNear(this.x, this.y)) {
      this.status = 'idle';
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
    ctx.hazards.pump(this.x, this.y, dt);
  }

  contents(): Record<string, number> {
    return this.fuelUnits && this.def.fuel ? { [this.def.fuel.res]: this.fuelUnits } : {};
  }

  serialize(): StructureSave {
    return { ...super.serialize(), fuelUnits: this.fuelUnits, burn: this.burn };
  }

  static load(s: StructureSave): Pump {
    const p = new Pump(s.x, s.y, s.dir);
    p.fuelUnits = Math.min(p.fuelMax, Number(s.fuelUnits ?? 0));
    p.burn = Number(s.burn ?? 0);
    return p;
  }
}
