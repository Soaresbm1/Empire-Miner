/**
 * Convoyeur : fait avancer les objets d'une tuile à la suivante.
 *
 * Chaque tuile a une capacité réelle (nombre d'objets et espacement minimum).
 * Si la sortie est bloquée ou trop lente, les objets s'accumulent : le convoyeur sature.
 */
import { DX, DY, Dir, opposite } from '../../core/dir';
import { getMachine } from '../../data/machines';
import { Structure, StructureContext, StructureSave } from './Structure';

export interface BeltItem {
  res: string;
  /** Progression sur la tuile : 0 = entrée, 1 = sortie. */
  p: number;
  /** Direction de déplacement de l'objet à son entrée (pour le rendu des virages). */
  from: Dir;
}

export class Conveyor extends Structure {
  readonly type = 'conveyor';
  items: BeltItem[] = [];
  /** Vrai si l'objet de tête attend faute de place en sortie. */
  blocked = false;
  readonly speed: number;
  readonly capacity: number;
  readonly spacing: number;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.solid = false;
    const def = getMachine('conveyor');
    this.speed = def.stats.speed;
    this.capacity = def.stats.capacity;
    this.spacing = 1 / this.capacity;
  }

  canAccept(_res: string, travel: Dir): boolean {
    if (travel === opposite(this.dir)) return false; // arrivée de face
    if (this.items.length >= this.capacity) return false;
    const last = this.items[this.items.length - 1];
    return !last || last.p >= this.spacing;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    this.items.push({ res, p: 0, from: travel });
    return true;
  }

  update(dt: number, ctx: StructureContext): void {
    const step = this.speed * dt;
    this.blocked = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const limit = i === 0 ? 1 : this.items[i - 1].p - this.spacing;
      it.p = Math.min(it.p + step, Math.max(it.p, limit));
    }
    const head = this.items[0];
    if (head && head.p >= 1) {
      const next = ctx.structureAt(this.x + DX[this.dir], this.y + DY[this.dir]);
      if (next && next.accept(head.res, this.dir, ctx)) this.items.shift();
      else this.blocked = true;
    }
  }

  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of this.items) out[it.res] = (out[it.res] ?? 0) + 1;
    return out;
  }

  serialize(): StructureSave {
    return { ...super.serialize(), items: this.items.map((i) => [i.res, Math.round(i.p * 1000) / 1000, i.from]) };
  }

  static load(s: StructureSave): Conveyor {
    const c = new Conveyor(s.x, s.y, s.dir);
    const items = (s.items as [string, number, Dir][] | undefined) ?? [];
    c.items = items.map(([res, p, from]) => ({ res, p, from }));
    return c;
  }
}
