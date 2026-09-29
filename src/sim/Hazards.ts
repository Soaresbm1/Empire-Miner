/**
 * Dangers de la mine : éboulements, grisou et eau.
 *
 * - Éboulement : en profondeur, un plafond trop largement creusé à la main (plus de
 *   `CAVE_IN.maxDug` cases creusées autour de la dernière) craque. Il s'effondre après un
 *   court délai, sauf si un étai le consolide entre-temps : des éboulis remplissent une partie
 *   des cases creusées et blessent le joueur pris dessous. Les galeries naturelles et les
 *   tunnels de la foreuse de percement (consolidés par la machine) ne comptent pas.
 * - Grisou : une poche percée envahit la galerie voisine ; le gaz se dissipe lentement tout
 *   seul, très vite près d'un ventilateur, et blesse le joueur qui le respire.
 * - Eau : une poche percée inonde la galerie ; l'eau s'infiltre lentement, une pompe
 *   l'assèche. Elle ralentit le joueur et, profonde, l'épuise.
 *
 * Les niveaux de gaz et d'eau (0 à 255) vivent dans `World` ; ce système garde la liste des
 * cases touchées pour ne jamais parcourir toute la carte.
 */
import { depthAt } from '../core/constants';
import { RUBBLE } from '../data/blocks';
import { CAVE_IN, GAS, POCKET_GAS, POCKET_WATER, WATER } from '../data/hazards';
import type { SimEvent } from './events';
import type { Structure } from './structures/Structure';
import type { World } from './World';

/** Ce dont les dangers ont besoin du reste de la simulation. */
export interface HazardHost {
  readonly world: World;
  structureAt(x: number, y: number): Structure | undefined;
  /** Vrai si le joueur ou un wagonnet occupe la case. */
  occupied(x: number, y: number): boolean;
  emit(e: SimEvent): void;
  /** Blesse le joueur s'il se trouve à moins de `radius` cases de (x, y). */
  hurtPlayerNear(x: number, y: number, radius: number, amount: number, cause: string): void;
  /** Tirage aléatoire dans [0, 1). */
  random(): number;
}

/** Plafond qui craque : il s'effondre quand `t` atteint 0, sauf s'il est étayé avant. */
export interface PendingCaveIn {
  x: number;
  y: number;
  t: number;
}

export class HazardSystem {
  pending: PendingCaveIn[] = [];
  private readonly gasTiles = new Set<number>();
  private readonly waterTiles = new Set<number>();

  constructor(private readonly host: HazardHost) {}

  private get world(): World {
    return this.host.world;
  }

  /** Reconstruit les listes de cases touchées (après un chargement). */
  rebuild(): void {
    this.gasTiles.clear();
    this.waterTiles.clear();
    const w = this.world;
    for (let i = 0; i < w.gas.length; i++) {
      if (w.gas[i] > 0) this.gasTiles.add(i);
      if (w.water[i] > 0) this.waterTiles.add(i);
    }
  }

  gasAt(x: number, y: number): number {
    return this.world.inBounds(x, y) ? this.world.gas[this.world.idx(x, y)] : 0;
  }

  waterAt(x: number, y: number): number {
    return this.world.inBounds(x, y) ? this.world.water[this.world.idx(x, y)] : 0;
  }

  get hasGas(): boolean {
    return this.gasTiles.size > 0;
  }

  get hasWater(): boolean {
    return this.waterTiles.size > 0;
  }

  /** Vitesse de marche dans l'eau (1 = normale). */
  speedFactor(x: number, y: number): number {
    const lvl = this.waterAt(x, y);
    return lvl >= WATER.deep ? WATER.slowDeep : lvl > 0 ? WATER.slowShallow : 1;
  }

  /** Un étai consolide la case (x, y). */
  supported(x: number, y: number): boolean {
    const r = CAVE_IN.propRadius;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.host.structureAt(x + dx, y + dy)?.type === 'prop') return true;
    return false;
  }

  /** Cases creusées à la main (et encore ouvertes) autour de (x, y). */
  dugAround(x: number, y: number): number {
    const w = this.world;
    const r = CAVE_IN.radius;
    let n = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (w.isOpen(nx, ny) && w.dug[w.idx(nx, ny)]) n++;
      }
    return n;
  }

  /** Éboulement annoncé près de (x, y), s'il y en a un. */
  pendingNear(x: number, y: number, dist = CAVE_IN.radius + 1): PendingCaveIn | null {
    return this.pending.find((p) => Math.abs(p.x - x) <= dist && Math.abs(p.y - y) <= dist) ?? null;
  }

  /**
   * Une case vient d'être percée (le bloc `block` a disparu). `byHand` : par le joueur
   * (pioche, marteau-piqueur) ; la foreuse de percement consolide ses tunnels.
   */
  onBroken(x: number, y: number, block: number, byHand: boolean): void {
    const w = this.world;
    const i = w.idx(x, y);
    const pocket = w.pocket[i];
    if (pocket) {
      w.pocket[i] = 0;
      // Des éboulis n'ont plus de poche : seule la roche d'origine en cache une.
      if (block !== RUBBLE) {
        if (pocket === POCKET_GAS) this.release(x, y, 'gas');
        else if (pocket === POCKET_WATER) this.release(x, y, 'water');
      }
    }
    if (byHand) {
      w.dug[i] = 1;
      this.checkCeiling(x, y);
    }
  }

  private checkCeiling(x: number, y: number): void {
    if (depthAt(y) < CAVE_IN.minDepth || this.pendingNear(x, y) || this.supported(x, y)) return;
    if (this.dugAround(x, y) <= CAVE_IN.maxDug) return;
    this.pending.push({ x, y, t: CAVE_IN.warning });
    this.host.emit({ t: 'rumble', tx: x, ty: y });
    this.host.emit({ t: 'message', text: 'Le plafond craque ! Posez un étai (B) ou éloignez-vous.', kind: 'warn' });
  }

  /** Libère une poche : le gaz ou l'eau envahit les cases ouvertes les plus proches. */
  private release(x: number, y: number, kind: 'gas' | 'water'): void {
    const w = this.world;
    const grid = kind === 'gas' ? w.gas : w.water;
    const set = kind === 'gas' ? this.gasTiles : this.waterTiles;
    const limit = kind === 'gas' ? GAS.spread : WATER.spread;
    const seen = new Set<number>([w.idx(x, y)]);
    const queue: [number, number][] = [[x, y]];
    let filled = 0;
    while (queue.length && filled < limit) {
      const [cx, cy] = queue.shift()!;
      if (!w.isOpen(cx, cy)) continue;
      const i = w.idx(cx, cy);
      grid[i] = 255;
      set.add(i);
      filled++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = w.idx(cx + dx, cy + dy);
        if (w.inBounds(cx + dx, cy + dy) && !seen.has(j)) {
          seen.add(j);
          queue.push([cx + dx, cy + dy]);
        }
      }
    }
    if (kind === 'gas') {
      this.host.emit({ t: 'gas', tx: x, ty: y });
      this.host.emit({ t: 'message', text: 'Poche de grisou percée ! Sortez du nuage, ou posez un ventilateur.', kind: 'bad' });
    } else {
      this.host.emit({ t: 'flood', tx: x, ty: y });
      this.host.emit({ t: 'message', text: "Poche d'eau percée : la galerie est inondée. Une pompe l'assèche.", kind: 'warn' });
    }
  }

  update(dt: number): void {
    for (const p of [...this.pending]) {
      if (this.supported(p.x, p.y)) {
        this.pending.splice(this.pending.indexOf(p), 1);
        this.host.emit({ t: 'message', text: 'Plafond consolidé : l’étai tient.', kind: 'good' });
        continue;
      }
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(this.pending.indexOf(p), 1);
        this.collapse(p.x, p.y);
      }
    }
    this.fade(this.world.gas, this.gasTiles, GAS.decay * dt);
    this.fade(this.world.water, this.waterTiles, WATER.drain * dt);
  }

  /** Baisse le niveau de chaque case touchée (et oublie celles qui sont vides ou rebouchées). */
  private fade(grid: Float32Array, set: Set<number>, amount: number): void {
    const w = this.world;
    for (const i of set) {
      const v = grid[i] - amount;
      if (v <= 0 || w.tiles[i] !== 0) {
        grid[i] = 0;
        set.delete(i);
      } else grid[i] = v;
    }
  }

  /** Effondrement : des éboulis tombent sur une partie des cases creusées autour de (x, y). */
  collapse(x: number, y: number): void {
    const w = this.world;
    const r = CAVE_IN.radius;
    const spots: [number, number][] = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!w.isOpen(nx, ny) || !w.dug[w.idx(nx, ny)]) continue;
        if (this.host.structureAt(nx, ny) || this.host.occupied(nx, ny)) continue;
        spots.push([nx, ny]);
      }
    for (let k = spots.length - 1; k > 0; k--) {
      const j = Math.floor(this.host.random() * (k + 1));
      [spots[k], spots[j]] = [spots[j], spots[k]];
    }
    const [lo, hi] = CAVE_IN.fill;
    const n = Math.min(spots.length, lo + Math.floor(this.host.random() * (hi - lo + 1)));
    for (const [sx, sy] of spots.slice(0, n)) {
      const i = w.idx(sx, sy);
      w.set(sx, sy, RUBBLE);
      w.dug[i] = 0;
      w.gas[i] = 0;
      w.water[i] = 0;
    }
    this.host.emit({ t: 'collapse', tx: x, ty: y });
    this.host.emit({ t: 'message', text: 'Éboulement ! Un étai tous les 7 cases tient les grandes salles.', kind: 'bad' });
    this.host.hurtPlayerNear(x, y, r + 0.5, CAVE_IN.damage, 'éboulement');
  }

  /** Ventilateur : chasse le gaz autour de (x, y). Vrai s'il y en avait. */
  ventilate(x: number, y: number, dt: number): boolean {
    return this.clear(this.world.gas, this.gasTiles, x, y, GAS.fanRadius, GAS.fanDecay * dt);
  }

  /** Vrai s'il y a de l'eau à portée d'une pompe en (x, y). */
  waterNear(x: number, y: number): boolean {
    return this.clear(this.world.water, this.waterTiles, x, y, WATER.pumpRadius, 0);
  }

  /** Pompe : retire l'eau autour de (x, y). Vrai s'il y en avait. */
  pump(x: number, y: number, dt: number): boolean {
    return this.clear(this.world.water, this.waterTiles, x, y, WATER.pumpRadius, WATER.pumpDrain * dt);
  }

  private clear(grid: Float32Array, set: Set<number>, x: number, y: number, r: number, amount: number): boolean {
    if (!set.size) return false;
    const w = this.world;
    let any = false;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (!w.inBounds(x + dx, y + dy)) continue;
        const i = w.idx(x + dx, y + dy);
        if (grid[i] <= 0) continue;
        any = true;
        if (amount <= 0) return true;
        grid[i] = Math.max(0, grid[i] - amount);
        if (grid[i] === 0) set.delete(i);
      }
    return any;
  }
}
