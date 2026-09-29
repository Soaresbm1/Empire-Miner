/** Aides de formatage pour l'interface. */
import { RARITY_COLORS, getResource } from '../data/resources';

export function money(v: number): string {
  return `${Math.floor(v).toLocaleString('fr-FR')} $`;
}

export function kg(v: number): string {
  return `${(Math.round(v * 10) / 10).toLocaleString('fr-FR')} kg`;
}

export function num(v: number, digits = 1): string {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

/** Petite icône de minerai (dégradé CSS aux couleurs de la ressource). */
export function resIcon(id: string): string {
  const r = getResource(id);
  return `<i class="res" style="--c:${r.color};--l:${r.light};--d:${r.dark}"></i>`;
}

export function rarityTag(id: string): string {
  const r = getResource(id);
  return `<span class="rarity" style="color:${RARITY_COLORS[r.rarity]}">${r.rarity}</span>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
