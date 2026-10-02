/** Aides de formatage pour l'interface. */
import { RARITY_COLORS, getResource } from '../data/resources';
import { icon } from './theme';

export function money(v: number): string {
  return `${Math.floor(v).toLocaleString('fr-FR')} $`;
}

/** Prix unitaire au cours du marché : une décimale au besoin (« 7,8 $ »), entier à partir de 100 $. */
export function price(v: number): string {
  return `${num(v, v >= 100 ? 0 : 1)}\u00a0$`;
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
  // Le sprite de la mine, s'il est prêt ; sinon une pastille de couleur.
  const src = icon(`res:${id}`);
  if (src) return `<img class="res-img${r.ingot ? ' ingot' : ''}" src="${src}" alt="">`;
  return `<i class="res${r.ingot ? ' ingot' : ''}" style="--c:${r.color};--l:${r.light};--d:${r.dark}"></i>`;
}

export function rarityTag(id: string): string {
  const r = getResource(id);
  return `<span class="rarity" style="color:${RARITY_COLORS[r.rarity]}">${r.rarity}</span>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
