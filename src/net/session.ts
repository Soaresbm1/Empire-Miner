/**
 * Une partie à deux : l'hôte (emplacement 0) et un invité (emplacement 1).
 *
 *  - L'hôte joue sa partie ; tant que personne ne l'a rejointe, elle avance comme en solo (`waiting`).
 *  - L'invité se présente (`hello`, répété jusqu'à réponse). L'hôte fait entrer l'invité dans sa partie, écrit la sauvegarde,
 *    la recharge lui-même (pour partir exactement du même état que l'invité), puis l'envoie en morceaux. L'invité la charge.
 *    À partir de là, les deux calculent la partie en lockstep (voir lockstep.ts) : on n'échange plus que des entrées.
 *  - Toutes les 2 s, les deux comparent leur empreinte ; au moindre écart (ou si un côté le demande), l'hôte renvoie la partie.
 *  - Silence de plus de 8 s : l'invité abandonne ; l'hôte garde les affaires de l'invité de côté et reprend en solo.
 *
 * Le transport est « au mieux » : tout ce qui est ici tolère les messages perdus, répétés ou en retard.
 */
import { SIM_DT } from '../core/constants';
import { deserialize, serialize } from '../save/save';
import { applyAction, type SimAction } from '../sim/actions';
import { GameState, type PlayerIntent } from '../sim/GameState';
import { stateDigest } from './digest';
import { dropGuest, joinGuest } from './guests';
import { Lockstep, MIN_DELAY } from './lockstep';
import { packSnapshot, unpackSnapshot } from './snapshot';
import type { Message, Transport, TransportStatus } from './transport';

/** Version du protocole : deux appareils de versions différentes ne jouent pas ensemble. */
export const PROTOCOL = 1;

export type SessionRole = 'host' | 'guest';
export type SessionStatus = 'connecting' | 'waiting' | 'syncing' | 'playing' | 'lost' | 'closed';

export interface SessionOptions {
  role: SessionRole;
  transport: Transport;
  code: string;
  /** Identifiant d'invité (stable d'une visite à l'autre : il retrouve ses affaires) ; nom affiché. */
  guestId: string;
  name: string;
  /** La partie de l'hôte, pour y faire entrer l'invité et en tirer l'instantané. */
  getState: () => GameState | null;
  /** Une nouvelle partie à adopter : celle de l'hôte rechargée, ou celle reçue par l'invité. */
  adopt: (g: GameState) => void;
  onStatus?: (s: SessionStatus, info: string) => void;
  /** Heure en ms (les tests fournissent la leur). */
  now?: () => number;
  /** Faux : l'appelant fait tourner `pump` lui-même (tests). */
  autoPump?: boolean;
}

/** Silence au bout duquel on considère l'autre perdu (ms). */
const SILENCE_MS = 8000;
/** Intervalle entre deux paquets de jeu (ms). */
const PACKET_EVERY = 66;
/** Au plus tant de pas de simulation par image. */
const MAX_STEPS = 12;

export class Session {
  readonly role: SessionRole;
  readonly code: string;
  status: SessionStatus;
  info = '';
  /** Nom de l'autre joueur. */
  peerName = '';
  /** Vrai quand on attend l'autre depuis un instant (au moins 0,35 s sans pouvoir avancer). */
  stalled = false;
  /** Pas exécutés avec les deux joueurs (pour les essais). */
  private g: GameState | null = null;
  private ls: Lockstep | null = null;
  private epoch = 0;
  private acc = 0;
  private peerId = '';
  private lastHeard = 0;
  private lastSent = 0;
  private lastHello = 0;
  private lastNeed = 0;
  private lastReady = 0;
  private lastDesync = 0;
  private stallSince = 0;
  private stallEpisodes: number[] = [];
  private readyId = -1;
  private gotPacketThisEpoch = false;
  private startedAt = 0;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private transportStatus: TransportStatus = 'connecting';
  /** Instantané en cours d'envoi (hôte). */
  private outgoing: { id: number; z: boolean; chunks: string[]; next: number } | null = null;
  /** Instantané en cours de réception (invité). */
  private incoming: { id: number; z: boolean; n: number; got: Map<number, string>; tick: number } | null = null;
  private resyncing = false;

  constructor(private readonly o: SessionOptions) {
    this.role = o.role;
    this.code = o.code;
    this.now = o.now ?? (() => performance.now());
    this.status = o.role === 'host' ? 'waiting' : 'connecting';
    this.startedAt = this.now();
    this.lastHeard = this.startedAt;
    o.transport.onMessage = (m) => this.onMessage(m);
    o.transport.onStatus = (s) => {
      this.transportStatus = s;
      if (s === 'closed' && this.status !== 'closed' && this.status !== 'lost') this.setStatus('lost', 'Connexion fermée');
    };
    if (o.autoPump !== false) this.timer = setInterval(() => this.pump(), 50);
  }

  private setStatus(s: SessionStatus, info = ''): void {
    if (s === this.status && info === this.info) return;
    this.status = s;
    this.info = info;
    this.o.onStatus?.(s, info);
  }

  /** La partie que l'on joue en ce moment. */
  get state(): GameState | null {
    return this.g;
  }

  /** Mode lockstep en cours (sinon : l'hôte avance seul, comme en solo). */
  get linked(): boolean {
    return this.ls !== null;
  }

  /** Un invité est connecté et la partie à deux tourne. */
  get playing(): boolean {
    return this.status === 'playing';
  }

  /** Avance d'attente de l'autre en pas (pour l'indicateur de connexion). */
  get lead(): number {
    return this.ls ? this.ls.lead : 0;
  }

  /** Les deux téléphones en sont au même numéro de pas (outil d'essai). */
  get tick(): number {
    return this.ls?.tick ?? 0;
  }

  /** Le jeu (hôte) donne l'état de départ de la session (partie déjà en cours, avant l'arrivée de l'invité). */
  attach(g: GameState): void {
    this.g = g;
  }

  // ------------------------------------------------------------------ actions et pas

  /** Une action du joueur de cet appareil. */
  send(a: SimAction): void {
    if (this.ls) this.ls.queueAction(a);
    else if (this.g) applyAction(this.g, a);
  }

  /**
   * Avance la partie d'une image d'horloge (`dt` secondes réelles) avec l'intention du joueur de cet appareil.
   * Renvoie le nombre de pas exécutés.
   */
  advance(dt: number, intent: PlayerIntent): number {
    const g = this.g;
    if (!g) return 0;
    this.acc = Math.min(this.acc + Math.min(dt, 0.1), 0.15);
    let steps = 0;
    if (!this.ls) {
      // L'hôte seul : la partie avance comme en solo.
      while (this.acc >= SIM_DT && steps < MAX_STEPS) {
        g.update(SIM_DT, [intent]);
        this.acc -= SIM_DT;
        steps++;
      }
      this.stalled = false;
      return steps;
    }
    this.ls.setIntent(intent);
    while (this.acc >= SIM_DT && steps < MAX_STEPS) {
      if (!this.ls.step()) break;
      this.acc -= SIM_DT;
      steps++;
    }
    const waiting = steps === 0 && this.acc >= SIM_DT;
    const t = this.now();
    if (waiting) {
      if (!this.stallSince) this.stallSince = t;
      const wasStalled = this.stalled;
      this.stalled = t - this.stallSince > 350;
      if (this.stalled && !wasStalled) this.stallEpisodes.push(t);
    } else if (steps > 0) {
      this.stallSince = 0;
      this.stalled = false;
    }
    if (this.acc >= SIM_DT && steps > 0) this.acc = Math.min(this.acc, SIM_DT * 2);
    return steps;
  }

  // ------------------------------------------------------------------ boucle réseau (toutes les 50 ms)

  /** Entretien du réseau : paquets de jeu, présentations, morceaux d'instantané, silences. */
  pump(): void {
    const t = this.now();
    if (this.status === 'closed' || this.status === 'lost') return;
    if (this.role === 'guest') this.pumpGuest(t);
    else this.pumpHost(t);
    if (this.ls && (this.status === 'playing' || this.status === 'syncing') && t - this.lastSent >= PACKET_EVERY) {
      this.lastSent = t;
      this.o.transport.send({ m: 'f', ...this.ls.packet() });
    }
    // Entrées trop souvent en retard : on s'écrit plus loin devant. Tout va bien depuis longtemps : on raccourcit.
    if (this.ls) {
      this.stallEpisodes = this.stallEpisodes.filter((s) => t - s < 8000);
      const calm = this.stallEpisodes.length ? (t - this.stallEpisodes[this.stallEpisodes.length - 1]) / 1000 : 99;
      this.ls.adapt(this.stallEpisodes.length, calm);
      if (this.stallEpisodes.length >= 3) this.stallEpisodes = [];
    }
    // Un désaccord d'empreinte : l'hôte renvoie la partie ; l'invité le demande.
    if (this.ls && this.ls.desyncAt !== null && this.status === 'playing') {
      if (this.role === 'host') void this.resync();
      else if (t - this.lastDesync > 1000) {
        this.lastDesync = t;
        this.o.transport.send({ m: 'desync', id: this.epoch });
      }
    }
  }

  private pumpHost(t: number): void {
    // Envoi des morceaux de l'instantané, quelques-uns à la fois.
    const out = this.outgoing;
    if (out && out.next < out.chunks.length) {
      for (let k = 0; k < 6 && out.next < out.chunks.length; k++) this.sendChunk(out, out.next++);
    }
    // Plus aucune nouvelle de l'invité : il est parti.
    if ((this.status === 'playing' || this.status === 'syncing') && t - this.lastHeard > SILENCE_MS) this.dropPeer('Votre ami a perdu la connexion.');
  }

  private pumpGuest(t: number): void {
    if (this.status === 'connecting') {
      if (t - this.lastHello >= 1000) {
        this.lastHello = t;
        this.o.transport.send({ m: 'hello', v: PROTOCOL, g: this.o.guestId, n: this.o.name });
      }
      if (this.transportStatus === 'closed') this.setStatus('lost', 'Impossible de se connecter');
      else if (t - this.startedAt > 20000) this.setStatus('lost', this.transportStatus === 'open' ? 'Aucune partie avec ce code (ou l’hôte n’est pas prêt).' : 'Aucun relais joignable : vérifiez la connexion.');
    }
    const inc = this.incoming;
    if (inc && t - this.lastNeed >= 300) {
      this.lastNeed = t;
      const miss: number[] = [];
      for (let i = 0; i < inc.n && miss.length < 60; i++) if (!inc.got.has(i)) miss.push(i);
      if (miss.length) this.o.transport.send({ m: 'need', id: inc.id, miss });
    }
    // Chargé : on le dit à l'hôte jusqu'à recevoir ses premiers paquets de jeu.
    if (this.readyId === this.epoch && !this.gotPacketThisEpoch && t - this.lastReady >= 250) {
      this.lastReady = t;
      this.o.transport.send({ m: 'ready', id: this.epoch });
    }
    if ((this.status === 'playing' || this.status === 'syncing') && t - this.lastHeard > SILENCE_MS) this.setStatus('lost', 'La connexion avec l’hôte est perdue.');
  }

  // ------------------------------------------------------------------ messages

  private onMessage(msg: Message): void {
    const t = this.now();
    this.lastHeard = t;
    switch (msg.m) {
      case 'hello':
        if (this.role === 'host') this.onHello(msg);
        return;
      case 'snap':
        if (this.role === 'guest') this.onSnap(msg);
        return;
      case 'need':
        if (this.role === 'host') this.onNeed(msg);
        return;
      case 'ready':
        if (this.role === 'host' && Number(msg.id) === this.epoch && this.status === 'syncing') {
          this.outgoing = null;
          this.setStatus('playing', this.peerName);
        }
        return;
      case 'desync':
        if (this.role === 'host' && Number(msg.id) === this.epoch && this.status === 'playing') void this.resync();
        return;
      case 'full':
        if (this.role === 'guest') this.setStatus('lost', 'La partie est déjà complète.');
        return;
      case 'bad':
        if (this.role === 'guest') this.setStatus('lost', String(msg.why ?? 'Versions différentes : rechargez la page.'));
        return;
      case 'bye':
        if (this.role === 'host') this.dropPeer('Votre ami a quitté la partie.');
        else this.setStatus('lost', 'L’hôte a quitté la partie.');
        return;
      case 'f':
        if (this.ls) {
          if (Number(msg.e) === this.epoch && this.status === 'syncing') {
            // Un paquet de jeu de la bonne génération : l'autre a chargé la partie et joue.
            if (this.role === 'guest') this.gotPacketThisEpoch = true;
            else this.outgoing = null;
            this.setStatus('playing', this.role === 'host' ? this.peerName : '');
          }
          this.ls.receive(msg);
        }
        return;
    }
  }

  // ------------------------------------------------------------------ hôte : arrivée d'un invité, instantané

  private onHello(msg: Message): void {
    if (Number(msg.v) !== PROTOCOL) {
      this.o.transport.send({ m: 'bad', why: 'Versions différentes du jeu : rechargez la page des deux côtés.' });
      return;
    }
    const id = typeof msg.g === 'string' ? msg.g.slice(0, 40) : '';
    if (!id) return;
    const g = this.g ?? this.o.getState();
    if (!g) return;
    const current = g.presentSlots().find((s) => s !== 0);
    if (current !== undefined && g.guestIds[current] !== id && this.status !== 'waiting') {
      this.o.transport.send({ m: 'full' });
      return;
    }
    // Un invité qui se représente alors que sa chargement est déjà en route : on ne recommence pas.
    if (this.status === 'syncing' && this.outgoing && this.peerId === id) return;
    this.peerId = id;
    this.peerName = typeof msg.n === 'string' ? msg.n.slice(0, 24) : 'Ami';
    void this.beginSync(id, true);
  }

  /** Fait entrer l'invité (ou non, pour une simple resynchronisation), recharge la partie et l'envoie. */
  private async beginSync(guestId: string, join: boolean): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      const g = this.g ?? this.o.getState();
      if (!g) return;
      if (join && joinGuest(g, guestId) < 0) {
        this.o.transport.send({ m: 'full' });
        return;
      }
      const text = JSON.stringify(serialize(g));
      const g2 = deserialize(JSON.parse(text));
      g2.setLocal(0);
      this.g = g2;
      this.o.adopt(g2);
      this.epoch += 1;
      this.ls = this.makeLockstep(0);
      this.ls.reset(0, this.epoch);
      this.acc = 0;
      this.gotPacketThisEpoch = false;
      this.setStatus('syncing', this.peerName);
      const packed = await packSnapshot(text);
      // Un autre instantané a pu partir entre-temps (l'invité s'est représenté) : on garde le dernier.
      this.outgoing = { id: this.epoch, z: packed.z, chunks: packed.chunks, next: 0 };
    } finally {
      this.resyncing = false;
    }
  }

  private sendChunk(out: { id: number; z: boolean; chunks: string[] }, i: number): void {
    this.o.transport.send({ m: 'snap', id: out.id, n: out.chunks.length, i, z: out.z ? 1 : 0, d: out.chunks[i] });
  }

  private onNeed(msg: Message): void {
    const out = this.outgoing;
    if (!out || Number(msg.id) !== out.id || !Array.isArray(msg.miss)) return;
    for (const i of msg.miss.slice(0, 60)) {
      const k = Number(i);
      if (Number.isInteger(k) && k >= 0 && k < out.chunks.length) this.sendChunk(out, k);
    }
  }

  /** L'invité est parti (silence, au revoir) : on garde ses affaires de côté et on reprend seul. */
  private dropPeer(reason: string): void {
    const g = this.g;
    if (g) for (const slot of g.presentSlots()) if (slot !== 0) dropGuest(g, slot);
    this.ls = null;
    this.outgoing = null;
    this.peerId = '';
    this.peerName = '';
    this.stalled = false;
    this.acc = 0;
    this.setStatus('waiting', reason);
  }

  /** Les deux parties ont divergé : on part d'un état commun, celui de l'hôte. */
  private async resync(): Promise<void> {
    if (this.role !== 'host' || this.resyncing || !this.peerId) return;
    await this.beginSync(this.peerId, false);
  }

  // ------------------------------------------------------------------ invité : réception de l'instantané

  private onSnap(msg: Message): void {
    const id = Number(msg.id);
    const n = Number(msg.n);
    const i = Number(msg.i);
    if (!Number.isInteger(id) || !Number.isInteger(n) || !Number.isInteger(i) || n < 1 || n > 4000 || i < 0 || i >= n || typeof msg.d !== 'string') return;
    if (id <= this.epoch) return; // déjà chargé
    if (!this.incoming || this.incoming.id !== id) this.incoming = { id, z: !!msg.z, n, got: new Map(), tick: 0 };
    const inc = this.incoming;
    if (!inc.got.has(i)) inc.got.set(i, msg.d);
    this.setStatus('syncing', 'Réception de la partie…');
    if (inc.got.size === inc.n) void this.finishSnap(inc);
  }

  private async finishSnap(inc: NonNullable<Session['incoming']>): Promise<void> {
    if (this.incoming !== inc) return;
    this.incoming = null;
    try {
      const chunks: string[] = [];
      for (let k = 0; k < inc.n; k++) chunks.push(inc.got.get(k) ?? '');
      const text = await unpackSnapshot(inc.z, chunks);
      const g = deserialize(JSON.parse(text));
      g.setLocal(1);
      this.g = g;
      this.o.adopt(g);
      this.epoch = inc.id;
      this.ls = this.makeLockstep(1);
      this.ls.reset(0, this.epoch);
      this.acc = 0;
      this.gotPacketThisEpoch = false;
      this.readyId = this.epoch;
      this.lastReady = 0;
      this.setStatus('syncing', '');
    } catch (e) {
      this.setStatus('lost', `Partie reçue illisible : ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ outils

  private makeLockstep(slot: number): Lockstep {
    return new Lockstep(slot, {
      act: (s, a) => {
        const g = this.g;
        if (g) g.withSlot(s, () => applyAction(g, a));
      },
      step: (intents) => this.g?.update(SIM_DT, intents),
      digest: () => (this.g ? stateDigest(this.g) : 0),
    });
  }

  /** Quitte la partie à deux proprement (l'autre en est averti). */
  close(): void {
    if (this.status !== 'closed') {
      try {
        this.o.transport.send({ m: 'bye' });
      } catch {
        /* déjà fermé */
      }
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus('closed', '');
    this.o.transport.close();
  }

  /** Avance d'écriture actuelle (pas) : pour l'affichage de la qualité de la liaison. */
  get delay(): number {
    return this.ls?.delay ?? MIN_DELAY;
  }
}
