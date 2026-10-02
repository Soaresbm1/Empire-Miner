/**
 * Bandeau de vitesse du HUD (dans le cadre en haut à gauche) : pause, ×1, ×2, ×4. Rien ici ne modifie la partie.
 */
import { SPEEDS, type Speed } from '../game/speed';

export interface SpeedView {
  speed: Speed;
  paused: boolean;
  /** Vitesse réellement obtenue (lissée) : sert à dire quand l'ordinateur ne suit plus. */
  rate: number;
  keepsUp: boolean;
  /** Libellés des touches (pause, vitesse suivante). */
  keys: { pause: string; speed: string };
}

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function speedBar(v: SpeedView): string {
  const pause = `<button class="sp sp-pause ${v.paused ? 'on' : ''}" data-action="speed" data-arg="0" title="${v.paused ? 'Reprendre' : 'Pause'} (${v.keys.pause})" aria-pressed="${v.paused}"><i></i></button>`;
  const speeds = SPEEDS.map(
    (s) =>
      `<button class="sp ${!v.paused && v.speed === s ? 'on' : ''}" data-action="speed" data-arg="${s}" title="${s === 1 ? 'Vitesse normale' : `Vitesse ×${s}`} (${v.keys.speed} : vitesse suivante)">×${s}</button>`,
  ).join('');
  const note = v.paused
    ? `<span class="sp-note pause">En pause : on peut construire (B) et acheter</span>`
    : v.speed > 1 && !v.keepsUp
      ? `<span class="sp-note slow" title="L'ordinateur ne suit pas la vitesse demandée">tourne à ×${fmt(v.rate)}</span>`
      : '';
  return `<div class="speedbar ${v.paused ? 'paused' : v.speed > 1 ? 'fast' : ''}">${pause}${speeds}</div>${note}`;
}
