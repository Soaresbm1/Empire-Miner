/**
 * Panneau « Statistiques de production », commun au comptoir (vente) et à l'atelier (boutique) :
 * trois chiffres clés, l'histogramme des gains des 10 dernières minutes, un tableau par
 * ressource et les machines à surveiller.
 */
import { RESOURCES } from '../data/resources';
import type { GameState } from '../sim/GameState';
import { GAIN_MINUTES, type MinuteGain, type Rates } from '../sim/Production';
import type { TunnelBorer } from '../sim/structures/Borer';
import type { Drill } from '../sim/structures/Drill';
import type { ShippingCrate } from '../sim/structures/ShippingCrate';
import type { Smelter } from '../sim/structures/Smelter';
import type { Storage } from '../sim/structures/Storage';
import { stuckWorkers } from './crew';
import { esc, money, num, resIcon } from './format';

/** Au-dessus de ce seuil (unités / min), une ligne du tableau s'affiche. */
const SHOWN = 0.05;

/** Argent arrondi, avec une espace insécable : « 69 $ » ne se coupe pas en fin de ligne. */
const cash = (v: number) => money(Math.round(v)).replace(' $', '\u00a0$');

/** Somme des débits (unités / min) hors pierre : elle brouillerait les chiffres du minerai. */
function total(t: Record<string, number>): number {
  let n = 0;
  for (const [res, v] of Object.entries(t)) if (res !== 'stone') n += v;
  return n;
}

function tile(label: string, value: string, unit: string, sub: string): string {
  return `<div class="kpi"><span class="kpi-label">${label}</span><b class="kpi-value">${value}<small> ${unit}</small></b><span class="kpi-sub">${sub}</span></div>`;
}

/** Plus petit « chiffre rond » (1, 2, 2,5, 5 × 10ⁿ) au moins égal à v. */
function niceCeil(v: number): number {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function ago(bar: number): string {
  const back = GAIN_MINUTES - 1 - bar;
  return back === 0 ? 'Cette dernière minute' : `Il y a ${back} min`;
}

/** Histogramme empilé : gains au comptoir et par les caisses d'expédition, une barre par minute. */
function gainChart(gains: MinuteGain[]): string {
  const totals = gains.map((x) => x.counter + x.crate);
  const peak = Math.max(...totals);
  const top = niceCeil(peak);
  const best = peak > 0 ? totals.indexOf(peak) : -1;
  const cols = gains
    .map((x, i) => {
      const sum = totals[i];
      const seg = (cls: string, v: number) => (v > 0 ? `<i class="pc-seg ${cls}" style="flex:${v}"></i>` : '');
      const label = i === GAIN_MINUTES - 1 || i === best ? `<span class="pc-val">${sum > 0 ? cash(sum) : ''}</span>` : '';
      const tip = `${ago(i)} : ${cash(sum)} (comptoir ${cash(x.counter)} · caisses ${cash(x.crate)})`;
      return `<div class="pc-col" title="${esc(tip)}">${label}<div class="pc-stack" style="height:${(sum / top) * 100}%">${seg('crate', x.crate)}${seg('counter', x.counter)}</div></div>`;
    })
    .join('');
  const summary = `Gains par minute, de la plus ancienne à la plus récente : ${totals.map(cash).join(', ')}.`;
  return `
    <div class="pchart" role="img" aria-label="${esc(summary)}">
      <div class="pc-area">
        <i class="pc-grid" style="bottom:0"></i><i class="pc-grid" style="bottom:50%"></i><i class="pc-grid" style="bottom:100%"></i>
        <span class="pc-tick" style="bottom:0">0</span><span class="pc-tick" style="bottom:50%">${cash(top / 2)}</span><span class="pc-tick" style="bottom:100%">${cash(top)}</span>
        <div class="pc-cols">${cols}</div>
        ${peak > 0 ? '' : '<p class="pc-empty">Aucune vente pour l’instant</p>'}
      </div>
    </div>
    <div class="pc-x"><span>il y a ${GAIN_MINUTES} min</span><span>maintenant</span></div>
    <div class="pc-legend"><span><i class="sw counter"></i>Comptoir</span><span><i class="sw crate"></i>Caisses d'expédition</span></div>`;
}

/** Ligne du tableau : « — » quand il n'y a rien. */
function cell(v: number): string {
  return v > SHOWN ? `<td class="num">${num(v, 1)}</td>` : '<td class="num dash">—</td>';
}

function resourceTable(r: Rates): string {
  const rows = RESOURCES.filter((res) => res.id !== 'stone')
    .map((res) => ({ res, ore: r.ore[res.id] ?? 0, ingots: r.ingots[res.id] ?? 0, sold: r.sold[res.id] ?? 0 }))
    .filter((x) => x.ore > SHOWN || x.ingots > SHOWN || x.sold > SHOWN)
    .map((x) => `<tr><td>${resIcon(x.res.id)} ${x.res.name}</td>${cell(x.ore)}${cell(x.ingots)}${cell(x.sold)}</tr>`)
    .join('');
  if (!rows) return '<p class="empty">Rien d’extrait, de fondu ni de vendu depuis un moment : minez, ou lancez une foreuse !</p>';
  return `<table class="table"><thead><tr><th>Ressource</th><th class="num">Extrait</th><th class="num">Fondu</th><th class="num">Vendu</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint">Unités par minute (hors pierre).</p>`;
}

interface Watch {
  n: number;
  text: string;
  tone: 'bad' | 'warn' | 'info';
}

/** Machines à l'arrêt ou ralenties, regroupées par nom et par cause. */
function machineWatch(g: GameState): string {
  let running = 0;
  let count = 0;
  const found = new Map<string, Watch>();
  const flag = (name: string, text: string, tone: Watch['tone']) => {
    const key = `${name}|${text}`;
    const w = found.get(key);
    if (w) w.n++;
    else found.set(key, { n: 1, text: `${name} : ${text}`, tone });
  };
  for (const s of g.structures.list) {
    switch (s.type) {
      case 'drill': {
        const d = s as Drill;
        count++;
        if (d.status === 'ok') {
          running++;
          if (d.heat < 1) flag('Foreuse à charbon', 'ralentie par la chaleur', 'warn');
        } else if (d.status === 'nofuel') flag('Foreuse à charbon', 'plus de charbon', 'bad');
        else if (d.status === 'full') flag('Foreuse à charbon', 'sortie bloquée', 'warn');
        else flag('Foreuse à charbon', 'gisement épuisé', 'warn');
        break;
      }
      case 'borer': {
        const b = s as TunnelBorer;
        count++;
        if (b.status === 'nofuel') flag('Foreuse de percement', 'plus de charbon', 'bad');
        else if (b.status === 'full') flag('Foreuse de percement', 'base pleine de minerai', 'warn');
        else if (b.status === 'blocked' || b.status === 'waiting') flag('Foreuse de percement', 'bloquée', 'warn');
        else {
          if (b.status !== 'idle' && b.status !== 'done') running++;
          if (b.status === 'digging' && b.heat < 1) flag('Foreuse de percement', 'ralentie par la chaleur', 'warn');
        }
        break;
      }
      case 'furnace':
      case 'foundry': {
        const f = s as Smelter;
        count++;
        if (f.status === 'ok') {
          running++;
          if (f.heat < 1) flag(f.def.name, 'ralenti par la chaleur', 'warn');
        } else if (f.status === 'nofuel') flag(f.def.name, 'plus de charbon', 'bad');
        else if (f.status === 'full') flag(f.def.name, 'sortie saturée', 'warn');
        else flag(f.def.name, 'attend du minerai', 'info');
        break;
      }
      case 'shipping': {
        const c = s as ShippingCrate;
        if (c.weight() >= c.capacity - 1e-6) flag("Caisse d'expédition", 'pleine', 'warn');
        break;
      }
      case 'storage': {
        const c = s as Storage;
        if (c.weight() >= c.capacity - 1e-6) flag('Coffre', 'plein', 'warn');
        break;
      }
    }
  }
  // Ouvriers qui ne peuvent pas avancer : un coffre ou du charbon manque.
  for (const w of stuckWorkers(g)) found.set(`crew|${w.text}`, { n: w.n, text: w.text, tone: 'warn' });
  const order = { bad: 0, warn: 1, info: 2 };
  const list = [...found.values()].sort((a, b) => order[a.tone] - order[b.tone]);
  const crew = g.workers.count ? g.workers.list.filter((w) => w.task && w.task.kind !== 'home').length : 0;
  const crewHint = g.workers.count ? `<p class="hint"><b>${crew}</b> ouvrier${crew > 1 ? 's' : ''} au travail sur <b>${g.workers.count}</b>.</p>` : '';
  const head = `${count ? `<p class="hint"><b>${running}</b> machine${running > 1 ? 's' : ''} en marche sur <b>${count}</b>.</p>` : ''}${crewHint}`;
  if (!list.length)
    return count
      ? `${head}<div class="status good">● Tout tourne : aucune machine à l'arrêt.</div>`
      : '<p class="empty">Aucune machine posée. Achetez une foreuse à l\'Atelier, puis posez-la sur un gisement.</p>';
  const rows = list.map((w) => `<li class="${w.tone}"><b>${w.n} ×</b> ${w.text}</li>`).join('');
  return `${head}<ul class="watch">${rows}</ul>`;
}

/** Corps du panneau (sans onglets). */
export function productionStats(g: GameState): string {
  const r = g.production.rates();
  const ore = total(r.ore);
  const ingots = total(r.ingots);
  const ingotValue = Object.entries(r.ingots).reduce((v, [res, n]) => v + n * g.market.price(res), 0);
  const window = r.minutes >= 4.5 ? 'les 5 dernières minutes' : 'ce début de partie';
  return `
    <div class="kpis">
      ${tile('Ventes', cash(r.counter + r.crate), '/ min', `comptoir ${cash(r.counter)} · caisses ${cash(r.crate)}`)}
      ${tile('Extrait', num(ore, 1), 'unités / min', `dont ${num(total({ x: r.machineOre }), 1)} par les machines`)}
      ${tile('Fondu', num(ingots, 1), 'lingots / min', ingots > SHOWN ? `valent ${cash(ingotValue)} / min` : 'aucun four en marche')}
    </div>
    <p class="hint">Moyennes sur ${window}.</p>
    <h4>Gains des ${GAIN_MINUTES} dernières minutes</h4>
    ${gainChart(g.production.gains())}
    <h4>Par ressource</h4>
    ${resourceTable(r)}
    <h4>Machines à surveiller</h4>
    ${machineWatch(g)}`;
}
