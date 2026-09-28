/** Coffre de stockage : accepte n'importe quel minerai, limité en poids. */
import type { Dir } from '../../core/dir';
import { getMachine } from '../../data/machines';
import { getResource } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export class Storage extends Structure {
  readonly type = 'storage';
  items: Record<string, number> = {};
  readonly capacity: number;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.capacity = getMachine('storage').stats.capacity;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.items)) w += getResource(res).weight * n;
    return w;
  }

  room(res: string): number {
    return Math.max(0, Math.floor((this.capacity - this.weight() + 1e-6) / getResource(res).weight));
  }

  canAccept(res: string): boolean {
    return this.room(res) >= 1;
  }

  accept(res: string, _travel: Dir, ctx: StructureContext): boolean {
    if (!this.canAccept(res)) return false;
    this.items[res] = (this.items[res] ?? 0) + 1;
    ctx.countDelivered(1);
    return true;
  }

  /** Ajout manuel (dépôt du joueur). Renvoie la quantité ajoutée. */
  put(res: string, n: number): number {
    const k = Math.min(n, this.room(res));
    if (k > 0) this.items[res] = (this.items[res] ?? 0) + k;
    return k;
  }

  take(res: string, n: number): number {
    const k = Math.min(n, this.items[res] ?? 0);
    if (k <= 0) return 0;
    const left = (this.items[res] ?? 0) - k;
    if (left > 0) this.items[res] = left;
    else delete this.items[res];
    return k;
  }

  contents(): Record<string, number> {
    return { ...this.items };
  }

  serialize(): StructureSave {
    return { ...super.serialize(), items: { ...this.items } };
  }

  static load(s: StructureSave): Storage {
    const st = new Storage(s.x, s.y, s.dir);
    st.items = { ...((s.items as Record<string, number>) ?? {}) };
    return st;
  }
}
