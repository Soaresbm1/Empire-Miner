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
    /** Vrai : le courtier refuse la connexion (CONNACK avec un code d'erreur). */
    private readonly refuse = false,
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

  /** Le courtier remet un message d'un autre joueur sur le sujet de la partie (paquet PUBLISH). */
  deliver(from: string, seq: number, msg: Record<string, unknown>, topic = 'empire-miner/v1/ABCDE'): void {
    const t = new TextEncoder().encode(topic);
    const p = new TextEncoder().encode(JSON.stringify({ f: from, s: seq, p: msg }));
    const rest = 2 + t.length + p.length;
    const bytes = [0x30, ...(rest < 128 ? [rest] : [(rest & 0x7f) | 0x80, rest >> 7]), t.length >> 8, t.length & 0xff, ...t, ...p];
    this.reply(bytes);
  }

  send(data: Uint8Array): void {
    const type = data[0] >> 4;
    this.got[type] = (this.got[type] ?? 0) + 1;
    if (!this.responsive) return;
    if (type === 1) this.reply([0x20, 0x02, 0x00, this.refuse ? 0x05 : 0x00]);
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


describe('MqttTransport : un seul relais pour les gros messages, état des relais', () => {
  afterEach(() => vi.restoreAllMocks());

  it('trySend envoie par un seul relais, tiré parmi ceux qui sont ouverts', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([1, 0, 0]);
    (Math.random as unknown as { mockReturnValue(v: number): void }).mockReturnValue(0.99);
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([1, 0, 1]);
    t.close();
  });

  it('trySend préfère les relais par lesquels l’autre joueur s’est fait entendre (ils relient sûrement les deux), puis les autres', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    made[2].deliver('autre', 1, { m: 'hello' });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let i = 0; i < 5; i++) expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([0, 0, 5]);
    // Celui-là est encombré : on se rabat sur un autre relais ouvert.
    made[2].bufferedAmount = MAX_BUFFERED + 1;
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([1, 0, 5]);
    // Passé quelques secondes sans nouvelle de l'autre par ce relais, on ne le préfère plus.
    made[2].bufferedAmount = 0;
    vi.advanceTimersByTime(6000);
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([2, 0, 5]);
    t.close();
  });

  it('un message de l’autre joueur déjà reçu par un autre relais compte aussi : ce relais relie bien les deux', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    const got: Message[] = [];
    t.onMessage = (m) => got.push(m);
    made[0].deliver('autre', 7, { m: 'f' });
    made[1].deliver('autre', 7, { m: 'f' }); // le même message, par le deuxième relais : doublon
    expect(got).toHaveLength(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    // Les relais 0 et 1 relient les deux joueurs ; le tirage au hasard (0,99) tombe sur le dernier d'entre eux.
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([0, 1, 0]);
    t.close();
  });

  it('trySend saute un relais encombré, et dit faux quand tous le sont (on réessaiera plus tard, rien n’est perdu)', () => {
    const { t, made } = setup();
    vi.advanceTimersByTime(100);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    made[0].bufferedAmount = MAX_BUFFERED + 1;
    expect(t.trySend({ m: 'snap' } as Message)).toBe(true);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([0, 1, 0]);
    for (const m of made) m.bufferedAmount = MAX_BUFFERED + 1;
    expect(t.trySend({ m: 'snap' } as Message)).toBe(false);
    expect(made.map((x) => x.got[3] ?? 0)).toEqual([0, 1, 0]); // rien de plus n'est parti
    t.close();
  });

  it('trySend dit faux quand aucun relais n’est ouvert', () => {
    const t = new MqttTransport('ABCDE', { brokers: URLS, makeSocket: (u) => new FakeSocket(u, false) as unknown as WebSocket });
    vi.advanceTimersByTime(100);
    expect(t.trySend({ m: 'snap' } as Message)).toBe(false);
    t.close();
  });

  it('relays() et report() disent combien de relais sont ouverts et pourquoi les autres ne le sont pas', () => {
    const t = new MqttTransport('ABCDE', {
      brokers: URLS,
      makeSocket: (u) => new FakeSocket(u, u !== URLS[0], u === URLS[1]) as unknown as WebSocket,
    });
    vi.advanceTimersByTime(100);
    expect(t.relays()).toEqual({ open: 1, total: 3 });
    const lines = t.report();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('a.test');
    expect(lines[0]).toContain('non joignable');
    expect(lines[1]).toContain('refusée');
    expect(lines[1]).toContain('code 5');
    expect(lines[2]).toContain('ouvert');
    expect(lines[2]).toContain('1 connexion(s) réussie(s)');
    t.close();
  });
});
