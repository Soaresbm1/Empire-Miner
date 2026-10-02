/**
 * Sauvegarde / chargement d'une partie.
 *
 * Le monde est régénéré depuis sa graine (décor, bâtiments), puis tout ce qui
 * a changé est réappliqué depuis la sauvegarde : blocs (roches détruites),
 * gisements et réserves, dégâts partiels, zones explorées, objets au sol,
 * machines et leur contenu, joueur, argent, inventaire, améliorations.
 *
 * Le format est versionné (`version`) pour permettre des migrations futures.
 */
import type { Dir } from '../core/dir';
import { isGear } from '../data/gear';
import { hasResource } from '../data/resources';
import { BAGS, PICKAXES, ROPE } from '../data/tools';
import { GameState, Stats } from '../sim/GameState';
import { STRUCTURE_FACTORIES } from '../sim/structures/registry';
import { Wagon, type WagonSave } from '../sim/Wagons';
import type { StructureSave } from '../sim/structures/Structure';
import { rleDecode, rleEncode } from './codec';
import { HEALTH } from '../data/hazards';
import type { MarkerSave } from '../sim/Markers';
import type { MarketSave } from '../sim/Market';
import type { SlotSave } from '../sim/Production';

export const SAVE_VERSION = 1;

export interface SaveData {
  game: 'empire-miner';
  version: number;
  savedAt: string;
  seed: number;
  time: number;
  player: { x: number; y: number; facing: Dir };
  money: number;
  pickaxeLevel: number;
  bagLevel: number;
  /** Outils mécaniques (absents des sauvegardes d'avant le marteau-piqueur). */
  tools?: { jackhammer: boolean; inHand: string; hammerFuel: number; scooter?: boolean };
  /** Cordes de rappel et point d'accroche (absents des anciennes sauvegardes : aucune corde). */
  rope?: { count: number; anchor: [number, number] | null };
  /** Équipement de protection acheté (absent des sauvegardes d'avant l'équipement : aucun). */
  gear?: string[];
  inventory: Record<string, number>;
  kits: Record<string, number>;
  autoPickup: Record<string, boolean>;
  stats: Stats;
  world: {
    w: number;
    h: number;
    tiles: string;
    deposit: string;
    explored: string;
    /** [indice, réserve] des gisements. */
    reserves: [number, number][];
    /** [indice, dégâts] des blocs entamés. */
    damage: [number, number][];
  };
  /** res, quantité, x, y et âge du tas (s ; absent dans les anciennes sauvegardes). */
  drops: [string, number, number, number, number?][];
  structures: StructureSave[];
  /** Absent des sauvegardes d'avant les wagonnets. */
  wagons?: WagonSave[];
  /** Santé du joueur (absente des sauvegardes d'avant les dangers : pleine santé). */
  health?: number;
  /**
   * Dangers (absents des anciennes sauvegardes) : cases creusées à la main, grisou et eau
   * ([indice, niveau]) et éboulements annoncés ([x, y, temps restant]). Les poches cachées se
   * recalculent depuis la graine.
   */
  hazards?: { dug: string; gas: [number, number][]; water: [number, number][]; pending: [number, number, number][] };
  /** Repères de la carte (absents des anciennes sauvegardes). */
  markers?: MarkerSave;
  /** Statistiques de production des 10 dernières minutes (absentes des anciennes sauvegardes). */
  production?: SlotSave[];
  /** Cours du marché, courbes et événements en cours (absents des anciennes sauvegardes : marché neuf à 100 %). */
  market?: MarketSave;
}

function sparse(grid: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] > 0) out.push([i, round2(grid[i])]);
  return out;
}

export function serialize(g: GameState): SaveData {
  const w = g.world;
  const reserves: [number, number][] = [];
  for (let i = 0; i < w.deposit.length; i++) if (w.deposit[i]) reserves.push([i, w.reserve[i]]);
  return {
    game: 'empire-miner',
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: g.seed,
    time: g.time,
    player: { x: round2(g.player.x), y: round2(g.player.y), facing: g.player.facing },
    money: g.money,
    pickaxeLevel: g.pickaxeLevel,
    bagLevel: g.bagLevel,
    tools: { jackhammer: g.hasJackhammer, inHand: g.tool, hammerFuel: round2(g.hammerFuel), scooter: g.hasScooter },
    gear: [...g.gear],
    rope: { count: g.ropes, anchor: g.ropeAnchor ? [g.ropeAnchor.tx, g.ropeAnchor.ty] : null },
    inventory: { ...g.inventory.items },
    kits: { ...g.inventory.kits },
    autoPickup: { ...g.autoPickup },
    stats: { ...g.stats, discovered: [...g.stats.discovered], collected: { ...g.stats.collected } },
    world: {
      w: w.w,
      h: w.h,
      tiles: rleEncode(w.tiles),
      deposit: rleEncode(w.deposit),
      explored: rleEncode(w.explored),
      reserves,
      damage: Array.from(w.damage.entries()),
    },
    drops: g.drops.list.map((d) => [d.res, d.count, round2(d.x), round2(d.y), round2(d.age)]),
    structures: g.structures.list.filter((s) => s.removable).map((s) => s.serialize()),
    wagons: g.wagons.list.map((w) => w.serialize()),
    health: round2(g.hp),
    markers: g.markers.serialize(),
    production: g.production.serialize(),
    market: g.market.serialize(),
    hazards: {
      dug: rleEncode(w.dug),
      gas: sparse(w.gas),
      water: sparse(w.water),
      pending: g.hazards.pending.map((p) => [p.x, p.y, round2(p.t)]),
    },
  };
}

export function deserialize(data: SaveData): GameState {
  if (!data || data.game !== 'empire-miner') throw new Error("Ce fichier n'est pas une sauvegarde Empire Miner");
  if (data.version > SAVE_VERSION) throw new Error('Sauvegarde créée par une version plus récente du jeu');
  const g = new GameState(data.seed);
  const w = g.world;
  // Une carte moins haute vient d'avant la Fournaise : on garde ses rangées et la mine se
  // prolonge par le bas. Sa dernière rangée était le socle : elle laisse place au terrain neuf.
  if (data.world.w !== w.w || data.world.h > w.h) throw new Error('Dimensions de carte incompatibles');
  const n = w.w * data.world.h;
  const kept = data.world.h < w.h ? w.w * (data.world.h - 1) : n;
  const restore = (grid: Uint8Array, rle: string, count = kept) => grid.set(rleDecode(rle, n).subarray(0, count));
  restore(w.tiles, data.world.tiles);
  restore(w.deposit, data.world.deposit);
  restore(w.explored, data.world.explored, n);
  w.reserve.fill(0, 0, kept);
  for (const [i, r] of data.world.reserves) if (i < kept) w.reserve[i] = r;
  w.damage.clear();
  for (const [i, d] of data.world.damage) if (i < kept) w.damage.set(i, d);
  if (data.hazards) {
    restore(w.dug, data.hazards.dug);
    for (const [i, v] of data.hazards.gas ?? []) if (i >= 0 && i < n) w.gas[i] = v;
    for (const [i, v] of data.hazards.water ?? []) if (i >= 0 && i < n) w.water[i] = v;
    g.hazards.pending = (data.hazards.pending ?? []).map(([x, y, t]) => ({ x, y, t }));
  }
  g.hazards.rebuild();
  g.markers.load(data.markers);
  g.production.load(data.production);
  w.markAllDirty();

  g.time = data.time;
  g.market.load(data.market, data.time);
  g.player.x = data.player.x;
  g.player.y = data.player.y;
  g.player.facing = data.player.facing;
  g.money = data.money;
  g.hp = Math.min(HEALTH.max, Math.max(1, Number(data.health ?? HEALTH.max) || HEALTH.max));
  g.pickaxeLevel = Math.min(Math.max(0, data.pickaxeLevel), PICKAXES.length - 1);
  g.setBagLevel(Math.min(Math.max(0, data.bagLevel), BAGS.length - 1));
  g.hasJackhammer = !!data.tools?.jackhammer;
  g.tool = g.hasJackhammer && data.tools?.inHand === 'jackhammer' ? 'jackhammer' : 'pickaxe';
  g.hammerFuel = Math.max(0, Number(data.tools?.hammerFuel ?? 0) || 0);
  g.hasScooter = data.tools?.scooter === true;
  for (const id of Array.isArray(data.gear) ? data.gear : []) if (isGear(id)) g.gear.add(id);
  g.ropes = Math.min(ROPE.maxStock, Math.max(0, Math.floor(Number(data.rope?.count ?? 0)) || 0));
  const a = data.rope?.anchor;
  g.ropeAnchor = Array.isArray(a) && Number.isInteger(a[0]) && Number.isInteger(a[1]) && w.inBounds(a[0], a[1]) ? { tx: a[0], ty: a[1] } : null;
  g.inventory.items = filterKnown(data.inventory);
  g.inventory.kits = { ...data.kits };
  g.autoPickup = { ...g.autoPickup, ...data.autoPickup };
  g.stats = {
    ...g.stats,
    ...data.stats,
    discovered: [...(data.stats?.discovered ?? [])],
    collected: { ...(data.stats?.collected ?? {}) },
  };
  for (const [res, count, x, y, age] of data.drops) {
    if (!hasResource(res)) continue;
    const d = g.drops.spawn(res, count, x, y, false);
    // L'âge compte le temps passé au sol : une pierre ne repart pas pour une minute complète au chargement.
    d.age = Math.max(1, Number(age ?? 1) || 1);
  }
  for (const s of data.structures) {
    const f = STRUCTURE_FACTORIES[s.type];
    if (f) g.structures.add(f.load(s));
  }
  for (const ws of data.wagons ?? []) {
    const w = g.wagons.add(Wagon.load(ws));
    if (w.rider) g.riding = w;
  }
  return g;
}

function filterKnown(items: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(items ?? {})) if (hasResource(k) && v > 0) out[k] = v;
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ------------------------------------------------------------------ stockage navigateur

const SLOT_KEY = 'empire-miner.save';
const BACKUP_KEY = 'empire-miner.save.backup';

export function saveToBrowser(g: GameState): boolean {
  try {
    const previous = localStorage.getItem(SLOT_KEY);
    if (previous) localStorage.setItem(BACKUP_KEY, previous);
    localStorage.setItem(SLOT_KEY, JSON.stringify(serialize(g)));
    return true;
  } catch {
    return false;
  }
}

export function loadFromBrowser(): GameState | null {
  const raw = readSlot();
  return raw ? deserialize(JSON.parse(raw)) : null;
}

export function hasBrowserSave(): boolean {
  return !!readSlot();
}

export function browserSaveInfo(): { savedAt: string; money: number; depth: number } | null {
  try {
    const raw = readSlot();
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return { savedAt: d.savedAt, money: d.money, depth: d.stats?.maxDepth ?? 0 };
  } catch {
    return null;
  }
}

function readSlot(): string | null {
  try {
    return localStorage.getItem(SLOT_KEY);
  } catch {
    return null;
  }
}
