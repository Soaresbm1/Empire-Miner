/**
 * Réglage de ce qu'un coffre accepte : puces de minerais (panneau d'un coffre et barre « Régler les coffres »),
 * choix de plusieurs coffres à la fois et barre du mode. Rien ici ne modifie la partie.
 */
import { RESOURCES, getResource, type ResourceDef } from '../data/resources';
import type { GameState } from '../sim/GameState';
import { normalizeAllow, type Storage } from '../sim/structures/Storage';
import { esc, resIcon } from './format';
import { btn } from './widgets';

/** Minerais proposés pour régler un coffre : ceux que le joueur connaît, plus ceux déjà choisis ou déjà dedans. */
export function filterResources(g: GameState, allow: readonly string[], present: Record<string, number> = {}): ResourceDef[] {
  return RESOURCES.filter(
    (r) => r.id === 'stone' || r.id === 'coal' || allow.includes(r.id) || (present[r.id] ?? 0) > 0 || g.stats.discovered.includes(r.id) || (g.stats.collected[r.id] ?? 0) > 0,
  );
}

/** Le bouton « Tout » puis une puce par minerai ; `action` reçoit le minerai cliqué (« » pour « Tout »). */
export function filterChips(g: GameState, allow: readonly string[], action: string, present: Record<string, number> = {}): string {
  const choice = (id: string, label: string, on: boolean) => btn(action, label, { arg: id, cls: `small ${on ? 'on' : 'off'}` });
  return `<div class="buy">${choice('', 'Tout', allow.length === 0)}${filterResources(g, allow, present)
    .map((r) => choice(r.id, `${resIcon(r.id)} ${r.name}`, allow.includes(r.id)))
    .join('')}</div>`;
}

/** « tout » ou « cuivre, fer » : ce qu'un réglage accepte, en minuscules, pour les messages. */
export function allowWords(allow: readonly string[]): string {
  return allow.length ? allow.map((r) => getResource(r).name.toLowerCase()).join(', ') : 'tout';
}

/** Ajoute le minerai au réglage, ou l'en retire (« » : tout accepter). */
export function toggleDraft(draft: readonly string[], res: string): string[] {
  if (!res) return [];
  return normalizeAllow(draft.includes(res) ? draft.filter((r) => r !== res) : [...draft, res]);
}

/** Coffres dont une case touche le rectangle de cases (bornes comprises, dans n'importe quel sens). */
export function chestsInRect(g: GameState, tx0: number, ty0: number, tx1: number, ty1: number): Storage[] {
  const x0 = Math.min(tx0, tx1);
  const x1 = Math.max(tx0, tx1);
  const y0 = Math.min(ty0, ty1);
  const y1 = Math.max(ty0, ty1);
  return g.storages().filter((s) => s.x + s.w - 1 >= x0 && s.x <= x1 && s.y + s.h - 1 >= y0 && s.y <= y1);
}

/**
 * Ajoute ces coffres à la sélection ; s'ils y sont déjà tous, les en retire (une même zone sert à choisir puis à défaire).
 * Renvoie vrai quand ils ont été ajoutés.
 */
export function pickChests(selected: Set<Storage>, found: readonly Storage[]): boolean {
  if (!found.length) return false;
  const adding = found.some((s) => !selected.has(s));
  for (const s of found) adding ? selected.add(s) : selected.delete(s);
  return adding;
}

export interface ChestBarView {
  /** Coffres posés, et coffres choisis. */
  total: number;
  selected: number;
  /** Réglage qui sera appliqué. */
  draft: readonly string[];
  /** Coffre sous la souris, et s'il est déjà choisi. */
  hover: { chest: Storage; picked: boolean } | null;
  /** Libellé d'une touche physique. */
  label: (code: string) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Barre du mode « Régler les coffres » : le réglage à appliquer, les coffres choisis et les boutons. */
export function chestBar(g: GameState, v: ChestBarView): string {
  const close = `<div class="bb-close" data-action="chestClose" title="Quitter (${v.label('KeyC')})">✕</div>`;
  const head = `<div class="bb-head"><span class="bb-title">Régler les coffres</span><span class="bb-tabs"></span>${close}</div>`;
  const keys = (parts: string[]) => `<div class="bb-keys">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
  if (!v.total)
    return `<div class="buildbar chestbar hud-box">${head}<div class="bb-empty">Aucun coffre posé : construisez-en (<kbd>${v.label('KeyB')}</kbd>), puis revenez ici.</div>
      ${keys([`<kbd>${v.label('KeyC')}</kbd> quitter`])}</div>`;
  const hover = v.hover
    ? `<div class="bb-status ${v.hover.picked ? 'ok' : ''}">${v.hover.picked ? '✓ Choisi' : 'Coffre'} — ${
        v.hover.chest.allow.length ? `accepte seulement ${esc(allowWords(v.hover.chest.allow))}` : 'accepte tout'
      } · clic : ${v.hover.picked ? 'le retirer de la sélection' : 'le choisir'}</div>`
    : '<div class="bb-status">Clic : choisir un coffre · glissez un rectangle pour en choisir plusieurs.</div>';
  const apply = v.selected
    ? `Appliquer à ${plural(v.selected, 'coffre')} : ${v.draft.length ? `seulement ${allowWords(v.draft)}` : 'tout accepter'}`
    : 'Choisissez des coffres pour les régler';
  return `<div class="buildbar chestbar hud-box">${head}
    <div class="cb-step"><b>1 · Ils accepteront</b>${filterChips(g, v.draft, 'chestDraft')}</div>
    <div class="cb-step"><b>2 · Les coffres</b><span class="cb-count"><b>${v.selected}</b> choisi${v.selected > 1 ? 's' : ''} sur ${v.total}</span>
      ${btn('chestAll', 'Tous les coffres', { cls: 'small', disabled: v.selected >= v.total })}${btn('chestNone', 'Aucun', { cls: 'small', disabled: !v.selected })}</div>
    <div class="cb-apply">${btn('chestApply', esc(apply), { cls: 'primary', disabled: !v.selected })}</div>
    ${hover}
    ${keys([
      '<kbd>Clic</kbd> choisir',
      '<kbd>Glisser</kbd> une zone',
      '<kbd>Clic droit</kbd> tout vider',
      '<kbd>Entrée</kbd> appliquer',
      `<kbd>${v.label('KeyC')}</kbd> quitter`,
    ])}
  </div>`;
}
