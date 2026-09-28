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
import { hasResource } from '../data/resources';
import { BAGS, PICKAXES } from '../data/tools';
import { GameState, Stats } from '../sim/GameState';
import { STRUCTURE_FACTORIES } from '../sim/structures/registry';
import { Wagon, type WagonSave } from '../sim/Wagons';
import type { StructureSave } from '../sim/structures/Structure';
import { rleDecode, rleEncode } from './codec';

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
  };
}

export function deserialize(data: SaveData): GameState {
  if (!data || data.game !== 'empire-miner') throw new Error("Ce fichier n'est pas une sauvegarde Empire Miner");
  if (data.version > SAVE_VERSION) throw new Error('Sauvegarde créée par une version plus récente du jeu');
  const g = new GameState(data.seed);
  const w = g.world;
  if (data.world.w !== w.w || data.world.h !== w.h) throw new Error('Dimensions de carte incompatibles');
  const n = w.w * w.h;
  w.tiles.set(rleDecode(data.world.tiles, n));
  w.deposit.set(rleDecode(data.world.deposit, n));
  w.explored.set(rleDecode(data.world.explored, n));
  w.reserve.fill(0);
  for (const [i, r] of data.world.reserves) w.reserve[i] = r;
  w.damage.clear();
  for (const [i, d] of data.world.damage) w.damage.set(i, d);
  w.markAllDirty();

  g.time = data.time;
  g.player.x = data.player.x;
  g.player.y = data.player.y;
  g.player.facing = data.player.facing;
  g.money = data.money;
  g.pickaxeLevel = Math.min(Math.max(0, data.pickaxeLevel), PICKAXES.length - 1);
  g.setBagLevel(Math.min(Math.max(0, data.bagLevel), BAGS.length - 1));
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
