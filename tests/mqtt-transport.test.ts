import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEAD_AFTER_MS, MAX_BUFFERED, MqttTransport, WAKE_REPLY_MS } from '../src/net/mqtt';
import type { Message } from '../src/net/transport';

/**
 * De faux courtiers MQTT : un WebSocket qui répond à CONNECT, SUBSCRIBE et PINGREQ comme un vrai (ou qui, une fois « muet »,
 * garde la connexion ouverte sans plus rien dire : réseau mobile qui change, téléphone qui dort). Le temps est simulé.
 */
class FakeSocket {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Faux : le courtier ne répond plus à rien (la connexion reste ouverte). */
  responsive = true;
  /** Paquets reçus par type MQTT (1 CONNECT, 3 PUBLISH, 8 SUBSCRIBE, 12 PINGREQ). */
  readonly got: Record<number, number> = {};

  constructor(
    readonly url: string,
    /** Faux : la connexion n'arrive jamais à s'ouvrir (reste en attente). */
    opens = true,
  ) {
    if (opens)
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 10);
  }

  private reply(bytes: number[]): void {
    this.onmessage?.({ data: Uint8Array.from(bytes).buffer });
  }

  send(data: Uint8Array): void {
    const type = data[0] >> 4;
    this.got[type] = (this.got[type] ?? 0) + 1;
    if (!this.responsive) return;
    if (type === 1) this.reply([0x20, 0x02, 0x00, 0x00]);
    else if (type === 8) this.reply([0x90, 0x03, data[2], data[3], 0x00]);
    else if (type === 12) this.reply([0xd0, 0x00]);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

const URLS = ['wss://a.test/mqtt', 'wss://b.test/mqtt', 'wss://c.test/mqtt'];

function setup() {
  const made: FakeSocket[] = [];
  const t = new MqttTransport('ABCDE', {
    brokers: URLS,
    makeSocket: (u) => {
      const s = new FakeSocket(u);
      made.push(s);
      return s as unknown as WebSocket;
    },
  });
  return { t, made, byUrl: (u: string) => made.filter((s) => s.url === u) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MqttTransport : courtiers lents, muets ou encombrés', () => {
  it('publie chez tous les courtiers ouverts, pas seulement deux : un courtier lent ne retarde pas les autres', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    expect(t.openCount).toBe(3);
    t.send({ m: 'f', n: 1 } as Message);
    expect(made.map((s) => s.got[3] ?? 0)).toEqual([1, 1, 1]);
    t.close();
  });

  it('ne publie pas chez un courtier dont la connexion est encombrée (les paquets du jeu se répètent, inutile de les empiler)', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    made[1].bufferedAmount = MAX_BUFFERED + 1;
    t.send({ m: 'f' } as Message);
    expect(made.map((s) => s.got[3] ?? 0)).toEqual([1, 0, 1]);
    made[1].bufferedAmount = 0;
    t.send({ m: 'f' } as Message);
    expect(made.map((s) => s.got[3] ?? 0)).toEqual([2, 1, 2]);
    t.close();
  });

  it('un courtier qui répond reste ouvert, même plusieurs minutes sans rien d’autre à dire', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(made).toHaveLength(3);
    expect(t.openCount).toBe(3);
    expect(made[0].got[12]).toBeGreaterThan(20); // des « ping » régulièrement
    t.close();
  });

  it('un courtier devenu muet sans que la connexion se ferme est abandonné, puis remplacé par une nouvelle connexion', () => {
    const { t, made, byUrl } = setup();
    vi.advanceTimersByTime(100);
    expect(t.openCount).toBe(3);
    // Le deuxième courtier ne répond plus à rien, mais la connexion reste « ouverte » (c'est ce qui rend la panne invisible).
    made[1].responsive = false;
    // Les « ping » partent toutes les 10 s : au contrôle de la 30e seconde, plus de 25 s de silence.
    vi.advanceTimersByTime(DEAD_AFTER_MS + 5400);
    expect(t.openCount).toBe(2);
    // On se reconnecte à ce courtier (une nouvelle connexion, qui répond).
    vi.advanceTimersByTime(2000);
    expect(byUrl(URLS[1])).toHaveLength(2);
    expect(t.openCount).toBe(3);
    // Et la connexion muette a bien été fermée de notre côté.
    expect(made[1].readyState).toBe(3);
    t.close();
  });

  it('les autres courtiers continuent de porter les messages pendant qu’un courtier est muet', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    made[0].responsive = false;
    made[2].responsive = false;
    vi.advanceTimersByTime(3000);
    t.send({ m: 'f' } as Message);
    expect(made[1].got[3]).toBe(1);
    t.close();
  });

  it('au réveil de l’application (téléphone rallumé), un courtier qui ne répond pas à un « ping » est abandonné tout de suite', () => {
    const { t, made, byUrl } = setup();
    vi.advanceTimersByTime(100);
    made[0].responsive = false;
    t.wake();
    vi.advanceTimersByTime(WAKE_REPLY_MS - 100);
    expect(t.openCount).toBe(3); // pas encore : on laisse le temps de répondre
    vi.advanceTimersByTime(300);
    expect(t.openCount).toBe(2);
    // Celui qui répond est gardé.
    expect(made[1].readyState).toBe(1);
    expect(made[2].readyState).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(byUrl(URLS[0])).toHaveLength(2);
    expect(t.openCount).toBe(3);
    t.close();
  });

  it('une connexion qui n’arrive jamais à s’ouvrir est abandonnée au bout d’un moment, et on réessaie', () => {
    const made: FakeSocket[] = [];
    const t = new MqttTransport('ABCDE', {
      brokers: ['wss://bloque.test/mqtt'],
      makeSocket: (u) => {
        // La première connexion reste en attente ; la suivante s'ouvre.
        const s = new FakeSocket(u, made.length > 0);
        made.push(s);
        return s as unknown as WebSocket;
      },
    });
    vi.advanceTimersByTime(20000);
    expect(made).toHaveLength(1);
    expect(t.openCount).toBe(0);
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    vi.advanceTimersByTime(3000);
    expect(made.length).toBeGreaterThanOrEqual(2);
    expect(t.openCount).toBe(1);
    t.close();
  });

  it('close() ferme tous les courtiers et ne se reconnecte plus', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    t.close();
    vi.advanceTimersByTime(60000);
    expect(made).toHaveLength(3);
    expect(made.every((s) => s.readyState === 3)).toBe(true);
  });
});
