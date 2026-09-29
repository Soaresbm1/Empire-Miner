/**
 * Base de toutes les structures posées dans le monde (machines, convoyeurs,
 * bâtiments). Les échanges de minerais passent par une interface unique :
 * `canAccept` / `accept`. Toute nouvelle machine (trieur, four…) n'a qu'à
 * l'implémenter pour se connecter aux convoyeurs existants.
 */
import { DX, DY, type Dir } from '../../core/dir';
import type { World } from '../World';
import type { SimEvent } from '../events';
import type { Drop, DropSystem } from '../Drops';
import type { HazardSystem } from '../Hazards';

/** Ce que la simulation met à disposition des structures. */
export interface StructureContext {
  world: World;
  drops: DropSystem;
  structureAt(x: number, y: number): Structure | undefined;
  emit(e: SimEvent): void;
  /** Statistique : objets livrés dans un stockage par l'automatisation. */
  countDelivered(n: number): void;
  /** Éboulements, grisou et eau (ventilateur, pompe). */
  hazards: HazardSystem;
  /** Statistique : un four ou une fonderie vient de sortir un lingot. */
  countSmelted(res: string, from: Structure): void;
  /** Statistique : une foreuse vient d'extraire une unité de `res`. */
  countExtracted(res: string, from: Structure): void;
  /** Vente automatique (caisse d'expédition) : crédite l'argent du joueur. `items` : ce qui est parti, par ressource. */
  autoSell(total: number, n: number, from: Structure, items?: Record<string, number>): void;
  /** Perce une tuile (foreuse de percement) ; les morceaux tombent en (from.x, from.y), en unités monde. Renvoie les morceaux lâchés. */
  digTile(tx: number, ty: number, from: { x: number; y: number }): Drop[];
  /** Vrai si le joueur ou un wagonnet occupe la tuile. */
  occupied(x: number, y: number): boolean;
  /** Révèle la tuile et ses voisines (tunnel creusé loin du joueur). */
  reveal(x: number, y: number): void;
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
  /** Vrai pour les convoyeurs (tous niveaux). */
  readonly isBelt: boolean = false;
  /** Structure de transport qui a un panneau de réglage (touche E), ex. le trieur. */
  readonly configurable: boolean = false;
  /** Fait partie de la voie des wagonnets (rails, quais). */
  readonly isTrack: boolean = false;
  /** Peut être alimentée par un coffre ou une foreuse collés, comme un convoyeur (ex. quai de chargement). */
  feedable = false;
  /** Rien à régler ni à ouvrir avec E (ex. rail simple). */
  readonly inert: boolean = false;

  /** Côté par lequel commencer la prochaine sortie (répartition équitable entre convoyeurs). */
  private outCursor = 0;

  constructor(x: number, y: number, dir: Dir) {
    this.x = x;
    this.y = y;
    this.dir = dir;
  }

  /**
   * Pousse `res` sur un convoyeur collé (structure 1×1). Un convoyeur qui pointe vers
   * cette structure est une entrée : il refuse l'objet (arrivée de face), rien ne repart
   * donc en arrière. Les côtés sont essayés à tour de rôle. Renvoie vrai si l'objet est parti.
   */
  protected pushToAdjacentConveyor(res: string, ctx: StructureContext, skip?: Dir): boolean {
    for (let k = 0; k < 4; k++) {
      const d = ((this.outCursor + k) % 4) as Dir;
      if (d === skip) continue;
      const next = ctx.structureAt(this.x + DX[d], this.y + DY[d]);
      if ((next?.isBelt || next?.feedable) && next.accept(res, d, ctx)) {
        this.outCursor = (d + 1) % 4;
        return true;
      }
    }
    return false;
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

  /**
   * Structures vers lesquelles celle-ci envoie ses objets (convoyeurs, séparateurs, ponts).
   * Sert à ordonner la mise à jour des chaînes de l'aval vers l'amont.
   */
  downstream(_at: (x: number, y: number) => Structure | undefined): Structure[] {
    return [];
  }

  /** Ressource que la structure veut recevoir comme combustible maintenant, ou null. */
  fuelWanted(): string | null {
    return null;
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
