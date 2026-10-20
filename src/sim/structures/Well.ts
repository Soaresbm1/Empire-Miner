/**
 * Puits : remonte du minerai sans épuiser aucun gisement. Il fonctionne par cycles fixes (fer, argent, or, diamant dans un ordre
 * qui ne doit rien au hasard), brûle du charbon pendant qu'il travaille et use un mécanisme à chaque tranche de `wearUnits`
 * morceaux remontés. Sans mécanisme, il s'arrête et le dépanneur en affiche la cause.
 *
 * Il se pose au camp (3×3 cases) et pousse sa production devant la flèche, comme une foreuse : convoyeur, coffre, caisse
 * d'expédition. Le charbon entre de partout (convoyeur, coffre collé, ravitailleur, dépôt à la main) ; le mécanisme aussi, sauf
 * par la sortie.
 */
import { opposite, type Dir } from '../../core/dir';
import { getMachine, type MachineDef, type WellSpec } from '../../data/machines';
import { hasResource } from '../../data/resources';
import type { FlowState } from '../Flow';
import { Structure, type StructureContext, type StructureSave, frontTilesOf } from './Structure';

export type WellStatus = 'ok' | 'nofuel' | 'nomech' | 'full';

export class Well extends Structure {
  readonly type = 'well';
  readonly def: MachineDef;
  fuelUnits = 0;
  /** Temps de combustion restant de l'unité de charbon entamée (s). */
  burn = 0;
  /** Avancement du prochain morceau (0 → 1). */
  progress = 0;
  /** Place dans le cycle de minerai (jamais réduite : seul le reste modulo la longueur du cycle compte). */
  cycle = 0;
  /** Morceaux que le mécanisme en place peut encore remonter avant d'être remplacé (0 : il en faut un neuf). */
  life = 0;
  /** Mécanismes en réserve dans la machine. */
  mech = 0;
  /** Morceaux prêts à sortir, dans l'ordre. */
  output: string[] = [];
  status: WellStatus = 'nomech';
  /** Morceaux remontés au total. */
  made = 0;
  /** Temps de travail cumulé (animation). */
  activeTime = 0;
  private frontCursor = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('well');
    this.w = this.def.w;
    this.h = this.def.h;
  }

  get spec(): WellSpec {
    return this.def.well!;
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Temps de travail restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Le prochain minerai du cycle. */
  nextRes(): string {
    return this.spec.cycle[this.cycle % this.spec.cycle.length];
  }

  /** Morceaux que la réserve de mécanismes et celui en place peuvent encore remonter. */
  unitsLeft(): number {
    return this.life + this.mech * this.spec.wearUnits;
  }

  frontTiles(): { x: number; y: number }[] {
    return frontTilesOf(this);
  }

  canAccept(res: string, travel: Dir): boolean {
    if (res === this.def.fuel?.res) return this.fuelUnits < this.fuelMax;
    if (res === this.spec.mechanism) return this.mech < this.spec.mechMax && travel !== opposite(this.dir);
    return false;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    if (res === this.def.fuel?.res) this.fuelUnits++;
    else this.mech++;
    return true;
  }

  fuelWanted(): string | null {
    return this.def.fuel && this.fuelUnits < this.fuelMax ? this.def.fuel.res : null;
  }

  /** Chargement manuel de charbon. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(Math.floor(n), this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    return k;
  }

  /** Dépôt manuel de mécanismes. Renvoie la quantité acceptée. */
  addMech(n: number): number {
    const k = Math.max(0, Math.min(Math.floor(n), this.spec.mechMax - this.mech));
    this.mech += k;
    return k;
  }

  /**
   * Récupération par le joueur : chaque morceau prêt est offert à `take`, qui dit s'il l'a réellement pris (le sac peut manquer
   * de place pour l'un et pas pour l'autre : les minerais pèsent différemment). Ce qui n'est pas pris reste dans la machine.
   * Renvoie le nombre de morceaux retirés.
   */
  takeOutput(take: (res: string) => boolean): number {
    const keep: string[] = [];
    let n = 0;
    for (const res of this.output) {
      if (take(res)) n++;
      else keep.push(res);
    }
    this.output = keep;
    return n;
  }

  update(dt: number, ctx: StructureContext): void {
    this.tryOutput(ctx);
    const spec = this.spec;
    if (this.output.length >= spec.outputMax) {
      this.status = 'full';
      return;
    }
    if (this.life <= 0 && this.mech <= 0) {
      this.status = 'nomech';
      this.progress = 0;
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
    this.progress += dt / spec.interval;
    while (this.progress >= 1 && this.output.length < spec.outputMax) {
      if (this.life <= 0) {
        if (this.mech <= 0) break; // le prochain morceau attend un mécanisme neuf
        this.mech--;
        this.life = spec.wearUnits;
      }
      this.progress -= 1;
      const res = this.nextRes();
      this.cycle = (this.cycle + 1) % spec.cycle.length;
      this.life--;
      this.output.push(res);
      this.made++;
      this.flow.add();
      ctx.countExtracted(res, this);
    }
    this.progress = Math.min(this.progress, 1);
  }

  flowState(): FlowState {
    return this.status === 'ok' ? 'busy' : 'stuck';
  }

  /** Morceaux par minute à pleine cadence. */
  maxPerMinute(): number {
    return 60 / this.spec.interval;
  }

  /** Pousse un morceau par pas dans la structure devant la sortie (les cases à tour de rôle). */
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
    for (const r of this.output) out[r] = (out[r] ?? 0) + 1;
    if (this.fuelUnits && this.def.fuel) out[this.def.fuel.res] = (out[this.def.fuel.res] ?? 0) + this.fuelUnits;
    if (this.mech) out[this.spec.mechanism] = (out[this.spec.mechanism] ?? 0) + this.mech;
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      progress: this.progress,
      cycle: this.cycle,
      life: this.life,
      mech: this.mech,
      output: [...this.output],
      made: this.made,
    };
  }

  /** Recharge un puits sauvegardé ; toute valeur aberrante est ignorée (la machine repart d'un état sain). */
  static load(s: StructureSave): Well {
    const w = new Well(s.x, s.y, s.dir);
    const int = (v: unknown, max: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : 0;
    };
    w.fuelUnits = int(s.fuelUnits, w.fuelMax);
    const burn = Number(s.burn);
    w.burn = Number.isFinite(burn) ? Math.min(w.def.fuel?.secondsPerUnit ?? 0, Math.max(0, burn)) : 0;
    const progress = Number(s.progress);
    w.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    w.cycle = int(s.cycle, w.spec.cycle.length - 1);
    w.life = int(s.life, w.spec.wearUnits);
    w.mech = int(s.mech, w.spec.mechMax);
    w.output = (Array.isArray(s.output) ? s.output : []).filter((res): res is string => typeof res === 'string' && hasResource(res)).slice(0, w.spec.outputMax);
    w.made = int(s.made, Number.MAX_SAFE_INTEGER);
    return w;
  }
}
