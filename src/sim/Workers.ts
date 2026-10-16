/**
 * Ouvriers : des travailleurs achetés à l'Atelier qui font des corvées à la place du joueur.
 *
 * - Ramasseur : va chercher les minerais laissés au sol et les range dans le coffre le plus proche qui les accepte
 *   (chaque coffre peut être réglé sur certains minerais : il ne prend jamais un tas qu'aucun coffre n'accepte).
 * - Ravitailleur : prend du charbon dans les coffres et recharge les machines qui en manquent.
 * - Dépanneur : va vers une machine à l'arrêt, regarde ce qui la bloque et le règle si c'est possible (charbon, sortie pleine) ;
 *   sinon il rentre au camp, y affiche la cause (`reports`, lue par les statistiques), puis repart vers une autre machine.
 *
 * Un ouvrier se déplace de case en case (plus court chemin sur la grille, en évitant la roche, les machines, le
 * grisou et l'eau profonde) puis fait son geste : ramasser, déposer, prendre, recharger. Il n'a pas de santé : il
 * évite simplement les dangers. Quand il n'y a rien à faire, il attend près du camp.
 *
 * Seuls le métier, la position, la charge et les signalements du dépanneur sont sauvegardés ; le reste se recalcule.
 */
import { TILE } from '../core/constants';
import { DX, DY, type Dir } from '../core/dir';
import { GAS, WATER } from '../data/hazards';
import { hasResource, getResource } from '../data/resources';
import { REPAIR, WORKERS, isJob, isRepairCause, type WorkerJob } from '../data/workers';
import type { GameState } from './GameState';
import { TunnelBorer } from './structures/Borer';
import { Drill } from './structures/Drill';
import { Storage } from './structures/Storage';
import type { Structure } from './structures/Structure';
import { hyp } from '../core/dmath';
import { diagnose, isRepairable, stuckOutput, takeOutput, type RepairReport, type Repairable } from './Repair';

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
  /** Dépanneur : marche vers une machine à l'arrêt (case d'origine) pour l'examiner. */
  | { kind: 'inspect'; x: number; y: number }
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
  | 'lost';

export interface Worker {
  id: number;
  job: WorkerJob;
  /** Position des pieds, en pixels du monde. */
  x: number;
  y: number;
  facing: Dir;
  cargo: Record<string, number>;
  task: WorkerTask | null;
  /** Cases restantes à parcourir (indices), la prochaine en premier. */
  path: number[];
  /** Pause après un geste (s), puis délai avant de chercher du travail (s). */
  wait: number;
  retry: number;
  flag: WorkerFlag | null;
  moving: boolean;
  walkTime: number;
  /** Dépanneur : la machine qu'il examine ou répare (case d'origine). */
  focus: { x: number; y: number } | null;
  /** Dépanneur : gestes de réparation déjà tentés sur la machine visée. */
  tries: number;
  /** Dépanneur : clé du signalement à afficher en arrivant au camp (null : rien à afficher). */
  note: string | null;
}

export interface WorkerSave {
  id: number;
  /** Une ancienne sauvegarde peut contenir `driller` (métier supprimé) : il devient dépanneur au chargement. */
  job: WorkerJob | 'driller';
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

export class WorkerSystem {
  list: Worker[] = [];
  /** Constats des dépanneurs, par machine (clé `x,y`). Sauvegardés : ils décident du délai avant de revisiter une machine. */
  reports = new Map<string, RepairReport>();
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
      task: null,
      path: [],
      wait: 0,
      retry: 0,
      flag: null,
      moving: false,
      walkTime: 0,
      focus: null,
      tries: 0,
      note: null,
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
    w.focus = null;
    w.tries = 0;
    w.note = null;
    return true;
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, g: GameState): void {
    for (const w of this.list) this.updateOne(w, dt, g);
  }

  /**
   * Un constat disparaît quand la machine n'existe plus, ou quand elle n'est plus à l'arrêt et que son délai (`REPAIR.cooldown`) est
   * écoulé : une machine bloquée par intermittence (ligne saturée) ne fait donc pas oublier le délai. Appelé par `GameState.update`
   * APRÈS la mise à jour des structures : leur état (`status`) n'est pas sauvegardé, il n'est juste qu'une fois qu'elles ont tourné.
   */
  pruneReports(g: GameState): void {
    if (!this.reports.size) return;
    for (const [key, r] of this.reports) {
      const m = g.structures.at(r.x, r.y);
      if (!m || m.x !== r.x || m.y !== r.y || (m.flowState() !== 'stuck' && g.time - r.t >= REPAIR.cooldown)) this.reports.delete(key);
    }
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
      const step = Math.min(dist, WORKERS.speed * g.hazards.speedFactor(tx, ty) * dt);
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
    const ok = w.job === 'picker' ? this.thinkPicker(w, g) : w.job === 'fixer' ? this.thinkFixer(w, g) : this.thinkRefueler(w, g);
    if (!ok) {
      // Rien à faire : retour au poste, sans bouger davantage s'il y est déjà.
      const home = this.homeTile(g, this.list.indexOf(w));
      const here = this.tileOf(w, g);
      if (here === home) {
        this.publish(w);
        return idle();
      }
      const path = this.finder(g).find(g, here, (i) => i === home, WORKERS.reach);
      if (path) {
        w.task = { kind: 'home' };
        w.path = path;
      } else {
        this.publish(w); // pas de chemin jusqu'au camp : le constat s'affiche quand même
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

  // ---------------------------------------------------------------- dépanneur

  /** Clé d'une machine dans `reports`. */
  private keyOf(s: { x: number; y: number }): string {
    return `${s.x},${s.y}`;
  }

  /** Le dépanneur est au camp : son constat s'affiche. */
  private publish(w: Worker): void {
    if (!w.note) return;
    const r = this.reports.get(w.note);
    if (r) r.shown = true;
    w.note = null;
  }

  /** Enregistre le constat d'une machine et prépare le retour au camp pour l'afficher (la machine n'est pas revisitée avant `REPAIR.cooldown`). */
  private report(w: Worker, g: GameState, m: Repairable, cause: RepairReport['cause']): void {
    this.publish(w); // un constat qu'il rapportait encore ne doit pas rester invisible parce qu'il en fait un autre
    const key = this.keyOf(m);
    this.reports.delete(key); // renouvelé : il redevient le plus récent (c'est le plus ancien qui part quand la liste est pleine)
    this.reports.set(key, { x: m.x, y: m.y, cause, t: g.time, shown: false });
    while (this.reports.size > REPAIR.maxReports) this.reports.delete(this.reports.keys().next().value as string);
    w.note = key;
    w.focus = null;
    w.tries = 0;
  }

  /** Marche jusqu'au contour de la machine pour y faire `task` ; faux s'il n'y a aucun chemin. */
  private planAt(w: Worker, g: GameState, m: Structure, task: WorkerTask): boolean {
    const goals = new Set(around(g, m));
    const path = goals.size ? this.finder(g).find(g, this.tileOf(w, g), (i) => goals.has(i), WORKERS.reach) : null;
    if (!path) return false;
    w.task = task;
    w.path = path;
    w.flag = null;
    return true;
  }

  /**
   * Dépanneur : poursuit la réparation en cours (recharger, vider la sortie), finit de ranger ce qu'il porte, sinon choisit la
   * machine à l'arrêt la plus proche qu'aucun autre dépanneur ne vise et qu'on n'a pas examinée récemment. Renvoie faux s'il n'y a
   * rien à faire (il rentre au camp, où un constat éventuel s'affiche).
   */
  private thinkFixer(w: Worker, g: GameState): boolean {
    let diag: ReturnType<typeof diagnose> = null;
    let m: Repairable | null = null;
    if (w.focus) {
      const at = g.structures.at(w.focus.x, w.focus.y);
      if (at && isRepairable(at) && at.x === w.focus.x && at.y === w.focus.y) {
        m = at;
        diag = diagnose(g, at, w.tries >= REPAIR.maxTries, w.cargo);
      }
      if (!diag) {
        // Débloquée (réparée ou repartie toute seule), ou disparue : plus rien à faire dessus.
        w.focus = null;
        w.tries = 0;
        m = null;
      }
    }
    if (m && diag) {
      if (!diag.fixable) {
        this.report(w, g, m, diag.cause);
        return false; // il rentre au camp, où le constat s'affichera
      }
      // Du charbon à porter : ce qu'il a pris pour elle ne retourne pas au coffre.
      if (diag.cause === 'nofuel') {
        w.tries++;
        if (this.thinkFuel(w, g)) return true;
        // Le diagnostic a vu du charbon (en coffre ou sur lui) : s'il n'y va pas, c'est que le chemin est coupé.
        if (w.flag === 'nocoal' || w.flag === 'lost') this.report(w, g, m, 'unreachable');
        else w.focus = null; // un ravitailleur s'en charge déjà : rien à signaler
        return false;
      }
    }
    if (cargoCount(w.cargo) > 0 && this.planStore(w, g)) return true;
    if (m && diag) {
      // Sortie pleine : il la vide (puis range ce qu'il a pris, au tour suivant).
      w.tries++;
      if (this.planAt(w, g, m, { kind: 'collect', x: m.x, y: m.y })) return true;
      this.report(w, g, m, 'unreachable');
      return false;
    }
    // Une nouvelle machine à examiner.
    const claimed = new Set<string>();
    for (const o of this.list) {
      if (o === w) continue;
      if (o.task?.kind === 'inspect') claimed.add(this.keyOf(o.task));
      if (o.focus) claimed.add(this.keyOf(o.focus));
    }
    const goals = new Map<number, Structure>();
    for (const c of g.structures.list) {
      if (!isRepairable(c) || claimed.has(this.keyOf(c))) continue;
      const seen = this.reports.get(this.keyOf(c));
      if (seen && g.time - seen.t < REPAIR.cooldown) continue;
      if (!diagnose(g, c)) continue;
      for (const k of around(g, c)) if (!goals.has(k)) goals.set(k, c);
    }
    if (!goals.size) {
      w.flag = null;
      return false;
    }
    const path = this.finder(g).find(g, this.tileOf(w, g), (k) => goals.has(k), WORKERS.reach);
    if (!path) {
      w.flag = 'lost';
      return false;
    }
    const target = goals.get(path.length ? path[path.length - 1] : this.tileOf(w, g))!;
    w.task = { kind: 'inspect', x: target.x, y: target.y };
    w.path = path;
    w.flag = null;
    return true;
  }

  /**
   * Machines qui réclament du charbon et dont le réservoir est à moitié vide ou moins. Le ravitailleur les sert toutes ;
   * le dépanneur seulement celle qu'il répare.
   */
  private needy(w: Worker, g: GameState): FuelMachine[] {
    const claimed = this.list.filter((o) => o !== w && o.task?.kind === 'fuel').map((o) => o.task as { x: number; y: number });
    return g.structures.list.filter(
      (s): s is FuelMachine =>
        isFuelMachine(s) &&
        (w.job !== 'fixer' || (w.focus !== null && s.x === w.focus.x && s.y === w.focus.y)) &&
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
      case 'inspect':
        // Il regarde la machine, puis décide (au prochain tour de réflexion, après la pause).
        w.focus = { x: task.x, y: task.y };
        w.tries = 0;
        w.wait = REPAIR.inspectTime;
        return;
      case 'collect':
        return this.doCollect(w, g, task.x, task.y);
      case 'home':
        this.publish(w);
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

  /** Ramasseur : prend dans la machine le minerai qu'un coffre accepte, jusqu'à sa charge maximale. */
  private doCollect(w: Worker, g: GameState, x: number, y: number): void {
    const s = g.structures.at(x, y);
    if (!s) return;
    // Le dépanneur vide tout ce que la machine retient ; le ramasseur seulement ce qui s'accumule (voir `heldOre`).
    const held = w.job === 'fixer' ? stuckOutput(s) : heldOre(s);
    let moved = false;
    for (const res of Object.keys(held).sort((a, b) => held[b] - held[a])) {
      const r = getResource(res);
      if (r.groundLife !== undefined) continue;
      if (!g.structures.list.some((c) => c instanceof Storage && c.canAccept(res))) continue;
      const room = Math.floor((WORKERS.capacity - cargoWeight(w.cargo)) / r.weight + 1e-6);
      const k = w.job === 'fixer' ? takeOutput(s, res, Math.min(held[res], room)) : takeHeld(s, res, Math.min(held[res], room));
      if (k <= 0) continue;
      w.cargo[res] = (w.cargo[res] ?? 0) + k;
      moved = true;
      g.emit({ t: 'worker', kind: 'pick', x: w.x, y: w.y, res });
    }
    if (moved) w.wait = WORKERS.actWait;
  }

  // ---------------------------------------------------------------- sauvegarde

  serialize(): WorkerSave[] {
    return this.list.map((w) => ({ id: w.id, job: w.job, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100, cargo: { ...w.cargo } }));
  }

  /** Recharge les ouvriers sauvegardés ; les valeurs aberrantes sont ignorées (au plus `WORKERS.max`). */
  load(data: WorkerSave[] | undefined, g: GameState): void {
    this.list = [];
    this.nextId = 1;
    if (!Array.isArray(data)) return;
    for (const s of data.slice(0, WORKERS.max)) {
      // Le foreur n'existe plus : un ouvrier sauvegardé comme tel devient dépanneur (il a été acheté, on ne le perd pas).
      const job = s?.job === 'driller' ? 'fixer' : s?.job;
      if (!s || !isJob(job)) continue;
      const w = this.add(job, g);
      if (job === 'fixer') w.retry = 0.5; // les machines ont d'abord un pas pour retrouver leur vrai état (`status` n'est pas sauvegardé)
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

  /** Constats des dépanneurs à sauvegarder (les plus anciens d'abord). */
  serializeReports(): RepairReport[] {
    return [...this.reports.values()].map((r) => ({ x: r.x, y: r.y, cause: r.cause, t: Math.round(r.t * 100) / 100, shown: r.shown }));
  }

  /** Recharge les constats ; une valeur aberrante est ignorée (au plus `REPAIR.maxReports`). */
  loadReports(data: unknown, g: GameState): void {
    this.reports = new Map();
    if (!Array.isArray(data)) return;
    for (const r of data.slice(0, REPAIR.maxReports) as Partial<RepairReport>[]) {
      const x = Math.floor(Number(r?.x));
      const y = Math.floor(Number(r?.y));
      const t = Number(r?.t);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t) || !isRepairCause(r?.cause) || !g.world.inBounds(x, y)) continue;
      // Le dépanneur ne se souvient plus de ce qu'il devait rapporter : un constat enregistré s'affiche.
      this.reports.set(this.keyOf({ x, y }), { x, y, cause: r.cause, t, shown: true });
    }
  }
}
