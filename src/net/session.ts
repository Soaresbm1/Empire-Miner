/**
 * Une partie à deux : l'hôte (emplacement 0) et un invité (emplacement 1).
 *
 *  - L'hôte joue sa partie ; tant que personne ne l'a rejointe, elle avance comme en solo (`waiting`).
 *  - L'invité se présente (`hello`, répété jusqu'à réponse). L'hôte fait entrer l'invité dans sa partie, écrit la sauvegarde,
 *    la recharge lui-même (pour partir exactement du même état que l'invité), puis l'envoie en morceaux. L'invité la charge.
 *    À partir de là, les deux calculent la partie en lockstep (voir lockstep.ts) : on n'échange plus que des entrées.
 *  - Toutes les 2 s, les deux comparent leur empreinte ; au moindre écart (ou si un côté le demande), l'hôte renvoie la partie.
 *  - Silence de plus de 8 s : l'hôte garde les affaires de l'invité de côté et reprend en solo ; l'invité cherche l'hôte (il
 *    renvoie `hello` toutes les 2 s) et la partie reprend toute seule s'il le retrouve, sinon il abandonne au bout d'une minute.
 *  - Chaque invité se présente avec un numéro d'instance (tiré au hasard à chaque ouverture de la page) : un `hello` ou un
 *    `bye` en retard, venu d'un courtier lent, ne recharge ni ne coupe une partie déjà en route.
 *  - Une synchronisation qui n'aboutit pas ne fige pas la partie de l'hôte pour toujours : au bout de 20 s il reprend seul (et
 *    laisse souffler son ami un instant avant de réessayer). Une erreur en préparant la partie est dite aux deux joueurs.
 *  - Une session fermée ne bouge plus : les retours asynchrones qui arrivent après (instantané déballé, message en retard) sont
 *    ignorés, au lieu de remplacer la partie ou l'écran de la session suivante.
 *
 * Le transport est « au mieux » : tout ce qui est ici tolère les messages perdus, répétés ou en retard.
 */
import { SIM_DT } from '../core/constants';
import { deserialize, serialize } from '../save/save';
import { applyAction, type SimAction } from '../sim/actions';
import { GameState, type PlayerIntent } from '../sim/GameState';
import { stateDigest } from './digest';
import { dropGuest, joinGuest } from './guests';
import { Lockstep, MIN_DELAY, START_LEAD } from './lockstep';
import { packSnapshot, unpackSnapshot } from './snapshot';
import { randomId, type Message, type Transport, type TransportStatus } from './transport';

/** Empreinte du code de simulation, calculée à la construction (vite.config.ts) ; absente hors de Vite. */
declare const __SIM_VERSION__: string | undefined;

/**
 * Version du protocole : deux appareils de versions différentes ne jouent pas ensemble. Le numéro change à la main quand le
 * format des messages change ; l'empreinte suit toute modification de la simulation, des données, de la sauvegarde ou du
 * réseau, sans qu'on ait à y penser (sinon un ami resté sur l'ancienne page jouerait une autre partie sans le savoir).
 */
export const PROTOCOL = `1-${typeof __SIM_VERSION__ === 'string' ? __SIM_VERSION__ : 'dev'}`;

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
  /** Un avis pour le joueur de cet appareil (l'hôte : « votre ami n'a pas la même version du jeu »…). */
  notice?: (text: string, kind: 'info' | 'warn' | 'bad') => void;
  /** Heure en ms (les tests fournissent la leur). */
  now?: () => number;
  /** Faux : l'appelant fait tourner `pump` lui-même (tests). */
  autoPump?: boolean;
}

/** Silence au bout duquel l'hôte reprend seul et l'invité se met à chercher l'hôte (ms). */
const SILENCE_MS = 8000;
/** L'invité cherche l'hôte pendant ce temps (depuis le dernier signe de vie) avant d'abandonner (ms). */
const GIVE_UP_MS = 60000;
/** Une attente de l'autre aussi longue, sans pouvoir avancer d'un pas, fait reprendre l'hôte seul (ms). */
const STALL_DROP_MS = 20000;
/** L'hôte renonce à une synchronisation qui dure plus que ça (ms) : sa partie, figée en attendant l'invité, reprend seule. */
const SYNC_TIMEOUT_MS = 20000;
/** Après un échec, l'hôte ignore les `hello` pendant ce temps, multiplié par le nombre d'échecs de suite (40 s au plus). */
const SYNC_PAUSE_MS = 6000;
/** L'invité renonce à recevoir la partie après ce temps (ms). */
const RECEIVE_TIMEOUT_MS = 60000;
/** L'invité qui ne voit plus arriver de nouveau morceau depuis ce temps se représente à l'hôte, puis toutes les 4 s (ms). */
const CHUNK_STALL_MS = 6000;
/** Morceaux de la partie envoyés à chaque entretien du réseau (toutes les 50 ms) tant que les relais ne sont pas encombrés. */
const SNAP_PER_PUMP = 4;
/** Un même avis n'est donné qu'une fois par ce temps (ms). */
const NOTICE_EVERY_MS = 15000;
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
  /** Invité : plus aucune nouvelle de l'hôte depuis un moment ; on le cherche (la partie reprendra toute seule). */
  reconnecting = false;
  /** Hôte : un invité était là et a perdu la connexion ; il peut revenir avec le même code. */
  dropped = false;
  /**
   * Pourquoi l'invité n'a pas pu entrer (ou a été perdu) : de quoi choisir le bon conseil à l'écran (« version », « complet »,
   * « trop lent », « hôte parti », « illisible », « perdu »), vide sinon.
   */
  failure: '' | 'version' | 'full' | 'slow' | 'left' | 'unreadable' | 'lost' | 'bad' = '';
  /** Journal des derniers événements (pour le diagnostic). */
  readonly log: string[] = [];
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
  private lastChunk = 0;
  private lastReady = 0;
  private lastDesync = 0;
  private stallSince = 0;
  /** L'attente en cours compte comme de la latence (pas l'attente des premiers pas, pendant que l'autre charge encore la partie). */
  private stallCounts = false;
  /** Début de la synchronisation en cours (hôte : de la préparation ; invité : du premier morceau reçu). */
  private syncSince = 0;
  /** Hôte : synchronisations qui ont échoué de suite, et jusqu'à quand les `hello` sont ignorés. */
  private syncFailures = 0;
  private refuseUntil = 0;
  /** Invité : dernière fois qu'on s'est représenté parce que plus aucun morceau n'arrivait ; début de la tentative de connexion. */
  private lastNudge = 0;
  private connectingSince = 0;
  private readonly noticeAt: Record<string, number> = {};
  /** Numéro de cette ouverture de la page (invité), et celui de l'invité actuel (hôte). */
  private readonly instance = randomId(8);
  private peerInstance = '';
  /** Plus grand numéro d'instantané reçu en entier (en cours de chargement ou chargé) : les morceaux en double sont ignorés. */
  private loadingId = 0;
  /** Le lockstep d'avant une coupure ou une resynchronisation : le réseau n'a pas changé, on garde ce qu'il a appris. */
  private prevLs: Lockstep | null = null;
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
    this.connectingSince = this.startedAt;
    this.lastHeard = this.startedAt;
    o.transport.onMessage = (m) => this.onMessage(m);
    o.transport.onStatus = (s) => {
      this.transportStatus = s;
      if (s === 'closed' && this.status !== 'closed' && this.status !== 'lost') this.setStatus('lost', 'Connexion fermée');
    };
    if (o.autoPump !== false) this.timer = setInterval(() => this.pump(), 50);
  }

  private setStatus(s: SessionStatus, info = ''): void {
    // Une session fermée ne bouge plus : un retour asynchrone qui arrive après la fermeture ne doit pas la ranimer.
    if (this.status === 'closed' && s !== 'closed') return;
    if (s === this.status && info === this.info) return;
    this.status = s;
    this.info = info;
    if (s === 'connecting') this.connectingSince = this.now();
    this.record(`état : ${s}${info ? ` (${info})` : ''}`);
    this.o.onStatus?.(s, info);
  }

  /** Une ligne au journal (les 40 dernières), avec l'heure en secondes depuis l'ouverture de la session. */
  private record(text: string): void {
    this.log.push(`${((this.now() - this.startedAt) / 1000).toFixed(1).padStart(6)} s  ${text}`);
    if (this.log.length > 40) this.log.shift();
  }

  /** Un avis pour le joueur, au plus une fois par `NOTICE_EVERY_MS` pour une même clé. */
  private notify(key: string, text: string, kind: 'info' | 'warn' | 'bad' = 'warn'): void {
    const t = this.now();
    if (t - (this.noticeAt[key] ?? -Infinity) < NOTICE_EVERY_MS) return;
    this.noticeAt[key] = t;
    this.record(`avis : ${text}`);
    this.o.notice?.(text, kind);
  }

  /** La session est fermée : elle ne réagit plus à rien (lu à part pour que TypeScript ne fige pas l'état d'avant un `await`). */
  private get closed(): boolean {
    return this.status === 'closed';
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
      this.stallSince = 0;
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
      if (!this.stallSince) {
        this.stallSince = t;
        this.stallCounts = this.status === 'playing' && this.ls.tick > START_LEAD + 30;
      }
      this.stalled = t - this.stallSince > 350;
    } else if (steps > 0) {
      // Une attente vient de finir : combien de temps l'autre était en retard, il devra écrire plus loin devant.
      if (this.stallSince && this.stallCounts) this.ls.noteStall(t - this.stallSince, t);
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
    // Tout va bien depuis longtemps : on redemande à l'autre un peu moins d'avance.
    if (this.ls) this.ls.relax(t);
    // Un désaccord d'empreinte : l'hôte renvoie la partie ; l'invité le demande.
    if (this.ls && this.ls.desyncAt !== null && this.status === 'playing') {
      if (this.role === 'host') {
        this.record(`empreintes différentes au pas ${this.ls.desyncAt} : je renvoie la partie`);
        void this.resync();
      } else if (t - this.lastDesync > 1000) {
        this.lastDesync = t;
        this.record(`empreintes différentes au pas ${this.ls.desyncAt} : je demande la partie à l’hôte`);
        this.o.transport.send({ m: 'desync', id: this.epoch });
      }
    }
  }

  private pumpHost(t: number): void {
    // Envoi des morceaux de l'instantané, quelques-uns à la fois, tant que les relais veulent bien les prendre (sinon on
    // reprend au même morceau à l'entretien suivant : rien ne se perd en route, l'invité n'a pas à tout redemander).
    const out = this.outgoing;
    if (out && out.next < out.chunks.length) {
      for (let k = 0; k < SNAP_PER_PUMP && out.next < out.chunks.length; k++) {
        if (!this.sendChunk(out, out.next)) break;
        out.next++;
      }
    }
    // Plus aucune nouvelle de l'invité : il est parti. Ou bien il écrit, mais la partie n'avance plus depuis trop longtemps.
    if ((this.status === 'playing' || this.status === 'syncing') && t - this.lastHeard > SILENCE_MS) this.dropPeer('Votre ami a perdu la connexion.');
    else if (this.status === 'playing' && this.stallSince && t - this.stallSince > STALL_DROP_MS) this.dropPeer('La partie à deux ne passe plus.');
    else if (this.status === 'syncing' && t - this.syncSince > SYNC_TIMEOUT_MS) this.giveUpSync(t);
  }

  /**
   * La partie n'a pas pu être envoyée à l'invité dans les temps (connexion trop lente, coupée, ou l'invité n'arrive pas à la
   * charger). La partie de l'hôte, figée pendant ce temps, reprend seule ; l'invité se représentera, mais pas tout de suite, pour
   * ne pas figer la partie de l'hôte en boucle.
   */
  private giveUpSync(t: number): void {
    this.syncFailures++;
    this.refuseUntil = t + Math.min(40000, SYNC_PAUSE_MS * this.syncFailures);
    this.dropPeer('La partie n’a pas pu être envoyée à votre ami.', false);
    this.notify(
      'sync',
      'La partie n’a pas pu être envoyée à votre ami (connexion trop lente ou coupée) : elle reprend sans lui. Il peut réessayer dans un instant.',
      'warn',
    );
  }

  private pumpGuest(t: number): void {
    if (this.status === 'connecting') {
      if (t - this.lastHello >= 1000) {
        this.lastHello = t;
        this.o.transport.send({ m: 'hello', v: PROTOCOL, g: this.o.guestId, n: this.o.name, k: this.instance });
      }
      if (this.transportStatus === 'closed') this.setStatus('lost', 'Impossible de se connecter');
      else if (t - this.connectingSince > 20000) {
        this.failure = 'lost';
        this.setStatus('lost', this.transportStatus === 'open' ? 'Aucune partie avec ce code (ou l’hôte n’est pas prêt).' : 'Aucun relais joignable : vérifiez la connexion.');
      }
    }
    const inc = this.incoming;
    if (inc && this.status === 'syncing') {
      // Plus aucun nouveau morceau : on se représente, l'hôte (qui a tout envoyé une fois) recommence l'envoi.
      if (t - this.lastChunk > CHUNK_STALL_MS && t - this.lastNudge > CHUNK_STALL_MS - 2000) {
        this.lastNudge = t;
        this.record(`plus de morceau depuis ${Math.round((t - this.lastChunk) / 1000)} s (${inc.got.size}/${inc.n}) : je me représente`);
        this.o.transport.send({ m: 'hello', v: PROTOCOL, g: this.o.guestId, n: this.o.name, k: this.instance });
      }
      if (t - this.syncSince > RECEIVE_TIMEOUT_MS) {
        this.incoming = null;
        this.failure = 'slow';
        this.setStatus('lost', 'La partie met trop de temps à arriver : la connexion est trop lente ou coupée.');
        return;
      }
    }
    // On réclame les morceaux manquants quand il n'en arrive plus (pas ceux qui sont encore en route : ils feraient des doublons).
    if (inc && t - this.lastNeed >= 400 && t - this.lastChunk >= 350) {
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
    if (this.status === 'playing' || this.status === 'syncing') {
      const quiet = t - this.lastHeard;
      this.reconnecting = quiet > SILENCE_MS;
      if (quiet > GIVE_UP_MS) {
        this.reconnecting = false;
        this.setStatus('lost', 'La connexion avec l’hôte est perdue.');
      } else if (this.reconnecting && t - this.lastHello >= 2000) {
        // L'hôte a peut-être repris seul : il nous fera revenir s'il nous entend (même instance : il ne confond pas avec un doublon).
        this.lastHello = t;
        this.o.transport.send({ m: 'hello', v: PROTOCOL, g: this.o.guestId, n: this.o.name, k: this.instance });
      }
    }
  }

  // ------------------------------------------------------------------ messages

  private onMessage(msg: Message): void {
    // Un message en retard qui arrive à une session fermée (le relais le livrait encore) ne doit rien changer.
    if (this.closed) return;
    const t = this.now();
    // Un `hello` n'est pas un signe de vie de l'invité actuel (c'est peut-être un autre, ou un message en retard) : voir onHello.
    if (msg.m !== 'hello') this.lastHeard = t;
    switch (msg.m) {
      case 'hello':
        if (this.role === 'host') this.onHello(msg, t);
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
          this.syncFailures = 0;
          this.setStatus('playing', this.peerName);
        }
        return;
      case 'desync':
        if (this.role === 'host' && Number(msg.id) === this.epoch && this.status === 'playing') {
          this.record('l’invité demande la partie (empreintes différentes) : je la renvoie');
          void this.resync();
        }
        return;
      case 'full':
        if (this.role === 'guest') {
          this.failure = 'full';
          this.setStatus('lost', 'La partie est déjà complète.');
        }
        return;
      case 'bad':
        if (this.role === 'guest') {
          const why = String(msg.why ?? 'Versions différentes : rechargez la page.');
          // Un hôte d'avant ces avis n'envoie pas de `kind` : on reconnaît alors son message de versions.
          this.failure = (msg.kind ? msg.kind === 'version' : /Versions différentes/.test(why)) ? 'version' : 'bad';
          this.setStatus('lost', why);
        }
        return;
      case 'bye':
        if (this.role === 'host') {
          // Un au revoir en retard, d'une visite précédente, ne coupe pas la partie d'aujourd'hui.
          if (this.peerId && (this.status === 'playing' || this.status === 'syncing') && (!msg.k || msg.k === this.peerInstance)) this.dropPeer('Votre ami a quitté la partie.');
        } else {
          this.failure = 'left';
          this.setStatus('lost', 'L’hôte a quitté la partie.');
        }
        return;
      case 'f':
        if (this.ls) {
          if (Number(msg.e) === this.epoch && this.status === 'syncing') {
            // Un paquet de jeu de la bonne génération : l'autre a chargé la partie et joue.
            if (this.role === 'guest') this.gotPacketThisEpoch = true;
            else {
              this.outgoing = null;
              this.syncFailures = 0;
            }
            this.setStatus('playing', this.role === 'host' ? this.peerName : '');
          }
          this.ls.receive(msg);
        }
        return;
    }
  }

  // ------------------------------------------------------------------ hôte : arrivée d'un invité, instantané

  private onHello(msg: Message, t: number): void {
    if (String(msg.v) !== PROTOCOL) {
      const theirs = String(msg.v ?? '?').slice(0, 24);
      this.o.transport.send({
        m: 'bad',
        kind: 'version',
        why: `Versions différentes du jeu (la vôtre : ${theirs} · celle de l’hôte : ${PROTOCOL}) : rechargez la page des deux côtés.`,
        v: PROTOCOL,
      });
      this.notify('version', `Votre ami n’a pas la même version du jeu que vous (la sienne : ${theirs} · la vôtre : ${PROTOCOL}). Rechargez la page, vous deux.`, 'bad');
      return;
    }
    const id = typeof msg.g === 'string' ? msg.g.slice(0, 40) : '';
    if (!id) return;
    const g = this.g ?? this.o.getState();
    if (!g) return;
    const current = g.presentSlots().find((s) => s !== 0);
    if (current !== undefined && g.guestIds[current] !== id && this.status !== 'waiting') {
      this.o.transport.send({ m: 'full' });
      this.notify('full', 'Quelqu’un d’autre essaie de rejoindre votre mine, mais elle est déjà occupée par un ami.', 'info');
      return;
    }
    const k = typeof msg.k === 'string' ? msg.k.slice(0, 16) : '';
    // Le même invité, de la même ouverture de page, alors que la partie est en route ou en chargement : un doublon, ou un
    // message en retard (courtier lent). Recharger la partie à chaque fois la ferait geler et sauter pour les deux.
    if ((this.status === 'syncing' || this.status === 'playing') && this.peerId === id && this.peerInstance === k) {
      this.lastHeard = t;
      // L'invité répète `hello` : il n'a encore rien reçu de la partie (il ne le dit plus dès qu'un morceau arrive). Si tout le
      // premier envoi s'est perdu, on le recommence ; sinon il attendrait en vain.
      const out = this.outgoing;
      if (this.status === 'syncing' && out && out.next >= out.chunks.length) out.next = 0;
      return;
    }
    // Une synchronisation vient d'échouer : on laisse souffler un instant (sinon la partie de l'hôte se figerait en boucle).
    if (t < this.refuseUntil) {
      this.record(`hello ignoré : pause de ${Math.ceil((this.refuseUntil - t) / 1000)} s après une synchronisation échouée`);
      return;
    }
    this.peerId = id;
    this.peerInstance = k;
    this.dropped = false;
    this.lastHeard = t;
    this.peerName = typeof msg.n === 'string' ? msg.n.slice(0, 24) : 'Ami';
    this.record(`${this.peerName} se présente (${id.slice(0, 6)}…, instance ${k || '?'})`);
    void this.beginSync(id, true);
  }

  /** Fait entrer l'invité (ou non, pour une simple resynchronisation), recharge la partie et l'envoie. */
  private async beginSync(guestId: string, join: boolean): Promise<void> {
    if (this.resyncing || this.closed) return;
    this.resyncing = true;
    try {
      const g = this.g ?? this.o.getState();
      if (!g) return;
      if (join && joinGuest(g, guestId) < 0) {
        this.o.transport.send({ m: 'full' });
        this.notify('full', 'Quelqu’un d’autre essaie de rejoindre votre mine, mais elle est déjà occupée par un ami.', 'info');
        return;
      }
      const text = JSON.stringify(serialize(g));
      const g2 = deserialize(JSON.parse(text));
      g2.setLocal(0);
      this.g = g2;
      this.o.adopt(g2);
      this.epoch += 1;
      this.startLockstep(0);
      this.acc = 0;
      this.gotPacketThisEpoch = false;
      this.syncSince = this.now();
      this.setStatus('syncing', this.peerName);
      const packed = await packSnapshot(text);
      // La session a pu être fermée pendant la compression : la partie ne part plus nulle part.
      if (this.closed) return;
      // Un autre instantané a pu partir entre-temps (l'invité s'est représenté) : on garde le dernier.
      this.outgoing = { id: this.epoch, z: packed.z, chunks: packed.chunks, next: 0 };
      this.record(`génération ${this.epoch} prête : ${(text.length / 1024).toFixed(0)} Ko, ${packed.chunks.length} morceau(x)`);
    } catch (e) {
      this.syncError(e);
    } finally {
      this.resyncing = false;
    }
  }

  /** Une erreur en préparant la partie : l'hôte reprend seul, et les deux joueurs savent pourquoi (au lieu d'attendre en vain). */
  private syncError(e: unknown): void {
    const why = e instanceof Error ? e.message : String(e);
    console.error('Jeu à deux : la partie n’a pas pu être préparée', e);
    this.record(`ERREUR en préparant la partie : ${why}`);
    this.o.transport.send({ m: 'bad', kind: 'host', why: `L’hôte n’a pas pu préparer la partie (${why.slice(0, 120)}).` });
    this.dropPeer('La partie n’a pas pu être préparée pour votre ami.', false);
    this.notify('error', `Impossible de faire entrer votre ami : ${why.slice(0, 120)}`, 'bad');
  }

  /** Envoie le morceau `i` ; faux si les relais sont encombrés (on réessaiera au prochain entretien). */
  private sendChunk(out: { id: number; z: boolean; chunks: string[] }, i: number): boolean {
    const msg = { m: 'snap', id: out.id, n: out.chunks.length, i, z: out.z ? 1 : 0, d: out.chunks[i], h: this.o.name };
    const t = this.o.transport;
    if (t.trySend) return t.trySend(msg);
    t.send(msg);
    return true;
  }

  private onNeed(msg: Message): void {
    const out = this.outgoing;
    if (!out || Number(msg.id) !== out.id || !Array.isArray(msg.miss)) return;
    for (const i of msg.miss.slice(0, 60)) {
      const k = Number(i);
      if (Number.isInteger(k) && k >= 0 && k < out.chunks.length && !this.sendChunk(out, k)) break;
    }
  }

  /** L'invité est parti (silence, au revoir) : on garde ses affaires de côté et on reprend seul. */
  private dropPeer(reason: string, say = true): void {
    this.record(`l'invité est lâché : ${reason}`);
    const g = this.g;
    if (g) for (const slot of g.presentSlots()) if (slot !== 0) dropGuest(g, slot);
    if (this.ls) this.prevLs = this.ls;
    this.ls = null;
    this.outgoing = null;
    this.peerId = '';
    this.peerInstance = '';
    this.peerName = '';
    this.stalled = false;
    this.stallSince = 0;
    this.acc = 0;
    this.dropped = true;
    // `say` faux : un avis plus complet suit (`notify`), inutile de le doubler par le message d'état.
    this.setStatus('waiting', say ? reason : '');
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
    // Déjà chargé, ou en cours de chargement : les morceaux renvoyés qui arrivent pendant ce temps (courtier lent, redemande) ne
    // doivent pas relancer un second chargement : l'invité repartirait du pas 0 pendant que l'hôte joue, et tout diverge.
    if (id <= this.epoch || id <= this.loadingId) return;
    if (typeof msg.h === 'string' && msg.h) this.peerName = msg.h.slice(0, 24);
    if (!this.incoming || this.incoming.id !== id) {
      this.incoming = { id, z: !!msg.z, n, got: new Map(), tick: 0 };
      this.syncSince = this.now();
      this.lastNudge = this.syncSince;
      this.record(`réception de la génération ${id} : ${n} morceau(x)`);
    }
    const inc = this.incoming;
    this.lastChunk = this.now();
    if (!inc.got.has(i)) inc.got.set(i, msg.d);
    this.setStatus('syncing', 'Réception de la partie…');
    if (inc.got.size === inc.n) void this.finishSnap(inc);
  }

  private async finishSnap(inc: NonNullable<Session['incoming']>): Promise<void> {
    if (this.incoming !== inc) return;
    this.incoming = null;
    this.loadingId = Math.max(this.loadingId, inc.id);
    try {
      const chunks: string[] = [];
      for (let k = 0; k < inc.n; k++) chunks.push(inc.got.get(k) ?? '');
      const text = await unpackSnapshot(inc.z, chunks);
      // La session a pu être fermée pendant le déballage : cette partie ne doit pas remplacer celle de la session suivante.
      if (this.closed) return;
      const g = deserialize(JSON.parse(text));
      g.setLocal(1);
      this.g = g;
      this.o.adopt(g);
      this.epoch = inc.id;
      this.startLockstep(1);
      this.acc = 0;
      this.gotPacketThisEpoch = false;
      this.readyId = this.epoch;
      this.lastReady = 0;
      this.setStatus('syncing', '');
    } catch (e) {
      console.error('Jeu à deux : la partie reçue est illisible', e);
      this.record(`ERREUR en chargeant la partie reçue : ${(e as Error).message}`);
      this.failure = 'unreadable';
      this.setStatus('lost', `Partie reçue illisible : ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ outils

  /** Un lockstep neuf pour la génération `epoch`, qui garde ce que l'ancien avait appris du réseau. */
  private startLockstep(slot: number): void {
    const old = this.ls ?? this.prevLs;
    const ls = this.makeLockstep(slot);
    if (old) ls.inherit(old);
    ls.reset(0, this.epoch);
    this.ls = ls;
    this.prevLs = null;
  }

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

  /** L'application revient au premier plan : le canal est-il encore vivant ? (L'autre a pu partir pendant ce temps.) */
  wake(): void {
    this.o.transport.wake?.();
  }

  /** Quitte la partie à deux proprement (l'autre en est averti). */
  close(): void {
    if (this.status !== 'closed') {
      try {
        this.o.transport.send({ m: 'bye', k: this.instance });
      } catch {
        /* déjà fermé */
      }
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus('closed', '');
    this.o.transport.close();
  }

  /** Relais joignables, sur le total (null si le canal n'en a pas : essais en local). */
  get relays(): { open: number; total: number } | null {
    return this.o.transport.relays?.() ?? null;
  }

  /** Réception de la partie en cours (invité) : morceaux reçus sur le total ; null sinon. */
  get progress(): { done: number; total: number } | null {
    const inc = this.incoming;
    return inc ? { done: inc.got.size, total: inc.n } : null;
  }

  /** Un texte à copier-coller pour dire ce qui se passe : version, état, relais, journal des dernières minutes. */
  diagnostic(): string {
    const t = this.now();
    const head = [
      `Version du jeu à deux : ${PROTOCOL}`,
      `${this.role === 'host' ? 'Hôte' : 'Invité'} · code ${this.code} · état : ${this.status}${this.info ? ` (${this.info})` : ''}`,
      `${this.reconnecting ? 'reconnexion en cours · ' : ''}${this.dropped ? 'ami hors ligne · ' : ''}${this.stalled ? 'en attente de l’autre · ' : ''}pas ${this.tick} · génération ${this.epoch} · avance ${this.delay}/${this.ask}`,
      `Dernier message reçu il y a ${((t - this.lastHeard) / 1000).toFixed(1)} s`,
    ];
    const relays = this.o.transport.report?.() ?? [];
    return [...head, ...(relays.length ? ['Relais :', ...relays.map((l) => `  ${l}`)] : []), 'Journal :', ...this.log.map((l) => `  ${l}`)].join('\n');
  }

  /** Avance d'écriture actuelle (pas) : pour l'affichage de la qualité de la liaison. */
  get delay(): number {
    return this.ls?.delay ?? MIN_DELAY;
  }

  /** Avance d'écriture que cet appareil demande à l'autre (pas) : monte quand il attend souvent. */
  get ask(): number {
    return this.ls?.ask ?? MIN_DELAY;
  }
}
