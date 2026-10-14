/**
 * Débit d'une structure : ce qu'elle a produit ou fait passer pendant la dernière minute, et comment elle a passé son temps
 * (en marche, bloquée, à sec).
 *
 * Ces chiffres ne servent qu'à l'affichage (infobulles, panneaux, vue « goulots »). Aucune règle du jeu ne les lit, rien
 * n'est sauvegardé ni envoyé à l'autre joueur : chaque appareil les calcule en suivant les pas de la simulation, donc ils
 * concordent, mais un chargement ou une resynchronisation les remet à zéro (ils se remplissent en une dizaine de secondes).
 *
 * La minute est un anneau de 12 tranches de 5 s : avancer écrase la plus ancienne. Le temps vient des pas de simulation
 * (`StructureManager` relève l'état des structures toutes les 0,05 s), jamais de l'horloge de la machine, donc la pause et les
 * vitesses ×2 / ×4 comptent comme il faut.
 */
import type { Structure } from './structures/Structure';

/** Durée mesurée (s) et nombre de tranches. */
export const FLOW_WINDOW = 60;
export const FLOW_BUCKETS = 12;
const BUCKET = FLOW_WINDOW / FLOW_BUCKETS;
/** En deçà de ce recul (s), on ne donne pas de débit : trop peu de mesure pour dire quoi que ce soit. */
export const FLOW_MIN = 10;

/** Ce que fait une structure à un instant : elle travaille, elle est bloquée (rien ne part, plus de charbon…), ou elle n'a rien à traiter. */
export type FlowState = 'busy' | 'stuck' | 'dry';

/** Par tranche : [sorties, entrées, secondes en marche, bloquée, à sec]. */
const STRIDE = 5;
const OUT = 0;
const IN = 1;
const BUSY = 2;
const STUCK = 3;
const DRY = 4;
/** Tranches terminées gardées : la tranche en cours (partielle) s'y ajoute, pour 12 en tout. */
const KEPT = FLOW_BUCKETS - 1;

export class Flow {
  /** Les tranches terminées, la plus ancienne écrasée la première. */
  private readonly ring = new Float64Array(KEPT * STRIDE);
  private next = 0;
  /** La tranche en cours : dans des champs, pour que le pas de simulation (le cas courant) ne touche qu'à cet objet. */
  private out_ = 0;
  private in_ = 0;
  private busy = 0;
  private stuck = 0;
  private dry = 0;
  /** Temps écoulé dans la tranche en cours (s). */
  private acc = 0;

  /** Compte `n` objets sortis (produits, ou passés à la structure suivante). */
  add(n = 1): void {
    this.out_ += n;
  }

  /** Compte `n` objets entrés (coffres et caisses, dont l'arrivée est ce qui compte). */
  addIn(n = 1): void {
    this.in_ += n;
  }

  private spend(d: number, state: FlowState): void {
    if (state === 'busy') this.busy += d;
    else if (state === 'stuck') this.stuck += d;
    else this.dry += d;
    this.acc += d;
  }

  /** Fait passer `dt` secondes dans l'état `state`. */
  tick(dt: number, state: FlowState): void {
    // Le cas de presque tous les pas : on reste dans la tranche en cours.
    if (dt < BUCKET - this.acc - 1e-9) {
      this.spend(dt, state);
      return;
    }
    let left = dt;
    while (left > 1e-12) {
      const d = Math.min(left, BUCKET - this.acc);
      this.spend(d, state);
      left -= d;
      if (this.acc >= BUCKET - 1e-9) this.roll();
    }
  }

  /** La tranche en cours est finie : elle prend sa place dans l'anneau, une nouvelle commence. */
  private roll(): void {
    const at = this.next * STRIDE;
    this.ring[at + OUT] = this.out_;
    this.ring[at + IN] = this.in_;
    this.ring[at + BUSY] = this.busy;
    this.ring[at + STUCK] = this.stuck;
    this.ring[at + DRY] = this.dry;
    this.next = (this.next + 1) % KEPT;
    this.out_ = this.in_ = this.busy = this.stuck = this.dry = 0;
    this.acc = 0;
  }

  private sum(k: number, current: number): number {
    let s = current;
    for (let i = 0; i < KEPT; i++) s += this.ring[i * STRIDE + k];
    return s;
  }

  /** Secondes mesurées (60 au plus : l'anneau en garde entre 55 et 60). */
  get seconds(): number {
    return this.sum(BUSY, this.busy) + this.sum(STUCK, this.stuck) + this.sum(DRY, this.dry);
  }

  /** Objets sortis, comptés sur la période mesurée. */
  get out(): number {
    return this.sum(OUT, this.out_);
  }

  /** Objets entrés, comptés sur la période mesurée. */
  get in(): number {
    return this.sum(IN, this.in_);
  }

  /** Il y a assez de recul pour donner des chiffres. */
  get known(): boolean {
    return this.seconds >= FLOW_MIN;
  }

  /** Objets sortis par minute, ou null tant que la mesure est trop courte. */
  perMinute(): number | null {
    const s = this.seconds;
    return s >= FLOW_MIN ? (this.out / s) * 60 : null;
  }

  /** Objets entrés par minute, ou null tant que la mesure est trop courte. */
  inPerMinute(): number | null {
    const s = this.seconds;
    return s >= FLOW_MIN ? (this.in / s) * 60 : null;
  }

  /** Part du temps mesuré passée dans l'état `state` (0 à 1), ou null tant que la mesure est trop courte. */
  share(state: FlowState): number | null {
    const s = this.seconds;
    if (s < FLOW_MIN) return null;
    return (state === 'busy' ? this.sum(BUSY, this.busy) : state === 'stuck' ? this.sum(STUCK, this.stuck) : this.sum(DRY, this.dry)) / s;
  }

  /** L'état qui a dominé la période (à égalité : bloquée avant à sec, à sec avant en marche), ou null tant que la mesure est trop courte. */
  dominant(): FlowState | null {
    const stuck = this.share('stuck');
    if (stuck === null) return null;
    const dry = this.share('dry')!;
    const busy = this.share('busy')!;
    if (stuck >= dry && stuck >= busy) return 'stuck';
    return dry >= busy ? 'dry' : 'busy';
  }
}

/** Couleur de la vue « goulots » : en marche, à sec ou limité, bloqué, ou rien à signaler. */
export type FlowTone = 'good' | 'warn' | 'bad' | 'none';

/** Un convoyeur qui porte au moins cette part de sa charge maximale est « à pleine charge ». */
export const SATURATED = 0.85;

/** L'état qui a dominé la dernière minute (celui du moment tant que la mesure est trop courte), ou null si la structure n'est pas mesurée. */
export function stateOf(s: Structure): FlowState | null {
  const now = s.flowState();
  return now === null ? null : (s.flow.dominant() ?? now);
}

/** Un convoyeur proche de sa charge maximale : il ne pourrait pas porter plus. */
export function saturated(s: Structure): boolean {
  if (!s.isBelt) return false;
  const rate = s.flow.perMinute();
  const max = s.maxPerMinute();
  return rate !== null && max !== null && max > 0 && rate >= max * SATURATED;
}

/**
 * Couleur d'une structure dans la vue « goulots » : rouge si elle a surtout été bloquée, ambre si elle a surtout manqué de
 * quoi travailler (ou si c'est un convoyeur à pleine charge), vert si elle tourne. Un convoyeur sur lequel rien n'est passé
 * de toute la minute, ou un coffre qui ne sert pas, ne disent rien.
 */
export function toneOf(s: Structure): FlowTone {
  const st = stateOf(s);
  if (st === null) return 'none';
  if (st === 'stuck') return 'bad';
  if (s.isBelt) {
    // Un convoyeur n'est « à sec » que par moments, entre deux objets : ce qui compte, c'est que quelque chose passe.
    if (saturated(s)) return 'warn';
    return s.flow.known ? (s.flow.out > 0 ? 'good' : 'none') : st === 'busy' ? 'good' : 'none';
  }
  if (st === 'dry') return 'warn';
  // « En marche » sans que rien soit passé de toute la minute (un coffre qui ne sert pas) : rien à signaler.
  if (s.flow.known && s.flow.out + s.flow.in === 0) return 'none';
  return 'good';
}
