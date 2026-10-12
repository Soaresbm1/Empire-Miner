/**
 * Ce que cet appareil garde du compte : la session ouverte (de quoi rester connecté d'une visite à l'autre), le souvenir du
 * dernier échange (voir reconcile.ts), et les deux emplacements de sauvegarde du jeu (celui de la partie, et celui de la partie
 * « mise de côté » quand il a fallu choisir entre deux parties).
 */
import type { Tokens } from './client';
import type { Mark, SyncLink } from './reconcile';

/** Le coin du navigateur où l'on écrit (localStorage) : réduit à ce dont on se sert, pour les essais. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_KEY = 'empire-miner.account';
const MEMORY_KEY = 'empire-miner.cloud';
/** Les mêmes clés que src/save/save.ts (la partie en cours) : un essai vérifie qu'elles restent identiques. */
export const SLOT_KEY = 'empire-miner.save';
export const ASIDE_KEY = 'empire-miner.save.aside';

/** La session conservée : on garde le jeton de renouvellement, jamais le mot de passe. */
export type Session = Tokens;

/** Ce que cet appareil sait de ses échanges avec le compte `uid`. */
export interface Memory {
  uid: string;
  /** Le dernier échange réussi. */
  link: SyncLink | null;
  /** Le dernier envoi dont on n'a pas vu la réponse. */
  sent: Mark | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class CloudStore {
  constructor(private readonly kv: KeyValue | null) {}

  private read(key: string): unknown {
    try {
      const raw = this.kv?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      if (value === null) this.kv?.removeItem(key);
      else this.kv?.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage plein ou interdit : la session ne durera que le temps de la page */
    }
  }

  session(): Session | null {
    const s = this.read(SESSION_KEY) as Partial<Session> | null;
    if (!s || typeof s.uid !== 'string' || typeof s.email !== 'string' || typeof s.refreshToken !== 'string') return null;
    return { uid: s.uid, email: s.email, refreshToken: s.refreshToken, idToken: typeof s.idToken === 'string' ? s.idToken : '', expiresAt: Number(s.expiresAt) || 0 };
  }

  setSession(s: Session | null): void {
    this.write(SESSION_KEY, s);
  }

  /** Les échanges de cet appareil avec le compte `uid` (un autre compte : rien). */
  memory(uid: string): Memory {
    const m = this.read(MEMORY_KEY) as { uid?: unknown; link?: Partial<SyncLink> | null; sent?: Partial<Mark> | null } | null;
    if (!m || m.uid !== uid) return { uid, link: null, sent: null };
    const l = m.link;
    const s = m.sent;
    return {
      uid,
      link: l && typeof l.rev === 'string' && isNum(l.seed) && isNum(l.time) ? { rev: l.rev, seed: l.seed, time: l.time, at: isNum(l.at) ? l.at : 0 } : null,
      sent: s && isNum(s.seed) && isNum(s.time) ? { seed: s.seed, time: s.time } : null,
    };
  }

  setMemory(m: Memory | null): void {
    this.write(MEMORY_KEY, m);
  }
}

/** Les emplacements de sauvegarde du jeu, vus par le compte. */
export interface LocalSaves {
  /** Le texte JSON de la partie de cet appareil. */
  read(): string | null;
  write(raw: string): boolean;
  /** La partie mise de côté. */
  readAside(): string | null;
  writeAside(raw: string | null): void;
}

export function browserSaves(kv: KeyValue | null): LocalSaves {
  const get = (key: string): string | null => {
    try {
      return kv?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  return {
    read: () => get(SLOT_KEY),
    write: (raw) => {
      try {
        if (!kv) return false;
        kv.setItem(SLOT_KEY, raw);
        return true;
      } catch {
        return false;
      }
    },
    readAside: () => get(ASIDE_KEY),
    writeAside: (raw) => {
      try {
        if (raw === null) kv?.removeItem(ASIDE_KEY);
        else kv?.setItem(ASIDE_KEY, raw);
      } catch {
        /* stockage plein : l'appelant vérifie que la partie est bien là avant d'écraser quoi que ce soit */
      }
    },
  };
}
