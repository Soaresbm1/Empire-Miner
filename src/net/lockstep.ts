/**
 * Jeu à deux en « lockstep » : les deux téléphones calculent exactement la même partie, pas de simulation après pas, et
 * n'échangent que ce que font les joueurs (leur intention à chaque pas, et leurs actions : acheter, poser, régler…).
 *
 * Chaque joueur écrit ses propres « images d'entrée » quelques pas à l'avance (`delay`, de quoi couvrir le temps que met
 * un message à traverser le réseau). Un pas ne s'exécute que lorsqu'on possède l'entrée des deux joueurs ; si celle de
 * l'autre n'est pas arrivée, on attend (« En attente de l'autre joueur »). Aucun octet de l'état de la partie ne circule :
 * c'est ce qui tient dans le relais gratuit, et ce qui garde les deux écrans identiques.
 *
 * Fiabilité par redondance, sans accusé de réception par message : chaque paquet répète toutes les entrées non vides
 * que l'autre n'a pas encore confirmées (`ack`) et annonce jusqu'à quel pas on a écrit (`up`) ; un pas sans entrée listée
 * est un pas « sans changement » (même intention, aucune action). Un paquet perdu, en double ou en retard n'est donc
 * jamais un problème : le suivant comble le trou.
 *
 * Ce module ne connaît ni le réseau ni la partie : `Hooks` fait le lien (appliquer une action, avancer d'un pas, calculer
 * l'empreinte).
 */
import type { PlayerIntent } from '../sim/GameState';
import { isSimAction, type SimAction } from '../sim/actions';

/** Pas entre deux contrôles d'empreinte (2 s de jeu). */
export const CHECK_EVERY = 120;
/** Avance d'écriture des entrées, en pas (≈ 133 ms) ; augmente si le réseau est lent. */
export const MIN_DELAY = 8;
/** Pas convenus vides au départ, identiques pour les deux joueurs. */
export const START_LEAD = 8;
export const MAX_DELAY = 30;
/** Au plus tant d'actions par pas (le reste attend le pas suivant) : un pair malveillant ne peut pas saturer. */
const MAX_ACTIONS_PER_FRAME = 24;

/** Intention d'un joueur sur le réseau : [mx, my, mine, ride, tx, ty] (tx = ty = -1 : pas de case visée). */
export type IntentWire = [number, number, number, number, number, number];
/** Une entrée non vide : [pas, intention ou 0 (inchangée), actions]. */
export type FrameWire = [number, IntentWire | 0, SimAction[]];

export interface Packet {
  t: 'f';
  /** Génération de la partie (augmente à chaque resynchronisation : les paquets d'avant sont ignorés). */
  e: number;
  /** Dernier pas écrit par l'émetteur. */
  up: number;
  /** Dernier pas de l'autre dont l'émetteur est sûr de tout avoir. */
  ack: number;
  fr: FrameWire[];
  /** Empreintes de contrôle : [pas, empreinte]. */
  d: [number, number][];
}

export interface Hooks {
  /** Applique une action pour le joueur `slot`. */
  act(slot: number, a: SimAction): void;
  /** Avance la simulation d'un pas avec l'intention de chaque joueur. */
  step(intents: PlayerIntent[]): void;
  /** Empreinte de l'état de la partie. */
  digest(): number;
}

export const toWire = (i: PlayerIntent): IntentWire => [i.mx, i.my, i.mine ? 1 : 0, i.ride ? 1 : 0, i.target ? i.target.tx : -1, i.target ? i.target.ty : -1];

export function fromWire(w: IntentWire): PlayerIntent {
  return { mx: w[0], my: w[1], mine: !!w[2], ride: !!w[3], target: w[4] >= 0 && w[5] >= 0 ? { tx: w[4], ty: w[5] } : null };
}

const sameWire = (a: IntentWire, b: IntentWire) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];

/** Une intention reçue du réseau, ramenée à des valeurs sûres. */
function cleanIntent(w: unknown): IntentWire | null {
  if (!Array.isArray(w) || w.length !== 6) return null;
  const n = w.map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  const c = (v: number) => Math.max(-1, Math.min(1, Math.round(v)));
  const tile = (v: number) => (v >= 0 && v < 100000 ? Math.floor(v) : -1);
  return [c(n[0]), c(n[1]), n[2] ? 1 : 0, n[3] ? 1 : 0, tile(n[4]), tile(n[5])];
}

const NEUTRAL: IntentWire = [0, 0, 0, 0, -1, -1];

export class Lockstep {
  /** Prochain pas à exécuter. */
  tick = 0;
  epoch = 0;
  /** Avance d'écriture actuelle (pas). */
  delay = MIN_DELAY;
  /** Pas manqués faute d'entrée de l'autre (pour adapter `delay`). */
  stalls = 0;
  private authored = -1;
  private theirHave = -1;
  private ackedByPeer = -1;
  /**
   * Mes entrées non vides : `mine` jusqu'à ce que l'autre les ait confirmées (on les renvoie tant qu'il ne l'a pas fait),
   * `own` jusqu'à leur exécution chez moi (je peux exécuter avant que l'autre ait reçu : les deux durées sont indépendantes).
   * Celles de l'autre, par numéro de pas, dans `theirs`.
   */
  private mine = new Map<number, { i: IntentWire | 0; c: SimAction[] }>();
  private own = new Map<number, { i: IntentWire | 0; c: SimAction[] }>();
  private theirs = new Map<number, { i: IntentWire | 0; c: SimAction[] }>();
  private pending: SimAction[] = [];
  private intent: IntentWire = NEUTRAL;
  private lastAuthored: IntentWire = NEUTRAL;
  /** Dernière intention exécutée de chaque joueur (reportée tant qu'aucune entrée ne la change). */
  private running: IntentWire[] = [NEUTRAL, NEUTRAL];
  private myDigests = new Map<number, number>();
  private theirDigests = new Map<number, number>();
  /** Pas où une divergence a été vue (une seule fois par génération). */
  desyncAt: number | null = null;

  constructor(
    /** Mon emplacement de joueur (0 : hôte). */
    readonly slot: number,
    private readonly hooks: Hooks,
  ) {}

  /**
   * Repart d'un état commun : pas `tick`, génération `epoch`. Les `START_LEAD` premiers pas sont convenus vides des deux
   * côtés (constante du protocole, pas l'avance d'écriture de chacun : elles peuvent différer).
   */
  reset(tick: number, epoch: number): void {
    this.tick = tick;
    this.epoch = epoch;
    this.authored = tick + START_LEAD - 1;
    this.theirHave = tick + START_LEAD - 1;
    this.ackedByPeer = tick + START_LEAD - 1;
    this.mine.clear();
    this.own.clear();
    this.theirs.clear();
    this.pending = [];
    this.lastAuthored = NEUTRAL;
    this.running = [NEUTRAL, NEUTRAL];
    this.myDigests.clear();
    this.theirDigests.clear();
    this.desyncAt = null;
    this.stalls = 0;
    this.author();
  }

  /** Mon intention actuelle (lue à chaque écriture d'une entrée). */
  setIntent(i: PlayerIntent): void {
    this.intent = toWire(i);
  }

  /** Une action de ce joueur : elle part avec la prochaine entrée écrite. */
  queueAction(a: SimAction): void {
    this.pending.push(a);
  }

  /** A-t-on tout ce qu'il faut pour exécuter le prochain pas ? */
  get ready(): boolean {
    return this.theirHave >= this.tick;
  }

  /** Pas d'avance de l'autre : combien de pas il peut encore faire sans nous. */
  get lead(): number {
    return this.theirHave - this.tick;
  }

  /** Exécute un pas si possible (renvoie vrai) ; sinon compte une attente. */
  step(): boolean {
    if (!this.ready) {
      this.stalls++;
      return false;
    }
    const t = this.tick;
    const mineF = this.own.get(t);
    const theirF = this.theirs.get(t);
    const peer = 1 - this.slot;
    const frames: ({ i: IntentWire | 0; c: SimAction[] } | undefined)[] = [];
    frames[this.slot] = mineF;
    frames[peer] = theirF;
    for (const slot of [0, 1]) {
      const f = frames[slot];
      if (f?.i) this.running[slot] = f.i;
      for (const a of f?.c ?? []) {
        try {
          this.hooks.act(slot, a);
        } catch (e) {
          console.error('Action refusée', a, e);
        }
      }
    }
    this.hooks.step([fromWire(this.running[0]), fromWire(this.running[1])]);
    this.tick = t + 1;
    this.theirs.delete(t);
    this.own.delete(t);
    if (this.tick % CHECK_EVERY === 0) {
      this.myDigests.set(this.tick, this.hooks.digest());
      this.compare(this.tick);
      for (const k of this.myDigests.keys()) if (k < this.tick - CHECK_EVERY * 6) this.myDigests.delete(k);
    }
    this.author();
    return true;
  }

  /** Écrit les entrées jusqu'à `delay` pas devant le pas courant. */
  author(): void {
    while (this.authored < this.tick + this.delay - 1) {
      const t = this.authored + 1;
      const changed = !sameWire(this.intent, this.lastAuthored);
      const c = this.pending.splice(0, MAX_ACTIONS_PER_FRAME);
      if (changed || c.length) {
        const f: { i: IntentWire | 0; c: SimAction[] } = { i: changed ? this.intent : 0, c };
        this.mine.set(t, f);
        this.own.set(t, f);
      }
      this.lastAuthored = this.intent;
      this.authored = t;
    }
  }

  /** Le paquet à envoyer à l'autre. */
  packet(): Packet {
    const fr: FrameWire[] = [];
    for (const [t, f] of this.mine) if (t > this.ackedByPeer) fr.push([t, f.i, f.c]);
    fr.sort((a, b) => a[0] - b[0]);
    const d: [number, number][] = [...this.myDigests].slice(-4);
    return { t: 'f', e: this.epoch, up: this.authored, ack: this.theirHave, fr, d };
  }

  /** Paquet reçu de l'autre : on retient ses entrées, jusqu'où il a écrit, ce qu'il a bien reçu de nous, ses empreintes. */
  receive(p: unknown): void {
    if (!p || typeof p !== 'object') return;
    const pk = p as Partial<Packet>;
    if (pk.t !== 'f' || pk.e !== this.epoch || !Array.isArray(pk.fr)) return;
    for (const f of pk.fr) {
      if (!Array.isArray(f) || f.length !== 3) continue;
      const t = Number(f[0]);
      if (!Number.isInteger(t) || t < this.tick || t > this.tick + MAX_DELAY * 4) continue;
      const acts = Array.isArray(f[2]) ? f[2].filter(isSimAction).slice(0, MAX_ACTIONS_PER_FRAME) : [];
      const i = f[1] === 0 ? 0 : cleanIntent(f[1]);
      this.theirs.set(t, { i: i ?? 0, c: acts });
    }
    const up = Number(pk.up);
    if (Number.isInteger(up) && up > this.theirHave && up < this.tick + MAX_DELAY * 4) this.theirHave = up;
    const ack = Number(pk.ack);
    if (Number.isInteger(ack) && ack > this.ackedByPeer) {
      this.ackedByPeer = ack;
      for (const t of this.mine.keys()) if (t <= ack) this.mine.delete(t);
    }
    if (Array.isArray(pk.d)) {
      for (const e of pk.d) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [tk, dg] = [Number(e[0]), Number(e[1])];
        if (!Number.isInteger(tk) || !Number.isFinite(dg)) continue;
        this.theirDigests.set(tk, dg);
        this.compare(tk);
      }
    }
  }

  private compare(tick: number): void {
    const mine = this.myDigests.get(tick);
    const theirs = this.theirDigests.get(tick);
    if (mine === undefined || theirs === undefined) return;
    this.theirDigests.delete(tick);
    if (mine !== theirs && this.desyncAt === null) this.desyncAt = tick;
  }

  /** Allonge l'avance d'écriture quand les attentes se répètent, la raccourcit quand tout va bien (appelé de temps en temps). */
  adapt(stallsSeen: number, calmSeconds: number): void {
    if (stallsSeen >= 3 && this.delay < MAX_DELAY) this.delay = Math.min(MAX_DELAY, this.delay + 3);
    else if (stallsSeen === 0 && calmSeconds >= 20 && this.delay > MIN_DELAY) this.delay = Math.max(MIN_DELAY, this.delay - 1);
  }
}
