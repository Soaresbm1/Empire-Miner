/**
 * Transports : comment deux téléphones s'échangent des messages. Un transport est un canal « au mieux » (un message peut
 * se perdre, arriver en double ou dans le désordre) ; le lockstep et la session le tolèrent.
 *
 *  - `BroadcastTransport` : deux onglets du même navigateur (essais, tests de bout en bout).
 *  - `MqttTransport` (voir mqtt.ts) : un courtier MQTT public sur WebSocket, sans compte ni serveur à soi.
 */
export type TransportStatus = 'connecting' | 'open' | 'closed';

/** Un message : un objet JSON. */
export type Message = { m: string; [key: string]: unknown };

export interface Transport {
  /** Envoie (au mieux) un message à l'autre joueur. */
  send(msg: Message): void;
  onMessage: ((msg: Message) => void) | null;
  onStatus: ((s: TransportStatus) => void) | null;
  close(): void;
}

/** Identifiant court au hasard (identifiant d'invité, de pair, code de partie). */
export function randomId(len: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Alphabet des codes de partie : sans les caractères qu'on confond (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newGameCode(): string {
  return randomId(5, CODE_ALPHABET);
}

/** Un code saisi à la main, mis en forme (majuscules, caractères permis seulement) ; null s'il est trop court. */
export function cleanCode(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('');
  return s.length >= 5 ? s.slice(0, 5) : null;
}

/** Enveloppe d'un message : l'expéditeur et un numéro, pour ignorer son propre écho et les doublons. */
interface Envelope {
  f: string;
  s: number;
  p: Message;
}

/** Retient les messages déjà vus (par expéditeur et numéro) sur une fenêtre glissante. */
export class Dedupe {
  private seen = new Map<string, Set<number>>();
  private order: string[] = [];
  /** Vrai si ce message est nouveau (et le retient). */
  fresh(from: string, seq: number): boolean {
    let set = this.seen.get(from);
    if (!set) this.seen.set(from, (set = new Set()));
    if (set.has(seq)) return false;
    set.add(seq);
    this.order.push(`${from}:${seq}`);
    if (this.order.length > 2000) {
      const old = this.order.shift()!;
      const [f, n] = old.split(':');
      this.seen.get(f)?.delete(Number(n));
    }
    return true;
  }
}

/** Fabrique et lit les enveloppes d'un transport (identité du pair, numérotation, filtre d'écho et de doublons). */
export class Wire {
  readonly id = randomId(8);
  private seq = 0;
  private readonly dedupe = new Dedupe();

  wrap(p: Message): string {
    const e: Envelope = { f: this.id, s: ++this.seq, p };
    return JSON.stringify(e);
  }

  /** Le message contenu, ou null (mal formé, mon propre écho, déjà vu). */
  unwrap(text: string): Message | null {
    let e: Partial<Envelope>;
    try {
      e = JSON.parse(text);
    } catch {
      return null;
    }
    if (!e || typeof e.f !== 'string' || typeof e.s !== 'number' || !e.p || typeof e.p !== 'object' || typeof (e.p as Message).m !== 'string') return null;
    if (e.f === this.id) return null;
    return this.dedupe.fresh(e.f, e.s) ? (e.p as Message) : null;
  }
}

/** Deux onglets du même navigateur et du même code de partie. */
export class BroadcastTransport implements Transport {
  onMessage: ((msg: Message) => void) | null = null;
  onStatus: ((s: TransportStatus) => void) | null = null;
  private readonly ch: BroadcastChannel;
  private readonly wire = new Wire();

  constructor(code: string) {
    this.ch = new BroadcastChannel(`empire-miner-${code}`);
    this.ch.onmessage = (e) => {
      const m = typeof e.data === 'string' ? this.wire.unwrap(e.data) : null;
      if (m) this.onMessage?.(m);
    };
    queueMicrotask(() => this.onStatus?.('open'));
  }

  send(msg: Message): void {
    this.ch.postMessage(this.wire.wrap(msg));
  }

  close(): void {
    this.ch.close();
    this.onStatus?.('closed');
  }
}
