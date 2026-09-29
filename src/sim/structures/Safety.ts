/**
 * Sécurité de la mine : étai (consolide le plafond), ventilateur (chasse le grisou) et
 * pompe (assèche les galeries inondées). Le ventilateur et la pompe tournent tout seuls.
 */
import { Structure, StructureContext } from './Structure';

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

export type PumpStatus = 'idle' | 'ok';

/** Pompe : retire l'eau autour d'elle, toute seule (sans charbon), dès qu'il y en a. */
export class Pump extends Structure {
  readonly type = 'pump';
  readonly inert = true;
  status: PumpStatus = 'idle';
  /** Temps de pompage cumulé (animation). */
  activeTime = 0;

  update(dt: number, ctx: StructureContext): void {
    this.status = ctx.hazards.pump(this.x, this.y, dt) ? 'ok' : 'idle';
    if (this.status === 'ok') this.activeTime += dt;
  }
}
