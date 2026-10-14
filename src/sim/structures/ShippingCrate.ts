/**
 * Caisse d'expédition : accepte n'importe quel minerai (convoyeurs, machines,
 * dépôt du joueur) et le vend automatiquement à chaque passage du transporteur.
 *
 * Elle peut aussi être réglée pour livrer plutôt que vendre : sur « Commandes », le transporteur apporte ce qu'attendent
 * les commandes acceptées au Tableau d'affichage ; sur « Chantier », ce qu'attend la phase en cours du Grand Chevalement.
 * Ce dont personne n'a besoin est vendu au cours du marché, comme d'habitude : rien ne se perd, et la caisse ne se bouche pas.
 *
 * Sa capacité est limitée : si le transporteur ne passe pas assez souvent pour
 * absorber la production, la caisse se remplit et bloque les convoyeurs.
 */
import type { Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { getResource, LIGHTEST_WEIGHT } from '../../data/resources';
import type { FlowState } from '../Flow';
import { Structure, StructureContext, StructureSave } from './Structure';

/** Ce que fait le transporteur : vendre au marché, livrer aux commandes, ou livrer au chantier. */
export type ShipMode = 'market' | 'orders' | 'site';

export const SHIP_MODES: readonly ShipMode[] = ['market', 'orders', 'site'];

export const isShipMode = (v: unknown): v is ShipMode => typeof v === 'string' && (SHIP_MODES as readonly string[]).includes(v);

export class ShippingCrate extends Structure {
  readonly type = 'shipping';
  readonly def: MachineDef;
  items: Record<string, number> = {};
  /** Temps avant le prochain passage du transporteur (s). */
  timer: number;
  /** Total vendu par cette caisse ($). */
  soldTotal = 0;
  /** Vendre, ou livrer aux commandes ou au chantier (le reste est vendu). */
  mode: ShipMode = 'market';

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

  /**
   * Montant que rapportera le prochain passage ($), au cours du marché que donne `quote` (le prix de base à défaut).
   */
  pendingValue(quote: (res: string, n: number) => number = (res, n) => getResource(res).value * n): number {
    let v = 0;
    for (const [res, n] of Object.entries(this.items)) v += Math.round(quote(res, n) * this.def.stats.efficiency);
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
    this.flow.addIn();
    ctx.countDelivered(1);
    return true;
  }

  /** Pleine : elle ne reçoit plus rien, les convoyeurs qui l'alimentent s'arrêtent. */
  get full(): boolean {
    return this.capacity - this.weight() < LIGHTEST_WEIGHT - 1e-6;
  }

  flowState(): FlowState {
    return this.full ? 'stuck' : 'busy';
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
    if (!Object.values(this.items).some((count) => count > 0)) return;
    const loaded = this.items;
    this.items = {};
    // Livraison d'abord ; ce qui n'a servi à rien se vend, comme dans une caisse ordinaire.
    const rest = this.mode === 'market' ? loaded : ctx.deliver(this.mode, loaded, this);
    let n = 0;
    let delivered = 0;
    for (const [res, count] of Object.entries(loaded)) {
      n += rest[res] ?? 0;
      delivered += count - (rest[res] ?? 0);
    }
    if (delivered > 0) ctx.emit({ t: 'delivered', tx: this.x, ty: this.y, n: delivered, to: this.mode === 'site' ? 'site' : 'orders' });
    if (n === 0) return;
    let total = 0;
    for (const [res, count] of Object.entries(rest)) total += Math.round(ctx.quote(res, count) * this.def.stats.efficiency);
    this.soldTotal += total;
    ctx.autoSell(total, n, this, rest);
  }

  contents(): Record<string, number> {
    return { ...this.items };
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      items: { ...this.items },
      timer: Math.round(this.timer * 100) / 100,
      soldTotal: this.soldTotal,
      ...(this.mode !== 'market' ? { mode: this.mode } : {}),
    };
  }

  static load(s: StructureSave): ShippingCrate {
    const c = new ShippingCrate(s.x, s.y, s.dir);
    c.items = { ...((s.items as Record<string, number>) ?? {}) };
    c.timer = Math.min(c.interval, Math.max(0, Number(s.timer ?? c.interval)));
    c.soldTotal = Number(s.soldTotal ?? 0);
    c.mode = isShipMode(s.mode) ? s.mode : 'market';
    return c;
  }
}
