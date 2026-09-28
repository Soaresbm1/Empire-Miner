/**
 * Wagonnets : véhicules qui roulent sur la voie (rails et quais).
 *
 * Un wagonnet avance dans sa direction ; à chaque case il continue tout droit si la
 * voie le permet, sinon il prend le virage. Au bout de la ligne il fait demi-tour.
 * Sur un quai il s'arrête : il est rempli (chargement) ou vidé (déchargement), puis
 * repart. Le joueur peut monter dedans pour voyager.
 */
import { TILE } from '../core/constants';
import { DX, DY, opposite, type Dir } from '../core/dir';
import { getMachine } from '../data/machines';
import { getResource } from '../data/resources';
import { RailStation } from './structures/Rail';
import type { Structure } from './structures/Structure';

export interface WagonContext {
  structureAt(x: number, y: number): Structure | undefined;
}

export interface WagonSave {
  x: number;
  y: number;
  dir: Dir;
  t: number;
  stopped: boolean;
  cargo: Record<string, number>;
  rider: boolean;
  hold?: boolean;
  trips: number;
  delivered?: number;
}

/** Objets transférés par seconde sur un quai. */
function transferRate(): number {
  return getMachine('rail_load').stats.speed;
}

export class Wagon {
  id = 0;
  /** Case actuelle (le wagonnet va vers la case suivante dans `dir`). */
  x: number;
  y: number;
  dir: Dir;
  /** Progression vers la case suivante (0 à 1). */
  t = 0;
  /** À l'arrêt (quai ou bout de ligne). */
  stopped = true;
  cargo: Record<string, number> = {};
  /** Le joueur est à bord. */
  rider = false;
  /** Arrivé à un arrêt avec le joueur à bord : attend qu'il descende. */
  hold = false;
  /** Temps écoulé depuis que le joueur est monté (départ peu après). */
  boardWait = 0;
  /** Allers ou retours terminés (arrêts sur un quai). */
  trips = 0;
  /** Minerais déposés sur des quais de déchargement. */
  delivered = 0;
  /** Temps passé à l'arrêt, temps sans transfert, reliquat de transfert. */
  wait = 0;
  idle = 0;
  private xfer = 0;
  readonly speed: number;
  readonly capacity: number;

  constructor(x: number, y: number, dir: Dir) {
    this.x = x;
    this.y = y;
    this.dir = dir;
    const def = getMachine('wagon');
    this.speed = def.stats.speed;
    this.capacity = def.stats.capacity;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.cargo)) w += getResource(res).weight * n;
    return w;
  }

  room(res: string): number {
    return Math.max(0, Math.floor((this.capacity - this.weight() + 1e-6) / getResource(res).weight));
  }

  count(): number {
    let n = 0;
    for (const v of Object.values(this.cargo)) n += v;
    return n;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  /** Centre du wagonnet (unités monde). */
  px(): number {
    return (this.x + 0.5 + (this.stopped ? 0 : DX[this.dir] * this.t)) * TILE;
  }

  py(): number {
    return (this.y + 0.5 + (this.stopped ? 0 : DY[this.dir] * this.t)) * TILE;
  }

  /** Case la plus proche (pour cliquer dessus). */
  tileX(): number {
    return Math.floor(this.px() / TILE);
  }

  tileY(): number {
    return Math.floor(this.py() / TILE);
  }

  /** Un transfert sur un quai ; renvoie vrai si un objet a bougé. */
  private transferOne(st: RailStation): boolean {
    if (st.mode === 'load') {
      for (const res of Object.keys(st.items)) {
        if (this.room(res) >= 1 && st.take(res, 1)) {
          this.cargo[res] = (this.cargo[res] ?? 0) + 1;
          return true;
        }
      }
      return false;
    }
    for (const res of Object.keys(this.cargo)) {
      if (st.put(res, 1)) {
        this.delivered++;
        const left = (this.cargo[res] ?? 0) - 1;
        if (left > 0) this.cargo[res] = left;
        else delete this.cargo[res];
        return true;
      }
    }
    return false;
  }

  /** Le wagonnet ne peut plus rien prendre de ce que propose le quai. */
  private fullFor(st: RailStation): boolean {
    if (this.weight() >= this.capacity - 1e-6) return true;
    const offered = Object.keys(st.items);
    return offered.length > 0 && offered.every((res) => this.room(res) < 1);
  }

  update(dt: number, ctx: WagonContext): void {
    const isTrack = (x: number, y: number) => !!ctx.structureAt(x, y)?.isTrack;
    if (this.stopped) {
      this.wait += dt;
      const here = ctx.structureAt(this.x, this.y);
      let leave: boolean;
      if (here instanceof RailStation) {
        this.xfer = Math.min(this.xfer + dt * transferRate(), 2);
        let moved = false;
        while (this.xfer >= 1) {
          this.xfer -= 1;
          if (!this.transferOne(here)) break;
          moved = true;
        }
        this.idle = moved ? 0 : this.idle + dt;
        if (here.mode === 'load') leave = this.fullFor(here) || (!this.isEmpty() && this.idle >= 2);
        else leave = this.isEmpty() && this.wait >= 0.4;
      } else {
        leave = this.wait >= 0.5; // bout de ligne : petite pause puis demi-tour
      }
      if (this.rider) {
        // Avec un passager : on attend qu'il descende à l'arrivée ; s'il vient de monter, on part vite.
        this.boardWait += dt;
        leave = !this.hold && this.boardWait >= 1.2;
      }
      if (leave) this.depart(ctx);
      return;
    }
    this.t += this.speed * dt;
    while (this.t >= 1) {
      const nx = this.x + DX[this.dir];
      const ny = this.y + DY[this.dir];
      if (!isTrack(nx, ny)) {
        // La voie a disparu devant : on s'arrête et on repartira dans l'autre sens.
        this.t = 0;
        this.stop();
        return;
      }
      this.t -= 1;
      this.x = nx;
      this.y = ny;
      if (this.arrive(ctx)) {
        this.t = 0;
        return;
      }
    }
  }

  private stop(): void {
    this.stopped = true;
    this.wait = 0;
    this.idle = 0;
    this.xfer = 0;
    if (this.rider) this.hold = true;
  }

  /** Arrivée sur une case : s'arrête sur un quai ou au bout de la ligne, sinon choisit sa direction. */
  private arrive(ctx: WagonContext): boolean {
    if (ctx.structureAt(this.x, this.y) instanceof RailStation) {
      this.trips++;
      this.stop();
      return true;
    }
    const d = this.nextDir(ctx);
    if (d === null) {
      this.stop();
      return true;
    }
    this.dir = d;
    return false;
  }

  /** Tout droit si possible, sinon le virage (droite puis gauche) ; null au bout de la ligne. */
  private nextDir(ctx: WagonContext): Dir | null {
    const isTrack = (d: Dir) => !!ctx.structureAt(this.x + DX[d], this.y + DY[d])?.isTrack;
    const right = ((this.dir + 1) % 4) as Dir;
    const left = ((this.dir + 3) % 4) as Dir;
    for (const d of [this.dir, right, left]) if (isTrack(d)) return d;
    return null;
  }

  private depart(ctx: WagonContext): void {
    let d = this.nextDir(ctx);
    if (d === null) {
      // Demi-tour.
      const back = opposite(this.dir);
      if (!ctx.structureAt(this.x + DX[back], this.y + DY[back])?.isTrack) return; // voie isolée : on attend
      d = back;
    }
    this.dir = d;
    this.stopped = false;
    this.t = 0;
    this.wait = 0;
    this.idle = 0;
  }

  serialize(): WagonSave {
    return {
      x: this.x,
      y: this.y,
      dir: this.dir,
      t: Math.round(this.t * 1000) / 1000,
      stopped: this.stopped,
      cargo: { ...this.cargo },
      rider: this.rider,
      hold: this.hold,
      trips: this.trips,
      delivered: this.delivered,
    };
  }

  static load(s: WagonSave): Wagon {
    const w = new Wagon(s.x, s.y, s.dir);
    w.t = Number(s.t ?? 0);
    w.stopped = !!s.stopped;
    w.cargo = { ...(s.cargo ?? {}) };
    w.rider = !!s.rider;
    w.hold = !!s.hold;
    w.trips = Number(s.trips ?? 0);
    w.delivered = Number(s.delivered ?? 0);
    return w;
  }
}

export class WagonSystem {
  list: Wagon[] = [];
  private nextId = 1;

  add(w: Wagon): Wagon {
    w.id = this.nextId++;
    this.list.push(w);
    return w;
  }

  remove(w: Wagon): void {
    const i = this.list.indexOf(w);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Wagonnet qui se trouve sur la case (tx, ty). */
  at(tx: number, ty: number): Wagon | undefined {
    return this.list.find((w) => w.tileX() === tx && w.tileY() === ty);
  }

  update(dt: number, ctx: WagonContext): void {
    for (const w of this.list) w.update(dt, ctx);
  }
}
