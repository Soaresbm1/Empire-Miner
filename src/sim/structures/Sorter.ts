/**
 * Trieur : comme un séparateur, le minerai entre par l'arrière. Les minerais choisis
 * (filtres, un ou plusieurs) partent tout droit ; tout le reste part sur les côtés, à
 * gauche et à droite à tour de rôle. Sans filtre, tout va tout droit.
 *
 * Le tri est strict : si la sortie avant est bloquée, le minerai filtré attend au
 * lieu de partir sur les côtés (et inversement).
 */
import type { Dir } from '../../core/dir';
import { hasResource, resourceIndex } from '../../data/resources';
import { Splitter } from './Splitter';
import type { StructureSave } from './Structure';

export class Sorter extends Splitter {
  readonly configurable = true;
  /** Minerais envoyés tout droit, dans l'ordre des ressources (vide : tout va tout droit). */
  filters: string[] = [];
  /** Compteurs affichés dans le panneau. */
  sortedFront = 0;
  sortedSides = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir, 'sorter');
  }

  /** Premier minerai choisi, ou null s'il n'y en a aucun (l'ancien filtre unique). */
  get filter(): string | null {
    return this.filters[0] ?? null;
  }

  /** Vrai si ce minerai part tout droit. */
  sendsFront(res: string): boolean {
    return this.filters.length === 0 || this.filters.includes(res);
  }

  /** Remplace les filtres (doublons et ressources inconnues écartés, ordre des ressources). */
  setFilters(list: readonly string[]): void {
    this.filters = [...new Set(list)].filter(hasResource).sort((a, b) => resourceIndex(a) - resourceIndex(b));
  }

  /** Ajoute le minerai aux filtres, ou l'en retire s'il y est déjà. Faux si la ressource n'existe pas. */
  toggleFilter(res: string): boolean {
    if (!hasResource(res)) return false;
    this.setFilters(this.filters.includes(res) ? this.filters.filter((r) => r !== res) : [...this.filters, res]);
    return true;
  }

  protected allowed(res: string): Dir[] {
    const [front, left, right] = this.outputs();
    return this.sendsFront(res) ? [front] : [left, right];
  }

  accept(res: string, travel: Dir): boolean {
    if (!super.accept(res, travel)) return false;
    if (this.sendsFront(res)) this.sortedFront++;
    else this.sortedSides++;
    return true;
  }

  serialize(): StructureSave {
    // `filter` (le premier) reste écrit pour les versions d'avant le multi-filtre.
    return { ...super.serialize(), filters: [...this.filters], filter: this.filter, sortedFront: this.sortedFront, sortedSides: this.sortedSides };
  }

  static load(s: StructureSave): Sorter {
    const base = Splitter.load(s);
    const so = new Sorter(s.x, s.y, s.dir);
    so.items = base.items;
    so.turn = base.turn;
    const saved = Array.isArray(s.filters) ? s.filters : typeof s.filter === 'string' ? [s.filter] : [];
    so.setFilters(saved.filter((r): r is string => typeof r === 'string'));
    so.sortedFront = Number(s.sortedFront ?? 0);
    so.sortedSides = Number(s.sortedSides ?? 0);
    return so;
  }
}
