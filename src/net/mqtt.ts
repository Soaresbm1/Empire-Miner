/**
 * Relais MQTT : des courtiers publics gratuits (sans compte, sans serveur à soi) servent de boîte aux lettres entre les
 * deux téléphones. Un client MQTT 3.1.1 minimal sur WebSocket : se connecter, s'abonner à un sujet, publier, rester vivant.
 *
 * On s'abonne chez tous les courtiers de la liste en même temps et on publie chez deux d'entre eux : les deux joueurs
 * n'ont besoin d'en avoir qu'un en commun. L'enveloppe (`Wire`) écarte son propre écho et les doublons.
 *
 * Rien de secret ne circule : la partie se tient sur un code de cinq caractères tirés au hasard, et les messages ne
 * contiennent que des intentions de jeu (pas de données personnelles).
 */
import { Wire, type Message, type Transport, type TransportStatus } from './transport';

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

/** Un paquet MQTT reçu. */
export type Incoming = { type: 'connack'; ok: boolean } | { type: 'suback' } | { type: 'publish'; topic: string; payload: Uint8Array } | { type: 'pingresp' } | { type: 'other' };

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
    if (type === 2) return { type: 'connack', ok: body.length >= 2 && body[1] === 0 };
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
  closed = false;

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
    this.parser = new MqttParser();
    ws.onopen = () => ws.send(connectPacket(this.clientId));
    ws.onmessage = (e) => {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : null;
      if (!data) return;
      for (const p of this.parser.push(data)) {
        if (p.type === 'connack') {
          if (p.ok) ws.send(subscribePacket(1, this.topic));
          else ws.close();
        } else if (p.type === 'suback') {
          this.open = true;
          this.tries = 0;
          this.onChange();
        } else if (p.type === 'publish' && p.topic === this.topic) this.onText(dec.decode(p.payload));
      }
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      const was = this.open;
      this.open = false;
      if (this.ws === ws) this.ws = null;
      if (was) this.onChange();
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
    this.ping = setInterval(() => {
      if (ws.readyState === 1) ws.send(PING);
    }, 15000);
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry) return;
    const wait = Math.min(15000, 1000 * 2 ** Math.min(this.tries++, 4));
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  publish(payload: Uint8Array): void {
    if (this.open && this.ws && this.ws.readyState === 1) this.ws.send(publishPacket(this.topic, payload));
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
  /** Nombre de courtiers chez qui on publie. */
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
  /** Courtiers préférés pour publier : ceux qui se sont ouverts en premier. */
  private order: Broker[] = [];

  constructor(code: string, opts: MqttOptions = {}) {
    const topic = `empire-miner/v1/${code}`;
    const urls = opts.brokers ?? BROKERS;
    const makeSocket = opts.makeSocket ?? ((u: string) => new WebSocket(u, 'mqtt'));
    this.publishTo = opts.publishTo ?? 2;
    for (const url of urls) {
      const clientId = `em-${this.wire.id}-${this.brokers.length}`;
      const b: Broker = new Broker(
        url,
        topic,
        clientId,
        (text) => {
          const m = this.wire.unwrap(text);
          if (m) this.onMessage?.(m);
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

  close(): void {
    this.status = 'closed';
    for (const b of this.brokers) b.close();
    this.onStatus?.('closed');
  }
}
