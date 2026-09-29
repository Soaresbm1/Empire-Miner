/**
 * Four et fonderie : fondent le minerai (cuivre, fer, argent, or) en lingots, au charbon.
 *
 * Le minerai entre par n'importe quel côté sauf la sortie (convoyeur, foreuse, base de
 * foreuse de percement collés, ou dépôt à la main) ; le charbon, lui, entre de partout et
 * remplit la réserve. Chaque minerai donne un lingot, poussé devant la flèche dans la
 * structure qui s'y trouve (convoyeur, coffre, caisse d'expédition…). Le charbon ne brûle
 * que pendant la fonte. La fonderie (2×2) fait la même chose, bien plus vite.
 */
import { opposite, type Dir } from '../../core/dir';
import { getMachine, MachineDef, SmelterSpec } from '../../data/machines';
import { getResource, hasResource } from '../../data/resources';
import { Structure, StructureContext, StructureSave } from './Structure';

export type SmelterStatus = 'idle' | 'ok' | 'nofuel' | 'full';

/** Lingot obtenu en fondant `res`, ou null si ce n'est pas un minerai qui se fond. */
export function ingotOf(res: string): string | null {
  return hasResource(res) ? (getResource(res).smeltsTo ?? null) : null;
}

export class Smelter extends Structure {
  readonly type: string;
  readonly def: MachineDef;
  fuelUnits = 0;
  /** Temps de combustion restant de l'unité de charbon entamée (s). */
  burn = 0;
  /** Avancement de la fonte du minerai en cours (0 → 1). */
  progress = 0;
  /** Minerai en attente, dans l'ordre d'arrivée, et lingots prêts à sortir. */
  input: string[] = [];
  output: string[] = [];
  status: SmelterStatus = 'idle';
  /** Lingots produits au total. */
  smelted = 0;
  /** Temps de fonte cumulé (animation). */
  activeTime = 0;
  /** Cadence due à la chaleur de la Fournaise (1 = normale). */
  heat = 1;
  /** Case de sortie servie en dernier (fonderie : deux cases devant elle). */
  private frontCursor = 0;

  constructor(type: string, x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.type = type;
    this.def = getMachine(type);
    this.w = this.def.w;
    this.h = this.def.h;
  }

  get spec(): SmelterSpec {
    return this.def.smelter!;
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Temps de fonte restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Cases devant la sortie (une pour le four, deux pour la fonderie). */
  frontTiles(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    if (this.dir === 0) for (let k = 0; k < this.h; k++) out.push({ x: this.x + this.w, y: this.y + k });
    else if (this.dir === 2) for (let k = 0; k < this.h; k++) out.push({ x: this.x - 1, y: this.y + k });
    else if (this.dir === 1) for (let k = 0; k < this.w; k++) out.push({ x: this.x + k, y: this.y + this.h });
    else for (let k = 0; k < this.w; k++) out.push({ x: this.x + k, y: this.y - 1 });
    return out;
  }

  canAccept(res: string, travel: Dir): boolean {
    const fuel = this.def.fuel?.res;
    if (res === fuel) return this.fuelUnits < this.fuelMax;
    // Le minerai n'entre pas par la sortie (il arriverait en sens inverse de la flèche).
    return !!ingotOf(res) && travel !== opposite(this.dir) && this.input.length < this.spec.inputMax;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    if (res === this.def.fuel?.res) this.fuelUnits++;
    else this.input.push(res);
    return true;
  }

  fuelWanted(): string | null {
    return this.def.fuel && this.fuelUnits < this.fuelMax ? this.def.fuel.res : null;
  }

  /** Chargement manuel de charbon. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    return k;
  }

  /** Dépôt manuel de minerai. Renvoie la quantité acceptée. */
  addOre(res: string, n: number): number {
    if (!ingotOf(res)) return 0;
    const k = Math.max(0, Math.min(n, this.spec.inputMax - this.input.length));
    for (let i = 0; i < k; i++) this.input.push(res);
    return k;
  }

  /** Retire les lingots prêts (récupération par le joueur), dans la limite de `room(res)`. */
  takeOutput(room: (res: string) => number): Record<string, number> {
    const taken: Record<string, number> = {};
    const keep: string[] = [];
    for (const res of this.output) {
      if ((taken[res] ?? 0) < room(res)) taken[res] = (taken[res] ?? 0) + 1;
      else keep.push(res);
    }
    this.output = keep;
    return taken;
  }

  update(dt: number, ctx: StructureContext): void {
    this.tryOutput(ctx);
    if (!this.input.length) {
      this.status = 'idle';
      return;
    }
    if (this.output.length >= this.spec.outputMax) {
      this.status = 'full';
      return;
    }
    if (this.burn <= 0) {
      if (this.fuelUnits > 0 && this.def.fuel) {
        this.fuelUnits--;
        this.burn += this.def.fuel.secondsPerUnit;
      } else {
        this.status = 'nofuel';
        return;
      }
    }
    this.status = 'ok';
    this.burn -= dt;
    this.activeTime += dt;
    this.heat = ctx.hazards.heatFactor(this.x, this.y);
    this.progress += (dt / this.spec.smeltTime) * this.heat;
    while (this.progress >= 1 && this.input.length && this.output.length < this.spec.outputMax) {
      this.progress -= 1;
      const ingot = ingotOf(this.input.shift()!)!;
      this.output.push(ingot);
      this.smelted++;
      ctx.countSmelted(ingot, this);
    }
    if (!this.input.length) this.progress = 0;
    this.progress = Math.min(this.progress, 1);
  }

  /** Pousse un lingot par pas dans la structure devant la sortie (les deux cases de la fonderie à tour de rôle). */
  private tryOutput(ctx: StructureContext): void {
    if (!this.output.length) return;
    const tiles = this.frontTiles();
    for (let k = 0; k < tiles.length; k++) {
      const i = (this.frontCursor + k) % tiles.length;
      const next = ctx.structureAt(tiles[i].x, tiles[i].y);
      if (next && next !== this && next.accept(this.output[0], this.dir, ctx)) {
        this.output.shift();
        this.frontCursor = i + 1;
        return;
      }
    }
  }

  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of [...this.input, ...this.output]) out[r] = (out[r] ?? 0) + 1;
    if (this.fuelUnits && this.def.fuel) out[this.def.fuel.res] = (out[this.def.fuel.res] ?? 0) + this.fuelUnits;
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      progress: this.progress,
      input: [...this.input],
      output: [...this.output],
      smelted: this.smelted,
    };
  }

  static load(type: string, s: StructureSave): Smelter {
    const m = new Smelter(type, s.x, s.y, s.dir);
    m.fuelUnits = Math.min(m.fuelMax, Number(s.fuelUnits ?? 0));
    m.burn = Number(s.burn ?? 0);
    m.progress = Math.min(1, Number(s.progress ?? 0));
    const list = (v: unknown, ok: (r: string) => boolean) => (Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string' && ok(r)) : []);
    m.input = list(s.input, (r) => !!ingotOf(r)).slice(0, m.spec.inputMax);
    m.output = list(s.output, (r) => hasResource(r)).slice(0, m.spec.outputMax);
    m.smelted = Number(s.smelted ?? 0);
    return m;
  }
}
