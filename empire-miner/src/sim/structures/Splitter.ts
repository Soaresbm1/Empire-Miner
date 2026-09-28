/**
 * Séparateur : le minerai entre par l'arrière et ressort à tour de rôle
 * devant, à gauche et à droite.
 *
 * Chaque objet choisit sa sortie en passant le centre (tour de rôle entre les
 * sorties où quelque chose est branché). Si cette sortie refuse l'objet au
 * moment de sortir (pleine, bloquée), il essaie les autres : une branche
 * saturée ne bloque donc pas tout le séparateur.
 */
import { DX, DY, type Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

export interface SplitItem {
  res: string;
  /** Progression sur la tuile : 0 = entrée (arrière), 1 = sortie. */
  p: number;
  /** Sortie prévue (-1 tant que l'objet n'a pas passé le centre). */
  out: Dir | -1;
}

export class Splitter extends Structure {
  readonly type = 'splitter';
  readonly isBelt = true;
  readonly def: MachineDef;
  items: SplitItem[] = [];
  blocked = false;
  readonly speed: number;
  readonly capacity: number;
  readonly spacing: number;
  /** Prochaine sortie dans le tour de rôle (indice dans outputs()). */
  turn = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.solid = false;
    this.def = getMachine('splitter');
    this.speed = this.def.stats.speed;
    this.capacity = this.def.stats.capacity;
    this.spacing = 1 / this.capacity;
  }

  /** Sorties dans l'ordre du tour de rôle : devant, gauche, droite. */
  outputs(): Dir[] {
    const d = this.dir;
    return [d, ((d + 3) % 4) as Dir, ((d + 1) % 4) as Dir];
  }

  /** N'accepte que ce qui arrive par l'arrière (objet qui se déplace dans sa direction). */
  canAccept(_res: string, travel: Dir): boolean {
    if (travel !== this.dir) return false;
    if (this.items.length >= this.capacity) return false;
    const last = this.items[this.items.length - 1];
    return !last || last.p >= this.spacing;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    this.items.push({ res, p: 0, out: -1 });
    return true;
  }

  /** Choisit la prochaine sortie branchée (tour de rôle). */
  private plan(ctx: StructureContext): Dir {
    const outs = this.outputs();
    for (let k = 0; k < 3; k++) {
      const i = (this.turn + k) % 3;
      if (ctx.structureAt(this.x + DX[outs[i]], this.y + DY[outs[i]])) {
        this.turn = (i + 1) % 3;
        return outs[i];
      }
    }
    return this.dir;
  }

  update(dt: number, ctx: StructureContext): void {
    const step = this.speed * dt;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const limit = i === 0 ? 1 : this.items[i - 1].p - this.spacing;
      it.p = Math.min(it.p + step, Math.max(it.p, limit));
      if (it.out === -1 && it.p >= 0.5) it.out = this.plan(ctx);
    }
    const head = this.items[0];
    this.blocked = false;
    if (!head || head.p < 1) return;
    const outs = this.outputs();
    const first = head.out === -1 ? this.plan(ctx) : head.out;
    const order = [first, ...outs.filter((d) => d !== first)];
    for (const d of order) {
      const next = ctx.structureAt(this.x + DX[d], this.y + DY[d]);
      if (next && next.accept(head.res, d, ctx)) {
        this.items.shift();
        return;
      }
    }
    this.blocked = true;
  }

  downstream(at: (x: number, y: number) => Structure | undefined): Structure[] {
    return this.outputs()
      .map((d) => at(this.x + DX[d], this.y + DY[d]))
      .filter((s): s is Structure => !!s);
  }

  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of this.items) out[it.res] = (out[it.res] ?? 0) + 1;
    return out;
  }

  serialize(): StructureSave {
    return { ...super.serialize(), items: this.items.map((i) => [i.res, Math.round(i.p * 1000) / 1000, i.out]), turn: this.turn };
  }

  static load(s: StructureSave): Splitter {
    const sp = new Splitter(s.x, s.y, s.dir);
    const items = (s.items as [string, number, Dir | -1][] | undefined) ?? [];
    sp.items = items.map(([res, p, out]) => ({ res, p, out }));
    sp.turn = Number(s.turn ?? 0) % 3;
    return sp;
  }
}
