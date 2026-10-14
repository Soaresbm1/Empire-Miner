/**
 * Prévisions à l'écran : « au rythme actuel, la phase est prête dans ~25 min, retenue par les lingots d'argent ». Les chiffres
 * viennent de `sim/Forecast` ; rien ici ne modifie la partie.
 */
import { getResource } from '../data/resources';
import { FAR_MINUTES, fitIn, type Fit, type Forecast, type Need } from '../sim/Forecast';
import { esc, num } from './format';

/** Ce que veut dire une prévision, en infobulle. */
export const FORECAST_TITLE =
  "Estimation d'après ce que vos machines ont produit ces 2 dernières minutes, ce que vous portez compris. Un ordre de grandeur pour décider s'il faut bâtir une ligne de plus, pas une promesse.";

/** « 2,1 /min », « 24 /min » : un débit. */
export function perMin(v: number): string {
  return `${num(v, v < 10 ? 1 : 0)} /min`;
}

/** « moins d'une minute », « ~7 min », « ~1 h 20 », « plus de 10 h » : une durée estimée. */
export function eta(minutes: number): string {
  if (minutes >= FAR_MINUTES) return 'plus de 10 h';
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const total = Math.round(minutes / 5) * 5;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `~${h} h ${String(m).padStart(2, '0')}` : `~${h} h`;
}

/** Le nom d'un besoin : celui de la ressource, ou « les salaires ». */
export const needName = (n: Need): string => (n.res === null ? 'les salaires' : getResource(n.res).name.toLowerCase());

/** Pourquoi un besoin n'avance pas : rien ne produit ce qu'il faut. */
function stalledWhy(n: Need): string {
  return n.res === null ? 'aucune vente depuis 2 minutes' : `aucune production de ${needName(n)} depuis 2 minutes`;
}

/** Ce qu'il manque d'un besoin : « 52 » ou « 1 250 $ ». */
function leftText(n: Need): string {
  return n.res === null ? `${num(Math.ceil(n.left), 0)} $` : num(Math.ceil(n.left), 0);
}

/** Ce qui arrive chaque minute : « 2,1 /min » pour un matériau, « 1 200 $/min » pour l'argent. */
function rateText(n: Need): string {
  return n.res === null ? `${num(Math.round(n.rate), 0)} $/min` : perMin(n.rate);
}

/** Étiquette d'un besoin sur sa ligne d'avancement : « ~12 min », « aucune production », ou rien s'il est couvert. */
export function needTag(n: Need | undefined, slowest: boolean): string {
  if (!n || n.minutes === 0) return '';
  if (n.minutes === null) return `<span class="eta none" title="${esc(FORECAST_TITLE)}">${n.res === null ? 'aucune vente' : 'aucune production'}</span>`;
  return `<span class="eta ${slowest ? 'slow' : ''}" title="${esc(FORECAST_TITLE)}">${eta(n.minutes)}</span>`;
}

/** Bloc de prévision du chantier. Vide quand rien ne manque (la phase se termine, ou attend ses commandes). */
export function projectForecastHtml(f: Forecast): string {
  if (!f.needs.length) return '';
  const slow = f.slowest;
  if (f.minutes === 0 || !slow) {
    return `<div class="forecast good" title="${esc(FORECAST_TITLE)}"><b>Votre sac et votre argent couvrent tout ce qui manque</b><span>Livrez le sac et versez les salaires : la phase se termine.</span></div>`;
  }
  if (f.minutes === null) {
    return `<div class="forecast bad" title="${esc(FORECAST_TITLE)}"><b>À ce rythme, ${esc(needName(slow))} n'avance pas</b><span>${esc(stalledWhy(slow))} : il en manque ${leftText(slow)}.</span></div>`;
  }
  return `<div class="forecast" title="${esc(FORECAST_TITLE)}"><b>Au rythme actuel, la phase est prête dans ${eta(f.minutes)}</b><span>Ce qui la retient : ${esc(needName(slow))} (${rateText(slow)}, il en manque ${leftText(slow)}).</span></div>`;
}

/** Ligne « À votre rythme » d'une commande acceptée : tient-elle avant l'échéance (`left` s) ? */
export function activeForecastHtml(f: Forecast, left: number): string {
  const fit = fitIn(f, left);
  return `<div class="stat" title="${esc(FORECAST_TITLE)}"><span>À votre rythme</span><b class="${tone(fit)}">${activeText(f, fit)}</b></div>`;
}

/** Ligne « Réalisable ? » d'une proposition : tiendrait-elle dans le délai accordé (`limit` s) ? */
export function offerForecastHtml(f: Forecast, limit: number): string {
  const fit = fitIn(f, limit);
  return `<div class="stat" title="${esc(FORECAST_TITLE)}"><span>Réalisable ?</span><b class="${tone(fit)}">${offerText(f, fit, limit)}</b></div>`;
}

const tone = (fit: Fit): string => (fit === 'ready' || fit === 'ok' ? 'good' : fit === 'tight' ? 'warn' : 'bad');

/** Le besoin qui retient une prévision, en une phrase courte. */
function holdUp(f: Forecast): string {
  return f.slowest ? esc(needName(f.slowest)) : '';
}

function activeText(f: Forecast, fit: Fit): string {
  switch (fit) {
    case 'ready':
      return 'tout est dans votre sac';
    case 'stalled':
      return `rien n'avance : ${holdUp(f)}`;
    case 'ok':
      return `${eta(f.minutes!)} · dans les temps`;
    case 'tight':
      return `${eta(f.minutes!)} · de justesse (${holdUp(f)})`;
    case 'late':
      return `${eta(f.minutes!)} · trop long (${holdUp(f)})`;
  }
}

function offerText(f: Forecast, fit: Fit, limit: number): string {
  const delay = `délai ${Math.round(limit / 60)} min`;
  switch (fit) {
    case 'ready':
      return 'oui : tout est dans votre sac';
    case 'stalled':
      return `pas encore : ${f.slowest?.res === null ? 'aucune vente' : `aucune production de ${holdUp(f)}`}`;
    case 'ok':
      return `oui, ${eta(f.minutes!)} (${delay})`;
    case 'tight':
      return `juste : ${eta(f.minutes!)} (${delay})`;
    case 'late':
      return `non : ${eta(f.minutes!)} (${delay})`;
  }
}
