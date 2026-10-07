/**
 * Ouvriers : des travailleurs achetés à l'Atelier qui font des corvées à la place du joueur.
 *
 * - Ramasseur : va chercher les minerais laissés au sol et les range dans le coffre le plus proche qui les accepte
 *   (chaque coffre peut être réglé sur certains minerais : il ne prend jamais un tas qu'aucun coffre n'accepte).
 * - Ravitailleur : prend du charbon dans les coffres et recharge les machines qui en manquent.
 *
 * Un ouvrier se déplace de case en case (plus court chemin sur la grille, en évitant la roche, les machines, le
 * grisou et l'eau profonde) puis fait son geste : ramasser, déposer, prendre, recharger. Il n'a pas de santé : il
 * évite simplement les dangers. Quand il n'y a rien à faire, il attend près du camp.
 *
 * Seuls le métier, la position et la charge sont sauvegardés ; le reste se recalcule.
 */
import { TILE } from '../core/constants';
import { DX, DY, type Dir } from '../core/dir';
import { GAS, WATER } from '../data/hazards';
import { hasResource, getResource, RESOURCES } from '../data/resources';
import { DRILLER, DRILLER_LEVELS, WORKERS, drillerLevel, isJob, type WorkerJob } from '../data/workers';
import type { GameState } from './GameState';
import { TunnelBorer } from './structures/Borer';
import { Drill } from './structures/Drill';
import { Storage } from './structures/Storage';
import type { Structure } from './structures/Structure';
import { hyp } from '../core/dmath';

/** Ce que l'ouvrier est en train de faire. */
export type WorkerTask =
  /** Marche vers un tas au sol (identifiant du tas). */
  | { kind: 'pick'; drop: number }
  /** Marche vers un coffre pour y déposer sa charge (case d'origine du coffre). */
  | { kind: 'store'; x: number; y: number }
  /** Ravitailleur : marche vers un coffre qui contient du charbon. */
  | { kind: 'take'; x: number; y: number }
  /** Ravitailleur : marche vers une machine à recharger. */
  | { kind: 'fuel'; x: number; y: number }
  /** Foreur : marche vers un gisement (case du gisement) où poser une foreuse. */
  | { kind: 'place'; x: number; y: number }
  /** Ramasseur : marche vers une machine qui garde du minerai (foreuse, base de foreuse de percement) pour la vider. */
  | { kind: 'collect'; x: number; y: number }
  | { kind: 'home' };

/** Pourquoi un ouvrier ne peut pas avancer (pour l'interface). */
export type WorkerFlag =
  /** Ramasseur : aucun coffre n'accepte ce qu'il porte ou ce qui traîne (réglage des coffres, pas de coffre). */
  | 'nostore'
  /** Ramasseur : les coffres qui acceptent ce minerai sont pleins. */
  | 'full'
  /** Ramasseur : un coffre convient, mais aucun chemin n'y mène (roche, grisou, eau profonde, machine en travers). */
  | 'noroute'
  | 'nocoal'
  | 'lost'
  /** Foreur : des gisements l'attendent, mais ni foreuse en stock ni argent pour en acheter une. */
  | 'nodrill';

export interface Worker {
  id: number;
  job: WorkerJob;
  /** Position des pieds, en pixels du monde. */
  x: number;
  y: number;
  facing: Dir;
  cargo: Record<string, number>;
  /** Niveau (1 à 4) : celui du foreur décide des minerais qu'il équipe et de sa vitesse ; les autres métiers restent au niveau 1. */
  level: number;
  task: WorkerTask | null;
  /** Cases restantes à parcourir (indices), la prochaine en premier. */
  path: number[];
  /** Pause après un geste (s), puis délai avant de chercher du travail (s). */
  wait: number;
  retry: number;
  flag: WorkerFlag | null;
  moving: boolean;
  walkTime: number;
}

export interface WorkerSave {
  id: number;
  job: WorkerJob;
  /** Niveau du foreur (facultatif : 1 par défaut, anciennes sauvegardes). */
  level?: number;
  x: number;
  y: number;
  cargo: Record<string, number>;
}

/** Une machine qui réclame du combustible. */
interface FuelMachine extends Structure {
  fuelUnits: number;
  fuelMax: number;
  addFuel(n: number): number;
}

const isFuelMachine = (s: Structure): s is FuelMachine => 'addFuel' in s && 'fuelUnits' in s && 'fuelMax' in s;

export function cargoWeight(cargo: Record<string, number>): number {
  let w = 0;
  for (const [res, n] of Object.entries(cargo)) w += getResource(res).weight * n;
  return w;
}

export const cargoCount = (cargo: Record<string, number>): number => Object.values(cargo).reduce((a, b) => a + b, 0);

/** Recherche de chemin sur la grille (largeur d'abord), avec des tableaux réutilisés d'une recherche à l'autre. */
class Pather {
  private seen: Uint32Array;
  private prev: Int32Array;
  private dist: Int32Array;
  private queue: Int32Array;
  private stamp = 0;

  constructor(size: number) {
    this.seen = new Uint32Array(size);
    this.prev = new Int32Array(size);
    this.dist = new Int32Array(size);
    this.queue = new Int32Array(size);
  }

  /**
   * Plus court chemin de la case `from` à la case franchissable la plus proche qui vérifie `goal`. Renvoie les cases à
   * parcourir (la case de départ exclue ; vide si l'on y est déjà), ou null s'il n'y en a pas à moins de `maxLen`.
   */
  find(g: GameState, from: number, goal: (i: number) => boolean, maxLen: number): number[] | null {
    const w = g.world.w;
    this.stamp++;
    const stamp = this.stamp;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = from;
    this.seen[from] = stamp;
    this.prev[from] = -1;
    this.dist[from] = 0;
    while (head < tail) {
      const i = this.queue[head++];
      if (goal(i)) {
        const path: number[] = [];
        for (let c = i; c !== from; c = this.prev[c]) path.push(c);
        return path.reverse();
      }
      const d = this.dist[i];
      if (d >= maxLen) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (!walkable(g, nx, ny)) continue;
        const n = ny * w + nx;
        if (this.seen[n] === stamp) continue;
        this.seen[n] = stamp;
        this.prev[n] = i;
        this.dist[n] = d + 1;
        this.queue[tail++] = n;
      }
    }
    return null;
  }
}

/** Délai (s) avant de refaire une recherche (jusqu'au bout de la mine) qui n'a rien donné. */
const FAR_RETRY = 3;

/** Case où un ouvrier peut marcher : ni roche, ni machine pleine, ni foreuse en route, ni grisou ou eau profonde. */
export function walkable(g: GameState, x: number, y: number): boolean {
  const world = g.world;
  if (!world.inBounds(x, y) || world.isSolid(x, y)) return false;
  const s = g.structures.at(x, y);
  if (s && s.solid) return false;
  if (g.borerAt(x, y)) return false;
  return g.hazards.gasAt(x, y) < GAS.harmful && g.hazards.waterAt(x, y) < WATER.deep;
}

/** Cases franchissables qui touchent la structure `s` (son contour, sans les angles). */
function around(g: GameState, s: Structure): number[] {
  const out: number[] = [];
  const w = g.world.w;
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++)
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx >= s.x && nx < s.x + s.w && ny >= s.y && ny < s.y + s.h) continue;
        if (walkable(g, nx, ny)) out.push(ny * w + nx);
      }
  return out;
}

/**
 * Minerai qu'une machine garde et qu'un ramasseur peut venir prendre : la sortie d'une foreuse à charbon qui en garde
 * assez (une foreuse reliée à un convoyeur se vide seule), le stock de la base d'une foreuse de percement.
 */
export function heldOre(s: Structure): Record<string, number> {
  const out: Record<string, number> = {};
  if (s instanceof Drill) {
    if (s.buffer.length >= WORKERS.machinePickup.drill) for (const r of s.buffer) out[r] = (out[r] ?? 0) + 1;
  } else if (s instanceof TunnelBorer) {
    if (s.storeCount() >= WORKERS.machinePickup.borerBase) for (const [r, n] of Object.entries(s.store)) if (n > 0) out[r] = n;
  }
  return out;
}

/** Retire `n` unités de `res` du minerai que garde la machine ; renvoie combien ont été prises. */
function takeHeld(s: Structure, res: string, n: number): number {
  if (s instanceof Drill) {
    let k = 0;
    for (let i = s.buffer.length - 1; i >= 0 && k < n; i--)
      if (s.buffer[i] === res) {
        s.buffer.splice(i, 1);
        k++;
      }
    return k;
  }
  if (s instanceof TunnelBorer) return s.takeStored(res, n);
  return 0;
}

/**
 * Une foreuse posée sur la case (x, y) boucherait-elle un passage ? Vrai quand les cases libres qui l'entourent ne se
 * rejoignent plus, dans un rayon de `DRILLER.passageRadius` cases, une fois la case occupée (un cul-de-sac ne gêne personne).
 */
export function blocksPassage(g: GameState, x: number, y: number): boolean {
  const w = g.world.w;
  const free: number[] = [];
  for (let k = 0; k < 4; k++) {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (walkable(g, nx, ny)) free.push(ny * w + nx);
  }
  if (free.length <= 1) return false;
  const here = y * w + x;
  const seen = new Set<number>([here, free[0]]);
  let frontier = [free[0]];
  for (let step = 0; step < DRILLER.passageRadius && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const cx = i % w;
      const cy = (i - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        const n = ny * w + nx;
        if (seen.has(n) || !walkable(g, nx, ny)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
    if (free.every((f) => seen.has(f))) return false;
  }
  return !free.every((f) => seen.has(f));
}

export class WorkerSystem {
  list: Worker[] = [];
  private nextId = 1;
  private pather: Pather | null = null;

  get count(): number {
    return this.list.length;
  }

  get(id: number): Worker | undefined {
    return this.list.find((w) => w.id === id);
  }

  /** Embauche un ouvrier sur sa case d'attente. */
  add(job: WorkerJob, g: GameState): Worker {
    const w: Worker = {
      id: this.nextId++,
      job,
      x: 0,
      y: 0,
      facing: 1,
      cargo: {},
      level: 1,
      task: null,
      path: [],
      wait: 0,
      retry: 0,
      flag: null,
      moving: false,
      walkTime: 0,
    };
    this.list.push(w);
    const home = this.homeTile(g, this.list.length - 1);
    w.x = (home % g.world.w + 0.5) * TILE;
    w.y = (Math.floor(home / g.world.w) + 0.5) * TILE;
    return w;
  }

  /** Congédie un ouvrier ; ce qu'il portait reste par terre, là où il se trouve. */
  remove(id: number, g: GameState): boolean {
    const w = this.get(id);
    if (!w) return false;
    for (const [res, n] of Object.entries(w.cargo)) if (n > 0) g.drops.spawn(res, n, w.x, w.y - 2);
    // Ses foreuses restent, mais n'ont plus de propriétaire (un identifiant libéré pourrait servir à un autre foreur).
    for (const s of g.structures.list) if (s instanceof Drill && s.placedBy === id) s.placedBy = 0;
    this.list.splice(this.list.indexOf(w), 1);
    return true;
  }

  setJob(id: number, job: WorkerJob): boolean {
    const w = this.get(id);
    if (!w || w.job === job) return false;
    w.job = job;
    w.task = null;
    w.path = [];
    w.flag = null;
    w.retry = 0;
    return true;
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, g: GameState): void {
    for (const w of this.list) this.updateOne(w, dt, g);
  }

  private updateOne(w: Worker, dt: number, g: GameState): void {
    w.moving = false;
    if (w.wait > 0) {
      w.wait -= dt;
      return;
    }
    if (!w.task) {
      w.retry -= dt;
      if (w.retry <= 0) this.think(w, g);
      return;
    }
    const r = this.walk(w, dt, g);
    if (r === 'blocked') this.abort(w, 1);
    else if (r === 'arrived') this.arrive(w, g);
  }

  /** Abandonne la tâche (chemin coupé, tas disparu…) et réfléchit de nouveau après `delay` secondes. */
  private abort(w: Worker, delay: number): void {
    w.task = null;
    w.path = [];
    w.retry = delay;
  }

  /** Avance vers la prochaine case du chemin. */
  private walk(w: Worker, dt: number, g: GameState): 'moving' | 'arrived' | 'blocked' {
    const width = g.world.w;
    if (w.path.length) {
      const i = w.path[0];
      const tx = i % width;
      const ty = (i - tx) / width;
      if (!walkable(g, tx, ty)) return 'blocked';
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      const dx = cx - w.x;
      const dy = cy - w.y;
      const dist = hyp(dx, dy);
      const pace = w.job === 'driller' ? drillerLevel(w.level).speed : 1;
      const step = Math.min(dist, WORKERS.speed * pace * g.hazards.speedFactor(tx, ty) * dt);
      if (dist > 1e-6) {
        w.x += (dx / dist) * step;
        w.y += (dy / dist) * step;
        w.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        w.moving = true;
        w.walkTime += dt;
      }
      if (step >= dist - 1e-6) w.path.shift();
    }
    return w.path.length ? 'moving' : 'arrived';
  }

  // ---------------------------------------------------------------- choix de la tâche

  private tileOf(w: Worker, g: GameState): number {
    return Math.floor((w.y - 1) / TILE) * g.world.w + Math.floor(w.x / TILE);
  }

  private finder(g: GameState): Pather {
    this.pather ??= new Pather(g.world.w * g.world.h);
    return this.pather;
  }

  private think(w: Worker, g: GameState): void {
    const idle = () => {
      w.task = null;
      w.path = [];
      w.retry = WORKERS.idleWait;
    };
    const ok = w.job === 'picker' ? this.thinkPicker(w, g) : w.job === 'driller' ? this.thinkDriller(w, g) : this.thinkRefueler(w, g);
    if (!ok) {
      // Rien à faire : retour au poste, sans bouger davantage s'il y est déjà.
      const home = this.homeTile(g, this.list.indexOf(w));
      const here = this.tileOf(w, g);
      if (here === home) return idle();
      const path = this.finder(g).find(g, here, (i) => i === home, WORKERS.reach);
      if (path) {
        w.task = { kind: 'home' };
        w.path = path;
      } else {
        idle();
        w.retry = FAR_RETRY; // pas de chemin du tout : inutile de refaire une grande recherche chaque seconde
      }
    }
  }

  /** Case d'attente de l'ouvrier n° `index` : une rangée devant l'entrée de la mine. */
  homeTile(g: GameState, index: number): number {
    const s = g.layout.spawn;
    const x = s.x - 2 + (index % 5);
    const y = s.y + 1 + Math.floor(index / 5);
    return walkable(g, x, y) ? y * g.world.w + x : s.y * g.world.w + s.x;
  }

  /** Ramasseur : un tas à prendre, sinon sa charge à ranger. Renvoie faux s'il n'y a rien à faire. */
  private thinkPicker(w: Worker, g: GameState): boolean {
    const width = g.world.w;
    const free = WORKERS.capacity - cargoWeight(w.cargo);
    const claimed = new Set(this.list.filter((o) => o !== w && o.task?.kind === 'pick').map((o) => (o.task as { drop: number }).drop));
    // Un tas que plus aucun coffre n'accepte (réglage des coffres, coffres pleins) reste où il est.
    const chests = g.structures.list.filter((s): s is Storage => s instanceof Storage);
    const wanted = new Map<string, 'ok' | 'full' | 'none'>();
    /** Un coffre peut-il recevoir ce minerai (ok), un seul le voudrait mais il est plein (full), aucun ne le veut (none) ? */
    const taken = (res: string) => {
      let r = wanted.get(res);
      if (r === undefined) wanted.set(res, (r = chests.some((c) => c.canAccept(res)) ? 'ok' : chests.some((c) => c.accepts(res)) ? 'full' : 'none'));
      return r;
    };
    let refused: WorkerFlag | null = null;
    /** Un coffre peut-il recevoir ce minerai ? Sinon on garde le signalement le plus utile pour le joueur. */
    const refuse = (t: 'full' | 'none') => {
      if (t === 'none' || refused === null) refused = t === 'none' ? 'nostore' : 'full';
    };
    if (free > 0) {
      const spots = new Map<number, number>();
      // Machines qui gardent du minerai (foreuses à charbon, bases de foreuse de percement), si un coffre le prend.
      const claimedMachines = new Set(this.list.filter((o) => o !== w && o.task?.kind === 'collect').map((o) => `${(o.task as { x: number }).x},${(o.task as { y: number }).y}`));
      const machines = new Map<number, Structure>();
      for (const s of g.structures.list) {
        if (claimedMachines.has(`${s.x},${s.y}`)) continue;
        const held = heldOre(s);
        let any = false;
        for (const res of Object.keys(held)) {
          const r = getResource(res);
          if (r.groundLife !== undefined || r.weight > free) continue;
          const t = taken(res);
          if (t === 'ok') any = true;
          else refuse(t);
        }
        if (any) for (const i of around(g, s)) if (!machines.has(i)) machines.set(i, s);
      }
      for (const d of g.drops.list) {
        const r = getResource(d.res);
        if (d.locked || d.age < 0.35 || r.groundLife !== undefined || r.weight > free || claimed.has(d.id)) continue;
        const t = taken(d.res);
        if (t !== 'ok') {
          // « aucun coffre n'en veut » prime sur « coffres pleins » : c'est ce qu'on règle en premier.
          refuse(t);
          continue;
        }
        const i = Math.floor((d.y - 1) / TILE) * width + Math.floor(d.x / TILE);
        if (!spots.has(i)) spots.set(i, d.id);
      }
      if (spots.size || machines.size) {
        const path = this.finder(g).find(g, this.tileOf(w, g), (i) => spots.has(i) || machines.has(i), WORKERS.reach);
        if (path) {
          const goal = path.length ? path[path.length - 1] : this.tileOf(w, g);
          const drop = spots.get(goal);
          if (drop !== undefined) w.task = { kind: 'pick', drop };
          else {
            const m = machines.get(goal)!;
            w.task = { kind: 'collect', x: m.x, y: m.y };
          }
          w.path = path;
          w.flag = null;
          return true;
        }
      }
    }
    if (cargoCount(w.cargo) > 0) return this.planStore(w, g);
    // Des minerais au sol, mais aucun coffre n'en veut (ou ils sont pleins) : on le signale au joueur.
    w.flag = refused;
    return false;
  }

  /**
   * Cherche un coffre qui accepte quelque chose de la charge : d'abord le plus proche des coffres réglés sur ces
   * minerais (un coffre à charbon reçoit le charbon même si un coffre libre est plus près), à défaut le plus proche
   * des coffres qui prennent tout. Les caisses d'expédition ne sont jamais visées.
   */
  private planStore(w: Worker, g: GameState): boolean {
    const here = this.tileOf(w, g);
    const chests = g.structures.list.filter((s): s is Storage => s instanceof Storage);
    for (const specific of [true, false]) {
      const goals = new Map<number, Structure>();
      for (const s of chests) {
        if ((s.allow.length > 0) !== specific) continue;
        if (!Object.keys(w.cargo).some((res) => (w.cargo[res] ?? 0) > 0 && s.canAccept(res))) continue;
        for (const i of around(g, s)) if (!goals.has(i)) goals.set(i, s);
      }
      const path = goals.size ? this.finder(g).find(g, here, (i) => goals.has(i), WORKERS.reach) : null;
      if (!path) continue;
      const target = goals.get(path.length ? path[path.length - 1] : here)!;
      w.task = { kind: 'store', x: target.x, y: target.y };
      w.path = path;
      w.flag = null;
      return true;
    }
    // Pourquoi aucun coffre n'est visé : personne n'en veut, ils sont pleins, ou le chemin est coupé.
    const carried = Object.keys(w.cargo).filter((res) => (w.cargo[res] ?? 0) > 0);
    const accepting = chests.filter((s) => carried.some((res) => s.accepts(res)));
    w.flag = !accepting.length ? 'nostore' : accepting.some((s) => carried.some((res) => s.canAccept(res))) ? 'noroute' : 'full';
    if (w.flag === 'noroute') w.retry = FAR_RETRY;
    return false;
  }

  /**
   * Foreur : d'abord du charbon pour les foreuses qui en réclament (comme un ravitailleur, mais pour elles seules), puis
   * un gisement où poser une foreuse.
   */
  private thinkDriller(w: Worker, g: GameState): boolean {
    // Le charbon d'abord : une foreuse posée sans combustible ne produit rien (celles du joueur comme les siennes).
    if (this.thinkFuel(w, g)) return true;
    const fuelFlag = w.flag;
    if (this.thinkPlace(w, g)) return true;
    // Rien à poser : un blocage de charbon reste visible tant qu'aucune autre cause (plus de foreuse) ne l'emporte.
    if (w.flag === null) w.flag = fuelFlag;
    return false;
  }

  /**
   * Un gisement de son niveau (minerais jusqu'au `maxTier` de son niveau, pas la pierre) où poser une foreuse : exposé,
   * pas déjà couvert par une foreuse, pas encore visé par un autre foreur, qui ne bouche aucun passage. Il va au plus
   * proche. Sans foreuse (stock vide, pas assez d'argent), il le signale.
   */
  private thinkPlace(w: Worker, g: GameState): boolean {
    // Son quota est atteint : il ne pose plus rien (ce n'est pas un blocage), jusqu'à ce qu'une de ses foreuses disparaisse.
    if (this.drillsOf(w, g) >= DRILLER.maxDrills) {
      w.flag = null;
      return false;
    }
    const world = g.world;
    const width = world.w;
    const lvl = drillerLevel(w.level);
    const covered = new Set<number>();
    for (const s of g.structures.list) if (s instanceof Drill) for (const t of s.reach()) covered.add(t.y * width + t.x);
    const claimed = new Set(this.list.filter((o) => o !== w && o.task?.kind === 'place').map((o) => (o.task as { y: number; x: number }).y * width + (o.task as { x: number }).x));
    // Case d'où l'ouvrier pose → case du gisement.
    const goals = new Map<number, number>();
    const dep = world.deposit;
    for (let i = 0; i < dep.length; i++) {
      if (!dep[i] || !world.explored[i] || world.reserve[i] < DRILLER.minReserve || covered.has(i) || claimed.has(i)) continue;
      const res = RESOURCES[dep[i] - 1];
      if (res.groundLife !== undefined || res.tier > lvl.maxTier) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (g.siteProblem(DRILLER.machine, x, y)) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (walkable(g, nx, ny)) goals.set(ny * width + nx, i);
      }
    }
    if (!goals.size) {
      w.flag = null; // rien à équiper à son niveau : ce n'est pas un blocage
      return false;
    }
    if (!g.drillAvailable) {
      w.flag = 'nodrill';
      return false;
    }
    const here = this.tileOf(w, g);
    for (let attempt = 0; attempt < 12 && goals.size; attempt++) {
      const path = this.finder(g).find(g, here, (i) => goals.has(i), WORKERS.reach);
      if (!path) break;
      const standing = path.length ? path[path.length - 1] : here;
      const site = goals.get(standing)!;
      const sx = site % width;
      const sy = (site - sx) / width;
      if (blocksPassage(g, sx, sy)) {
        for (const [k, v] of [...goals]) if (v === site) goals.delete(k);
        continue;
      }
      w.task = { kind: 'place', x: sx, y: sy };
      w.path = path;
      w.flag = null;
      return true;
    }
    w.flag = null;
    return false;
  }

  /**
   * Machines qui réclament du charbon et dont le réservoir est à moitié vide ou moins. Le ravitailleur les sert toutes ;
   * le foreur seulement les foreuses à charbon.
   */
  private needy(w: Worker, g: GameState): FuelMachine[] {
    const claimed = this.list.filter((o) => o !== w && o.task?.kind === 'fuel').map((o) => o.task as { x: number; y: number });
    return g.structures.list.filter(
      (s): s is FuelMachine =>
        isFuelMachine(s) &&
        (w.job !== 'driller' || s instanceof Drill) &&
        s.fuelWanted() !== null &&
        s.fuelUnits <= s.fuelMax * WORKERS.fuelLow &&
        !claimed.some((c) => c.x === s.x && c.y === s.y),
    );
  }

  /** Ravitailleur : du charbon à porter aux machines, sinon à aller chercher dans un coffre. */
  private thinkRefueler(w: Worker, g: GameState): boolean {
    return this.thinkFuel(w, g);
  }

  /**
   * Du charbon à porter aux machines qui en réclament (celles de son métier, voir `needy`), sinon à aller chercher dans un
   * coffre. Renvoie faux s'il n'y a rien à faire ; `flag` dit alors si c'est faute de charbon (`nocoal`) ou de chemin (`lost`).
   */
  private thinkFuel(w: Worker, g: GameState): boolean {
    const needy = this.needy(w, g);
    if (!needy.length) {
      w.flag = null;
      return false;
    }
    const here = this.tileOf(w, g);
    const fuelRes = needy[0].fuelWanted()!;
    if ((w.cargo[fuelRes] ?? 0) > 0) {
      const goals = new Map<number, Structure>();
      for (const s of needy) for (const i of around(g, s)) if (!goals.has(i)) goals.set(i, s);
      const path = this.finder(g).find(g, here, (i) => goals.has(i), WORKERS.reach);
      if (path) {
        const target = goals.get(path.length ? path[path.length - 1] : here)!;
        w.task = { kind: 'fuel', x: target.x, y: target.y };
        w.path = path;
        w.flag = null;
        return true;
      }
      w.flag = 'lost';
      return false;
    }
    // Sans charbon sur lui : un coffre qui en contient.
    const goals = new Map<number, Structure>();
    for (const s of g.structures.list)
      if (s instanceof Storage && (s.items[fuelRes] ?? 0) > 0) for (const i of around(g, s)) if (!goals.has(i)) goals.set(i, s);
    const path = goals.size ? this.finder(g).find(g, here, (i) => goals.has(i), WORKERS.reach) : null;
    if (!path) {
      w.flag = 'nocoal';
      return false;
    }
    const target = goals.get(path.length ? path[path.length - 1] : here)!;
    w.task = { kind: 'take', x: target.x, y: target.y };
    w.path = path;
    w.flag = null;
    return true;
  }

  // ---------------------------------------------------------------- gestes

  private arrive(w: Worker, g: GameState): void {
    const task = w.task!;
    w.task = null;
    w.path = [];
    // Un geste qui échoue ne relance pas la réflexion à chaque image : petite pause avant de réessayer.
    w.retry = 0.2;
    switch (task.kind) {
      case 'pick':
        return this.doPick(w, g, task.drop);
      case 'store':
        return this.doStore(w, g, task.x, task.y);
      case 'take':
        return this.doTake(w, g, task.x, task.y);
      case 'fuel':
        return this.doFuel(w, g, task.x, task.y);
      case 'place':
        return this.doPlace(w, g, task.x, task.y);
      case 'collect':
        return this.doCollect(w, g, task.x, task.y);
      case 'home':
        w.retry = WORKERS.idleWait;
    }
  }

  private doPick(w: Worker, g: GameState, dropId: number): void {
    const d = g.drops.list.find((o) => o.id === dropId);
    // Sur la même case que le tas, on est toujours à portée (la diagonale d'une case fait 22,6 pixels).
    if (!d || hyp(d.x - w.x, d.y - 1 - w.y) > TILE * 1.5) return;
    const room = Math.floor((WORKERS.capacity - cargoWeight(w.cargo)) / getResource(d.res).weight + 1e-6);
    const k = Math.min(d.count, room);
    if (k <= 0) return;
    d.count -= k;
    if (d.count <= 0) g.drops.remove(d);
    w.cargo[d.res] = (w.cargo[d.res] ?? 0) + k;
    w.wait = WORKERS.actWait;
    g.emit({ t: 'worker', kind: 'pick', x: w.x, y: w.y, res: d.res });
  }

  private doStore(w: Worker, g: GameState, x: number, y: number): void {
    const s = g.structures.at(x, y);
    if (!(s instanceof Storage)) return;
    let moved = false;
    for (const [res, n] of Object.entries(w.cargo)) {
      if (n <= 0) continue;
      const k = s.put(res, n);
      if (k > 0) {
        w.cargo[res] = n - k;
        moved = true;
        g.emit({ t: 'worker', kind: 'store', x: w.x, y: w.y, res });
      }
      if (w.cargo[res] <= 0) delete w.cargo[res];
    }
    if (moved) w.wait = WORKERS.actWait;
  }

  private doTake(w: Worker, g: GameState, x: number, y: number): void {
    const s = g.structures.at(x, y);
    if (!(s instanceof Storage)) return;
    const needy = this.needy(w, g);
    const fuelRes = needy[0]?.fuelWanted();
    if (!fuelRes) return;
    const wanted = needy.reduce((sum, m) => sum + (m.fuelMax - m.fuelUnits), 0);
    const room = Math.floor((WORKERS.capacity - cargoWeight(w.cargo)) / getResource(fuelRes).weight + 1e-6);
    const k = s.take(fuelRes, Math.min(room, wanted));
    if (k <= 0) return;
    w.cargo[fuelRes] = (w.cargo[fuelRes] ?? 0) + k;
    w.wait = WORKERS.actWait;
    g.emit({ t: 'worker', kind: 'pick', x: w.x, y: w.y, res: fuelRes });
  }

  private doFuel(w: Worker, g: GameState, x: number, y: number): void {
    const s = g.structures.at(x, y);
    if (!s || !isFuelMachine(s)) return;
    const res = s.fuelWanted();
    if (!res) return;
    const k = s.addFuel(w.cargo[res] ?? 0);
    if (k <= 0) return;
    w.cargo[res] -= k;
    if (w.cargo[res] <= 0) delete w.cargo[res];
    w.wait = WORKERS.actWait;
    g.emit({ t: 'worker', kind: 'fuel', x: w.x, y: w.y, res });
  }

  /** Foreuses posées par ce foreur et encore debout (celles d'avant cette règle ou posées par le joueur ne comptent pas). */
  drillsOf(w: Worker, g: GameState): number {
    let n = 0;
    for (const s of g.structures.list) if (s instanceof Drill && s.placedBy === w.id) n++;
    return n;
  }

  /** Foreur : pose la foreuse sur le gisement, face à un coffre voisin s'il y en a un, puis marque une pause. */
  private doPlace(w: Worker, g: GameState, x: number, y: number): void {
    if (this.drillsOf(w, g) >= DRILLER.maxDrills || blocksPassage(g, x, y)) return;
    let dir: Dir = 1;
    for (let k = 0; k < 4; k++)
      if (g.structures.at(x + DX[k], y + DY[k]) instanceof Storage) {
        dir = k as Dir;
        break;
      }
    const res = g.world.depositAt(x, y) ?? 'coal';
    const placed = g.placeDrillFor(x, y, dir);
    if (!placed) return;
    placed.drill.placedBy = w.id;
    w.wait = drillerLevel(w.level).placeTime;
    g.emit({ t: 'worker', kind: 'place', x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, res });
  }

  /** Ramasseur : prend dans la machine le minerai qu'un coffre accepte, jusqu'à sa charge maximale. */
  private doCollect(w: Worker, g: GameState, x: number, y: number): void {
    const s = g.structures.at(x, y);
    if (!s) return;
    const held = heldOre(s);
    let moved = false;
    for (const res of Object.keys(held).sort((a, b) => held[b] - held[a])) {
      const r = getResource(res);
      if (r.groundLife !== undefined) continue;
      if (!g.structures.list.some((c) => c instanceof Storage && c.canAccept(res))) continue;
      const room = Math.floor((WORKERS.capacity - cargoWeight(w.cargo)) / r.weight + 1e-6);
      const k = takeHeld(s, res, Math.min(held[res], room));
      if (k <= 0) continue;
      w.cargo[res] = (w.cargo[res] ?? 0) + k;
      moved = true;
      g.emit({ t: 'worker', kind: 'pick', x: w.x, y: w.y, res });
    }
    if (moved) w.wait = WORKERS.actWait;
  }

  // ---------------------------------------------------------------- sauvegarde

  serialize(): WorkerSave[] {
    return this.list.map((w) => ({ id: w.id, job: w.job, level: w.level, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100, cargo: { ...w.cargo } }));
  }

  /** Recharge les ouvriers sauvegardés ; les valeurs aberrantes sont ignorées (au plus `WORKERS.max`). */
  load(data: WorkerSave[] | undefined, g: GameState): void {
    this.list = [];
    this.nextId = 1;
    if (!Array.isArray(data)) return;
    for (const s of data.slice(0, WORKERS.max)) {
      if (!s || !isJob(s.job)) continue;
      const w = this.add(s.job, g);
      w.level = Math.max(1, Math.min(DRILLER_LEVELS.length, Math.floor(Number(s.level ?? 1)) || 1));
      const x = Number(s.x);
      const y = Number(s.y);
      if (Number.isFinite(x) && Number.isFinite(y) && g.world.inBounds(Math.floor(x / TILE), Math.floor((y - 1) / TILE))) {
        w.x = x;
        w.y = y;
      }
      for (const [res, n] of Object.entries(s.cargo ?? {})) {
        const k = Math.floor(Number(n));
        if (hasResource(res) && Number.isFinite(k) && k > 0 && cargoWeight(w.cargo) + getResource(res).weight * k <= WORKERS.capacity + 1e-6) w.cargo[res] = k;
      }
      const id = Math.floor(Number(s.id));
      if (Number.isInteger(id) && id >= 1 && !this.list.some((o) => o !== w && o.id === id)) w.id = id;
    }
    // Des identifiants en double (sauvegarde abîmée) : les suivants en reçoivent un neuf.
    const used = new Set<number>();
    for (const w of this.list) {
      if (used.has(w.id)) w.id = Math.max(...this.list.map((o) => o.id)) + 1;
      used.add(w.id);
    }
    this.nextId = this.list.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  }
}
