/**
 * Grille de tuiles de la mine. Contient tout ce qui est persistant dans le terrain :
 * blocs, gisements (réserves exploitables), dégâts partiels, zones explorées.
 */
import { AIR, getBlock } from '../data/blocks';
import { RESOURCES } from '../data/resources';

export class World {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  /** id de bloc par tuile (0 = ouvert). */
  readonly tiles: Uint8Array;
  /** Gisement au sol : 0 = aucun, sinon index de ressource + 1. */
  readonly deposit: Uint8Array;
  /** Réserves restantes du gisement. */
  readonly reserve: Uint16Array;
  /** 1 si la tuile a été découverte par le joueur. */
  readonly explored: Uint8Array;
  /** Décor de sol (non gameplay) : 1 = chemin de terre en surface. */
  readonly floorDeco: Uint8Array;
  /** Dégâts accumulés sur les blocs partiellement minés. */
  readonly damage = new Map<number, number>();
  /** Tuiles modifiées depuis la dernière synchronisation du rendu. */
  private readonly dirty = new Set<number>();

  constructor(w: number, h: number, seed: number) {
    this.w = w;
    this.h = h;
    this.seed = seed;
    const n = w * h;
    this.tiles = new Uint8Array(n);
    this.deposit = new Uint8Array(n);
    this.reserve = new Uint16Array(n);
    this.explored = new Uint8Array(n);
    this.floorDeco = new Uint8Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 1; // hors carte = socle
    return this.tiles[y * this.w + x];
  }

  set(x: number, y: number, block: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.tiles[i] === block) return;
    this.tiles[i] = block;
    this.damage.delete(i);
    this.markDirty(x, y);
  }

  isSolid(x: number, y: number): boolean {
    return getBlock(this.get(x, y)).solid;
  }

  isOpen(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === AIR;
  }

  /** Ressource du gisement au sol, ou null. */
  depositAt(x: number, y: number): string | null {
    if (!this.inBounds(x, y)) return null;
    const d = this.deposit[y * this.w + x];
    return d ? RESOURCES[d - 1].id : null;
  }

  setDeposit(x: number, y: number, resIndex: number, amount: number): void {
    const i = this.idx(x, y);
    this.deposit[i] = resIndex + 1;
    this.reserve[i] = Math.min(65535, Math.max(0, Math.round(amount)));
    this.markDirty(x, y);
  }

  /** Retire une unité de réserve. Renvoie la ressource extraite, ou null si épuisé. */
  takeFromDeposit(x: number, y: number): string | null {
    const i = this.idx(x, y);
    const d = this.deposit[i];
    if (!d || this.reserve[i] <= 0) return null;
    this.reserve[i]--;
    const res = RESOURCES[d - 1].id;
    if (this.reserve[i] === 0) {
      this.deposit[i] = 0;
      this.markDirty(x, y);
    }
    return res;
  }

  setExplored(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    if (this.explored[i]) return false;
    this.explored[i] = 1;
    this.markDirty(x, y);
    return true;
  }

  markDirty(x: number, y: number): void {
    // Les voisins dépendent de cette tuile (faces de murs, ombres).
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (this.inBounds(nx, ny)) this.dirty.add(ny * this.w + nx);
      }
  }

  markAllDirty(): void {
    for (let i = 0; i < this.w * this.h; i++) this.dirty.add(i);
  }

  /** Renvoie puis vide l'ensemble des tuiles modifiées. */
  consumeDirty(): number[] {
    const out = Array.from(this.dirty);
    this.dirty.clear();
    return out;
  }
}
