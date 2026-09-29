/**
 * Foreuse : extrait le gisement situé sous elle et pousse chaque unité vers
 * la tuile de devant (convoyeur, coffre…) ou, à défaut, dans n'importe quel
 * convoyeur collé à elle. Fonctionne au charbon.
 *
 * Améliorable sur place : le niveau 2 ajoute des têtes de forage à gauche et
 * à droite, le niveau 3 aussi derrière (la sortie reste devant). Chaque case
 * couverte qui a un gisement produit à la cadence de base ; la consommation
 * de charbon, elle, ne change pas.
 *
 * Elle accepte du charbon comme combustible de tous les côtés (convoyeur qui
 * pointe vers elle, coffre de charbon collé) : son alimentation peut donc
 * elle-même être automatisée.
 */
import { DX, DY, opposite, rotateCW, type Dir } from '../../core/dir';
import { getMachine, MachineDef, MachineLevel, ReachSide } from '../../data/machines';
import type { World } from '../World';
import { Structure, StructureContext, StructureSave } from './Structure';

/** Case couverte par une tête de forage. */
export interface DrillTile {
  x: number;
  y: number;
  side: ReachSide;
}

/** Ce qu'il faut pour savoir quelles cases couvertes ont encore un gisement. */
type DepositView = { world: World; structureAt(x: number, y: number): Structure | undefined };

/** Direction de la case `side`, vue depuis une foreuse dont la flèche pointe vers `dir`. */
function sideDir(dir: Dir, side: ReachSide): Dir | null {
  if (side === 'under') return null;
  if (side === 'right') return rotateCW(dir);
  if (side === 'left') return rotateCW(opposite(dir));
  return opposite(dir);
}

/** Cases couvertes par une foreuse posée en (x, y), flèche vers `dir`, pour la liste `reach`. */
export function reachTiles(x: number, y: number, dir: Dir, reach: readonly ReachSide[]): DrillTile[] {
  return reach.map((side) => {
    const d = sideDir(dir, side);
    return d === null ? { x, y, side } : { x: x + DX[d], y: y + DY[d], side };
  });
}

export type DrillStatus = 'ok' | 'nofuel' | 'full' | 'depleted';

export class Drill extends Structure {
  readonly type = 'drill';
  readonly def: MachineDef;
  /** Charbon en réserve dans la machine. */
  fuelUnits = 0;
  /** Temps de combustion restant (s). */
  burn = 0;
  progress = 0;
  buffer: string[] = [];
  status: DrillStatus = 'nofuel';
  /** Temps d'activité cumulé (animation). */
  activeTime = 0;
  extracted = 0;
  /** Niveau d'amélioration (1 = de base). */
  level = 1;
  /** Têtes de forage en activité au dernier pas (cases couvertes avec un gisement). */
  heads = 0;
  /** Cadence due à la chaleur de la Fournaise (1 = normale). */
  heat = 1;
  /** Prochaine case à forer (répartition équitable entre les têtes). */
  private cursor = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('drill');
  }

  get interval(): number {
    return 1 / this.def.stats.speed;
  }

  get levels(): MachineLevel[] {
    return this.def.levels ?? [{ level: 1, price: 0, reach: ['under'], summary: '' }];
  }

  get maxLevel(): number {
    return this.levels.length;
  }

  levelDef(level = this.level): MachineLevel {
    return this.levels[Math.max(1, Math.min(level, this.maxLevel)) - 1];
  }

  /** Amélioration suivante, ou null au niveau maximal. */
  nextLevel(): MachineLevel | null {
    return this.level < this.maxLevel ? this.levelDef(this.level + 1) : null;
  }

  /** Cases couvertes au niveau `level` (par défaut : le niveau actuel). */
  reach(level = this.level): DrillTile[] {
    return reachTiles(this.x, this.y, this.dir, this.levelDef(level).reach ?? ['under']);
  }

  /** Une case est exploitable si elle a un gisement et qu'aucune autre foreuse n'est posée dessus. */
  canDrill(t: DrillTile, v: DepositView): boolean {
    if (!v.world.depositAt(t.x, t.y)) return false;
    const other = v.structureAt(t.x, t.y);
    return !(other instanceof Drill) || other === this;
  }

  /** Cases couvertes qui ont encore un gisement exploitable. */
  sources(v: DepositView, level = this.level): DrillTile[] {
    return this.reach(level).filter((t) => this.canDrill(t, v));
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** Temps de fonctionnement restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Accepte son combustible de tous les côtés (convoyeur qui pointe vers elle, coffre collé…). */
  canAccept(res: string, _travel: Dir): boolean {
    return !!this.def.fuel && res === this.def.fuel.res && this.fuelUnits < this.fuelMax;
  }

  fuelWanted(): string | null {
    return this.def.fuel && this.fuelUnits < this.fuelMax ? this.def.fuel.res : null;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    this.fuelUnits++;
    return true;
  }

  /** Chargement manuel de combustible. Renvoie la quantité acceptée. */
  addFuel(n: number): number {
    const k = Math.max(0, Math.min(n, this.fuelMax - this.fuelUnits));
    this.fuelUnits += k;
    if (k > 0 && this.status === 'nofuel') this.status = 'ok';
    return k;
  }

  update(dt: number, ctx: StructureContext): void {
    this.tryOutput(ctx);
    const sources = this.sources(ctx);
    this.heads = sources.length;
    if (!sources.length) {
      this.status = 'depleted';
      return;
    }
    if (this.buffer.length >= this.def.stats.capacity) {
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
    this.progress += (dt / this.interval) * sources.length * this.heat;
    if (this.progress >= 1) {
      this.progress -= 1;
      const k = this.cursor % sources.length;
      this.cursor = k + 1;
      const src = sources[k];
      const res = ctx.world.takeFromDeposit(src.x, src.y);
      if (res) {
        this.buffer.push(res);
        this.extracted++;
        ctx.countExtracted(res, this);
        ctx.emit({ t: 'extract', tx: src.x, ty: src.y, res });
        this.tryOutput(ctx);
      }
    }
  }

  /** Sortie : la tuile devant la flèche en priorité, sinon un convoyeur collé sur un autre côté. */
  private tryOutput(ctx: StructureContext): void {
    if (!this.buffer.length) return;
    const res = this.buffer[0];
    const front = ctx.structureAt(this.x + DX[this.dir], this.y + DY[this.dir]);
    if ((front && front.accept(res, this.dir, ctx)) || this.pushToAdjacentConveyor(res, ctx, this.dir)) this.buffer.shift();
  }

  contents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.buffer) out[r] = (out[r] ?? 0) + 1;
    if (this.fuelUnits && this.def.fuel) out[this.def.fuel.res] = (out[this.def.fuel.res] ?? 0) + this.fuelUnits;
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      progress: this.progress,
      buffer: [...this.buffer],
      extracted: this.extracted,
      level: this.level,
    };
  }

  static load(s: StructureSave): Drill {
    const d = new Drill(s.x, s.y, s.dir);
    d.fuelUnits = Number(s.fuelUnits ?? 0);
    d.burn = Number(s.burn ?? 0);
    d.progress = Number(s.progress ?? 0);
    d.buffer = [...((s.buffer as string[]) ?? [])];
    d.extracted = Number(s.extracted ?? 0);
    d.level = Math.max(1, Math.min(d.maxLevel, Math.floor(Number(s.level ?? 1)) || 1));
    return d;
  }
}
