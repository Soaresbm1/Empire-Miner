/** Petites briques HTML communes à plusieurs panneaux. */
import { esc } from './format';

/** Bouton d'action : `data-action` est relayé à `Game.onAction`. */
export const btn = (action: string, label: string, opts: { arg?: string; disabled?: boolean; cls?: string; title?: string } = {}): string =>
  `<button class="btn ${opts.cls ?? ''}" data-action="${action}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ''}${
    opts.disabled ? ' disabled' : ''
  }${opts.title ? ` title="${esc(opts.title)}"` : ''}>${label}</button>`;

/** Ligne « libellé … valeur », avec « → nouvelle valeur » quand elle change. */
export function stat(label: string, from: string, to?: string): string {
  return `<div class="stat"><span>${label}</span><b>${from}${to && to !== from ? ` <em>→ ${to}</em>` : ''}</b></div>`;
}
