/**
 * Registre des structures posées : index spatial par tuile, ordre de mise à jour
 * et création/suppression.
 */
import { DX, DY } from '../core/dir';
import { TunnelBorer } from './structures/Borer';
import { Bridge } from './structures/Bridge';
import type { Structure, StructureContext } from './structures/Structure';
import type { World } from './World';

export class StructureManager {
  list: Structure[] = [];
  /** Foreuses de percement (leur foreuse peut occuper des cases hors de la base). */
  borers: TunnelBorer[] = [];
  private readonly byTile = new Map<number, Structure>();
  private nextId = 1;
  /** Ordre de mise à jour (convoyeurs aval d'abord), recalculé si le réseau change. */
  private order: Structure[] | null = null;
  constructor(private readonly worldW: number) {}

  at(x: number, y: number): Structure | undefined {
    return this.byTile.get(y * this.worldW + x);
  }

  add(s: Structure): Structure {
    s.id = this.nextId++;
    this.list.push(s);
    if (s instanceof TunnelBorer) this.borers.push(s);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) this.byTile.set(y * this.worldW + x, s);
    this.order = null;
    return s;
  }

  remove(s: Structure): void {
    const i = this.list.indexOf(s);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (s instanceof TunnelBorer) this.borers.splice(this.borers.indexOf(s), 1);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) this.byTile.delete(y * this.worldW + x);
    this.order = null;
  }

  /** Signale une modification (ex. rotation) qui change le graphe de transport. */
  invalidate(): void {
    this.order = null;
  }

  update(dt: number, ctx: StructureContext): void {
    if (!this.order) this.order = this.computeOrder(ctx.world);
    for (const s of this.order) s.update(dt, ctx);
  }

  /**
   * Relie les ponts : chaque pont cherche devant lui (jusqu'à sa portée, sans traverser la
   * roche) le premier pont de même direction ; s'il est libre, il devient sa sortie.
   * Les ponts sont traités de l'amont vers l'aval pour un résultat déterministe.
   */
  private linkBridges(world: World): void {
    const bridges = this.list.filter((s): s is Bridge => s instanceof Bridge);
    const previous = new Map(bridges.map((b) => [b, b.target]));
    for (const b of bridges) {
      b.target = null;
      b.source = null;
    }
    const along = (b: Bridge) => b.x * DX[b.dir] + b.y * DY[b.dir];
    bridges.sort((a, b) => along(a) - along(b));
    for (const b of bridges) {
      if (b.source) continue; // déjà une sortie
      for (let k = 1; k <= b.range; k++) {
        const x = b.x + DX[b.dir] * k;
        const y = b.y + DY[b.dir] * k;
        if (!world.inBounds(x, y) || world.isSolid(x, y)) break;
        const s = this.at(x, y);
        if (s instanceof Bridge && s.dir === b.dir) {
          if (!s.source && !s.target) {
            b.target = s;
            s.source = b;
          }
          break;
        }
      }
    }
    for (const b of bridges) if (previous.get(b) !== b.target && b.transit.length) b.spillTransit();
  }

  /**
   * Les structures de transport (convoyeurs, séparateurs, ponts) sont mises à jour de
   * l'aval vers l'amont pour que la place libérée en tête de chaîne profite
   * immédiatement aux objets qui suivent.
   */
  private computeOrder(world: World): Structure[] {
    this.linkBridges(world);
    const at = (x: number, y: number) => this.at(x, y);
    const dist = new Map<Structure, number>();
    const visiting = new Set<Structure>();
    const distance = (c: Structure): number => {
      const known = dist.get(c);
      if (known !== undefined) return known;
      if (visiting.has(c)) return 0; // boucle
      visiting.add(c);
      const next = c.downstream(at).filter((n) => n.isBelt);
      const d = next.length ? 1 + Math.min(...next.map(distance)) : 0;
      visiting.delete(c);
      dist.set(c, d);
      return d;
    };
    const belts = this.list.filter((s) => s.isBelt);
    belts.sort((a, b) => distance(a) - distance(b));
    const others = this.list.filter((s) => !s.isBelt);
    // Machines (producteurs) après les convoyeurs : elles poussent dans une chaîne déjà avancée.
    return [...belts, ...others];
  }

  /** Recalcule immédiatement les liaisons (utile pour l'affichage après une modification). */
  refresh(world: World): void {
    this.order = this.computeOrder(world);
  }
}
