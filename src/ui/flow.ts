/**
 * Débits à l'écran : infobulles des machines et des convoyeurs, lignes « Débit réel » des panneaux, légende de la vue
 * « goulots ». Les chiffres viennent de `sim/Flow` (mesure d'affichage, jamais sauvegardée) ; rien ici ne modifie la partie.
 */
import { saturated, stateOf } from '../sim/Flow';
import { Crafter } from '../sim/structures/Crafter';
import { Smelter } from '../sim/structures/Smelter';
import type { Structure } from '../sim/structures/Structure';
import { perMin } from './forecast';
import { num } from './format';
import { stat } from './widgets';

/** Ce que mesure un débit : une machine qui produit, un convoyeur qui fait passer, une caisse ou un coffre qui reçoit. */
export type FlowKind = 'producer' | 'belt' | 'crate' | 'chest';

/** Le genre de lecture d'une structure, ou null si elle n'est pas mesurée. */
export function flowKind(s: Structure): FlowKind | null {
  if (s.flowState() === null) return null;
  if (s.isBelt) return 'belt';
  if (s.type === 'shipping') return 'crate';
  if (s.type === 'storage') return 'chest';
  return 'producer';
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;

/** Part du temps passé à travailler, bloqué, à sec — les parts de 5 % ou plus seulement. */
function shares(s: Structure, kind: FlowKind): string {
  const f = s.flow;
  const busy = f.share('busy');
  const stuck = f.share('stuck');
  const dry = f.share('dry');
  if (busy === null || stuck === null || dry === null) return '';
  const parts: string[] = [];
  if (kind === 'producer' && busy >= 0.05) parts.push(`en marche ${pct(busy)}`);
  if (kind === 'belt' && busy >= 0.05) parts.push(`fluide ${pct(busy)}`);
  if (stuck >= 0.05) parts.push(`<span class="bad">${kind === 'chest' || kind === 'crate' ? 'plein' : 'bloqué'} ${pct(stuck)}</span>`);
  if (kind === 'producer' && dry >= 0.05) parts.push(`<span class="warn">à sec ${pct(dry)}</span>`);
  return parts.join(' · ');
}

/** La machine travaille à plein régime pendant que sa file d'attente déborde : c'est elle qui limite la ligne. */
export function limiting(s: Structure): boolean {
  return (s instanceof Smelter || s instanceof Crafter) && s.backedUp() && s.flow.known && stateOf(s) === 'busy';
}

/** Phrase qui explique ce qu'on peut faire d'un goulot. */
const LIMITING_TEXT = "Goulot : sa file d'attente est pleine et elle travaille à plein régime. Une machine de plus sur la ligne augmenterait le débit.";
const SATURATED_TEXT = 'À pleine charge : ce convoyeur ne peut pas porter plus. Un convoyeur plus rapide, ou une deuxième ligne, augmenterait le débit.';

/** Le débit en une phrase : « Débit : 18 /min sur 24 possibles ». `null` : pas de mesure encore. */
function rateSentence(s: Structure, kind: FlowKind): string | null {
  const f = s.flow;
  const out = f.perMinute();
  const into = f.inPerMinute();
  if (out === null || into === null) return null;
  const max = s.maxPerMinute();
  const top = max !== null && max > 0 ? num(max, max < 10 ? 1 : 0) : null;
  switch (kind) {
    case 'producer':
      return `Débit : <b>${perMin(out)}</b>${top ? ` sur ${top} possibles` : ''}`;
    case 'belt':
      return `Passent : <b>${perMin(out)}</b>${top ? ` (${top} au plus)` : ''}`;
    case 'crate':
      return `Reçoit : <b>${perMin(into)}</b>`;
    case 'chest':
      return `Entre : <b>${perMin(into)}</b> · sort : <b>${perMin(out)}</b>`;
  }
}

/** Lignes ajoutées à l'infobulle d'une structure (commence par un saut de ligne), ou '' si elle n'est pas mesurée. */
export function flowTip(s: Structure): string {
  const kind = flowKind(s);
  if (!kind) return '';
  const sentence = rateSentence(s, kind);
  if (sentence === null) return '<br><span class="muted">Débit : mesure en cours…</span>';
  const time = shares(s, kind);
  const note = limiting(s) ? `<br><span class="warn">${LIMITING_TEXT}</span>` : saturated(s) ? `<br><span class="warn">${SATURATED_TEXT}</span>` : '';
  return `<br>${sentence}${time ? `<br><span class="muted">${time}</span>` : ''}${note}`;
}

/** Lignes « Débit réel » d'un panneau de machine (des `stat`), plus un encart quand la machine limite sa ligne. */
export function flowRows(s: Structure): string {
  const kind = flowKind(s);
  if (!kind) return '';
  const f = s.flow;
  const out = f.perMinute();
  if (out === null) return stat('Débit réel', '<span class="muted">mesure en cours…</span>');
  const into = f.inPerMinute() ?? 0;
  const max = s.maxPerMinute();
  const value =
    kind === 'crate'
      ? perMin(into)
      : kind === 'chest'
        ? `entre ${perMin(into)} · sort ${perMin(out)}`
        : `${perMin(out)}${max !== null && max > 0 ? ` sur ${num(max, max < 10 ? 1 : 0)}` : ''}`;
  const time = shares(s, kind);
  return `${stat('Débit réel', value)}${time ? stat('Temps passé', time) : ''}${limiting(s) ? `<div class="forecast"><b>Goulot</b><span>${LIMITING_TEXT.replace(/^Goulot : /, '')}</span></div>` : ''}`;
}

/** Légende de la vue « goulots » (au bas de l'écran tant qu'elle est active). */
export function flowLegend(): string {
  return `<span class="fl-dot bad"></span>Bloqué<span class="fl-dot warn"></span>À sec / saturé<span class="fl-dot good"></span>Ça tourne`;
}
