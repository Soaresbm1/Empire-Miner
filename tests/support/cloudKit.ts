/** Outils des essais du compte : un stockage en mémoire, des parties de toutes graines et de tous âges, des « appareils ». */
import { CloudClient } from '../../src/cloud/client';
import { CloudStore, browserSaves, type KeyValue, type LocalSaves } from '../../src/cloud/store';
import { CloudSync, type SyncOptions } from '../../src/cloud/sync';
import { deserialize, serialize } from '../../src/save/save';
import { GameState } from '../../src/sim/GameState';
import { FakeFirebase } from './fakeFirebase';

export class MemoryStorage implements KeyValue {
  readonly map = new Map<string, string>();
  /** Nombre d'octets au-delà duquel le stockage est « plein » (écritures refusées). */
  quota = Infinity;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    let used = value.length;
    for (const [k, v] of this.map) if (k !== key) used += v.length;
    if (used > this.quota) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Le texte d'une vraie sauvegarde du jeu, de cette graine, à ce temps de jeu. */
export function makeSave(seed: number, time: number, money = 0, depth = 0): string {
  const g = new GameState(seed);
  g.time = time;
  g.money = money;
  g.stats.maxDepth = depth;
  return JSON.stringify(serialize(g));
}

export const ENDPOINTS = { identity: 'http://fake/identity/v1', token: 'http://fake/token/v1', firestore: 'http://fake/firestore/v1' };

export function clientFor(fake: FakeFirebase, fetchFn: typeof fetch = fake.fetch): CloudClient {
  return new CloudClient({ config: { apiKey: fake.apiKey, projectId: fake.projectId }, endpoints: ENDPOINTS, fetch: fetchFn, now: () => fake.now(), timeout: 2000 });
}

export interface Events {
  pulled: number;
  changed: number;
  notices: string[];
  playing: boolean;
}

/** Un appareil : son stockage, son jeu, son client, et la synchronisation. */
export interface Device {
  kv: MemoryStorage;
  store: CloudStore;
  saves: LocalSaves;
  client: CloudClient;
  sync: CloudSync;
  events: Events;
}

export function makeDevice(fake: FakeFirebase, opts: SyncOptions & { fetch?: typeof fetch; kv?: MemoryStorage } = {}): Device {
  const kv = opts.kv ?? new MemoryStorage();
  const store = new CloudStore(kv);
  const saves = browserSaves(kv);
  const client = clientFor(fake, opts.fetch);
  const events: Events = { pulled: 0, changed: 0, notices: [], playing: false };
  const sync = new CloudSync(
    client,
    saves,
    store,
    {
      playing: () => events.playing,
      pulled: () => events.pulled++,
      changed: () => events.changed++,
      notice: (text) => events.notices.push(text),
      validate: (json) => void deserialize(JSON.parse(json)),
    },
    { now: () => fake.now(), pushDelay: 0, pushEvery: 0, retryAfter: 1000, drift: 0, ...opts },
  );
  return { kv, store, saves, client, sync, events };
}
