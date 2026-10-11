import { describe, expect, it } from 'vitest';
import { SIM_DT, TILE } from '../src/core/constants';
import { mulberry32 } from '../src/core/rng';
import { stateDigest } from '../src/net/digest';
import { CHECK_EVERY, Lockstep, MAX_DELAY, MIN_DELAY, START_LEAD, type Packet } from '../src/net/lockstep';
import { deserialize, serialize } from '../src/save/save';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { applyAction, type SimAction } from '../src/sim/actions';
import { SURFACE_ROWS } from '../src/core/constants';
import { goTo } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 14;

/** Une partie de départ à deux, la même pour les deux appareils (comme après une synchronisation). */
function startText(): string {
  const g = new GameState(9);
  g.addPlayer();
  g.guestIds[1] = 'amie';
  g.money = 30000;
  g.pickaxeLevel = 2;
  g.stats.discovered = ['coal', 'copper', 'iron'];
  g.inventory.addKit('storage', 4);
  g.inventory.addKit('drill', 3);
  g.inventory.addKit('conveyor', 40);
  g.inventory.add('coal', 10);
  for (const x of [48, 50]) g.world.set(x, Y, 0);
  g.world.setDeposit(50, Y, 2, 80);
  g.world.setDeposit(48, Y, 1, 80);
  goTo(g, 'workshop');
  g.hireWorker('picker');
  g.hireWorker('refueler');
  g.withSlot(1, () => {
    g.player.x = 47.5 * TILE;
    g.player.y = (Y + 0.5) * TILE;
  });
  g.player.x = 52.5 * TILE;
  g.player.y = (Y + 0.5) * TILE;
  return JSON.stringify(serialize(g));
}

interface Net {
  latency: number;
  jitter: number;
  loss: number;
  dup: number;
}

/** Deux appareils simulés : horloge virtuelle, réseau avec délai, pertes, doublons et désordre. */
class Pair {
  readonly g: GameState[];
  readonly ls: Lockstep[];
  readonly acc = [0, 0];
  readonly lastSend = [0, 0];
  private inbox: { at: number; to: number; msg: Packet }[] = [];
  now = 0;
  down = false;
  private readonly rnd = mulberry32(99);
  private readonly intents: PlayerIntent[] = [
    { mx: 0, my: 0, mine: false, target: null },
    { mx: 0, my: 0, mine: false, target: null },
  ];

  constructor(
    text: string,
    readonly net: Net,
    tweak?: (g: GameState, i: number) => void,
  ) {
    this.g = [0, 1].map((i) => {
      const g = deserialize(JSON.parse(text));
      g.setLocal(i);
      tweak?.(g, i);
      return g;
    });
    this.ls = [0, 1].map((i) => {
      const g = this.g[i];
      const ls = new Lockstep(i, {
        act: (slot, a) => g.withSlot(slot, () => applyAction(g, a)),
        step: (intents) => g.update(SIM_DT, intents),
        digest: () => stateDigest(g),
      });
      ls.reset(0, 1);
      return ls;
    });
  }

  /** Une action que le joueur `i` fait au prochain moment possible. */
  do(i: number, a: SimAction): void {
    this.ls[i].queueAction(a);
  }

  setIntent(i: number, it: PlayerIntent): void {
    this.intents[i] = it;
  }

  private send(from: number, p: Packet): void {
    if (this.down) return;
    if (this.rnd() < this.net.loss) return;
    const copies = this.rnd() < this.net.dup ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      const delay = this.net.latency + (this.rnd() * 2 - 1) * this.net.jitter;
      this.inbox.push({ at: this.now + Math.max(0, delay), to: 1 - from, msg: JSON.parse(JSON.stringify(p)) });
    }
  }

  /** Avance l'horloge d'une image (1/60 s) pour les deux appareils. */
  frame(dt = 1 / 60): void {
    this.now += dt;
    this.inbox.sort((a, b) => a.at - b.at);
    while (this.inbox.length && this.inbox[0].at <= this.now) {
      const m = this.inbox.shift()!;
      this.ls[m.to].receive(m.msg);
    }
    for (const i of [0, 1]) {
      const ls = this.ls[i];
      ls.setIntent(this.intents[i]);
      this.acc[i] = Math.min(this.acc[i] + dt, 0.1);
      while (this.acc[i] >= SIM_DT) {
        if (!ls.step()) break;
        this.acc[i] -= SIM_DT;
      }
      if (this.now - this.lastSend[i] >= 0.05) {
        this.lastSend[i] = this.now;
        this.send(i, ls.packet());
      }
    }
  }

  run(seconds: number, each?: (t: number) => void): void {
    const n = Math.round(seconds * 60);
    for (let k = 0; k < n; k++) {
      this.frame();
      each?.(k);
    }
  }

  /** Les deux joueurs ont-ils exactement la même partie au même pas ? */
  sameNow(): boolean {
    return this.ls[0].tick === this.ls[1].tick && stateDigest(this.g[0]) === stateDigest(this.g[1]);
  }
}

const walk = (mx: number, my: number, mine = false): PlayerIntent => ({ mx, my, mine, target: mine ? { tx: 53, ty: Y } : null });

describe('lockstep : deux appareils, une seule partie', () => {
  const text = startText();

  it('réseau parfait : les parties restent identiques, intentions et actions des deux joueurs comprises', () => {
    const p = new Pair(text, { latency: 0.02, jitter: 0, loss: 0, dup: 0 });
    p.setIntent(0, walk(1, 0));
    p.setIntent(1, walk(0, 1, true));
    p.run(5);
    p.do(0, { k: 'togglePickup', res: 'iron' });
    p.do(1, { k: 'togglePickup', res: 'copper' });
    p.do(1, { k: 'place', kit: 'storage', x: 46, y: Y, dir: 1 });
    p.run(10);
    expect(p.ls[0].desyncAt).toBeNull();
    expect(p.ls[1].desyncAt).toBeNull();
    expect(p.ls[0].tick).toBeGreaterThan(500);
    // Les actions se sont appliquées pour le bon joueur, sur les deux appareils.
    expect(p.g[0].withSlot(1, () => p.g[0].autoPickup.copper)).toBe(false);
    expect(p.g[1].withSlot(1, () => p.g[1].autoPickup.copper)).toBe(false);
    expect(p.g[0].autoPickup.copper).toBe(true);
    expect(p.g[0].structures.at(46, Y)?.type).toBe('storage');
    expect(p.g[1].structures.at(46, Y)?.type).toBe('storage');
    expect(p.g[1].withSlot(0, () => p.g[1].autoPickup.iron)).toBe(false);
    // Au moins un contrôle d'empreinte a eu lieu et concordait.
    expect(p.ls[0].tick).toBeGreaterThan(CHECK_EVERY);
    p.run(1);
    expect(Math.abs(p.ls[0].tick - p.ls[1].tick)).toBeLessThanOrEqual(START_LEAD + 30);
  });

  it('réseau lent et peu fiable (130 ms ± 60, 15 % de pertes, doublons, désordre) : toujours identiques', () => {
    const p = new Pair(text, { latency: 0.13, jitter: 0.06, loss: 0.15, dup: 0.1 });
    let step = 0;
    p.run(40, (k) => {
      if (k % 90 === 0) {
        p.setIntent(0, walk([-1, 0, 1][step % 3], [0, 1, -1][(step + 1) % 3], step % 2 === 0));
        p.setIntent(1, walk([1, 0, -1][step % 3], [1, -1, 0][(step + 2) % 3], step % 3 === 0));
        step++;
      }
      if (k % 300 === 100) p.do(0, { k: 'sellAll' });
      if (k % 300 === 200) p.do(1, { k: 'buyKit', id: 'conveyor', qty: 2 });
    });
    expect(p.ls[0].desyncAt).toBeNull();
    expect(p.ls[1].desyncAt).toBeNull();
    // Le jeu avance malgré tout (pas bloqué) : au moins la moitié du temps demandé.
    expect(p.ls[0].tick).toBeGreaterThan(40 * 60 * 0.5);
    // On arrête les mouvements : les deux rattrapent le même pas et sont identiques.
    p.setIntent(0, walk(0, 0));
    p.setIntent(1, walk(0, 0));
    p.run(3);
    const lag = Math.abs(p.ls[0].tick - p.ls[1].tick);
    expect(lag).toBeLessThan(40);
    // Comparaison à pas égal : on avance le plus en retard jusqu'au pas de l'autre.
    p.net.latency = 0.01;
    p.net.loss = 0;
    p.net.jitter = 0;
    p.net.dup = 0;
    for (let k = 0; k < 600 && p.ls[0].tick !== p.ls[1].tick; k++) p.frame();
    expect(p.sameNow()).toBe(true);
  });

  it('une coupure de 3 secondes fait attendre les deux joueurs, puis tout reprend sans écart', () => {
    const p = new Pair(text, { latency: 0.05, jitter: 0.02, loss: 0, dup: 0 });
    p.setIntent(0, walk(1, 1, true));
    p.run(4);
    const before = p.ls[0].tick;
    p.down = true;
    p.run(3);
    // Coupés : on n'avance plus que de l'avance d'écriture.
    expect(p.ls[0].tick - before).toBeLessThanOrEqual(MIN_DELAY + START_LEAD + 12);
    p.down = false;
    p.run(6);
    expect(p.ls[0].tick - before).toBeGreaterThan(200);
    expect(p.ls[0].desyncAt).toBeNull();
    expect(p.ls[1].desyncAt).toBeNull();
    p.setIntent(0, walk(0, 0));
    p.run(3);
    for (let k = 0; k < 600 && p.ls[0].tick !== p.ls[1].tick; k++) p.frame();
    expect(p.sameNow()).toBe(true);
  });

  it('une divergence est vue au contrôle d’empreinte suivant (moins de 5 s)', () => {
    const p = new Pair(text, { latency: 0.03, jitter: 0, loss: 0, dup: 0 });
    p.run(3);
    expect(p.ls[0].desyncAt).toBeNull();
    p.g[1].money += 1; // un écart de plus
    let seen = -1;
    for (let k = 0; k < 600; k++) {
      p.frame();
      if (p.ls[0].desyncAt !== null || p.ls[1].desyncAt !== null) {
        seen = k;
        break;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(0);
    expect(seen).toBeLessThan(300);
  });

  it('les paquets mal formés ou d’une autre génération sont ignorés', () => {
    const p = new Pair(text, { latency: 0.02, jitter: 0, loss: 0, dup: 0 });
    const ls = p.ls[0];
    const tick = ls.tick;
    ls.receive(null);
    ls.receive('x');
    ls.receive({ t: 'f', e: 99, up: 99999, ack: 0, fr: [], d: [] });
    ls.receive({ t: 'f', e: 1, up: 'oups', ack: NaN, fr: [[1, 'a', 3], [2], 7], d: [['a', 'b'], 4] });
    ls.receive({ t: 'f', e: 1, up: tick + 3, ack: 0, fr: [[tick + 2, [9, 9, 1, 1, -5, 1e9], [{ k: 'rm -rf' }, 3, { k: 'sellAll' }]]], d: [] });
    expect(ls.tick).toBe(tick);
    p.run(2);
    expect(p.ls[0].desyncAt).toBeNull();
  });
});

describe('lockstep : avance d’écriture demandée à l’autre', () => {
  const make = () => {
    const ls = new Lockstep(0, { act: () => {}, step: () => {}, digest: () => 0 });
    ls.reset(0, 1);
    return ls;
  };
  const packet = (extra: Record<string, unknown> = {}) => ({ t: 'f', e: 1, up: START_LEAD - 1, ack: START_LEAD - 1, fr: [], d: [], ...extra });

  it('une attente de 100 ms fait demander à l’autre d’écrire plus loin devant, d’autant de pas (plus un de marge)', () => {
    const ls = make();
    expect(ls.ask).toBe(MIN_DELAY);
    ls.noteStall(100, 5000);
    expect(ls.ask).toBe(MIN_DELAY + Math.ceil(100 / (1000 / 60)) + 1);
    expect(ls.packet().dl).toBe(ls.ask);
  });

  it('une gigue très courte (< 40 ms) ou une vraie panne (> 1,5 s) ne comptent pas comme de la latence', () => {
    const ls = make();
    ls.noteStall(30, 5000);
    ls.noteStall(2000, 6000);
    ls.noteStall(8000, 9000);
    expect(ls.ask).toBe(MIN_DELAY);
  });

  it('une seule attente ne fait pas monter la demande de plus de 12 pas, et jamais au-delà du maximum', () => {
    const ls = make();
    ls.noteStall(1400, 5000);
    expect(ls.ask).toBe(MIN_DELAY + 12);
    let t = 5000;
    for (let i = 0; i < 20; i++) ls.noteStall(1400, (t += 1500));
    expect(ls.ask).toBe(MAX_DELAY);
  });

  it('une demande qui n’a pas encore eu le temps de faire effet n’est pas surenchérie', () => {
    const ls = make();
    ls.noteStall(200, 5000);
    const after = ls.ask;
    ls.noteStall(200, 5500);
    expect(ls.ask).toBe(after);
    ls.noteStall(200, 6100);
    expect(ls.ask).toBeGreaterThan(after);
  });

  it('après un calme de 20 s la demande redescend d’un pas toutes les 3 s, jusqu’au minimum', () => {
    const ls = make();
    ls.noteStall(300, 5000);
    const high = ls.ask;
    ls.relax(5000 + 19000);
    expect(ls.ask).toBe(high);
    ls.relax(5000 + 20000);
    expect(ls.ask).toBe(high - 1);
    ls.relax(5000 + 21000);
    expect(ls.ask).toBe(high - 1);
    ls.relax(5000 + 23000);
    expect(ls.ask).toBe(high - 2);
    for (let t = 5000 + 26000; t < 5000 + 200000; t += 3000) ls.relax(t);
    expect(ls.ask).toBe(MIN_DELAY);
  });

  it('l’avance d’écriture est celle que l’autre demande : bornée, et seulement si elle est valable', () => {
    const ls = make();
    ls.receive(packet({ dl: 20 }));
    expect(ls.delay).toBe(20);
    ls.receive(packet({ dl: 1 }));
    expect(ls.delay).toBe(MIN_DELAY);
    ls.receive(packet({ dl: 9999 }));
    expect(ls.delay).toBe(MAX_DELAY);
    ls.receive(packet({ dl: 'oups' }));
    ls.receive(packet({ dl: 12.5 }));
    expect(ls.delay).toBe(MAX_DELAY);
    ls.receive(packet({ e: 7, dl: 12 })); // une autre génération : ignorée
    expect(ls.delay).toBe(MAX_DELAY);
  });

  it('une avance demandée plus grande fait écrire plus de pas à l’avance', () => {
    const ls = make();
    const before = ls.packet().up;
    ls.receive(packet({ dl: 20 }));
    ls.author();
    expect(ls.packet().up).toBe(before + (20 - MIN_DELAY));
  });

  it('après une resynchronisation, le nouveau lockstep garde ce que l’ancien avait appris du réseau', () => {
    const a = make();
    a.noteStall(300, 5000);
    a.receive(packet({ dl: 22 }));
    const b = make();
    b.inherit(a);
    b.reset(0, 2);
    expect(b.ask).toBe(a.ask);
    expect(b.delay).toBe(22);
  });
});
