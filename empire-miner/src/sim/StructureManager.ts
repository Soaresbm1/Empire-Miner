/**
 * Registre des structures posées : index spatial par tuile, ordre de mise à jour
 * et création/suppression.
 */
import { DX, DY } from '../core/dir';
import { Conveyor } from './structures/Conveyor';
import type { Structure, StructureContext } from './structures/Structure';

export class StructureManager {
  list: Structure[] = [];
  private readonly byTile = new Map<number, Structure>();
  private nextId = 1;
  /** Ordre de mise à jour (convoyeurs aval d'abord), recalculé si le réseau change. */
  private order: Structure[] | null = null;
  constructor(private readonly worldW: number) {}

  at(x: number, y: number): Structure | undefined {
    return this.byTile.get(y * this.worldW + x);
  }

  add(s: Structure): Structure {
    s.id = this.nextId++;
    this.list.push(s);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) this.byTile.set(y * this.worldW + x, s);
    this.order = null;
    return s;
  }

  remove(s: Structure): void {
    const i = this.list.indexOf(s);
    if (i < 0) return;
    this.list.splice(i, 1);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) this.byTile.delete(y * this.worldW + x);
    this.order = null;
  }

  /** Signale une modification (ex. rotation) qui change le graphe de transport. */
  invalidate(): void {
    this.order = null;
  }

  update(dt: number, ctx: StructureContext): void {
    if (!this.order) this.order = this.computeOrder();
    for (const s of this.order) s.update(dt, ctx);
  }

  /**
   * Les convoyeurs sont mis à jour de l'aval vers l'amont pour que la place
   * libérée en tête de chaîne profite immédiatement aux objets qui suivent.
   */
  private computeOrder(): Structure[] {
    const dist = new Map<Structure, number>();
    const visiting = new Set<Structure>();
    const distance = (c: Conveyor): number => {
      const known = dist.get(c);
      if (known !== undefined) return known;
      if (visiting.has(c)) return 0; // boucle
      visiting.add(c);
      const next = this.at(c.x + DX[c.dir], c.y + DY[c.dir]);
      const d = next instanceof Conveyor ? 1 + distance(next) : 0;
      visiting.delete(c);
      dist.set(c, d);
      return d;
    };
    const belts = this.list.filter((s): s is Conveyor => s instanceof Conveyor);
    belts.sort((a, b) => distance(a) - distance(b));
    const others = this.list.filter((s) => !(s instanceof Conveyor));
    // Machines (producteurs) après les convoyeurs : elles poussent dans une chaîne déjà avancée.
    return [...belts, ...others];
  }
}
