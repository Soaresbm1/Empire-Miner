/**
 * Coffre de stockage : accepte n'importe quel minerai, limité en poids.
 * Si un convoyeur est collé au coffre (sans pointer vers lui), le coffre s'y vide :
 * il peut ainsi servir de tampon au milieu d'une chaîne.
 * Il recharge aussi en combustible (charbon) les foreuses collées, en priorité.
 */
import { DX, DY, type Dir } from '../../core/dir';
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

  /** Ressource suivante à sortir (tour de rôle entre les types de minerai). */
  private resCursor = 0;

  update(_dt: number, ctx: StructureContext): void {
    this.refuelNeighbors(ctx);
    // Au plus un objet par côté et par pas : le débit reste limité par les convoyeurs.
    for (let k = 0; k < 4; k++) {
      const keys = Object.keys(this.items);
      if (!keys.length) return;
      const res = keys[this.resCursor % keys.length];
      if (!this.pushToAdjacentConveyor(res, ctx)) return;
      this.take(res, 1);
      this.resCursor++;
    }
  }

  accept(res: string, _travel: Dir, ctx: StructureContext): boolean {
    if (!this.canAccept(res)) return false;
    this.items[res] = (this.items[res] ?? 0) + 1;
    ctx.countDelivered(1);
    return true;
  }

  /** Remplit le réservoir des machines collées qui réclament un combustible présent dans le coffre. */
  private refuelNeighbors(ctx: StructureContext): void {
    for (let d = 0; d < 4; d++) {
      const machine = ctx.structureAt(this.x + DX[d], this.y + DY[d]);
      if (!machine) continue;
      let res = machine.fuelWanted();
      while (res && (this.items[res] ?? 0) > 0 && machine.accept(res, d as Dir, ctx)) {
        this.take(res, 1);
        res = machine.fuelWanted();
      }
    }
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
