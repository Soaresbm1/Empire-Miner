/**
 * Sac du joueur : limité en poids (kg).
 * Les kits de construction (machines achetées) sont rangés à part et ne pèsent rien.
 */
import { getResource } from '../data/resources';

export class Inventory {
  items: Record<string, number> = {};
  kits: Record<string, number> = {};
  capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  count(res: string): number {
    return this.items[res] ?? 0;
  }

  weight(): number {
    let w = 0;
    for (const [res, n] of Object.entries(this.items)) w += getResource(res).weight * n;
    return w;
  }

  /** Nombre d'unités de `res` qui peuvent encore entrer dans le sac. */
  room(res: string): number {
    const free = this.capacity - this.weight();
    return Math.max(0, Math.floor((free + 1e-6) / getResource(res).weight));
  }

  /** Ajoute jusqu'à `n` unités ; renvoie le nombre réellement ajouté. */
  add(res: string, n: number): number {
    const k = Math.min(n, this.room(res));
    if (k > 0) this.items[res] = this.count(res) + k;
    return k;
  }

  /** Retire jusqu'à `n` unités ; renvoie le nombre réellement retiré. */
  remove(res: string, n: number): number {
    const k = Math.min(n, this.count(res));
    if (k <= 0) return 0;
    const left = this.count(res) - k;
    if (left > 0) this.items[res] = left;
    else delete this.items[res];
    return k;
  }

  isEmpty(): boolean {
    return Object.keys(this.items).length === 0;
  }

  kitCount(id: string): number {
    return this.kits[id] ?? 0;
  }

  addKit(id: string, n = 1): void {
    this.kits[id] = this.kitCount(id) + n;
  }

  removeKit(id: string, n = 1): boolean {
    if (this.kitCount(id) < n) return false;
    const left = this.kitCount(id) - n;
    if (left > 0) this.kits[id] = left;
    else delete this.kits[id];
    return true;
  }
}
