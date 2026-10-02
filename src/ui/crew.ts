/**
 * Ouvriers à l'écran : ce que fait chacun (onglet « Ouvriers » de l'Atelier) et ceux qui sont bloqués (Tableau
 * d'affichage). Rien ici ne modifie la partie.
 */
import { getResource } from '../data/resources';
import { WORKERS } from '../data/workers';
import type { GameState } from '../sim/GameState';
import { cargoCount, cargoWeight, type Worker } from '../sim/Workers';
import { kg, resIcon } from './format';

export interface WorkerStatus {
  text: string;
  /** « ok » : au travail ; « idle » : rien à faire ; « warn » : bloqué, le joueur peut agir. */
  tone: 'ok' | 'idle' | 'warn';
}

/** Ce que fait l'ouvrier, en une phrase. */
export function workerStatus(g: GameState, w: Worker): WorkerStatus {
  const t = w.task;
  if (!t) {
    if (w.flag === 'nostore') return { text: 'Aucun coffre accessible : il garde sa charge. Posez un coffre au camp.', tone: 'warn' };
    if (w.flag === 'nocoal') return { text: 'Plus de charbon dans les coffres : déposez-en dans un coffre.', tone: 'warn' };
    if (w.flag === 'lost') return { text: 'La machine à recharger est inaccessible.', tone: 'warn' };
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
    const text = w.flag === 'nostore' ? 'Ramasseur : aucun coffre accessible' : w.flag === 'nocoal' ? 'Ravitailleur : plus de charbon dans les coffres' : 'Ravitailleur : machine inaccessible';
    found.set(text, (found.get(text) ?? 0) + 1);
  }
  return [...found].map(([text, n]) => ({ text, n }));
}
