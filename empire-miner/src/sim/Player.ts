/** État du personnage : position, orientation, animation de coup de pioche. */
import { TILE } from '../core/constants';
import type { Dir } from '../core/dir';

export class Player {
  /** Position des pieds (unités monde). */
  x: number;
  y: number;
  facing: Dir = 1;
  /** Angle de visée (radians) pour l'animation de la pioche. */
  aim = Math.PI / 2;
  moving = false;
  walkTime = 0;
  /** Temps restant du coup en cours (s), 0 = prêt. */
  swingT = 0;
  swingDuration = 0.5;
  swingHitPending = false;
  swingTarget: { tx: number; ty: number } | null = null;
  /** Demi-dimensions de la boîte de collision (pieds). */
  readonly halfW = 5;
  readonly halfH = 4;

  constructor(tileX: number, tileY: number) {
    this.x = (tileX + 0.5) * TILE;
    this.y = (tileY + 0.5) * TILE;
  }

  get tileX(): number {
    return Math.floor(this.x / TILE);
  }

  get tileY(): number {
    return Math.floor(this.y / TILE);
  }

  /** Progression du coup en cours dans [0, 1]. */
  swingProgress(): number {
    if (this.swingT <= 0) return 0;
    return 1 - this.swingT / this.swingDuration;
  }
}
