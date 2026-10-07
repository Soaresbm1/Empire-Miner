import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { mulberry32 } from '../src/core/rng';
import { stateDigest } from '../src/net/digest';
import { PROTOCOL, Session, type SessionRole, type SessionStatus } from '../src/net/session';
import type { Message, Transport, TransportStatus } from '../src/net/transport';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { goTo } from './helpers';

const Y = SURFACE_ROWS + 14;
const STILL: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Un bout de réseau simulé : l'envoi arrive de l'autre côté après un délai, avec des pertes et des doublons possibles. */
class FakeLink {
  now = 0;
  loss = 0;
  dup = 0;
  latency = 40;
  jitter = 20;
  /** Coupure totale (ni envoi ni réception). */
  cut = false;
  private readonly rnd = mulberry32(5);
  private queue: { at: number; to: FakeEnd; msg: Message }[] = [];
  readonly a = new FakeEnd(this, 'a');
  readonly b = new FakeEnd(this, 'b');
  /** Messages envoyés par chaque côté, par type (pour les contrôles). */
  readonly sent: Record<string, Record<string, number>> = { a: {}, b: {} };

  push(from: FakeEnd, msg: Message): void {
    const sent = this.sent[from.name];
    sent[msg.m] = (sent[msg.m] ?? 0) + 1;
    if (this.cut) return;
    const to = from === this.a ? this.b : this.a;
    const copies = this.rnd() < this.dup ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      if (this.rnd() < this.loss) continue;
      // Copie profonde : le message ne doit pas partager d'objets avec l'émetteur.
      this.queue.push({ at: this.now + this.latency + this.rnd() * this.jitter, to, msg: JSON.parse(JSON.stringify(msg)) });
    }
  }

  /** Livre ce qui est arrivé à l'heure actuelle. */
  deliver(): void {
    const due = this.queue.filter((q) => q.at <= this.now).sort((x, y) => x.at - y.at);
    this.queue = this.queue.filter((q) => q.at > this.now);
    if (this.cut) return;
    for (const q of due) q.to.onMessage?.(q.msg);
  }
}

class FakeEnd implements Transport {
  onMessage: ((msg: Message) => void) | null = null;
  onStatus: ((s: TransportStatus) => void) | null = null;
  closed = false;
  constructor(
    private readonly link: FakeLink,
    readonly name: 'a' | 'b',
  ) {}
  send(msg: Message): void {
    if (!this.closed) this.link.push(this, msg);
  }
  close(): void {
    this.closed = true;
  }
}

/** Partie de départ de l'hôte (quelques machines, des ouvriers, de l'argent). */
function hostGame(): GameState {
  const g = new GameState(9);
  g.money = 30000;
  g.pickaxeLevel = 2;
  g.stats.discovered = ['coal', 'copper', 'iron'];
  g.inventory.addKit('storage', 4);
  g.inventory.addKit('drill', 3);
  g.inventory.addKit('conveyor', 40);
  g.inventory.add('coal', 10);
  for (const x of [48, 50]) g.world.set(x, Y, 0);
  g.world.setDeposit(50, Y, 2, 80);
  goTo(g, 'workshop');
  g.hireWorker('picker');
  g.player.x = 52.5 * TILE;
  g.player.y = (Y + 0.5) * TILE;
  return g;
}

/** Hôte + invité reliés par un faux réseau, avec une horloge virtuelle commune (16 ms par image). */
class Duel {
  readonly link = new FakeLink();
  readonly host: Session;
  readonly guest: Session;
  hostG: GameState = hostGame();
  guestG: GameState | null = null;
  readonly hostStatus: SessionStatus[] = [];
  readonly guestStatus: SessionStatus[] = [];
  readonly adopted: { host: GameState[]; guest: GameState[] } = { host: [], guest: [] };
  readonly intents: PlayerIntent[] = [STILL, STILL];
  private pumped = 0;

  constructor(opts: { guestId?: string; hostId?: string } = {}) {
    const t = () => this.link.now;
    this.host = new Session({
      role: 'host',
      transport: this.link.a,
      code: 'ABCDE',
      guestId: opts.hostId ?? 'hote',
      name: 'Hôte',
      getState: () => this.hostG,
      adopt: (g) => {
        this.hostG = g;
        this.adopted.host.push(g);
      },
      onStatus: (s) => this.hostStatus.push(s),
      now: t,
      autoPump: false,
    });
    this.host.attach(this.hostG);
    this.guest = this.makeGuest(opts.guestId ?? 'amie');
  }

  makeGuest(id: string): Session {
    return new Session({
      role: 'guest',
      transport: this.link.b,
      code: 'ABCDE',
      guestId: id,
      name: 'Amie',
      getState: () => null,
      adopt: (g) => {
        this.guestG = g;
        this.adopted.guest.push(g);
      },
      onStatus: (s) => this.guestStatus.push(s),
      now: () => this.link.now,
      autoPump: false,
    });
  }

  /** Une image d'horloge (16 ms) : réseau, entretien, pas de jeu des deux côtés. */
  frame(): void {
    this.link.now += 16;
    this.link.deliver();
    // L'entretien réseau tourne toutes les 50 ms.
    if (this.link.now - this.pumped >= 50) {
      this.pumped = this.link.now;
      this.host.pump();
      this.guest.pump();
    }
    this.host.advance(0.016, this.intents[0]);
    this.guest.advance(0.016, this.intents[1]);
  }

  run(ms: number, until?: () => boolean): void {
    const end = this.link.now + ms;
    while (this.link.now < end) {
      this.frame();
      if (until?.()) return;
    }
  }

  /** Laisse aussi les promesses (compression de l'instantané) se résoudre. */
  async runAsync(ms: number, until?: () => boolean): Promise<void> {
    const end = this.link.now + ms;
    while (this.link.now < end) {
      this.frame();
      if (until?.()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Les deux parties à un même pas : mêmes empreintes ? (on avance jusqu'à ce que les deux en soient au même numéro de pas.) */
  async same(): Promise<boolean> {
    for (let i = 0; i < 900; i++) {
      if (this.guestG && this.host.tick === this.guest.tick) return stateDigest(this.hostG) === stateDigest(this.guestG);
      this.frame();
      if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return false;
  }
}

const playing = (d: Duel) => d.host.status === 'playing' && d.guest.status === 'playing';

describe('Session : arrivée de l’invité', () => {
  it('l’hôte attend seul, puis l’invité rejoint : même partie, deux joueurs', async () => {
    const d = new Duel();
    expect(d.host.status).toBe('waiting');
    // Seul : la partie avance comme en solo.
    d.run(500);
    expect(d.hostG.time).toBeGreaterThan(0);
    expect(d.host.linked).toBe(false);
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    expect(d.hostG.playerCount).toBe(2);
    expect(d.guestG?.playerCount).toBe(2);
    expect(d.guestG?.local).toBe(1);
    expect(d.hostG.local).toBe(0);
    expect(d.adopted.host).toHaveLength(1);
    expect(d.adopted.guest).toHaveLength(1);
    await d.runAsync(1000);
    expect(d.host.tick).toBeGreaterThan(30);
    expect(d.guest.tick).toBeGreaterThan(30);
  });

  it('les deux parties restent identiques pendant plusieurs minutes avec des mouvements et des actions des deux', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    const rnd = mulberry32(3);
    let mismatches = 0;
    let checks = 0;
    for (let i = 0; i < 60 * 150; i++) {
      if (i % 40 === 0) {
        const pick = () => [-1, 0, 0, 1][Math.floor(rnd() * 4)];
        d.intents[0] = { mx: pick(), my: pick(), mine: rnd() < 0.5, target: null };
        d.intents[1] = { mx: pick(), my: pick(), mine: rnd() < 0.5, target: null };
      }
      if (i % 200 === 100) d.host.send({ k: 'togglePickup', res: 'coal' });
      if (i % 300 === 150) d.guest.send({ k: 'togglePickup', res: 'coal' });
      d.frame();
      if (i % 61 === 0) await new Promise((r) => setTimeout(r, 0));
      if (d.host.tick === d.guest.tick && d.host.tick % 30 === 0) {
        checks++;
        if (stateDigest(d.hostG) !== stateDigest(d.guestG!)) mismatches++;
      }
    }
    expect(playing(d)).toBe(true);
    expect(checks).toBeGreaterThan(5);
    expect(mismatches).toBe(0);
    // Les réglages personnels de chacun sont les mêmes sur les deux appareils (à chaque emplacement).
    for (const slot of [0, 1]) {
      expect(d.hostG.withSlot(slot, () => d.hostG.autoPickup.coal)).toBe(d.guestG!.withSlot(slot, () => d.guestG!.autoPickup.coal));
      expect(d.hostG.withSlot(slot, () => d.hostG.hp)).toBe(d.guestG!.withSlot(slot, () => d.guestG!.hp));
    }
  });

  it('survit à des pertes de 15 %, des doublons et un réseau lent', async () => {
    const d = new Duel();
    d.link.loss = 0.15;
    d.link.dup = 0.1;
    d.link.latency = 120;
    d.link.jitter = 200;
    await d.runAsync(30000, () => playing(d));
    expect(playing(d)).toBe(true);
    let mism = 0;
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 90 === 0) d.intents[i % 180 === 0 ? 0 : 1] = { mx: i % 3 === 0 ? 1 : -1, my: 0, mine: true, target: null };
      d.frame();
      if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
      if (d.host.tick === d.guest.tick && d.host.tick % 60 === 0 && stateDigest(d.hostG) !== stateDigest(d.guestG!)) mism++;
    }
    expect(mism).toBe(0);
    expect(d.host.tick).toBeGreaterThan(600);
  });

  it('un instantané dont des morceaux se perdent est complété à la demande', async () => {
    const d = new Duel();
    // Une grosse partie : plusieurs morceaux.
    for (let i = 0; i < 400; i++) d.hostG.inventory.addKit(`conveyor@${i % 3}`, 1);
    d.link.loss = 0.4;
    await d.runAsync(40000, () => playing(d));
    expect(playing(d)).toBe(true);
    expect(d.link.sent.b.need ?? 0).toBeGreaterThan(0);
    expect(d.guestG!.playerCount).toBe(2);
    expect(await d.same()).toBe(true);
  });

  it('une version différente du jeu est refusée avec un message clair', async () => {
    const d = new Duel();
    d.link.b.send({ m: 'hello', v: PROTOCOL + 1, g: 'x', n: 'Z' });
    d.run(400);
    expect(d.host.status).toBe('waiting');
    expect(d.hostG.playerCount).toBe(1);
    expect(d.link.sent.a.bad).toBe(1);
  });

  it('une troisième personne trouve la partie complète', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    const got: Message[] = [];
    const prev = d.link.b.onMessage;
    d.link.b.onMessage = (m) => {
      got.push(m);
      prev?.(m);
    };
    d.link.b.send({ m: 'hello', v: PROTOCOL, g: 'intruse', n: 'Z' });
    d.run(400);
    expect(got.some((m) => m.m === 'full')).toBe(true);
    expect(d.hostG.playerCount).toBe(2);
    expect(d.hostG.guestIds[1]).toBe('amie');
  });

  it('sans réponse, l’invité abandonne après un moment avec un message', () => {
    const d = new Duel();
    d.link.cut = true;
    d.run(25000);
    expect(d.guest.status).toBe('lost');
    expect(d.guest.info.length).toBeGreaterThan(5);
    expect(d.host.status).toBe('waiting');
  });
});

describe('Session : départ, retour et resynchronisation', () => {
  it('quand l’invité s’en va, l’hôte garde ses affaires et reprend seul ; il les retrouve en revenant', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    // L'invité règle son ramassage et se déplace ; l'hôte ne touche à rien.
    d.guest.send({ k: 'togglePickup', res: 'coal' });
    d.intents[1] = { mx: -1, my: 0, mine: false, target: null };
    await d.runAsync(1500);
    d.intents[1] = STILL;
    await d.runAsync(500);
    expect(d.hostG.withSlot(1, () => d.hostG.autoPickup.coal)).toBe(false);
    expect(d.hostG.autoPickup.coal).toBe(true);
    const pos = d.hostG.withSlot(1, () => ({ x: d.hostG.player.x, y: d.hostG.player.y }));
    // Il quitte.
    d.guest.close();
    await d.runAsync(1500, () => d.host.status === 'waiting');
    expect(d.host.status).toBe('waiting');
    expect(d.hostG.playerCount).toBe(1);
    expect(d.host.linked).toBe(false);
    const t0 = d.hostG.time;
    d.run(1000);
    expect(d.hostG.time).toBeGreaterThan(t0);
    expect(d.hostG.guestStash.amie).toBeTruthy();
    // Il revient avec le même identifiant, sur un nouveau transport.
    d.link.b.closed = false;
    const guest2 = d.makeGuest('amie');
    let ok = false;
    for (let i = 0; i < 60 * 12 && !ok; i++) {
      d.link.now += 16;
      d.link.deliver();
      if (i % 3 === 0) {
        d.host.pump();
        guest2.pump();
      }
      d.host.advance(0.016, STILL);
      guest2.advance(0.016, STILL);
      await new Promise((r) => setTimeout(r, 0));
      ok = d.host.status === 'playing' && guest2.status === 'playing';
    }
    expect(ok).toBe(true);
    expect(d.guestG!.playerCount).toBe(2);
    expect(d.guestG!.withSlot(1, () => d.guestG!.autoPickup.coal)).toBe(false);
    expect(d.guestG!.withSlot(0, () => d.guestG!.autoPickup.coal)).toBe(true);
    const back = d.guestG!.withSlot(1, () => ({ x: d.guestG!.player.x, y: d.guestG!.player.y }));
    expect(back.x).toBeCloseTo(pos.x, 0);
    expect(back.y).toBeCloseTo(pos.y, 0);
    expect(d.hostG.guestStash.amie).toBeUndefined();
    guest2.close();
  });

  it('un silence prolongé de l’invité : l’hôte reprend seul, sans bloquer', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    d.link.cut = true;
    const before = d.host.tick;
    d.run(12000);
    expect(d.host.status).toBe('waiting');
    expect(d.host.linked).toBe(false);
    expect(d.guest.status).toBe('lost');
    expect(d.host.tick).toBe(0); // plus de lockstep
    expect(before).toBeGreaterThan(0);
    expect(d.hostG.playerCount).toBe(1);
  });

  it('une panne courte (3 s) est traversée sans resynchronisation', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    const epochs = d.adopted.host.length;
    await d.runAsync(2000);
    d.link.cut = true;
    d.run(3000);
    expect(d.host.stalled || d.guest.stalled).toBe(true);
    d.link.cut = false;
    await d.runAsync(6000, () => !d.host.stalled && !d.guest.stalled);
    await d.runAsync(2000);
    expect(playing(d)).toBe(true);
    expect(d.adopted.host.length).toBe(epochs);
    expect(await d.same()).toBe(true);
  });

  it('une divergence est détectée et l’hôte renvoie sa partie : les deux repartent d’un état commun', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    expect(playing(d)).toBe(true);
    await d.runAsync(1000);
    // On abîme la partie de l'invité : de l'argent en trop.
    d.guestG!.money += 12345;
    const n = d.adopted.guest.length;
    await d.runAsync(15000, () => d.adopted.guest.length > n && playing(d));
    expect(d.adopted.guest.length).toBeGreaterThan(n);
    expect(playing(d)).toBe(true);
    await d.runAsync(2500);
    expect(await d.same()).toBe(true);
    expect(d.guestG!.money).toBe(d.hostG.money);
    expect(d.guestG!.local).toBe(1);
  });

  it('close() prévient l’autre côté', async () => {
    const d = new Duel();
    await d.runAsync(8000, () => playing(d));
    d.host.close();
    d.run(500);
    expect(d.guest.status).toBe('lost');
    expect(d.guest.info).toMatch(/hôte/);
  });
});

describe('Session : rôles', () => {
  it('un invité ne peut pas être hôte : il ignore les présentations', () => {
    const d = new Duel();
    const r: SessionRole = d.guest.role;
    expect(r).toBe('guest');
    d.link.a.send({ m: 'hello', v: PROTOCOL, g: 'zzz', n: 'Z' });
    d.run(300);
    expect(d.guest.status).toBe('connecting');
  });
});
