/**
 * Commandes à l'écran : onglet « Commandes » du Tableau d'affichage, ligne du HUD et annonces. Les chiffres viennent de
 * `GameState.contracts` ; rien ici ne modifie la partie.
 */
import { CLIENTS, CONTRACTS, GOODS, REPUTATION, rankOf } from '../data/contracts';
import { getResource } from '../data/resources';
import { baseValue, type Contract } from '../sim/Contracts';
import { orderForecast } from '../sim/Forecast';
import type { GameState } from '../sim/GameState';
import type { Rates } from '../sim/Production';
import { activeForecastHtml, offerForecastHtml } from './forecast';
import { esc, money, resIcon } from './format';
import { btn } from './widgets';

/** « 9:05 » : un décompte en minutes et secondes. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** « 10 min » : une durée ronde. */
const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

/** « de cuivre », « d'or », « de lingots d'or » : le complément d'un nom de ressource, en minuscules. */
const nameOf = (res: string) => getResource(res).name.toLowerCase();

/** Ce que demande une ligne, en lettres : « 40 cuivre », « 12 lingot de fer ». */
export function lineText(res: string, qty: number): string {
  return `${qty} ${nameOf(res)}`;
}

/** Toutes les lignes d'une commande en une phrase : « 40 cuivre et 12 lingot de fer ». */
export function linesText(lines: readonly [string, number][]): string {
  return lines.map(([res, qty]) => lineText(res, qty)).join(' et ');
}

export const clientName = (index: number): string => CLIENTS[index] ?? CLIENTS[0];

/** Ce que le client retient de la commande : un nouveau niveau de confiance (en hausse ou en baisse), ou rien. */
function memory(e: { client: number; trust?: { level: number; up: boolean } }): string {
  if (!e.trust) return '';
  const who = clientName(e.client);
  if (e.trust.up) return ` ${who} vous fait désormais confiance : ${REPUTATION.levels[e.trust.level].name}.`;
  return e.trust.level === 0 ? ` ${who} ne vous fait plus confiance.` : ` ${who} est moins sûr de vous : ${REPUTATION.levels[e.trust.level].name}.`;
}

/** Annonce d'un événement de commande (proposition, commande honorée, en retard, abandonnée). */
export function contractNews(e: {
  kind: 'offer' | 'done' | 'late' | 'abandoned';
  client: number;
  paid: number;
  lines: [string, number][];
  exclusive?: boolean;
  trust?: { level: number; up: boolean };
}): string {
  const who = clientName(e.client);
  const what = linesText(e.lines);
  switch (e.kind) {
    case 'offer':
      return e.exclusive
        ? `Commande exclusive : ${who}, qui compte sur vous, vous réserve ${what}, pour ${money(e.paid)} (Tableau d'affichage).`
        : `Nouvelle commande : ${who} veut ${what}, pour ${money(e.paid)} (Tableau d'affichage).`;
    case 'done':
      return `Commande honorée : ${who} vous verse ${money(e.paid)} !${memory(e)}`;
    case 'late':
      return (e.paid > 0 ? `Commande en retard : ${who} ne paie que ce qui est livré (${money(e.paid)}).` : `Commande en retard : ${who} s'est tourné vers un autre fournisseur.`) + memory(e);
    case 'abandoned':
      return (e.paid > 0 ? `Commande abandonnée : ${who} paie ce qui est livré (${money(e.paid)}).` : `Commande abandonnée : ${who} ne doit rien.`) + memory(e);
  }
}

/** L'étiquette de confiance d'un client (rien pour un client nouveau), avec dans l'infobulle ce que ça lui rapporte. */
function trustTag(g: GameState, client: number): string {
  const t = g.contracts.trust(client);
  if (t.index === 0) return '';
  const pts = g.contracts.reputation[client] ?? 0;
  const next = t.next === null ? 'niveau maximal' : `encore ${t.next - pts} point${t.next - pts > 1 ? 's' : ''} avant le niveau suivant`;
  const tip = `${t.name} : ${pts} point${pts > 1 ? 's' : ''} de confiance (${next}). Ses commandes paient ${Math.round(t.premium * 100)} points de prime de plus et laissent ${Math.round(t.time * 100)} % de temps en plus.`;
  return `<span class="tag trust t${t.index}" title="${esc(tip)}">${esc(t.name)}</span>`;
}

const EXCLUSIVE_TAG = `<span class="tag excl" title="Une exclusivité : à chaque nouveau rang, votre client le plus fidèle vous réserve une grosse commande, mieux payée, avec plus de temps. Elle reste affichée plus longtemps, mais elle ne revient pas.">★ Exclusive</span>`;

/** Écart de la récompense au prix du marché : « +42 % ». */
function bonusTag(reward: number, market: number): string {
  if (market <= 0) return '';
  const p = Math.round((reward / market - 1) * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)} %`;
}

/** Une ligne de commande : icône, quantité, nom, et (commande acceptée) avancement. */
function lineRow(g: GameState, l: { res: string; qty: number; done: number }, accepted: boolean): string {
  const r = getResource(l.res);
  const have = g.inventory.count(l.res);
  if (!accepted) return `<li><span class="ord-what">${resIcon(l.res)} <b>${l.qty}</b> ${esc(r.name)}</span><small>${esc(`${money(g.quote(l.res, l.qty))} au marché`)}</small></li>`;
  const pct = Math.min(100, (l.done / l.qty) * 100);
  const bag = have > 0 && l.done < l.qty ? `<small class="ord-bag">dans le sac : ${have}</small>` : '';
  return `<li><span class="ord-what">${resIcon(l.res)} ${esc(r.name)}</span><b class="ord-n ${l.done >= l.qty ? 'ok' : ''}">${l.done} / ${l.qty}</b>${bag}<div class="ord-meter"><i style="width:${pct}%"></i></div></li>`;
}

/** Une commande acceptée : où elle en est, combien il reste de temps, et ses boutons. `rates` : la production récente (prévision). */
function activeCard(g: GameState, c: Contract, confirmAbandon: number | null, rates: Rates): string {
  const left = c.until - g.time;
  const useful = c.lines.some((l) => l.done < l.qty && g.inventory.count(l.res) > 0);
  const clockCls = left < 60 ? 'late' : left < 180 ? 'soon' : '';
  const sure = confirmAbandon === c.id;
  return `<div class="card ord st-active">
    <div class="ord-head"><span class="ord-who"><b>${esc(clientName(c.client))}</b>${c.exclusive ? EXCLUSIVE_TAG : ''}${trustTag(g, c.client)}</span><span class="ord-time ${clockCls}" title="Temps restant pour livrer">⏱ ${clock(left)}</span></div>
    <ul class="ord-lines">${c.lines.map((l) => lineRow(g, l, true)).join('')}</ul>
    <div class="stat"><span>Récompense</span><b class="gold">${money(c.reward)}</b></div>
    ${activeForecastHtml(orderForecast(c, (res) => g.inventory.count(res), rates), left)}
    <div class="buy">${btn('contractDeliver', 'Livrer mon sac', { arg: String(c.id), cls: 'primary small', disabled: !useful, title: useful ? undefined : "Rien dans votre sac que cette commande n'attend" })}${btn(
      'contractAbandon',
      sure ? 'Sûr ? Appuyez encore' : 'Abandonner',
      {
        arg: String(c.id),
        cls: `small ${sure ? 'danger' : ''}`,
        title: `Le client paie seulement ce qui est livré, au prix de base (${money(Math.round(baseValue(c, true) * CONTRACTS.partialPay))} pour l'instant), sans la prime${
          (g.contracts.reputation[c.client] ?? 0) > 0 ? `, et il perd ${REPUTATION.abandon} point de confiance en vous` : ''
        }`,
      },
    )}</div>
  </div>`;
}

/** Une proposition : de quoi se décider (ce que ça rapporte, par rapport au marché, en combien de temps, et si la production suffit). */
function offerCard(g: GameState, c: Contract, rates: Rates): string {
  const market = c.lines.reduce((s, l) => s + g.quote(l.res, l.qty), 0);
  const full = g.contracts.active().length >= g.contracts.slots;
  const left = c.until - g.time;
  return `<div class="card ord offer">
    <div class="ord-head"><span class="ord-who"><b>${esc(clientName(c.client))}</b>${c.exclusive ? EXCLUSIVE_TAG : ''}${trustTag(g, c.client)}${c.hot ? '<span class="tag hot" title="Forte demande sur le marché : le client paie une prime de plus">▲ Forte demande</span>' : ''}</span></div>
    <ul class="ord-lines">${c.lines.map((l) => lineRow(g, l, false)).join('')}</ul>
    <div class="stat"><span>Il paie</span><b class="gold">${money(c.reward)} <em>${bonusTag(c.reward, market)}</em></b></div>
    <div class="stat"><span>Au marché, ce serait</span><b>${money(market)}</b></div>
    <div class="stat"><span>Délai une fois acceptée</span><b>${minutes(c.limit)}</b></div>
    ${offerForecastHtml(orderForecast(c, (res) => g.inventory.count(res), rates), c.limit)}
    <div class="stat"><span>Reste affichée encore</span><b>${clock(left)}</b></div>
    <div class="buy">${btn('contractAccept', 'Accepter', { arg: String(c.id), cls: 'primary small', disabled: full, title: full ? `Vous menez déjà ${g.contracts.slots} commandes : terminez-en une, ou abandonnez-en une` : undefined })}${btn('contractDecline', 'Refuser', { arg: String(c.id), cls: 'small' })}</div>
  </div>`;
}

/** Rang du joueur : son titre et ce qu'il lui manque pour le suivant. */
function rankBlock(g: GameState): string {
  const done = g.stats.contracts;
  const rank = rankOf(done);
  const next = rank.next;
  const bar = next === null ? '' : `<div class="bar"><div style="width:${Math.min(100, ((done - rank.at) / (next - rank.at)) * 100)}%"></div><span>${done} / ${next} commandes honorées</span></div>`;
  const perks = rank.index > 0 ? ` · commandes ${Math.round(rank.index * CONTRACTS.rankQty * 100)} % plus grosses, ${rank.index * Math.round(CONTRACTS.rankPremium * 100)} points de prime en plus` : '';
  return `<div class="ord-rank"><b>${esc(rank.name)}</b><small>${done} commande${done > 1 ? 's' : ''} honorée${done > 1 ? 's' : ''}${next === null ? ' · rang maximal' : ''}${perks}</small></div>${bar}`;
}

/** Les clients qui connaissent le joueur : leur niveau de confiance et leurs points, le plus fidèle d'abord (six au plus). */
function clientsBlock(g: GameState): string {
  const all = g.contracts.regulars();
  if (!all.length) return '';
  const rows = all
    .slice(0, 6)
    .map((r) => {
      const left = r.trust.next === null ? 'niveau maximal' : `${r.trust.next - r.points} point${r.trust.next - r.points > 1 ? 's' : ''} avant le suivant`;
      return `<li><span class="ord-what">${esc(clientName(r.client))}</span><span class="tag trust t${r.trust.index}">${esc(r.trust.name)}</span><small class="ord-pts">${left}</small></li>`;
    })
    .join('');
  const more = all.length > 6 ? `<li class="ord-more">… et ${all.length - 6} autre${all.length - 6 > 1 ? 's' : ''}</li>` : '';
  return `<h4>Vos clients <small class="ord-count">${all.length}</small></h4><ul class="ord-clients">${rows}${more}</ul>`;
}

/** Onglet « Commandes » du Tableau d'affichage. `abandon` : la commande dont l'abandon attend une confirmation. */
export function ordersTab(g: GameState, abandon: number | null = null): string {
  const active = g.contracts.active();
  const offers = g.contracts.offers();
  const waiting = !active.length && !offers.length;
  const slots = g.contracts.slots;
  const useful = active.some((c) => c.lines.some((l) => l.done < l.qty && g.inventory.count(l.res) > 0));
  // Les clients ne demandent que ce que le joueur a déjà trouvé.
  const knows = GOODS.some((x) => g.stats.discovered.includes(x.res) || (g.stats.collected[x.res] ?? 0) > 0);
  const empty = `<p class="empty">${
    knows ? 'Les clients arrivent : la prochaine proposition ne devrait pas tarder.' : "Aucun client pour l'instant. Ils achètent ce que vous avez déjà trouvé : minez du charbon ou du cuivre, puis revenez."
  }</p>`;
  // Production récente, pour dire si chaque commande est à la portée de vos machines.
  const rates = g.production.recent();
  return `
    <p class="sub ord-intro">Des clients achètent une quantité précise, plus cher que le marché, avant une échéance. Ce que vous ne livrez pas à temps est payé au prix de base.</p>
    ${rankBlock(g)}
    <h4>Vos commandes <small class="ord-count">${active.length} / ${slots}</small></h4>
    ${
      active.length
        ? `<div class="cards one">${active.map((c) => activeCard(g, c, abandon, rates)).join('')}</div>
      <div class="panel-footer"><span class="muted">Livrez ce qu'il y a dans votre sac, ou réglez une caisse d'expédition sur « Commandes ».</span>${btn('contractDeliver', 'Tout livrer', { arg: '', cls: 'primary', disabled: !useful, title: useful ? undefined : "Rien dans votre sac que vos commandes n'attendent" })}</div>`
        : '<p class="empty">Aucune commande en cours : acceptez une proposition ci-dessous.</p>'
    }
    <h4>Propositions <small class="ord-count">${offers.length} / ${g.contracts.capacity}</small></h4>
    ${offers.length ? `<div class="cards">${offers.map((c) => offerCard(g, c, rates)).join('')}</div>` : waiting ? empty : '<p class="empty">Plus de proposition pour le moment : un client reviendra bientôt.</p>'}
    ${clientsBlock(g)}
    <p class="hint">Une commande honorée à temps verse la récompense complète. Chaque client se souvient de vous : à temps, il vous fait plus confiance (il revient plus souvent, paie une meilleure prime et laisse plus de temps) ; en retard ou abandonnée, il en perd un peu. À chaque nouveau rang, votre client le plus fidèle vous réserve une commande exclusive. Le grand chantier du camp (<b>Grand Chevalement</b>) demande lui aussi des commandes honorées, et lui apporter du travail ouvre plus de commandes en parallèle et de meilleures primes.</p>`;
}

/** Ligne du HUD : la commande la plus pressée, et combien d'autres attendent. Vide quand aucune n'est acceptée. */
export function hudOrders(g: GameState): string {
  const active = g.contracts.active();
  if (!active.length) return '';
  const c = active[0];
  const l = c.lines.find((x) => x.done < x.qty) ?? c.lines[0];
  const left = c.until - g.time;
  const more = active.length > 1 ? ` +${active.length - 1}` : '';
  const tip = `${clientName(c.client)} : ${c.lines.map((x) => `${x.done}/${x.qty} ${nameOf(x.res)}`).join(', ')} — récompense ${money(c.reward)}, encore ${clock(left)}`;
  return `<div class="ord-hud ${left < 60 ? 'late' : ''}" title="${esc(tip)}">▸ ${l.done}/${l.qty} ${esc(getResource(l.res).name)}${more} · ${clock(left)}</div>`;
}
