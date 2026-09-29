/**
 * Caisse d'expédition : accepte n'importe quel minerai (convoyeurs, machines,
 * dépôt du joueur) et le vend automatiquement à chaque passage du transporteur.
 *
 * Sa capacité est limitée : si le transporteur ne passe pas assez souvent pour
 * absorber la production, la caisse se remplit et bloque les convoyeurs.
 */
import type { Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { getResource } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export class ShippingCrate extends Structure {
  readonly type = 'shipping';
  readonly def: MachineDef;
  items: Record<string, number> = {};
  /** Temps avant le prochain passage du transporteur (s). */
  timer: number;
  /** Total vendu par cette caisse ($). */
  soldTotal = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('shipping');
    this.timer = this.interval;
  }

  get interval(): number {
    return this.def.shipping?.interval ?? 15;
  }

  get capacity(): number {
    return this.def.stats.capacity;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.items)) w += getResource(res).weight * n;
    return w;
  }

  /** Montant que rapportera le prochain passage ($). */
  pendingValue(): number {
    let v = 0;
    for (const [res, n] of Object.entries(this.items)) v += Math.round(getResource(res).value * this.def.stats.efficiency) * n;
    return v;
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

  /** Dépôt manuel. Renvoie la quantité acceptée. */
  put(res: string, n: number): number {
    const k = Math.min(n, this.room(res));
    if (k > 0) this.items[res] = (this.items[res] ?? 0) + k;
    return k;
  }

  update(dt: number, ctx: StructureContext): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer += this.interval;
    let n = 0;
    for (const count of Object.values(this.items)) n += count;
    if (n === 0) return;
    const total = this.pendingValue();
    this.items = {};
    this.soldTotal += total;
    ctx.autoSell(total, n, this);
  }

  contents(): Record<string, number> {
    return { ...this.items };
  }

  serialize(): StructureSave {
    return { ...super.serialize(), items: { ...this.items }, timer: Math.round(this.timer * 100) / 100, soldTotal: this.soldTotal };
  }

  static load(s: StructureSave): ShippingCrate {
    const c = new ShippingCrate(s.x, s.y, s.dir);
    c.items = { ...((s.items as Record<string, number>) ?? {}) };
    c.timer = Math.min(c.interval, Math.max(0, Number(s.timer ?? c.interval)));
    c.soldTotal = Number(s.soldTotal ?? 0);
    return c;
  }
}
