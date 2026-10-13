/**
 * Le Grand Chevalement à l'écran : le panneau du chantier (phase en cours, matériaux, salaires, commandes honorées) et, une fois
 * le monument achevé, l'écran de fin avec les chiffres de la partie. Rien ici ne modifie la partie.
 */
import { PHASES, PROJECT_TITLE } from '../data/project';
import { getResource } from '../data/resources';
import type { GameState } from '../sim/GameState';
import { esc, money, num, resIcon } from './format';
import { btn } from './widgets';

/** « 2 h 05 min » ou « 47 min » : un temps de jeu. */
export function duration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/** Annonce faite quand une phase se termine. */
export function siteNews(phase: number, last: boolean): string {
  const ph = PHASES[phase];
  if (!ph) return 'Grand Chevalement : phase terminée !';
  return last ? `Le Grand Chevalement est achevé ! ${PROJECT_TITLE} : la mine est à vous.` : `Grand Chevalement : « ${ph.name} » est terminée ! ${ph.perk.text}.`;
}

/** Une ligne d'avancement : ce que c'est, où l'on en est, une barre. */
function row(label: string, n: number, of: number, extra = '', fmt: (v: number) => string = String): string {
  const pct = of > 0 ? Math.min(100, (n / of) * 100) : 100;
  return `<li class="site-row ${n >= of ? 'ok' : ''}"><span class="ord-what">${label}</span><b class="ord-n ${n >= of ? 'ok' : ''}">${fmt(Math.min(n, of))} / ${fmt(of)}</b>${extra}<div class="ord-meter"><i style="width:${pct}%"></i></div></li>`;
}

/** Les cinq phases en frise : terminées, en cours, à venir. */
function steps(g: GameState): string {
  return `<ol class="site-steps">${PHASES.map((ph, i) => {
    const st = i < g.project.phase ? 'done' : i === g.project.phase ? 'now' : 'next';
    return `<li class="${st}" title="${esc(`${ph.name} : ${ph.perk.text}`)}"><i>${st === 'done' ? '✓' : i + 1}</i><span>${esc(ph.name)}</span></li>`;
  }).join('')}</ol>`;
}

/** Les avantages déjà gagnés par les phases terminées. */
function earned(g: GameState): string {
  const list = PHASES.slice(0, g.project.phase).map((ph) => `<li>${esc(ph.perk.text)}</li>`);
  return list.length ? `<h4>Acquis</h4><ul class="site-perks">${list.join('')}</ul>` : '';
}

/** La phase en cours : matériaux, salaires, commandes honorées, boutons. */
function phaseBlock(g: GameState): string {
  const p = g.project;
  const spec = p.spec!;
  const rows = spec.needs
    .map((n) => {
      const got = p.delivered[n.res] ?? 0;
      const bag = g.inventory.count(n.res);
      return row(`${resIcon(n.res)} ${esc(getResource(n.res).name)}`, got, n.qty, bag > 0 && got < n.qty ? `<small class="ord-bag">dans le sac : ${bag}</small>` : '');
    })
    .join('');
  const wages = row('Salaires des ouvriers', p.funded, spec.money, '', (v) => money(v));
  const orders = spec.contracts > 0 ? row('Commandes honorées', g.stats.contracts, spec.contracts, '<small class="ord-bag">Tableau d’affichage</small>') : '';
  const bagUseful = p.missing().some((n) => g.inventory.count(n.res) > 0);
  const pay = Math.min(g.money, p.moneyLeft());
  const waitingOrders = p.supplied() && g.stats.contracts < spec.contracts;
  return `
    <p class="sub">${esc(spec.blurb)}</p>
    ${
      waitingOrders
        ? `<div class="status warn">Tout est livré et payé. Les ouvriers attendent que vous ayez honoré ${spec.contracts} commande${spec.contracts > 1 ? 's' : ''} (${g.stats.contracts} pour l'instant) : voyez le Tableau d'affichage.</div>`
        : ''
    }
    <h4>Matériaux, salaires, commandes</h4>
    <ul class="site-rows">${rows}${wages}${orders}</ul>
    <div class="panel-footer">
      <span class="muted">Récompense : <b class="gold">${esc(spec.perk.text)}</b></span>
      <span class="site-acts">${btn('siteFund', pay > 0 ? `Verser ${money(pay)}` : 'Verser des salaires', { disabled: p.moneyLeft() <= 0 || g.money <= 0, title: p.moneyLeft() <= 0 ? 'Les ouvriers sont payés pour cette phase' : g.money <= 0 ? "Vous n'avez pas d'argent" : undefined })}${btn('siteDeliver', 'Livrer mon sac', { cls: 'primary', disabled: !bagUseful, title: bagUseful ? undefined : "Rien dans votre sac que cette phase n'attend" })}</span>
    </div>
    ${earned(g)}
    <p class="hint">Plus besoin de revenir ici à chaque fois : posez une caisse d'expédition au camp, réglez-la sur <b>Chantier</b> (son panneau), et amenez-y vos lingots par convoyeur. Son transporteur livre au chantier ce que la phase attend, et vend le reste.</p>`;
}

/** Écran de fin : le monument est achevé. */
function victory(g: GameState): string {
  const st = g.stats;
  const cells: [string, string][] = [
    ['Temps de jeu', duration(st.playTime)],
    ['Argent gagné', money(st.earned)],
    ['Blocs minés', num(st.tilesMined, 0)],
    ['Minerais ramassés', num(st.itemsCollected, 0)],
    ['Profondeur maximale', `${Math.floor(st.maxDepth)} m`],
    ['Lingots fondus', num(st.smelted, 0)],
    ['Livré par vos machines', num(st.delivered, 0)],
    ['Vendu par les caisses', money(st.autoSold)],
    ['Commandes honorées', num(st.contracts, 0)],
    ['Gagné en commandes', money(st.contractMoney)],
    ['Machines posées', num(st.structuresBuilt, 0)],
    ['Ouvriers', num(g.workers.count, 0)],
  ];
  const when = PHASES.map((ph, i) => `<li><b>${esc(ph.name)}</b><span>après ${duration(g.project.doneAt[i] ?? 0)} de jeu</span></li>`).join('');
  return `
    <div class="victory">
      <p class="victory-title">★ ${esc(PROJECT_TITLE)} ★</p>
      <p class="sub">Le Grand Chevalement domine la mine : cinq phases, des tonnes de lingots et un diamant au sommet. Vous pouvez continuer à jouer : les commandes et les caisses d'expédition continuent comme avant.</p>
    </div>
    ${steps(g)}
    <h4>Votre empire en chiffres</h4>
    <div class="stats-grid">${cells.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
    <h4>Le chantier, phase par phase</h4>
    <ul class="site-when">${when}</ul>
    <div class="panel-footer"><span class="muted">Merci d'avoir creusé jusque-là.</span>${btn('close', 'Continuer à jouer', { cls: 'primary' })}</div>`;
}

/** Corps du panneau du Grand Chevalement. */
export function sitePanel(g: GameState): string {
  if (g.project.done) return victory(g);
  const p = g.project;
  return `
    <div class="site-head"><b>Phase ${p.phase + 1} sur ${PHASES.length}</b> — ${esc(p.spec!.name)}<span class="site-pct">${Math.round(p.progress() * 100)} %</span></div>
    ${steps(g)}
    ${phaseBlock(g)}`;
}
