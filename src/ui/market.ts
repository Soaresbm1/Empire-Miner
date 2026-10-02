/**
 * Cours du marché à l'écran : prix du jour avec tendance (Comptoir, sac), courbes et événements du Tableau d'affichage,
 * et la ligne d'événements du HUD. Les chiffres viennent de `GameState.market` ; rien ici ne modifie la partie.
 */
import { MARKET } from '../data/market';
import { RESOURCES, getResource } from '../data/resources';
import type { GameState } from '../sim/GameState';
import { COMMODITIES, commodityOf, ingotOf, type ActiveEvent } from '../sim/Market';
import { esc, price, resIcon } from './format';

/** Onglets du Tableau d'affichage. */
export const BOARD_TABS: readonly (readonly [string, string])[] = [
  ['market', 'Marché'],
  ['production', 'Production'],
];

export const isBoardTab = (id: string): boolean => BOARD_TABS.some(([t]) => t === id);

/** Le joueur connaît-il ce minerai ? (Seuls ceux-là s'affichent au marché, et font l'objet d'événements.) */
export function knownOre(g: GameState, res: string): boolean {
  return g.stats.discovered.includes(res) || (g.stats.collected[res] ?? 0) > 0 || g.inventory.count(res) > 0;
}

/** Écart au prix de base en pourcents, avec le vrai signe moins : « +12 % », « −8 % », « 0 % ». */
export function pct(mult: number): string {
  const p = Math.round((mult - 1) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
}

type Tone = 'up' | 'down' | 'flat';

/** Cours nettement au-dessus (vert) ou au-dessous (rouge) du prix de base. */
function tone(mult: number): Tone {
  return mult >= 1 + MARKET.good / 2 ? 'up' : mult <= 1 - MARKET.good / 2 ? 'down' : 'flat';
}

const ARROWS = { '-1': '▼', '0': '▬', '1': '▲' } as const;

/** « ▲ +12 % » : la flèche donne la tendance des 30 dernières secondes, la couleur et le chiffre l'écart au prix de base. */
export function trendTag(g: GameState, res: string, small = false): string {
  const m = g.market.mult(res);
  const arrow = ARROWS[String(g.market.trend(res)) as keyof typeof ARROWS];
  const tip = `Cours : ${pct(m)} par rapport au prix de base (${price(getResource(res).value)})`;
  return `<span class="mk ${tone(m)}${small ? ' small' : ''}" title="${esc(tip)}">${arrow} ${pct(m)}</span>`;
}

/** Prix unitaire du moment, suivi de sa tendance (vide pour la pierre, dont le prix ne bouge pas). */
export function priceCell(g: GameState, res: string): string {
  if (!commodityOf(res)) return price(getResource(res).value);
  return `${price(g.market.price(res))}<br>${trendTag(g, res, true)}`;
}

/** « de cuivre », « d'or » : le complément du nom d'un minerai. */
function de(name: string): string {
  const n = name.toLowerCase();
  return /^[aeiouyéèh]/.test(n) ? `d'${n}` : `de ${n}`;
}

/** Titre d'un événement : « Forte demande de cuivre », « Surproduction d'or ». */
export function eventTitle(e: Pick<ActiveEvent, 'res' | 'up'>): string {
  const name = getResource(e.res).name;
  return `${e.up ? 'Forte demande' : 'Surproduction'} ${de(name)}`;
}

/** Texte de l'annonce faite quand un événement commence. */
export function marketNews(e: Pick<ActiveEvent, 'res' | 'up' | 'pct'>): string {
  const p = `${e.pct > 0 ? '+' : '−'}${Math.abs(e.pct)} %`;
  return e.up ? `Marché : ${eventTitle(e).toLowerCase()}, les prix montent (${p}).` : `Marché : ${eventTitle(e).toLowerCase()}, les prix chutent (${p}).`;
}

function remaining(left: number): string {
  return left > 75 ? `encore ${Math.round(left / 60)} min` : 'bientôt terminé';
}

/** Événements en cours, une ligne chacun (vide s'il n'y en a pas). */
function eventList(g: GameState): string {
  const list = g.market.active();
  if (!list.length) return '<p class="mk-calm">Marché calme : aucun événement en cours. Les cours dérivent doucement autour du prix de base.</p>';
  const rows = list
    .map((e) => `<li class="${e.up ? 'up' : 'down'}"><b>${e.up ? '▲' : '▼'} ${eventTitle(e)}</b> <span class="mk ${e.up ? 'up' : 'down'}">${e.pct > 0 ? '+' : '−'}${Math.abs(e.pct)} %</span> <small>${remaining(e.left)}</small></li>`)
    .join('');
  return `<ul class="mk-events">${rows}</ul>`;
}

/** Bandeau de rappel au Comptoir : les événements en cours, sur une ligne chacun (rien s'il n'y en a pas). */
export function counterBanner(g: GameState): string {
  const list = g.market.active();
  if (!list.length) return '';
  return `<ul class="mk-events slim">${list
    .map((e) => `<li class="${e.up ? 'up' : 'down'}"><b>${e.up ? '▲' : '▼'} ${eventTitle(e)}</b> <span class="mk ${e.up ? 'up' : 'down'}">${e.pct > 0 ? '+' : '−'}${Math.abs(e.pct)} %</span></li>`)
    .join('')}</ul>`;
}

/** Le meilleur et le pire moment du jour parmi les minerais connus, en une phrase chacun. */
function advice(g: GameState): string {
  const known = COMMODITIES.filter((id) => knownOre(g, id));
  if (!known.length) return '';
  const byMult = [...known].sort((a, b) => g.market.mult(b) - g.market.mult(a));
  const best = byMult[0];
  const worst = byMult[byMult.length - 1];
  const lines: string[] = [];
  if (g.market.mult(best) >= 1 + MARKET.good) {
    const held = g.inventory.count(best);
    lines.push(`<div class="status good">▲ Bon moment pour vendre : ${resIcon(best)} ${getResource(best).name} à ${pct(g.market.mult(best))}${held ? ` (vous en avez ${held} dans le sac)` : ''}.</div>`);
  }
  if (worst !== best && g.market.mult(worst) <= 1 - MARKET.good)
    lines.push(`<div class="status warn">▼ ${getResource(worst).name} est bradé (${pct(g.market.mult(worst))}) : gardez-le dans un coffre en attendant la remontée.</div>`);
  return lines.join('');
}

/** Courbe d'un minerai sur les 10 dernières minutes : échelle logarithmique centrée sur le prix de base (pointillés). */
export function sparkline(values: number[], label: string, w = 168, h = 38): string {
  const n = MARKET.history;
  const logs = values.map((v) => Math.log(v));
  // L'échelle s'adapte aux variations, sans jamais devenir plus fine que ±28 %.
  const span = Math.max(0.25, ...logs.map(Math.abs)) * 1.12;
  const px = (i: number) => (((n - values.length + i) / (n - 1)) * (w - 4) + 2).toFixed(1);
  const py = (l: number) => (h / 2 - (l / span) * (h / 2 - 3)).toFixed(1);
  const cur = values.length ? values[values.length - 1] : 1;
  const line = values.length > 1 ? `<polyline points="${values.map((v, i) => `${px(i)},${py(Math.log(v))}`).join(' ')}"/>` : '';
  const dot = values.length ? `<circle cx="${px(values.length - 1)}" cy="${py(Math.log(cur))}" r="2.5"/>` : '';
  return `<svg class="spark ${tone(cur)}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><line class="base" x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/>${line}${dot}</svg>`;
}

function marketRows(g: GameState): string {
  return RESOURCES.filter((r) => COMMODITIES.includes(r.id) && knownOre(g, r.id))
    .map((r) => {
      const ingot = ingotOf(r.id);
      const smelted = ingot && g.stats.discovered.includes(ingot) ? `<small>Lingot : ${price(g.market.price(ingot))}</small>` : '';
      const hist = g.market.history(r.id);
      const low = Math.min(...hist);
      const high = Math.max(...hist);
      const label = `${r.name} : de ${pct(low)} à ${pct(high)} sur les 10 dernières minutes, ${pct(g.market.mult(r.id))} maintenant`;
      return `<tr><td>${resIcon(r.id)} ${r.name}<small>Prix de base : ${price(r.value)}</small>${smelted}</td>
        <td class="spark-cell" title="${esc(label)}">${sparkline(hist, label)}</td>
        <td class="num">${price(g.market.price(r.id))}<br>${trendTag(g, r.id, true)}</td></tr>`;
    })
    .join('');
}

/** Onglet « Marché » du Tableau d'affichage : événements, conseils et courbes des 10 dernières minutes. */
export function marketTab(g: GameState): string {
  const rows = marketRows(g);
  const unknown = COMMODITIES.some((id) => !knownOre(g, id));
  return `
    <p class="sub">Les prix de vente changent au fil du temps. Le comptoir et les caisses d'expédition paient au cours du moment.</p>
    ${eventList(g)}
    ${advice(g)}
    ${
      rows
        ? `<table class="table mk-table"><thead><tr><th>Minerai</th><th>10 dernières minutes</th><th class="num">Prix du moment</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">Pointillés : le prix de base. Un lingot suit le cours de son minerai. Stockez dans un coffre quand le cours est bas, vendez quand il remonte.${unknown ? ' D\'autres minerais apparaîtront ici à mesure que vous les découvrirez.' : ''}</p>`
        : '<p class="empty">Aucun minerai connu pour l\'instant : minez-en pour suivre son cours.</p>'
    }`;
}

/** Événements en cours pour le HUD : au plus deux lignes courtes, « ▲ Cuivre +45 % ». */
export function hudMarket(g: GameState): string {
  return g.market
    .active()
    .slice(0, 2)
    .map((e) => `<div class="mk ${e.up ? 'up' : 'down'}" title="${esc(`${eventTitle(e)} : ${remaining(e.left)}`)}">${e.up ? '▲' : '▼'} ${getResource(e.res).name} ${e.pct > 0 ? '+' : '−'}${Math.abs(e.pct)} %</div>`)
    .join('');
}
