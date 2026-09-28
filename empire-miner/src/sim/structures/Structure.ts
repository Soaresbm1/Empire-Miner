/**
 * Base de toutes les structures posées dans le monde (machines, convoyeurs,
 * bâtiments). Les échanges de minerais passent par une interface unique :
 * `canAccept` / `accept`. Toute nouvelle machine (trieur, four…) n'a qu'à
 * l'implémenter pour se connecter aux convoyeurs existants.
 */
import type { Dir } from '../../core/dir';
import type { World } from '../World';
import type { SimEvent } from '../events';
import type { DropSystem } from '../Drops';

/** Ce que la simulation met à disposition des structures. */
export interface StructureContext {
  world: World;
  drops: DropSystem;
  structureAt(x: number, y: number): Structure | undefined;
  emit(e: SimEvent): void;
  /** Statistique : objets livrés dans un stockage par l'automatisation. */
  countDelivered(n: number): void;
  /** Vente automatique (caisse d'expédition) : crédite l'argent du joueur. */
  autoSell(total: number, n: number, from: Structure): void;
}

export interface StructureSave {
  type: string;
  x: number;
  y: number;
  dir: Dir;
  [key: string]: unknown;
}

export abstract class Structure {
  id = 0;
  abstract readonly type: string;
  x: number;
  y: number;
  dir: Dir;
  w = 1;
  h = 1;
  solid = true;
  /** Peut être démontée par le joueur. */
  removable = true;

  constructor(x: number, y: number, dir: Dir) {
    this.x = x;
    this.y = y;
    this.dir = dir;
  }

  update(_dt: number, _ctx: StructureContext): void {}

  /**
   * Un objet se déplaçant dans la direction `travel` veut entrer dans cette structure.
   */
  canAccept(_res: string, _travel: Dir): boolean {
    return false;
  }

  accept(_res: string, _travel: Dir, _ctx: StructureContext): boolean {
    return false;
  }

  /** Contenu à restituer (au sol) quand la structure est démontée. */
  contents(): Record<string, number> {
    return {};
  }

  covers(tx: number, ty: number): boolean {
    return tx >= this.x && ty >= this.y && tx < this.x + this.w && ty < this.y + this.h;
  }

  serialize(): StructureSave {
    return { type: this.type, x: this.x, y: this.y, dir: this.dir };
  }
}
