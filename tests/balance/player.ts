/**
 * Joueur « macro » du banc : joue une vraie partie par grandes décisions, avec les vraies règles du jeu.
 *
 * Ce qui est réel : chaque coup de pioche (`GameState.update` avec une intention de minage : durée, dégâts, paliers de pioche),
 * le ramassage, le poids du sac, les ventes au comptoir au cours du marché, les achats à l'Atelier (prix, déblocages), la pose
 * des machines (`GameState.place` : portée, kits, emplacement), le charbon qui brûle, les caisses d'expédition.
 *
 * Ce qui est simplifié, et biaise les temps mesurés (à dire dans tout rapport) :
 * - le joueur se déplace d'un coup, mais la durée du trajet (plus court chemin ÷ vitesse de marche) est jouée : la partie
 *   avance pendant ce temps (machines, marché) ;
 * - il connaît toute la carte (il choisit ses filons et ses gisements sans les chercher) ;
 * - il ne subit pas les dangers (grisou, eau, éboulements) dans ses choix de chemin, et ne se soigne pas ;
 * - il ne pose que des lignes foreuse → convoyeurs → caisse d'expédition (avec un four en option), ne fait ni commandes ni
 *   chantier, n'emploie pas d'ouvriers, n'améliore pas ses machines ;
 * - il refait le plein de charbon à la main, en tournée.
 */
import { SURFACE_ROWS, TILE } from '../../src/core/constants';
import { DX, DY, opposite, type Dir } from '../../src/core/dir';
import { BLOCKS } from '../../src/data/blocks';
import { getMachine } from '../../src/data/machines';
import { getResource } from '../../src/data/resources';
import { BAGS, PICKAXES } from '../../src/data/tools';
import { PLAYER_SPEED, type GameState } from '../../src/sim/GameState';
import { Conveyor } from '../../src/sim/structures/Conveyor';
import { ShippingCrate } from '../../src/sim/structures/ShippingCrate';
import type { Structure } from '../../src/sim/structures/Structure';
import { walkable } from '../../src/sim/Workers';
import { Bench, round } from './harness';

const S = SURFACE_ROWS;
/** Temps pour traverser une case à pied (s). */
export const STEP = TILE / PLAYER_SPEED;
/** Case de la caisse d'expédition en surface, au-dessus du puits (celle de tests/shipping.test.ts). */
const CRATE = { x: 50, y: S - 2 };

export interface Profile {
  id: string;
  label: string;
  /** Le joueur remonte-t-il maintenant pour acheter quelque chose ? (appelé après chaque filon) */
  wantsShop(m: Macro): boolean;
  /** Achats à l'Atelier ; renvoie vrai si quelque chose a été acheté ou construit. */
  shop(m: Macro): boolean;
}

export interface Milestone {
  id: string;
  label: string;
  reached: (g: GameState) => boolean;
}

export const MILESTONES: Milestone[] = [
  { id: 'sale', label: 'première vente', reached: (g) => g.stats.earned > 0 },
  { id: 'pick2', label: 'pioche améliorée', reached: (g) => g.pickaxeLevel >= 1 },
  { id: 'bag2', label: 'grand sac', reached: (g) => g.bagLevel >= 1 },
  { id: 'drill', label: 'première foreuse posée', reached: (g) => g.structures.list.some((s) => s.type === 'drill') },
  { id: 'auto', label: 'première vente automatique', reached: (g) => g.stats.autoSold > 0 },
  { id: 'm100', label: 'profondeur 100 m', reached: (g) => g.stats.maxDepth >= 100 },
  { id: 'pick3', label: 'pioche en fer', reached: (g) => g.pickaxeLevel >= 2 },
  { id: 'furnace', label: 'premier lingot', reached: (g) => g.stats.smelted > 0 },
  { id: 'k1', label: 'argent ≥ 1 000 $', reached: (g) => g.money >= 1000 },
  { id: 'm300', label: 'profondeur 300 m', reached: (g) => g.stats.maxDepth >= 300 },
  { id: 'k10', label: 'argent ≥ 10 000 $', reached: (g) => g.money >= 10_000 },
  { id: 'pick4', label: 'pioche pro', reached: (g) => g.pickaxeLevel >= 3 },
  { id: 'm450', label: 'profondeur 450 m (Fournaise)', reached: (g) => g.stats.maxDepth >= 450 },
  { id: 'k100', label: 'argent ≥ 100 000 $', reached: (g) => g.money >= 100_000 },
];

interface Plan {
  /** Cases à parcourir, de la case du joueur (exclue) jusqu'au filon (inclus). */
  path: number[];
  value: number;
  cost: number;
}

export class Macro {
  readonly g: GameState;
  readonly reached = new Map<string, number>();
  /** Temps passé (s de jeu) à marcher, piocher, construire. */
  spent = { walk: 0, mine: 0, build: 0, idle: 0 };
  lines = 0;
  smelters = 0;
  failures: string[] = [];
  /** Blocs qu'il a fallu abandonner après 4 minutes de coups (chaleur, évanouissement, dégâts) : un fait du jeu, pas une erreur. */
  stuck = 0;
  private shopBlockedUntil = 0;
  private quoteKey = "";
  private quoteLine: ReturnType<Macro["bestLine"]> = null;

  constructor(
    readonly b: Bench,
    readonly profile: Profile,
  ) {
    this.g = b.g;
    // Le joueur ne ramasse pas la pierre : elle remplirait son sac (réglage de l'interface du jeu).
    this.g.autoPickup.stone = false;
    this.stand(CRATE.x - 1, S - 1);
  }

  // ------------------------------------------------------------------ déplacements

  private stand(tx: number, ty: number): void {
    this.g.player.x = (tx + 0.5) * TILE;
    this.g.player.y = (ty + 0.5) * TILE;
  }

  private tile(): { x: number; y: number } {
    return { x: this.g.player.tileX, y: this.g.player.tileY };
  }

  /** Laisse passer `seconds` de jeu (le joueur fait autre chose : marche, attend). */
  private pass(seconds: number, kind: keyof Macro['spent']): void {
    if (seconds <= 0) return;
    this.b.run(seconds);
    this.spent[kind] += seconds;
  }

  /** Nombre de cases du plus court chemin à pied entre deux cases (null : pas de chemin). */
  private walkSteps(x0: number, y0: number, x1: number, y1: number): number | null {
    const w = this.g.world.w;
    const h = this.g.world.h;
    const from = y0 * w + x0;
    const to = y1 * w + x1;
    if (from === to) return 0;
    const dist = new Int16Array(w * h).fill(-1);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    queue[tail++] = from;
    dist[from] = 0;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] >= 0) continue;
        if (n !== to && !walkable(this.g, nx, ny)) continue;
        dist[n] = dist[c] + 1;
        if (n === to) return dist[n];
        queue[tail++] = n;
      }
    }
    return null;
  }

  /** Marche jusqu'à la case (le temps du trajet est joué), puis s'y tient. */
  private walkTo(tx: number, ty: number): void {
    const p = this.tile();
    const steps = this.walkSteps(p.x, p.y, tx, ty);
    // Sans chemin connu (éboulis, structure en travers) : à vol d'oiseau, plus un détour.
    const n = steps ?? Math.ceil((Math.abs(tx - p.x) + Math.abs(ty - p.y)) * 1.4);
    this.pass(n * STEP, 'walk');
    this.stand(tx, ty);
  }

  /** Se tient devant un bâtiment du camp (assez près pour s'en servir). */
  private toBuilding(type: string): void {
    const bld = this.g.structures.list.find((s) => s.type === type);
    if (!bld) throw new Error(`bâtiment du camp absent : ${type}`);
    this.walkTo(bld.x + 1, bld.y + bld.h);
  }

  // ------------------------------------------------------------------ minage

  private pickaxe() {
    return PICKAXES[this.g.pickaxeLevel];
  }

  /** Valeur d'un bloc de filon (prix de base de ce qu'il lâche en moyenne), 0 pour une roche. */
  private veinValue(id: number): number {
    const blk = BLOCKS[id];
    if (!blk?.ore || !blk.drop) return 0;
    return ((blk.drop.min + blk.drop.max) / 2) * blk.drop.chance * getResource(blk.drop.res).value;
  }

  /**
   * Meilleur filon accessible : Dijkstra sur la carte (marcher coûte `STEP` par case, piocher une roche coûte le temps de ses
   * coups), borné à `horizon` secondes. Le meilleur est celui qui rapporte le plus par seconde, vente comprise.
   */
  private plan(horizon = 600): Plan | null {
    const g = this.g;
    const w = g.world.w;
    const h = g.world.h;
    const tool = this.pickaxe();
    const dist = new Float64Array(w * h).fill(Infinity);
    const prev = new Int32Array(w * h).fill(-1);
    const heap: [number, number][] = [];
    const push = (c: number, i: number) => {
      heap.push([c, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (heap[parent][0] <= heap[k][0]) break;
        [heap[parent], heap[k]] = [heap[k], heap[parent]];
        k = parent;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const start = g.player.tileY * w + g.player.tileX;
    dist[start] = 0;
    push(0, start);
    const coalWanted = this.coalWanted() > (g.inventory.items.coal ?? 0);
    const room = g.inventory.capacity - g.inventory.weight();
    let best: { idx: number; score: number; value: number } | null = null;
    while (heap.length) {
      const [c, i] = pop();
      if (c > dist[i]) continue;
      if (c > horizon) break;
      const x = i % w;
      const y = (i - x) / w;
      const id = g.world.tiles[i];
      const v = this.veinValue(id);
      if (v > 0 && BLOCKS[id].tier <= tool.tier) {
        const res = BLOCKS[id].drop!.res;
        const wt = getResource(res).weight * BLOCKS[id].drop!.max;
        if (wt <= room + 1e-6) {
          const wanted = res === 'coal' && coalWanted ? 4 : 1;
          const score = (v * wanted) / (c + 3);
          if (!best || score > best.score) best = { idx: i, score, value: v };
        }
      }
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 1 || ny < 0 || nx >= w - 1 || ny >= h - 1) continue;
        const n = ny * w + nx;
        let step: number;
        if (!g.world.isSolid(nx, ny)) {
          if (!walkable(g, nx, ny)) continue;
          step = STEP;
        } else {
          const blk = BLOCKS[g.world.tiles[n]];
          if (!blk.breakable || blk.tier > tool.tier) continue;
          step = STEP + Math.ceil(blk.hp / tool.damage) * tool.swingTime;
        }
        if (c + step < dist[n]) {
          dist[n] = c + step;
          prev[n] = i;
          push(c + step, n);
        }
      }
    }
    if (!best) return null;
    const path: number[] = [];
    for (let k = best.idx; k !== start && k >= 0; k = prev[k]) path.push(k);
    path.reverse();
    return { path, value: best.value, cost: dist[best.idx] };
  }

  /** Pioche un bloc depuis la case voisine `from`, jusqu'à ce qu'il cède (les coups sont ceux du jeu). */
  private mineTile(tx: number, ty: number): void {
    const intent = { mx: 0, my: 0, mine: true, target: { tx, ty } };
    let t = 0;
    while (this.g.world.isSolid(tx, ty) && t < 240) {
      this.b.run(0.25, { intent });
      t += 0.25;
    }
    this.spent.mine += t;
    if (t >= 240) this.stuck++;
  }

  /** Suit le chemin d'un plan : marche sur le dégagé, pioche le reste. */
  private follow(plan: Plan): void {
    const w = this.g.world.w;
    let walk = 0;
    for (let k = 0; k < plan.path.length; k++) {
      const i = plan.path[k];
      const x = i % w;
      const y = (i - x) / w;
      const last = k === plan.path.length - 1;
      if (this.g.world.isSolid(x, y)) {
        this.pass(walk * STEP, 'walk');
        walk = 0;
        const pi = k ? plan.path[k - 1] : this.g.player.tileY * w + this.g.player.tileX;
        this.stand(pi % w, (pi - (pi % w)) / w);
        this.mineTile(x, y);
        if (last) this.pass(0.8, 'mine'); // les morceaux viennent vers le joueur
        else walk++;
      } else {
        walk++;
      }
      if (!last) this.stand(x, y);
    }
    this.pass(walk * STEP, 'walk');
  }

  // ------------------------------------------------------------------ sac, vente, achats

  /** Charbon à garder sur soi pour les machines (la vente laisse ce stock). */
  coalWanted(): number {
    const burners = this.burners().length;
    return burners ? Math.min(60, 10 + burners * 6) : 0;
  }

  private bagNearlyFull(): boolean {
    const inv = this.g.inventory;
    return inv.capacity - inv.weight() < 7;
  }

  /** Remonte au comptoir, vend tout sauf la réserve de charbon, puis passe à l'Atelier si le profil le veut. */
  trip(): void {
    this.toBuilding('counter');
    for (const [res, n] of Object.entries({ ...this.g.inventory.items })) {
      const keep = res === 'coal' ? Math.min(n, this.coalWanted()) : 0;
      if (n - keep > 0) this.g.sell(res, n - keep);
    }
    if (this.g.time >= this.shopBlockedUntil && this.profile.wantsShop(this)) {
      this.toBuilding('workshop');
      if (!this.profile.shop(this)) this.shopBlockedUntil = this.g.time + 120;
    }
  }

  /** Achats élémentaires, à l'Atelier (le joueur y est). */
  buyPickaxe(): boolean {
    this.atWorkshop();
    return this.g.buyNextPickaxe();
  }
  buyBag(): boolean {
    this.atWorkshop();
    return this.g.buyNextBag();
  }
  /** Retourne devant l'Atelier si on s'en est éloigné (après avoir posé une ligne, par exemple). */
  private atWorkshop(): void {
    if (!this.g.isNear('workshop')) this.toBuilding('workshop');
  }
  nextPickaxePrice(): number {
    return PICKAXES[this.g.pickaxeLevel + 1]?.price ?? Infinity;
  }
  nextBagPrice(): number {
    return BAGS[this.g.bagLevel + 1]?.price ?? Infinity;
  }

  // ------------------------------------------------------------------ lignes de production

  private burners(): (Structure & { fuelUnits: number; fuelMax: number; addFuel(n: number): number })[] {
    return this.g.structures.list.filter((s): s is Structure & { fuelUnits: number; fuelMax: number; addFuel(n: number): number } => 'addFuel' in s && 'fuelMax' in s && 'fuelUnits' in s);
  }

  private free(x: number, y: number): boolean {
    const g = this.g;
    return g.world.isOpen(x, y) && !g.structures.at(x, y) && !g.world.depositAt(x, y) && walkable(g, x, y);
  }

  /**
   * Meilleure ligne à poser : un gisement dégagé relié par des convoyeurs à la caisse d'expédition (ou à une ligne existante,
   * par le côté). Recherche depuis le point d'arrivée vers l'extérieur, une seule fois pour tous les gisements.
   */
  private bestLine(): { dep: { x: number; y: number }; start: { x: number; y: number; dir: Dir }; cells: { x: number; y: number; dir: Dir }[]; res: string; score: number } | null {
    const g = this.g;
    const w = g.world.w;
    const h = g.world.h;
    const next = new Int8Array(w * h).fill(-1);
    const dist = new Int16Array(w * h).fill(-1);
    const queue: number[] = [];
    const seed = (x: number, y: number, d: Dir) => {
      if (x < 1 || y < 0 || x >= w - 1 || y >= h - 1 || !this.free(x, y)) return;
      const i = y * w + x;
      if (dist[i] >= 0) return;
      dist[i] = 1;
      next[i] = d;
      queue.push(i);
    };
    const hasCrate = g.structures.list.some((s) => s instanceof ShippingCrate);
    const targets: { x: number; y: number; belt: Conveyor | null }[] = [];
    if (!hasCrate) targets.push({ x: CRATE.x, y: CRATE.y, belt: null });
    for (const s of g.structures.list) if (s instanceof ShippingCrate) targets.push({ x: s.x, y: s.y, belt: null });
    for (const s of g.structures.list) if (s instanceof Conveyor) targets.push({ x: s.x, y: s.y, belt: s });
    for (const t of targets)
      for (let d = 0; d < 4; d++) {
        // On entre dans la cible en allant dans la direction d, depuis la case qui la précède.
        if (t.belt && opposite(d as Dir) === t.belt.dir) continue;
        seed(t.x - DX[d], t.y - DY[d], d as Dir);
      }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % w;
      const y = (i - x) / w;
      if (dist[i] >= 140) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 1 || ny < 0 || nx >= w - 1 || ny >= h - 1 || !this.free(nx, ny)) continue;
        const n = ny * w + nx;
        if (dist[n] >= 0) continue;
        dist[n] = dist[i] + 1;
        next[n] = opposite(d as Dir); // de n vers i
        queue.push(n);
      }
    }
    // Chaque gisement dégagé : sa meilleure case de départ (voisine ouverte, déjà reliée), valeur × réserve exploitable ÷ longueur.
    let best: { dep: { x: number; y: number }; startIdx: number; res: string; len: number; score: number } | null = null;
    for (let y = 0; y < h; y++)
      for (let x = 1; x < w - 1; x++) {
        const di = y * w + x;
        const res = g.world.depositAt(x, y);
        if (!res || !g.world.isOpen(x, y) || g.structures.at(x, y) || g.world.reserve[di] < 150) continue;
        let startIdx = -1;
        let len = 1e9;
        for (let d = 0; d < 4; d++) {
          const n = (y + DY[d]) * w + x + DX[d];
          if (dist[n] > 0 && dist[n] < len) {
            len = dist[n];
            startIdx = n;
          }
        }
        if (startIdx < 0) continue;
        // Rendement d'une foreuse : 24 unités par minute, dans la limite de la réserve (une heure de travail au plus).
        const worth = getResource(res).value * Math.min(g.world.reserve[di], 1440);
        const score = worth / (len * 6 + 400);
        if (!best || score > best.score) best = { dep: { x, y }, startIdx, res, len, score };
      }
    if (!best) return null;
    const cells: { x: number; y: number; dir: Dir }[] = [];
    for (let i = best.startIdx; ; ) {
      const x = i % w;
      const y = (i - x) / w;
      const d = next[i] as Dir;
      cells.push({ x, y, dir: d });
      const nx = x + DX[d];
      const ny = y + DY[d];
      const target = g.structures.at(nx, ny);
      if ((nx === CRATE.x && ny === CRATE.y) || target) break;
      i = ny * w + nx;
    }
    const sx = best.startIdx % w;
    const sy = (best.startIdx - sx) / w;
    const dd = DX.findIndex((v, k) => best!.dep.x + v === sx && best!.dep.y + DY[k] === sy) as Dir;
    return { dep: best.dep, start: { x: sx, y: sy, dir: dd }, cells, res: best.res, score: best.score };
  }

  /** Prix de la prochaine ligne (foreuse, convoyeurs, caisse si elle manque, four en option), ou null s'il n'y a pas de gisement. */
  lineQuote(smelt: boolean): number | null {
    // La recherche parcourt toute la carte : on la garde 30 s de jeu (et tant que les machines ne changent pas).
    const key = Math.floor(this.g.time / 30) + ":" + this.g.structures.list.length + ":" + this.g.pickaxeLevel;
    if (this.quoteKey !== key) {
      this.quoteKey = key;
      this.quoteLine = this.bestLine();
    }
    const line = this.quoteLine;
    if (!line) return null;
    const hasCrate = this.g.structures.list.some((s) => s instanceof ShippingCrate);
    return getMachine('drill').price + line.cells.length * getMachine('conveyor').price + (hasCrate ? 0 : getMachine('shipping').price) + (smelt ? getMachine('furnace').price : 0);
  }

  /**
   * Pose la prochaine ligne (le joueur est à l'Atelier, kits payés au prix de l'Atelier). Renvoie faux, avec la raison dans
   * `failures`, si une pose est refusée par le jeu.
   */
  buildLine(smelt: boolean): boolean {
    const g = this.g;
    const line = this.bestLine();
    if (!line) return false;
    const hasCrate = g.structures.list.some((s) => s instanceof ShippingCrate);
    const cells = line.cells;
    const useFurnace = smelt && cells.length >= 4;
    const belts = cells.length - (useFurnace ? 1 : 0);
    const need: Record<string, number> = { drill: 1, conveyor: belts, ...(hasCrate ? {} : { shipping: 1 }), ...(useFurnace ? { furnace: 1 } : {}) };
    // Seulement les kits qui manquent (un achat interrompu ne se paie pas deux fois), au prix de l'Atelier.
    const missing = Object.entries(need).map(([id, n]) => [id, Math.max(0, n - g.inventory.kitCount(id))] as const);
    const price = missing.reduce((a, [id, n]) => a + n * getMachine(id).price, 0);
    if (g.money < price) return false;
    this.atWorkshop();
    for (const [id, n] of missing) {
      if (n > 0 && !g.buyKit(id, n)) {
        this.failures.push(`achat de ${n} ${id} refusé (argent ${g.money}, prix ${getMachine(id).price * n})`);
        return false;
      }
    }
    // Le trajet jusqu'au gisement et le long de la ligne.
    const p = this.tile();
    const toDep = this.walkSteps(p.x, p.y, line.start.x, line.start.y) ?? 60;
    this.pass((toDep + cells.length) * STEP, 'build');
    const put = (id: string, x: number, y: number, dir: Dir, from: { x: number; y: number }): Structure | null => {
      this.stand(from.x, from.y);
      const s = g.place(id, x, y, dir);
      if (!s || 'rider' in s) {
        this.failures.push(`${id} en ${x},${y} : ${g.canPlace(id, x, y).reason ?? 'refusé'}`);
        return null;
      }
      return s;
    };
    if (!hasCrate) {
      const last = cells[cells.length - 1];
      if (!put('shipping', CRATE.x, CRATE.y, 0, last)) return false;
    }
    const drill = put('drill', line.dep.x, line.dep.y, line.start.dir, line.start);
    if (!drill) return false;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const furnaceHere = useFurnace && k === 2;
      const from = furnaceHere ? cells[1] : c;
      const s = put(furnaceHere ? 'furnace' : 'conveyor', c.x, c.y, c.dir, from);
      if (!s) return false;
    }
    this.lines++;
    if (useFurnace) this.smelters++;
    this.refuelAll();
    return true;
  }

  // ------------------------------------------------------------------ charbon

  /** Machines à charbon qui ont besoin d'être rechargées, la plus urgente d'abord. */
  private fuelDue(threshold: number) {
    return this.burners()
      .filter((s) => s.fuelUnits < s.fuelMax - 1)
      .map((s) => {
        const per = (s as unknown as { def: { fuel?: { secondsPerUnit: number } } }).def.fuel?.secondsPerUnit ?? 30;
        const burn = (s as unknown as { burn?: number }).burn ?? 0;
        return { s, left: burn + s.fuelUnits * per };
      })
      .filter((x) => x.left < threshold)
      .sort((a, b) => a.left - b.left);
  }

  /** Tournée de ravitaillement : va de machine en machine avec le charbon du sac. */
  refuelAll(threshold = 1e9): number {
    const g = this.g;
    let given = 0;
    const todo = this.fuelDue(threshold).map((x) => x.s);
    while (todo.length && (g.inventory.items.coal ?? 0) > 0) {
      const p = this.tile();
      // La plus proche d'abord.
      todo.sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)));
      const s = todo.shift()!;
      const spot = [
        [s.x, s.y - 1],
        [s.x, s.y + s.h],
        [s.x - 1, s.y],
        [s.x + s.w, s.y],
      ].find(([x, y]) => g.world.isOpen(x, y) && walkable(g, x, y));
      if (!spot) continue;
      this.walkTo(spot[0], spot[1]);
      const k = s.addFuel(g.inventory.count('coal'));
      g.inventory.remove('coal', k);
      given += k;
    }
    return given;
  }

  // ------------------------------------------------------------------ partie

  private checkMilestones(): void {
    for (const m of MILESTONES) if (!this.reached.has(m.id) && m.reached(this.g)) this.reached.set(m.id, round(this.g.time / 60, 1));
  }

  /** Joue jusqu'à `minutes` minutes de jeu. */
  play(minutes: number): void {
    const g = this.g;
    const end = minutes * 60;
    let stuck = 0;
    while (g.time < end) {
      this.checkMilestones();
      if (this.bagNearlyFull() || (g.time >= this.shopBlockedUntil && this.profile.wantsShop(this))) {
        this.trip();
        continue;
      }
      if (this.fuelDue(45).length && (g.inventory.items.coal ?? 0) > 0) {
        this.refuelAll(240);
        continue;
      }
      const plan = this.plan();
      if (!plan) {
        // Plus rien d'utile à portée : on attend (les lignes travaillent), puis on remonte vendre.
        this.pass(30, 'idle');
        if (++stuck > 3) this.trip();
        continue;
      }
      stuck = 0;
      this.follow(plan);
    }
    this.checkMilestones();
  }
}

export { round };
