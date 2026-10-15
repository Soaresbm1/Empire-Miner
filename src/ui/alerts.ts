/**
 * Alerte « machine à l'arrêt » : prévient le joueur qu'une machine ne travaille plus, sans qu'il ait à la survoler.
 *
 * Tout est lu dans l'état de la partie (`flowState`, `diagnose`) : rien ici ne modifie la simulation, rien n'est sauvegardé ni
 * envoyé à l'autre joueur. Chaque appareil garde sa propre liste. Une machine n'est signalée qu'après `ALERT.delay` secondes
 * d'arrêt continu (temps de la simulation : la pause et les vitesses comptent comme il faut), pour ne pas crier à chaque
 * à-coup d'une ligne qui se remplit.
 */
import { getMachine } from '../data/machines';
import { REPAIR_TEXT } from '../data/workers';
import { diagnose, isRepairable } from '../sim/Repair';
import type { GameState } from '../sim/GameState';
import type { Structure } from '../sim/structures/Structure';

export const ALERT = {
  /** Arrêt continu (s de jeu) avant de signaler une machine. */
  delay: 20,
  /** Intervalle entre deux relevés (s de jeu). */
  every: 0.5,
  /** Au-delà, les nouveaux arrêts sont annoncés d'un seul message. */
  maxToasts: 2,
} as const;

export interface Stall {
  s: Structure;
  /** Depuis quand elle est à l'arrêt (`GameState.time`). */
  since: number;
  /** « Four : plus de charbon » */
  text: string;
}

/** Pourquoi la machine est à l'arrêt, en quelques mots. */
function causeLabel(g: GameState, s: Structure): string {
  const d = diagnose(g, s);
  return d ? REPAIR_TEXT[d.cause].label : 'à l’arrêt';
}

export class StallWatch {
  /** Machines signalées, la plus ancienne d'abord. */
  list: Stall[] = [];
  private game: GameState | null = null;
  private readonly since = new Map<Structure, number>();
  private readonly told = new Set<Structure>();
  private next = 0;
  /** Quelle machine « Aller voir » montre ensuite. */
  private cursor = 0;

  /** Relève l'état ; renvoie les machines qui viennent d'être signalées (pour un message). */
  update(g: GameState): Stall[] {
    if (g !== this.game) {
      this.game = g;
      this.since.clear();
      this.told.clear();
      this.list = [];
      this.next = 0;
      this.cursor = 0;
    }
    if (g.time < this.next) return [];
    this.next = g.time + ALERT.every;
    const fresh: Stall[] = [];
    const list: Stall[] = [];
    const live = new Set<Structure>();
    for (const s of g.structures.list) {
      if (!isRepairable(s) || s.flowState() !== 'stuck') continue;
      live.add(s);
      const t = this.since.get(s) ?? g.time;
      this.since.set(s, t);
      if (g.time - t < ALERT.delay) continue;
      const stall = { s, since: t, text: `${getMachine(s.type).name} : ${causeLabel(g, s)}` };
      list.push(stall);
      if (!this.told.has(s)) {
        this.told.add(s);
        fresh.push(stall);
      }
    }
    for (const s of [...this.since.keys()])
      if (!live.has(s)) {
        this.since.delete(s);
        this.told.delete(s);
      }
    this.list = list.sort((a, b) => a.since - b.since);
    return fresh;
  }

  /** La machine à montrer à l'appui suivant (on les fait défiler), ou null. */
  nextToShow(): Stall | null {
    if (!this.list.length) return null;
    this.cursor %= this.list.length;
    return this.list[this.cursor++];
  }
}

/** Message à afficher pour les nouveaux arrêts : un par machine, ou un seul si elles sont nombreuses. */
export function stallToasts(fresh: Stall[]): string[] {
  if (fresh.length <= ALERT.maxToasts) return fresh.map((f) => f.text);
  return [`${fresh.length} machines viennent de s’arrêter`];
}

/** La pastille du HUD, ou '' s'il n'y a rien à signaler. */
export function alertChip(list: readonly Stall[]): string {
  if (!list.length) return '';
  const n = list.length;
  const title = list
    .slice(0, 5)
    .map((f) => f.text)
    .join('\n');
  return `<button class="btn alert" data-action="alertGo" title="${title.replace(/"/g, '&quot;')}">⚠ ${n} machine${n > 1 ? 's' : ''} à l’arrêt<small>Appuyez pour voir où</small></button>`;
}
