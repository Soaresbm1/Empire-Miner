/**
 * Ouvriers à l'écran : ce que fait chacun (onglet « Ouvriers » de l'Atelier) et ceux qui sont bloqués (Tableau
 * d'affichage). Rien ici ne modifie la partie.
 */
import { TILE } from '../core/constants';
import { getResource } from '../data/resources';
import { WORKERS, getJob, workerName } from '../data/workers';
import type { GameState } from '../sim/GameState';
import { cargoCount, cargoWeight, type Worker, type WorkerFlag } from '../sim/Workers';
import { kg, resIcon } from './format';

export interface WorkerStatus {
  text: string;
  /** « ok » : au travail ; « idle » : rien à faire ; « warn » : bloqué, le joueur peut agir. */
  tone: 'ok' | 'idle' | 'warn';
}

/** Pourquoi un ouvrier est bloqué, et ce que le joueur peut y faire. */
const FLAG_TEXT: Record<WorkerFlag, string> = {
  nostore: "Aucun coffre n'accepte ce minerai : réglez un coffre ou posez-en un.",
  full: 'Les coffres qui acceptent ce minerai sont pleins : videz-en un ou posez-en un autre.',
  noroute: "Aucun chemin jusqu'à un coffre (roche, grisou, eau profonde ou machine en travers) : dégagez le passage.",
  nocoal: 'Plus de charbon dans les coffres : déposez-en dans un coffre.',
  lost: 'La machine à recharger est inaccessible.',
};

/** Les blocages en quelques mots, pour la liste « machines à surveiller » du Tableau d'affichage. */
const FLAG_BOARD: Record<WorkerFlag, string> = {
  nostore: "Ramasseur : aucun coffre n'accepte ce minerai",
  full: 'Ramasseur : les coffres sont pleins',
  noroute: 'Ramasseur : aucun chemin vers un coffre',
  nocoal: 'Ravitailleur : plus de charbon dans les coffres',
  lost: 'Ravitailleur : machine inaccessible',
};

/** Ce que fait l'ouvrier, en une phrase. */
export function workerStatus(g: GameState, w: Worker): WorkerStatus {
  const t = w.task;
  if (!t) {
    if (w.flag) return { text: FLAG_TEXT[w.flag], tone: 'warn' };
    return { text: w.job === 'picker' ? 'Attend des minerais par terre' : 'Toutes les machines ont du charbon', tone: 'idle' };
  }
  switch (t.kind) {
    case 'pick': {
      const d = g.drops.list.find((o) => o.id === t.drop);
      return { text: d ? `Va ramasser : ${getResource(d.res).name.toLowerCase()}` : 'Va ramasser un tas', tone: 'ok' };
    }
    case 'store':
      return { text: 'Rapporte sa charge au coffre', tone: 'ok' };
    case 'take':
      return { text: 'Va chercher du charbon', tone: 'ok' };
    case 'fuel':
      return { text: 'Ravitaille une machine', tone: 'ok' };
    case 'home':
      return { text: 'Retourne à son poste', tone: 'idle' };
  }
}

/** Ce que l'ouvrier porte, en icônes : « 3 cuivre, 1 charbon · 7,5 kg / 15 kg » (vide s'il ne porte rien). */
export function cargoLine(w: Worker): string {
  if (!cargoCount(w.cargo)) return '';
  const items = Object.entries(w.cargo)
    .filter(([, n]) => n > 0)
    .map(([res, n]) => `<span class="chip">${resIcon(res)}${n}</span>`)
    .join('');
  return `<span class="crew-cargo" title="Charge : ${kg(cargoWeight(w.cargo))} sur ${kg(WORKERS.capacity)}">${items}</span>`;
}

/** Ouvriers bloqués, regroupés par cause, pour la liste « machines à surveiller » du Tableau d'affichage. */
export function stuckWorkers(g: GameState): { text: string; n: number }[] {
  const found = new Map<string, number>();
  for (const w of g.workers.list) {
    if (w.task || !w.flag) continue;
    const text = FLAG_BOARD[w.flag];
    found.set(text, (found.get(text) ?? 0) + 1);
  }
  return [...found].map(([text, n]) => ({ text, n }));
}

/** Ouvrier sous la souris : sur la case (tx, ty), ou juste au-dessus de sa tête (là où s'affiche son « ! »). */
export function workerAt(g: GameState, tx: number, ty: number): Worker | undefined {
  return g.workers.list.find((w) => {
    const wx = Math.floor(w.x / TILE);
    const wy = Math.floor((w.y - 1) / TILE);
    return tx === wx && (ty === wy || ty === wy - 1);
  });
}

/** Infobulle d'un ouvrier : qui il est, ce qu'il fait ou pourquoi il est bloqué, ce qu'il porte. */
export function workerTooltip(g: GameState, w: Worker): string {
  const st = workerStatus(g, w);
  const load = cargoLine(w);
  return `<b>${workerName(w.id)}</b> · ${getJob(w.job).name}<br>${st.tone === 'warn' ? `<span class="bad">${st.text}</span>` : st.text}${
    load ? `<br>${load}` : ''
  }`;
}
