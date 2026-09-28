/**
 * Voie des wagonnets : rails et quais. Les rails se raccordent tout seuls à leurs
 * voisins (lignes droites, virages). Les quais font partie de la voie : un wagonnet
 * s'y arrête pour être rempli (quai de chargement) ou vidé (quai de déchargement).
 */
import { DX, DY, type Dir } from '../../core/dir';
import { getMachine, MachineDef } from '../../data/machines';
import { getResource } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export class Rail extends Structure {
  readonly type = 'rail';
  readonly isTrack = true;

  constructor(x: number, y: number) {
    super(x, y, 1);
    this.solid = false;
  }
}

export class RailStation extends Structure {
  readonly type: string;
  readonly isTrack = true;
  readonly def: MachineDef;
  readonly mode: 'load' | 'unload';
  items: Record<string, number> = {};
  /** Côté par lequel commencer la prochaine sortie (quai de déchargement). */
  private cursor = 0;

  constructor(x: number, y: number, machineId: 'rail_load' | 'rail_unload') {
    super(x, y, 1);
    this.solid = false;
    this.type = machineId;
    this.def = getMachine(machineId);
    this.mode = this.def.station ?? 'load';
    this.feedable = this.mode === 'load';
  }

  get capacity(): number {
    return this.def.stats.capacity;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.items)) w += getResource(res).weight * n;
    return w;
  }

  room(res: string): number {
    return Math.max(0, Math.floor((this.capacity - this.weight() + 1e-6) / getResource(res).weight));
  }

  count(): number {
    let n = 0;
    for (const v of Object.values(this.items)) n += v;
    return n;
  }

  /** Un quai de chargement accepte le minerai de tous les côtés (convoyeurs, foreuses, coffres). */
  canAccept(res: string): boolean {
    return this.mode === 'load' && this.room(res) >= 1;
  }

  accept(res: string): boolean {
    if (!this.canAccept(res)) return false;
    this.items[res] = (this.items[res] ?? 0) + 1;
    return true;
  }

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

  /** Quai de déchargement : envoie son contenu dans ce qui est collé (hors voie). */
  update(_dt: number, ctx: StructureContext): void {
    if (this.mode !== 'unload') return;
    for (let k = 0; k < 4; k++) {
      const keys = Object.keys(this.items);
      if (!keys.length) return;
      const d = ((this.cursor + k) % 4) as Dir;
      const next = ctx.structureAt(this.x + DX[d], this.y + DY[d]);
      if (!next || next.isTrack) continue;
      const res = keys[(this.cursor + k) % keys.length];
      if (next.accept(res, d, ctx)) {
        this.take(res, 1);
        this.cursor = (d + 1) % 4;
      }
    }
  }

  contents(): Record<string, number> {
    return { ...this.items };
  }

  serialize(): StructureSave {
    return { ...super.serialize(), items: { ...this.items } };
  }

  static load(s: StructureSave): RailStation {
    const st = new RailStation(s.x, s.y, s.type as 'rail_load' | 'rail_unload');
    st.items = { ...((s.items as Record<string, number>) ?? {}) };
    return st;
  }
}
