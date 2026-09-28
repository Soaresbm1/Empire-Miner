/**
 * Ressources physiquement posées au sol. Elles rebondissent à l'apparition,
 * se regroupent en tas et sont aspirées par le joueur à proximité.
 *
 * Les ressources qui ont une durée de vie au sol (`groundLife`, la pierre)
 * s'effritent au bout de ce délai ; les minerais, eux, restent indéfiniment.
 */
import { TILE } from '../core/constants';
import { getResource } from '../data/resources';
import type { World } from './World';

/** Durée (s) pendant laquelle un tas sur le point de s'effriter clignote. */
export const FADE_TIME = 5;

export interface Drop {
  id: number;
  res: string;
  count: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Hauteur fictive (rebond) et vitesse verticale. */
  z: number;
  vz: number;
  age: number;
  /** En cours d'aspiration vers le joueur. */
  magnet: boolean;
  /** Jeté volontairement : ignoré jusqu'à ce que le joueur s'éloigne. */
  locked: boolean;
}

const FRICTION = 5;
const GRAVITY = 420;

export class DropSystem {
  list: Drop[] = [];
  private nextId = 1;
  private mergeTimer = 0;

  spawn(res: string, count: number, x: number, y: number, burst = true): Drop {
    const a = Math.random() * Math.PI * 2;
    const sp = burst ? 25 + Math.random() * 35 : 0;
    const d: Drop = {
      id: this.nextId++,
      res,
      count,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      z: burst ? 2 : 0,
      vz: burst ? 70 + Math.random() * 40 : 0,
      age: 0,
      magnet: false,
      locked: false,
    };
    this.list.push(d);
    return d;
  }

  /** Secondes avant que le tas s'effrite (Infinity pour les ressources qui restent au sol). */
  lifeLeft(d: Drop): number {
    const life = getResource(d.res).groundLife;
    return life === undefined ? Infinity : life - d.age;
  }

  /** Fait avancer les tas ; renvoie ceux qui viennent de s'effriter. */
  update(dt: number, world: World): Drop[] {
    for (const d of this.list) {
      d.age += dt;
      if (d.magnet) continue;
      if (d.vz !== 0 || d.z > 0) {
        d.vz -= GRAVITY * dt;
        d.z += d.vz * dt;
        if (d.z <= 0) {
          d.z = 0;
          d.vz = Math.abs(d.vz) > 40 ? -d.vz * 0.35 : 0;
        }
      }
      if (d.vx !== 0 || d.vy !== 0) {
        const nx = d.x + d.vx * dt;
        if (!world.isSolid(Math.floor(nx / TILE), Math.floor(d.y / TILE))) d.x = nx;
        else d.vx = -d.vx * 0.3;
        const ny = d.y + d.vy * dt;
        if (!world.isSolid(Math.floor(d.x / TILE), Math.floor(ny / TILE))) d.y = ny;
        else d.vy = -d.vy * 0.3;
        const f = Math.exp(-FRICTION * dt);
        d.vx *= f;
        d.vy *= f;
        if (Math.abs(d.vx) < 1 && Math.abs(d.vy) < 1) d.vx = d.vy = 0;
      }
    }
    this.mergeTimer -= dt;
    if (this.mergeTimer <= 0) {
      this.mergeTimer = 0.5;
      this.merge();
    }
    // Un tas en train d'être aspiré par le joueur ne disparaît pas sous ses yeux.
    const expired = this.list.filter((d) => !d.magnet && this.lifeLeft(d) <= 0);
    if (expired.length) this.list = this.list.filter((d) => !expired.includes(d));
    return expired;
  }

  /** Regroupe les tas identiques proches pour limiter le nombre d'entités. */
  private merge(): void {
    const settled = this.list.filter((d) => d.age > 1 && d.z === 0 && !d.magnet && d.vx === 0 && d.vy === 0);
    const removed = new Set<number>();
    for (let i = 0; i < settled.length; i++) {
      const a = settled[i];
      if (removed.has(a.id)) continue;
      for (let j = i + 1; j < settled.length; j++) {
        const b = settled[j];
        if (removed.has(b.id) || b.res !== a.res) continue;
        if (Math.abs(a.x - b.x) < 7 && Math.abs(a.y - b.y) < 7) {
          a.count += b.count;
          // Le tas fusionné garde le temps restant du plus récent des deux.
          a.age = Math.min(a.age, b.age);
          removed.add(b.id);
        }
      }
    }
    if (removed.size) this.list = this.list.filter((d) => !removed.has(d.id));
  }

  remove(d: Drop): void {
    const i = this.list.indexOf(d);
    if (i >= 0) this.list.splice(i, 1);
  }
}
