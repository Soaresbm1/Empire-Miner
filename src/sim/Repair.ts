/**
 * Dépannage : ce que voit le dépanneur quand il examine une machine à l'arrêt.
 *
 * `diagnose` dit pourquoi une machine est bloquée et si un ouvrier peut y remédier (recharger en charbon, vider la sortie dans un
 * coffre). Ce qu'il ne peut pas régler (ligne saturée, aucune sortie reliée, coffres pleins…) est signalé au joueur : voir
 * `RepairReport` et la liste « Machines à surveiller » des statistiques.
 *
 * Tout est déduit de l'état de la partie (structures, coffres), sans hasard ni heure de l'appareil : les deux joueurs voient la même chose.
 */
import { DX, DY } from '../core/dir';
import type { RepairCause } from '../data/workers';
import type { GameState } from './GameState';
import { Crafter } from './structures/Crafter';
import { Drill } from './structures/Drill';
import { ShippingCrate } from './structures/ShippingCrate';
import { Smelter } from './structures/Smelter';
import { Storage } from './structures/Storage';
import type { Structure } from './structures/Structure';

/** Machines qu'un dépanneur sait examiner. */
export type Repairable = Drill | Smelter | Crafter;

export const isRepairable = (s: Structure): s is Repairable => s instanceof Drill || s instanceof Smelter || s instanceof Crafter;

/** Ce qu'un dépanneur a constaté sur une machine. */
export interface RepairReport {
  /** Case d'origine de la machine. */
  x: number;
  y: number;
  cause: RepairCause;
  /** Instant du constat (`GameState.time`). */
  t: number;
  /** Le dépanneur est rentré au camp : le signalement est affiché (avant cela il ne sert qu'à ne pas revisiter la machine). */
  shown: boolean;
}

export interface Diagnosis {
  cause: RepairCause;
  /** Un ouvrier peut y remédier tout de suite. */
  fixable: boolean;
}

/** Produit retenu dans la machine (ce qu'elle n'arrive pas à faire sortir), sans seuil : tout ce qui s'y trouve. */
export function stuckOutput(s: Structure): Record<string, number> {
  const out: Record<string, number> = {};
  if (s instanceof Drill) for (const r of s.buffer) out[r] = (out[r] ?? 0) + 1;
  else if (s instanceof Smelter || s instanceof Crafter) for (const r of s.output) out[r] = (out[r] ?? 0) + 1;
  return out;
}

/** Retire jusqu'à `n` unités de `res` de la sortie retenue ; renvoie combien ont été prises. */
export function takeOutput(s: Structure, res: string, n: number): number {
  const list = s instanceof Drill ? s.buffer : s instanceof Smelter || s instanceof Crafter ? s.output : null;
  if (!list) return 0;
  let k = 0;
  for (let i = list.length - 1; i >= 0 && k < n; i--)
    if (list[i] === res) {
      list.splice(i, 1);
      k++;
    }
  return k;
}

/** Structures voisines (sans doublon) qui touchent le contour de `s`. */
function neighbours(g: GameState, s: Structure): Structure[] {
  const out: Structure[] = [];
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++)
      for (let k = 0; k < 4; k++) {
        const n = g.structures.at(x + DX[k], y + DY[k]);
        if (n && n !== s && !out.includes(n)) out.push(n);
      }
  return out;
}

/** Pourquoi la production n'a nulle part où aller : aucune sortie, une caisse pleine, un convoyeur plein, ou des coffres qui ne la veulent pas. */
function exitCause(g: GameState, s: Structure): RepairCause {
  const outs = neighbours(g, s).filter((n) => n.isBelt || n.feedable || n instanceof Storage || n instanceof ShippingCrate);
  if (!outs.length) return 'noexit';
  if (outs.some((n) => n instanceof ShippingCrate)) return 'cratefull';
  if (outs.some((n) => n.isBelt || n.feedable)) return 'beltfull';
  return 'nochest';
}

/**
 * Ce qui bloque la machine `s`, ou null si elle n'est pas bloquée (ou pas examinable). `giveUp` : le dépanneur a déjà vidé la
 * sortie plusieurs fois sans que ça tienne : il ne propose plus de la vider et dit pourquoi elle se remplit. `carried` : ce que le
 * dépanneur porte (du charbon pris pour la machine compte comme du charbon disponible).
 */
export function diagnose(g: GameState, s: Structure, giveUp = false, carried: Record<string, number> = {}): Diagnosis | null {
  if (!isRepairable(s) || s.flowState() !== 'stuck') return null;
  if (s.status === 'nofuel') {
    const res = s.fuelWanted();
    if (!res) return null;
    // Du charbon en coffre, ou déjà sur le dépanneur (il vient de le prendre pour cette machine).
    const coal = (carried[res] ?? 0) > 0 || g.structures.list.some((c) => c instanceof Storage && (c.items[res] ?? 0) > 0);
    return { cause: coal ? 'nofuel' : 'nocoal', fixable: coal };
  }
  if (s.status === 'full') {
    const res = Object.keys(stuckOutput(s))[0];
    if (!res) return { cause: exitCause(g, s), fixable: false };
    if (!giveUp && g.structures.list.some((c) => c instanceof Storage && c.canAccept(res))) return { cause: 'outfull', fixable: true };
    return { cause: exitCause(g, s), fixable: false };
  }
  return null;
}
