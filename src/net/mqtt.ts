/**
 * Relais MQTT : des courtiers publics gratuits (sans compte, sans serveur à soi) servent de boîte aux lettres entre les
 * deux téléphones. Un client MQTT 3.1.1 minimal sur WebSocket : se connecter, s'abonner à un sujet, publier, rester vivant.
 *
 * On s'abonne chez tous les courtiers de la liste en même temps et on publie chez tous ceux qui sont ouverts : les deux
 * joueurs n'ont besoin d'en avoir qu'un en commun, et un courtier lent ou muet ne retarde pas les autres. L'enveloppe
 * (`Wire`) écarte son propre écho et les doublons.
 *
 * Un courtier peut cesser de répondre sans que la connexion se ferme (réseau mobile qui change, téléphone qui dort) : on le
 * remarque à son silence (aucun octet reçu, pas même la réponse à nos « ping »), on l'abandonne tout de suite et on se
 * reconnecte, au lieu d'attendre la fin de la connexion, qui peut prendre des minutes.
 *
 * Rien de secret ne circule : la partie se tient sur un code de cinq caractères tirés au hasard, et les messages ne
 * contiennent que des intentions de jeu (pas de données personnelles).
 */
import { Wire, type Message, type Transport, type TransportStatus } from './transport';

/** Un relais par lequel l'autre joueur s'est fait entendre depuis moins que ça (ms) relie sûrement les deux joueurs. */
const PEER_SEEN_MS = 5000;

/** Courtiers publics MQTT sur WebSocket sécurisé. */
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/'];

type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8(s: string): Bytes {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}

function remaining(n: number): number[] {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(first: number, ...parts: Uint8Array[]): Bytes {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const head = [first, ...remaining(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Les octets d'un paquet CONNECT (session propre, 30 s de garde). */
export function connectPacket(clientId: string, keepAlive = 30): Bytes {
  return packet(0x10, utf8('MQTT'), Uint8Array.of(4, 0x02, keepAlive >> 8, keepAlive & 0xff), utf8(clientId));
}

export function subscribePacket(id: number, topic: string): Bytes {
  return packet(0x82, Uint8Array.of(id >> 8, id & 0xff), utf8(topic), Uint8Array.of(0));
}

export function publishPacket(topic: string, payload: Uint8Array): Bytes {
  return packet(0x30, utf8(topic), payload);
}

const PING = Uint8Array.of(0xc0, 0x00);
const DISCONNECT = Uint8Array.of(0xe0, 0x00);

/** Un « ping » toutes les 10 s ; un courtier muet depuis 25 s est abandonné. */
export const PING_EVERY_MS = 10000;
export const DEAD_AFTER_MS = 25000;
/** Au réveil de l'application : un courtier qui ne répond pas à un « ping » en si peu de temps est abandonné. */
export const WAKE_REPLY_MS = 3000;
/** Au-delà, la connexion est trop lente pour ce qu'on y envoie : on laisse tomber des paquets (le jeu les répète) plutôt que de les empiler. */
export const MAX_BUFFERED = 32768;

/** Un paquet MQTT reçu. */
export type Incoming = { type: 'connack'; ok: boolean; code: number } | { type: 'suback' } | { type: 'publish'; topic: string; payload: Uint8Array } | { type: 'pingresp' } | { type: 'other' };

/** Découpe un flux d'octets en paquets MQTT (un message WebSocket peut en contenir plusieurs, ou une moitié). */
export class MqttParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Incoming[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf, 0);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: Incoming[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let len = 0;
      let mul = 1;
      let i = 1;
      let complete = false;
      while (i < this.buf.length && i <= 4) {
        const d = this.buf[i++];
        len += (d & 0x7f) * mul;
        if (!(d & 0x80)) {
          complete = true;
          break;
        }
        mul *= 128;
      }
      if (!complete) {
        if (i > 4) this.buf = new Uint8Array(0); // longueur invalide : on repart de zéro
        break;
      }
      if (this.buf.length < i + len) break;
      const first = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      out.push(MqttParser.decode(first, body));
    }
    return out;
  }

  private static decode(first: number, body: Uint8Array): Incoming {
    const type = first >> 4;
    if (type === 2) return { type: 'connack', ok: body.length >= 2 && body[1] === 0, code: body.length >= 2 ? body[1] : -1 };
    if (type === 9) return { type: 'suback' };
    if (type === 13) return { type: 'pingresp' };
    if (type === 3) {
      if (body.length < 2) return { type: 'other' };
      const tl = (body[0] << 8) | body[1];
      const qos = (first >> 1) & 3;
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const start = 2 + tl + (qos > 0 ? 2 : 0);
      return { type: 'publish', topic, payload: body.subarray(start) };
    }
    return { type: 'other' };
  }
}

/** Une connexion à un courtier : ouverte quand elle est abonnée. */
class Broker {
  ws: WebSocket | null = null;
  open = false;
  private parser = new MqttParser();
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;
  /** Dernière fois (ms) qu'un octet est venu de ce courtier. */
  private lastRx = 0;
  closed = false;
  /** Dernière fois (ms) que l'autre joueur s'est fait entendre par ce relais : il relie donc bien les deux joueurs. */
  peerSeenAt = 0;
  /** Pour le diagnostic : pourquoi la dernière connexion s'est arrêtée, combien de fois on s'est connecté, quand. */
  private lastWhy = '';
  private opens = 0;
  private lastOpenAt = 0;
  private attempts = 0;

  constructor(
    readonly url: string,
    private readonly topic: string,
    private readonly clientId: string,
    private readonly onText: (text: string) => void,
    private readonly onChange: () => void,
    private readonly makeSocket: (url: string) => WebSocket,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.attempts++;
    this.parser = new MqttParser();
    ws.onopen = () => {
      this.lastRx = Date.now();
      ws.send(connectPacket(this.clientId));
    };
    ws.onmessage = (e) => {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : null;
      if (!data) return;
      this.lastRx = Date.now();
      for (const p of this.parser.push(data)) {
        if (p.type === 'connack') {
          if (p.ok) ws.send(subscribePacket(1, this.topic));
          else {
            this.lastWhy = `connexion refusée par le relais (code ${p.code})`;
            ws.close();
          }
        } else if (p.type === 'suback') {
          this.open = true;
          this.tries = 0;
          this.opens++;
          this.lastOpenAt = Date.now();
          this.lastWhy = '';
          this.onChange();
        } else if (p.type === 'publish' && p.topic === this.topic) this.onText(dec.decode(p.payload));
      }
    };
    ws.onclose = (ev) => {
      if (!this.lastWhy) this.lastWhy = `connexion fermée${ev?.code ? ` (code ${ev.code})` : ''}`;
      this.lose(ws);
    };
    ws.onerror = () => {
      if (!this.lastWhy) this.lastWhy = 'erreur réseau';
      ws.close();
    };
    this.lastRx = Date.now();
    this.ping = setInterval(() => {
      // Muet : rien reçu depuis trop longtemps (connexion ouverte qui ne dit plus rien, ou qui n'arrive jamais à s'ouvrir).
      if (Date.now() - this.lastRx > DEAD_AFTER_MS) this.lose(ws, true);
      else if (ws.readyState === 1) ws.send(PING);
    }, PING_EVERY_MS);
  }

  /** Cette connexion est finie (fermée, ou muette : alors on la ferme nous-mêmes, sans attendre) : on se reconnecte. */
  private lose(ws: WebSocket, abandon = false): void {
    if (this.ws !== ws && !abandon) return;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const was = this.open;
    this.open = false;
    if (this.ws === ws) this.ws = null;
    if (abandon) {
      this.lastWhy = 'relais muet, connexion abandonnée';
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
    }
    if (was) this.onChange();
    this.scheduleRetry();
  }

  /** L'application revient au premier plan : la connexion est-elle encore vivante ? On le sait vite par un « ping ». */
  wake(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || !this.open) return;
    const since = Date.now();
    ws.send(PING);
    setTimeout(() => {
      if (this.ws === ws && this.lastRx < since) this.lose(ws, true);
    }, WAKE_REPLY_MS);
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry) return;
    const wait = Math.min(15000, 1000 * 2 ** Math.min(this.tries++, 4));
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  /** Envoie ; faux si ce relais n'est pas ouvert ou si sa connexion est encombrée (on n'empile pas). */
  publish(payload: Uint8Array): boolean {
    const ws = this.ws;
    if (!this.open || !ws || ws.readyState !== 1) return false;
    if ((ws.bufferedAmount ?? 0) > MAX_BUFFERED) return false;
    ws.send(publishPacket(this.topic, payload));
    return true;
  }

  /** Une ligne pour le diagnostic. */
  describe(): string {
    const host = this.url.replace(/^wss?:\/\//, '').replace(/[:/].*$/, '');
    const state = this.open ? `ouvert depuis ${Math.round((Date.now() - this.lastOpenAt) / 1000)} s` : this.closed ? 'fermé' : `non joignable${this.lastWhy ? ` : ${this.lastWhy}` : ''}`;
    return `${host} : ${state} · ${this.opens} connexion(s) réussie(s) sur ${this.attempts} essai(s)`;
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(DISCONNECT);
      this.ws?.close();
    } catch {
      /* déjà fermé */
    }
  }
}

export interface MqttOptions {
  brokers?: string[];
  /** Fabrique de WebSocket (les tests y mettent la leur). */
  makeSocket?: (url: string) => WebSocket;
  /** Nombre de courtiers chez qui on publie (tous ceux qui sont ouverts par défaut). */
  publishTo?: number;
}

/** Le canal MQTT d'une partie : tous les courtiers de la liste, un sujet par code de partie. */
export class MqttTransport implements Transport {
  onMessage: ((msg: Message) => void) | null = null;
  onStatus: ((s: TransportStatus) => void) | null = null;
  private readonly brokers: Broker[] = [];
  private readonly wire = new Wire();
  private status: TransportStatus = 'connecting';
  private readonly publishTo: number;
  /** Courtiers ouverts, dans l'ordre où ils se sont ouverts (on publie chez les `publishTo` premiers). */
  private order: Broker[] = [];

  constructor(code: string, opts: MqttOptions = {}) {
    const topic = `empire-miner/v1/${code}`;
    const urls = opts.brokers ?? BROKERS;
    const makeSocket = opts.makeSocket ?? ((u: string) => new WebSocket(u, 'mqtt'));
    this.publishTo = opts.publishTo ?? urls.length;
    for (const url of urls) {
      const clientId = `em-${this.wire.id}-${this.brokers.length}`;
      const b: Broker = new Broker(
        url,
        topic,
        clientId,
        (text) => {
          const r = this.wire.read(text);
          if (r.peer) b.peerSeenAt = Date.now();
          if (r.msg) this.onMessage?.(r.msg);
        },
        () => {
          if (b.open && !this.order.includes(b)) this.order.push(b);
          if (!b.open) this.order = this.order.filter((o) => o !== b);
          this.refresh();
        },
        makeSocket,
      );
      this.brokers.push(b);
    }
  }

  private refresh(): void {
    const next: TransportStatus = this.brokers.some((b) => b.open) ? 'open' : this.status === 'closed' ? 'closed' : 'connecting';
    if (next !== this.status) {
      this.status = next;
      this.onStatus?.(next);
    }
  }

  /** Nombre de courtiers actuellement ouverts. */
  get openCount(): number {
    return this.brokers.filter((b) => b.open).length;
  }

  send(msg: Message): void {
    const payload = enc.encode(this.wire.wrap(msg));
    let n = 0;
    for (const b of this.order) {
      if (!b.open) continue;
      b.publish(payload);
      if (++n >= this.publishTo) break;
    }
  }

  /**
   * Un seul relais, tiré au hasard parmi ceux qui sont ouverts et pas encombrés (voir `Transport.trySend`), en préférant ceux par
   * lesquels l'autre joueur s'est fait entendre ces dernières secondes : ils relient sûrement les deux joueurs.
   */
  trySend(msg: Message): boolean {
    const open = this.brokers.filter((b) => b.open);
    if (!open.length) return false;
    const payload = enc.encode(this.wire.wrap(msg));
    const now = Date.now();
    const shared = open.filter((b) => now - b.peerSeenAt < PEER_SEEN_MS);
    // Les relais sûrs d'abord (au hasard parmi eux : un relais qui perd des messages ne coince pas toujours le même morceau), puis les autres.
    const others = open.filter((b) => !shared.includes(b));
    if (shared.length) {
      const start = Math.floor(Math.random() * shared.length);
      for (let i = 0; i < shared.length; i++) if (shared[(start + i) % shared.length].publish(payload)) return true;
    }
    const start = Math.floor(Math.random() * Math.max(1, others.length));
    for (let i = 0; i < others.length; i++) if (others[(start + i) % others.length].publish(payload)) return true;
    return false;
  }

  relays(): { open: number; total: number } {
    return { open: this.openCount, total: this.brokers.length };
  }

  report(): string[] {
    return this.brokers.map((b) => b.describe());
  }

  /** L'application revient au premier plan : on vérifie que les courtiers répondent encore. */
  wake(): void {
    for (const b of this.brokers) b.wake();
  }

  close(): void {
    this.status = 'closed';
    for (const b of this.brokers) b.close();
    this.onStatus?.('closed');
  }
}
