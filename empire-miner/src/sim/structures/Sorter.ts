/**
 * Trieur : comme un séparateur, le minerai entre par l'arrière. Le minerai choisi
 * (filtre) part tout droit ; tout le reste part sur les côtés, à gauche et à droite
 * à tour de rôle. Sans filtre, tout va tout droit.
 *
 * Le tri est strict : si la sortie avant est bloquée, le minerai filtré attend au
 * lieu de partir sur les côtés (et inversement).
 */
import type { Dir } from '../../core/dir';
import { Splitter } from './Splitter';
import type { StructureSave } from './Structure';

export class Sorter extends Splitter {
  readonly configurable = true;
  /** Minerai envoyé tout droit (null : tout va tout droit). */
  filter: string | null = null;
  /** Compteurs affichés dans le panneau. */
  sortedFront = 0;
  sortedSides = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir, 'sorter');
  }

  protected allowed(res: string): Dir[] {
    const [front, left, right] = this.outputs();
    return this.filter === null || res === this.filter ? [front] : [left, right];
  }

  accept(res: string, travel: Dir): boolean {
    if (!super.accept(res, travel)) return false;
    if (this.filter === null || res === this.filter) this.sortedFront++;
    else this.sortedSides++;
    return true;
  }

  serialize(): StructureSave {
    return { ...super.serialize(), filter: this.filter, sortedFront: this.sortedFront, sortedSides: this.sortedSides };
  }

  static load(s: StructureSave): Sorter {
    const base = Splitter.load(s);
    const so = new Sorter(s.x, s.y, s.dir);
    so.items = base.items;
    so.turn = base.turn;
    so.filter = typeof s.filter === 'string' ? s.filter : null;
    so.sortedFront = Number(s.sortedFront ?? 0);
    so.sortedSides = Number(s.sortedSides ?? 0);
    return so;
  }
}
