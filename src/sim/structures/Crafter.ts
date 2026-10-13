/**
 * Manufacture : transforme des lingots (ou des diamants) en produits — plaques, acier, diamant taillé — selon la recette
 * que le joueur a choisie (touche E, voir `data/recipes.ts`).
 *
 * Elle marche comme un four : les matières de la recette entrent par n'importe quel côté sauf la sortie (convoyeur,
 * foreuse, coffre collés, ou dépôt à la main), le charbon entre de partout et ne brûle que pendant le travail, et chaque
 * produit est poussé devant la flèche dans la structure qui s'y trouve (convoyeur, coffre, caisse d'expédition…). Une
 * matière qui n'est pas dans la recette en cours est refusée : le convoyeur attend.
 *
 * Changer de recette rend ce qui attendait dans la machine et que la nouvelle recette n'utilise pas (voir `setRecipe`).
 */
import { opposite, type Dir } from '../../core/dir';
import { getMachine, type CrafterSpec, type MachineDef } from '../../data/machines';
import { getRecipe, hasRecipe, type RecipeSpec } from '../../data/recipes';
import { hasResource } from '../../data/resources';
import { Structure, type StructureContext, type StructureSave, frontTilesOf } from './Structure';

export type CrafterStatus = 'norecipe' | 'idle' | 'ok' | 'nofuel' | 'full';

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

export class Crafter extends Structure {
  readonly type = 'crafter';
  readonly def: MachineDef;
  /** Recette choisie (identifiant du produit), ou null tant que rien n'est choisi. */
  recipe: string | null = null;
  fuelUnits = 0;
  /** Temps de combustion restant de l'unité de charbon entamée (s). */
  burn = 0;
  /** Avancement de la fabrication en cours (0 → 1). */
  progress = 0;
  /** Matières en attente, par ressource. */
  input: Record<string, number> = {};
  /** Produits prêts à sortir, dans l'ordre. */
  output: string[] = [];
  status: CrafterStatus = 'norecipe';
  /** Produits fabriqués au total par cette machine. */
  made = 0;
  /** Temps de travail cumulé (animation). */
  activeTime = 0;
  /** Cadence due à la chaleur de la Fournaise (1 = normale). */
  heat = 1;
  /** Case de sortie servie en dernier (deux cases devant la machine). */
  private frontCursor = 0;

  constructor(x: number, y: number, dir: Dir) {
    super(x, y, dir);
    this.def = getMachine('crafter');
    this.w = this.def.w;
    this.h = this.def.h;
  }

  get spec(): CrafterSpec {
    return this.def.crafter!;
  }

  get fuelMax(): number {
    return this.def.fuel?.maxUnits ?? 0;
  }

  /** La recette en cours, ou null. */
  get current(): RecipeSpec | null {
    return this.recipe ? getRecipe(this.recipe) : null;
  }

  /** Temps de travail restant avec le charbon chargé (s). */
  fuelSeconds(): number {
    return this.burn + this.fuelUnits * (this.def.fuel?.secondsPerUnit ?? 0);
  }

  /** Fabrications par minute à la cadence du moment (0 sans recette). */
  perMinute(): number {
    const r = this.current;
    return r ? (60 / r.time) * r.yield * this.heat : 0;
  }

  /** Cases devant la sortie (deux, la machine fait 2×2). */
  frontTiles(): { x: number; y: number }[] {
    return frontTilesOf(this);
  }

  /** Les matières en attente suffisent-elles pour une fabrication de `r` ? */
  private canMake(r: RecipeSpec): boolean {
    return Object.entries(r.inputs).every(([res, n]) => (this.input[res] ?? 0) >= n);
  }

  /** Matières en attente, toutes confondues. */
  inputCount(): number {
    return Object.values(this.input).reduce((n, k) => n + k, 0);
  }

  canAccept(res: string, travel: Dir): boolean {
    const fuel = this.def.fuel?.res;
    if (res === fuel) return this.fuelUnits < this.fuelMax;
    const r = this.current;
    // Une matière hors recette est refusée ; elle n'entre pas non plus par la sortie (sens inverse de la flèche).
    if (!r || !own(r.inputs, res) || travel === opposite(this.dir)) return false;
    return (this.input[res] ?? 0) < this.spec.inputMax;
  }

  accept(res: string, travel: Dir): boolean {
    if (!this.canAccept(res, travel)) return false;
    if (res === this.def.fuel?.res) this.fuelUnits++;
    else this.input[res] = (this.input[res] ?? 0) + 1;
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

  /** Dépôt manuel d'une matière de la recette. Renvoie la quantité acceptée. */
  addInput(res: string, n: number): number {
    const r = this.current;
    if (!r || !own(r.inputs, res)) return 0;
    const k = Math.max(0, Math.min(Math.floor(n), this.spec.inputMax - (this.input[res] ?? 0)));
    if (k > 0) this.input[res] = (this.input[res] ?? 0) + k;
    return k;
  }

  /** Retire les produits prêts (récupération par le joueur), dans la limite de `room(res)`. */
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

  /**
   * Choisit la recette (null : aucune). Renvoie les matières en attente que la nouvelle recette n'utilise pas : elles sont
   * retirées de la machine, à l'appelant de les rendre au joueur. Celles que les deux recettes utilisent restent.
   */
  setRecipe(id: string | null): Record<string, number> {
    this.recipe = hasRecipe(id) ? id : null;
    this.progress = 0;
    const r = this.current;
    const displaced: Record<string, number> = {};
    for (const [res, n] of Object.entries(this.input)) {
      if (r && own(r.inputs, res)) continue;
      if (n > 0) displaced[res] = n;
      delete this.input[res];
    }
    return displaced;
  }

  update(dt: number, ctx: StructureContext): void {
    this.tryOutput(ctx);
    const r = this.current;
    if (!r) {
      this.status = 'norecipe';
      this.progress = 0;
      return;
    }
    if (!this.canMake(r)) {
      this.status = 'idle';
      this.progress = 0;
      return;
    }
    if (this.output.length + r.yield > this.spec.outputMax) {
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
    this.progress += (dt / r.time) * this.heat;
    while (this.progress >= 1 && this.canMake(r) && this.output.length + r.yield <= this.spec.outputMax) {
      this.progress -= 1;
      for (const [res, n] of Object.entries(r.inputs)) {
        const left = (this.input[res] ?? 0) - n;
        if (left > 0) this.input[res] = left;
        else delete this.input[res];
      }
      for (let i = 0; i < r.yield; i++) {
        this.output.push(r.id);
        this.made++;
        ctx.countCrafted(r.id, this);
      }
    }
    if (!this.canMake(r)) this.progress = 0;
    this.progress = Math.min(this.progress, 1);
  }

  /** Pousse un produit par pas dans la structure devant la sortie (les deux cases à tour de rôle). */
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
    for (const [res, n] of Object.entries(this.input)) if (n > 0) out[res] = (out[res] ?? 0) + n;
    for (const r of this.output) out[r] = (out[r] ?? 0) + 1;
    if (this.fuelUnits && this.def.fuel) out[this.def.fuel.res] = (out[this.def.fuel.res] ?? 0) + this.fuelUnits;
    return out;
  }

  serialize(): StructureSave {
    return {
      ...super.serialize(),
      recipe: this.recipe,
      fuelUnits: this.fuelUnits,
      burn: this.burn,
      progress: this.progress,
      input: { ...this.input },
      output: [...this.output],
      made: this.made,
    };
  }

  /** Recharge une Manufacture sauvegardée ; toute valeur aberrante est ignorée (la machine repart d'un état sain). */
  static load(s: StructureSave): Crafter {
    const m = new Crafter(s.x, s.y, s.dir);
    m.recipe = hasRecipe(s.recipe) ? s.recipe : null;
    const r = m.current;
    const int = (v: unknown, max: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : 0;
    };
    m.fuelUnits = int(s.fuelUnits, m.fuelMax);
    const burn = Number(s.burn);
    m.burn = Number.isFinite(burn) ? Math.min(m.def.fuel?.secondsPerUnit ?? 0, Math.max(0, burn)) : 0;
    const progress = Number(s.progress);
    m.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const input = s.input && typeof s.input === 'object' ? (s.input as Record<string, unknown>) : {};
    if (r)
      for (const res of Object.keys(r.inputs)) {
        const n = int(input[res], m.spec.inputMax);
        if (n > 0) m.input[res] = n;
      }
    m.output = (Array.isArray(s.output) ? s.output : []).filter((res): res is string => typeof res === 'string' && hasResource(res)).slice(0, m.spec.outputMax);
    m.made = int(s.made, Number.MAX_SAFE_INTEGER);
    return m;
  }
}
