/**
 * Le cycle de vie d'une partie à deux tel que le vit le joueur, et non session par session : chaque joueur a une application qui
 * ouvre une session (hôte : « Inviter un ami », invité : « Rejoindre »), la ferme, en rouvre une autre avec un nouveau code, se
 * recharge, reprend sa sauvegarde… pendant que le réseau coupe et ralentit au hasard. À la fin, le réseau est rétabli et les deux
 * joueurs font ce que fait quelqu'un à qui « ça ne marche plus » : l'hôte recrée l'invitation, l'invité rejoint avec le nouveau
 * code. Ça doit toujours marcher, quoi qu'il se soit passé avant (c'était le signalement : « il n'arrive plus à rejoindre le même
 * monde, même en annulant et en recréant l'invitation »).
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { mulberry32 } from '../src/core/rng';
import { releaseGuests } from '../src/net/guests';
import { Session, type SessionStatus } from '../src/net/session';
import { newGameCode, type Message, type Transport, type TransportStatus } from '../src/net/transport';
import { deserialize, serialize } from '../src/save/save';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { goTo } from './helpers';

const STILL: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };
const Y = SURFACE_ROWS + 14;

function hostGame(): GameState {
  const g = new GameState(9);
  g.money = 30000;
  g.pickaxeLevel = 2;
  g.stats.discovered = ['coal', 'copper', 'iron'];
  g.inventory.addKit('storage', 4);
  g.inventory.add('coal', 10);
  for (const x of [48, 50]) g.world.set(x, Y, 0);
  g.world.setDeposit(50, Y, 2, 80);
  goTo(g, 'workshop');
  g.hireWorker('picker');
  g.player.x = 52.5 * TILE;
  g.player.y = (Y + 0.5) * TILE;
  return g;
}

/** Un courtier MQTT très simplifié : un sujet par code, chaque message arrive chez tous les autres abonnés. */
class Hub {
  now = 0;
  private rnd = mulberry32(11);
  private queue: { at: number; to: End; msg: Message }[] = [];
  private topics = new Map<string, Set<End>>();
  connect(code: string): End {
    const e = new End(this, code);
    if (!this.topics.has(code)) this.topics.set(code, new Set());
    this.topics.get(code)!.add(e);
    return e;
  }
  drop(e: End): void {
    this.topics.get(e.code)?.delete(e);
  }
  publish(from: End, msg: Message): void {
    if (from.cutOut) return;
    for (const to of this.topics.get(from.code) ?? []) {
      if (to === from) continue;
      this.queue.push({ at: this.now + 40 + this.rnd() * 20 + from.lag + to.lag, to, msg: JSON.parse(JSON.stringify(msg)) });
    }
  }
  deliver(): void {
    const due = this.queue.filter((q) => q.at <= this.now).sort((a, b) => a.at - b.at);
    this.queue = this.queue.filter((q) => q.at > this.now);
    for (const q of due) if (!q.to.closed && !q.to.cutIn) q.to.onMessage?.(q.msg);
  }
}

class End implements Transport {
  onMessage: ((m: Message) => void) | null = null;
  onStatus: ((s: TransportStatus) => void) | null = null;
  closed = false;
  cutIn = false;
  cutOut = false;
  lag = 0;
  constructor(
    private readonly hub: Hub,
    readonly code: string,
  ) {}
  send(m: Message): void {
    if (!this.closed) this.hub.publish(this, m);
  }
  close(): void {
    this.closed = true;
    this.hub.drop(this);
  }
}

/** L'application d'un joueur, comme Game.ts : une partie, une session à la fois. */
class App {
  state: GameState | null;
  session: Session | null = null;
  code = '';
  end: End | null = null;
  status: SessionStatus | '' = '';
  /** Pannes de réseau de cet appareil. */
  cutUntil = 0;
  constructor(
    private readonly hub: Hub,
    readonly role: 'host' | 'guest',
    readonly guestId: string,
    state: GameState | null,
  ) {
    this.state = state;
  }
  open(code: string): void {
    this.close();
    this.code = code;
    const end = this.hub.connect(code);
    this.end = end;
    this.session = new Session({
      role: this.role,
      transport: end,
      code,
      guestId: this.role === 'guest' ? this.guestId : 'host',
      name: this.role === 'host' ? 'Hôte' : 'Invité',
      getState: () => this.state,
      adopt: (g) => {
        this.state = g;
      },
      onStatus: (s) => {
        this.status = s;
      },
      now: () => this.hub.now,
      autoPump: false,
    });
    if (this.role === 'host') this.session.attach(this.state!);
    this.status = this.session.status;
  }
  close(): void {
    const s = this.session;
    this.session = null;
    s?.close();
  }
}


interface Scenario {
  hub: Hub;
  host: App;
  guest: App;
  trace: string[];
  say: (t: string) => void;
  run: (ms: number, until?: () => boolean) => Promise<void>;
}

function makeScenario(): Scenario {
  const hub = new Hub();
  const host = new App(hub, 'host', 'hote', hostGame());
  const guest = new App(hub, 'guest', 'amie', null);
  const trace: string[] = [];
  const say = (t: string) => trace.push(`${(hub.now / 1000).toFixed(1).padStart(7)} s  ${t}`);
  let pumped = 0;
  const frame = () => {
    hub.now += 16;
    for (const a of [host, guest])
      if (a.end) {
        const cut = hub.now < a.cutUntil;
        a.end.cutIn = cut;
        a.end.cutOut = cut;
      }
    hub.deliver();
    if (hub.now - pumped >= 50) {
      pumped = hub.now;
      host.session?.pump();
      guest.session?.pump();
    }
    if (host.session) host.session.advance(0.016, STILL);
    else host.state?.update(0.016, [STILL]);
    guest.session?.advance(0.016, STILL);
  };
  const run = async (ms: number, until?: () => boolean) => {
    const end = hub.now + ms;
    let i = 0;
    while (hub.now < end) {
      frame();
      if (until?.()) return;
      if (++i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { hub, host, guest, trace, say, run };
}

const bothPlaying = (s: Scenario) =>
  s.host.session?.status === 'playing' && s.guest.session?.status === 'playing' && s.host.state?.playerCount === 2 && s.guest.state?.playerCount === 2;

async function scenario(seed: number, randomSeconds: number): Promise<{ ok: boolean; why: string; trace: string[] }> {
  const s = makeScenario();
  const { host, guest, hub, say } = s;
  const rnd = mulberry32(seed * 7919 + 13);
  const startHosting = () => {
    host.close();
    host.open(newGameCode());
    say(`HÔTE   Inviter un ami → code ${host.code}`);
  };
  const guestJoin = (code: string, why: string) => {
    guest.close();
    guest.state = null;
    guest.open(code);
    say(`INVITÉ ${why} → code ${code}`);
  };
  startHosting();
  guestJoin(host.code, 'rejoint');
  await s.run(6000, () => !!bothPlaying(s));
  say(`état : hôte=${host.session?.status} invité=${guest.session?.status}`);
  const previousCodes: string[] = [];
  const endAt = hub.now + randomSeconds * 1000;
  while (hub.now < endAt) {
    const pick = Math.floor(rnd() * 11);
    switch (pick) {
      case 0:
      case 1: {
        const d = 1000 + rnd() * 24000;
        guest.cutUntil = hub.now + d;
        say(`RÉSEAU coupure de l'invité pendant ${(d / 1000).toFixed(1)} s`);
        break;
      }
      case 2: {
        const d = 1000 + rnd() * 24000;
        host.cutUntil = hub.now + d;
        say(`RÉSEAU coupure de l'hôte pendant ${(d / 1000).toFixed(1)} s`);
        break;
      }
      case 3:
        if (guest.end) guest.end.lag = rnd() < 0.5 ? 0 : 150 + rnd() * 450;
        say(`RÉSEAU latence de l'invité ${Math.round(guest.end?.lag ?? 0)} ms`);
        break;
      case 4:
        if (guest.session) {
          guest.close();
          say('INVITÉ quitte (menu)');
        }
        break;
      case 5:
        if (host.session) guestJoin(rnd() < 0.15 && previousCodes.length ? previousCodes[previousCodes.length - 1] : host.code, 'rejoint');
        break;
      case 6:
        previousCodes.push(host.code);
        startHosting();
        break;
      case 7:
        if (host.session) {
          previousCodes.push(host.code);
          host.close();
          say('HÔTE   arrête la partie à deux');
        }
        break;
      case 8:
        if (host.session) guestJoin(host.code, 'recharge la page et rejoint');
        break;
      case 9: {
        // L'hôte quitte vers le menu puis reprend sa partie sauvegardée.
        const text = JSON.stringify(serialize(host.state!));
        previousCodes.push(host.code);
        host.close();
        host.state = deserialize(JSON.parse(text));
        releaseGuests(host.state);
        startHosting();
        say('HÔTE   quitte puis reprend sa partie sauvegardée');
        break;
      }
      default:
        break;
    }
    await s.run(1000 + rnd() * 5000);
  }
  say(`fin du hasard : hôte=${host.session?.status ?? '-'} invité=${guest.session?.status ?? '-'}`);
  // Le réseau est rétabli ; comme le joueur : l'hôte recrée l'invitation, l'invité rejoint avec le nouveau code.
  host.cutUntil = 0;
  guest.cutUntil = 0;
  if (host.end) host.end.lag = 0;
  if (guest.end) guest.end.lag = 0;
  await s.run(500);
  say('— réseau rétabli : l\'hôte recrée l\'invitation, l\'invité rejoint avec le nouveau code —');
  startHosting();
  guestJoin(host.code, 'rejoint');
  await s.run(45000, () => !!bothPlaying(s));
  const ok = !!bothPlaying(s);
  if (ok) {
    // Les deux avancent-ils vraiment ?
    const t0 = [host.session!.tick, guest.session!.tick];
    await s.run(3000);
    const t1 = [host.session!.tick, guest.session!.tick];
    if (!(t1[0] > t0[0] + 60 && t1[1] > t0[1] + 60)) {
      return { ok: false, why: `playing mais gelé (ticks ${t0} → ${t1})`, trace: s.trace };
    }
  }
  const why = ok
    ? ''
    : `hôte=${host.session?.status} (${host.session?.info ?? ''}) joueurs=${host.state?.playerCount} · invité=${guest.session?.status} (${guest.session?.info ?? ''}) joueurs=${guest.state?.playerCount}`;
  return { ok, why, trace: s.trace };
}

/** Nombre de scénarios au hasard (chacun joue ~2 minutes de jeu simulées). */
const SEEDS = 10;

describe('Session : cycle de vie vu par l’application (ouvrir, fermer, recréer l’invitation) au milieu de pannes au hasard', () => {
  it(
    'après des coupures, des départs, des retours, des invitations recréées et des rechargements, l’hôte qui recrée l’invitation et l’invité qui rejoint avec le nouveau code y arrivent toujours',
    { timeout: 300000 },
    async () => {
      const bad: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = await scenario(seed, 90);
        if (!r.ok) bad.push(`graine ${seed} : ${r.why}\n${r.trace.slice(-25).join('\n')}`);
      }
      expect(bad).toEqual([]);
    },
  );
});
