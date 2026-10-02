/**
 * Coffre de stockage : accepte n'importe quel minerai, limité en poids.
 * Si un convoyeur est collé au coffre (sans pointer vers lui), le coffre s'y vide :
 * il peut ainsi servir de tampon au milieu d'une chaîne.
 * Il recharge aussi en combustible (charbon) les foreuses collées, en priorité.
 *
 * On peut lui choisir ce qu'il accepte (`allow`) : convoyeurs, dépôt du joueur et ouvriers ne lui apportent alors
 * que ces minerais. Ce qui est déjà dedans y reste et peut toujours en sortir.
 */
import { DX, DY, type Dir } from '../../core/dir';
import { getMachine } from '../../data/machines';
import { getResource, hasResource, resourceIndex } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export class Storage extends Structure {
  readonly type = 'storage';
  items: Record<string, number> = {};
  readonly capacity: number;
  /** Minerais acceptés, dans l'ordre des ressources (vide : tout est accepté). */
  allow: string[] = [];

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.capacity = getMachine('storage').stats.capacity;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.items)) w += getResource(res).weight * n;
    return w;
  }

  /** Ce minerai est-il autorisé dans ce coffre (indépendamment de la place) ? */
  accepts(res: string): boolean {
    return this.allow.length === 0 || this.allow.includes(res);
  }

  /** Remplace les minerais acceptés (doublons et ressources inconnues écartés, ordre des ressources). */
  setAllow(list: readonly string[]): void {
    this.allow = [...new Set(list)].filter(hasResource).sort((a, b) => resourceIndex(a) - resourceIndex(b));
  }

  /** Ajoute le minerai à ceux que le coffre accepte, ou l'en retire. Depuis « tout accepter », choisir un minerai ne garde que lui. */
  toggleAllow(res: string): boolean {
    if (!hasResource(res)) return false;
    this.setAllow(this.allow.includes(res) ? this.allow.filter((r) => r !== res) : [...this.allow, res]);
    return true;
  }

  /** Nombre d'unités de ce minerai que le coffre peut encore recevoir (0 s'il le refuse). */
  room(res: string): number {
    if (!this.accepts(res)) return 0;
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
    return { ...super.serialize(), items: { ...this.items }, allow: [...this.allow] };
  }

  static load(s: StructureSave): Storage {
    const st = new Storage(s.x, s.y, s.dir);
    st.items = { ...((s.items as Record<string, number>) ?? {}) };
    st.setAllow(Array.isArray(s.allow) ? s.allow.filter((r): r is string => typeof r === 'string') : []);
    return st;
  }
}
