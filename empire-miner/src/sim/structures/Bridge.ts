/**
 * Pont de convoyeur. Deux ponts orientés dans la même direction, à portée l'un de
 * l'autre et sans roche entre eux, se relient automatiquement : le premier (entrée)
 * envoie le minerai par-dessus ce qui se trouve entre les deux (convoyeurs, machines)
 * jusqu'au second (sortie), qui le pose devant lui.
 *
 * Un pont seul se comporte comme une case de convoyeur. Les liaisons sont
 * recalculées par StructureManager dès que le réseau change.
 */
import { DX, DY, opposite, type Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

/** Objets en attente de sortie devant un pont. */
const OUT_MAX = 2;

export class Bridge extends Structure {
  readonly type = 'bridge';
  readonly isBelt = true;
  readonly def: MachineDef;
  /** Pont de sortie relié (si ce pont est une entrée). */
  target: Bridge | null = null;
  /** Pont d'entrée relié (si ce pont est une sortie). */
  source: Bridge | null = null;
  /** Objets au-dessus du vide ; t = temps écoulé depuis l'entrée (s). Le plus ancien en tête. */
  transit: { res: string; t: number }[] = [];
  /** Objets prêts à sortir devant ce pont. */
  out: string[] = [];
  readonly speed: number;
  readonly perTile: number;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.solid = false;
    this.def = getMachine('bridge');
    this.speed = this.def.stats.speed;
    this.perTile = this.def.stats.capacity;
  }

  get range(): number {
    return this.def.bridge?.range ?? 5;
  }

  /** Longueur de la travée (cases), 0 si le pont n'est pas une entrée reliée. */
  span(): number {
    return this.target ? Math.abs(this.target.x - this.x) + Math.abs(this.target.y - this.y) : 0;
  }

  travelTime(): number {
    return this.span() / this.speed;
  }

  /** Temps minimal entre deux objets sur la travée. */
  private get gap(): number {
    return 1 / (this.speed * this.perTile);
  }

  canAccept(_res: string, travel: Dir): boolean {
    if (this.source) return false; // une sortie ne reçoit que de son entrée
    if (travel === opposite(this.dir)) return false; // arrivée de face
    if (this.target) {
      if (this.transit.length >= this.perTile * this.span()) return false;
      const last = this.transit[this.transit.length - 1];
      return !last || last.t >= this.gap;
    }
    return this.out.length < OUT_MAX;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    if (this.target) this.transit.push({ res, t: 0 });
    else this.out.push(res);
    return true;
  }

  /** Réception d'un objet arrivé au bout de la travée. */
  receive(res: string): boolean {
    if (this.out.length >= OUT_MAX) return false;
    this.out.push(res);
    return true;
  }

  update(dt: number, ctx: StructureContext): void {
    if (this.target) {
      const T = this.travelTime();
      for (let i = 0; i < this.transit.length; i++) {
        const it = this.transit[i];
        const limit = i === 0 ? T : this.transit[i - 1].t - this.gap;
        it.t = Math.min(it.t + dt, Math.max(it.t, limit));
      }
      const head = this.transit[0];
      if (head && head.t >= T && this.target.receive(head.res)) this.transit.shift();
    }
    if (this.out.length) {
      const next = ctx.structureAt(this.x + DX[this.dir], this.y + DY[this.dir]);
      if (next && next.accept(this.out[0], this.dir, ctx)) this.out.shift();
    }
  }

  /** Appelé quand la liaison change : ce qui était en l'air redescend devant le pont. */
  spillTransit(): void {
    for (const it of this.transit) this.out.push(it.res);
    this.transit = [];
  }

  downstream(at: (x: number, y: number) => Structure | undefined): Structure[] {
    if (this.target) return [this.target];
    const next = at(this.x + DX[this.dir], this.y + DY[this.dir]);
    return next ? [next] : [];
  }

  contents(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const r of [...this.transit.map((t) => t.res), ...this.out]) c[r] = (c[r] ?? 0) + 1;
    return c;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      transit: this.transit.map((t) => [t.res, Math.round(t.t * 1000) / 1000]),
      out: [...this.out],
    };
  }

  static load(s: StructureSave): Bridge {
    const b = new Bridge(s.x, s.y, s.dir);
    b.transit = ((s.transit as [string, number][] | undefined) ?? []).map(([res, t]) => ({ res, t }));
    b.out = [...((s.out as string[] | undefined) ?? [])];
    return b;
  }
}
