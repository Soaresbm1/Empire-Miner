/**
 * Le Grand Chevalement à l'écran : le panneau du chantier (phase en cours, matériaux, salaires, commandes honorées) et, une fois
 * le monument achevé, l'écran de fin avec les chiffres de la partie. Rien ici ne modifie la partie.
 */
import { CROWN_PHASE, PHASES, PROJECT2_TITLE, PROJECT_TITLE, stageOf, type Stage } from '../data/project';
import { getResource } from '../data/resources';
import { projectForecast } from '../sim/Forecast';
import type { GameState } from '../sim/GameState';
import { needTag, projectForecastHtml } from './forecast';
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
  const st = stageOf(phase);
  if (!ph) return `${st.name} : phase terminée !`;
  if (last) return phase + 1 === CROWN_PHASE ? `Le Grand Chevalement est achevé ! ${PROJECT_TITLE} : un second chantier s'ouvre, l'Ascenseur de puits.` : `L'Ascenseur de puits est achevé ! ${PROJECT2_TITLE} : la mine est à vous, jusqu'au fond.`;
  return `${st.name} : « ${ph.name} » est terminée ! ${ph.perk.text}.`;
}

/** Une ligne d'avancement : ce que c'est, où l'on en est, une barre. */
function row(label: string, n: number, of: number, extra = '', fmt: (v: number) => string = String): string {
  const pct = of > 0 ? Math.min(100, (n / of) * 100) : 100;
  return `<li class="site-row ${n >= of ? 'ok' : ''}"><span class="ord-what">${label}</span><b class="ord-n ${n >= of ? 'ok' : ''}">${fmt(Math.min(n, of))} / ${fmt(of)}</b>${extra}<div class="ord-meter"><i style="width:${pct}%"></i></div></li>`;
}

/** Les phases d'un chantier en frise : terminées, en cours, à venir. */
function steps(g: GameState, stage: Stage): string {
  return `<ol class="site-steps">${PHASES.slice(stage.from, stage.to).map((ph, k) => {
    const i = stage.from + k;
    const st = i < g.project.phase ? 'done' : i === g.project.phase ? 'now' : 'next';
    return `<li class="${st}" title="${esc(`${ph.name} : ${ph.perk.text}`)}"><i>${st === 'done' ? '✓' : k + 1}</i><span>${esc(ph.name)}</span></li>`;
  }).join('')}</ol>`;
}

/** Les avantages déjà gagnés par les phases terminées. */
function earned(g: GameState): string {
  const list = PHASES.slice(0, g.project.phase).map((ph) => `<li>${esc(ph.perk.text)}</li>`);
  return list.length ? `<h4>Acquis</h4><ul class="site-perks">${list.join('')}</ul>` : '';
}

/** Petite ligne sous un besoin : ce qu'il y a dans le sac, et le temps qu'il faut encore au rythme actuel. */
function note(...parts: string[]): string {
  const shown = parts.filter(Boolean);
  return shown.length ? `<small class="ord-bag">${shown.join(' · ')}</small>` : '';
}

/** La phase en cours : matériaux, salaires, commandes honorées, boutons. */
function phaseBlock(g: GameState): string {
  const p = g.project;
  const spec = p.spec!;
  // Au rythme de la production récente : dans combien de temps chaque besoin, et la phase entière, seront couverts.
  const fc = projectForecast(p, g.money, (res) => g.inventory.count(res), g.production.recent());
  const tagOf = (res: string | null) => {
    const need = fc.needs.find((x) => x.res === res);
    return needTag(need, !!need && need === fc.slowest);
  };
  const rows = spec.needs
    .map((n) => {
      const got = p.delivered[n.res] ?? 0;
      const bag = g.inventory.count(n.res);
      return row(`${resIcon(n.res)} ${esc(getResource(n.res).name)}`, got, n.qty, note(bag > 0 && got < n.qty ? `dans le sac : ${bag}` : '', tagOf(n.res)));
    })
    .join('');
  const wages = row('Salaires des ouvriers', p.funded, spec.money, note(tagOf(null)), (v) => money(v));
  const orders = spec.contracts > 0 ? row('Commandes honorées', g.stats.contracts, spec.contracts, '<small class="ord-bag">Tableau d’affichage</small>') : '';
  const bagUseful = p.missing().some((n) => g.inventory.count(n.res) > 0);
  const pay = Math.min(g.money, p.moneyLeft());
  const waitingOrders = p.supplied() && g.stats.contracts < spec.contracts;
  // Des produits de la Manufacture au programme : on dit d'où ils viennent.
  const made = spec.needs.filter((n) => getResource(n.res).product);
  const where = made.length
    ? `<p class="hint">${made.length > 1 ? 'Ces produits se fabriquent' : 'Ce produit se fabrique'} à la <b>Manufacture</b> (Atelier, onglet Machines), à partir de lingots, de plaques ou de diamants bruts (le mécanisme : engrenages, acier et fils, chacun fabriqué par une Manufacture) : posez-en une sur votre ligne, puis réglez une caisse d'expédition sur « Chantier » à sa sortie.</p>`
    : '';
  return `
    <p class="sub">${esc(spec.blurb)}</p>
    ${
      waitingOrders
        ? `<div class="status warn">Tout est livré et payé. Les ouvriers attendent que vous ayez honoré ${spec.contracts} commande${spec.contracts > 1 ? 's' : ''} (${g.stats.contracts} pour l'instant) : voyez le Tableau d'affichage.</div>`
        : ''
    }
    <h4>Matériaux, salaires, commandes</h4>
    <ul class="site-rows">${rows}${wages}${orders}</ul>
    ${projectForecastHtml(fc)}
    ${where}
    <div class="panel-footer">
      <span class="muted">Récompense : <b class="gold">${esc(spec.perk.text)}</b></span>
      <span class="site-acts">${btn('siteFund', pay > 0 ? `Verser ${money(pay)}` : 'Verser des salaires', { disabled: p.moneyLeft() <= 0 || g.money <= 0, title: p.moneyLeft() <= 0 ? 'Les ouvriers sont payés pour cette phase' : g.money <= 0 ? "Vous n'avez pas d'argent" : undefined })}${btn('siteDeliver', 'Livrer mon sac', { cls: 'primary', disabled: !bagUseful, title: bagUseful ? undefined : "Rien dans votre sac que cette phase n'attend" })}</span>
    </div>
    ${earned(g)}
    <p class="hint">Plus besoin de revenir ici à chaque fois : posez une caisse d'expédition au camp, réglez-la sur <b>Chantier</b> (son panneau), et amenez-y vos lingots par convoyeur. Son transporteur livre au chantier ce que la phase attend, et vend le reste.</p>`;
}

/** Écran de fin : l'Ascenseur de puits est achevé. */
function victory(g: GameState): string {
  const st = g.stats;
  const cells: [string, string][] = [
    ['Temps de jeu', duration(st.playTime)],
    ['Argent gagné', money(st.earned)],
    ['Blocs minés', num(st.tilesMined, 0)],
    ['Minerais ramassés', num(st.itemsCollected, 0)],
    ['Profondeur maximale', `${Math.floor(st.maxDepth)} m`],
    ['Lingots fondus', num(st.smelted, 0)],
    ['Produits fabriqués', num(st.crafted, 0)],
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
      <p class="victory-title">★ ${esc(PROJECT2_TITLE)} ★</p>
      <p class="sub">Le Grand Chevalement domine la mine et l'Ascenseur de puits la perce jusqu'au fond : neuf phases, des mécanismes par centaines, des plaques d'or et des diamants taillés. Vous pouvez continuer à jouer : les commandes et les caisses d'expédition continuent comme avant.</p>
    </div>
    <h4>Votre empire en chiffres</h4>
    <div class="stats-grid">${cells.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
    <h4>Le chantier, phase par phase</h4>
    <ul class="site-when">${when}</ul>
    <div class="panel-footer"><span class="muted">Merci d'avoir creusé jusque-là.</span>${btn('close', 'Continuer à jouer', { cls: 'primary' })}</div>`;
}

/** Au couronnement du Grand Chevalement : le titre gagné, et ce qui s'ouvre ensuite. Il reste en tête du panneau du second chantier. */
function crownBanner(g: GameState): string {
  return `
    <div class="victory">
      <p class="victory-title">★ ${esc(PROJECT_TITLE)} ★</p>
      <p class="sub">Le Grand Chevalement domine la mine depuis ${duration(g.project.doneAt[CROWN_PHASE - 1] ?? 0)} de jeu. Un second chantier s'ouvre : l'Ascenseur de puits.</p>
    </div>`;
}

/** Corps du panneau des grands chantiers : celui en cours, ou l'écran de fin quand tout est achevé. */
export function sitePanel(g: GameState): string {
  if (g.project.done) return victory(g);
  const p = g.project;
  const st = stageOf(p.phase);
  return `
    ${p.crowned ? crownBanner(g) : ''}
    <div class="site-head"><b>${esc(st.name)} : phase ${p.phase - st.from + 1} sur ${st.to - st.from}</b> — ${esc(p.spec!.name)}<span class="site-pct">${Math.round(p.progress() * 100)} %</span></div>
    ${steps(g, st)}
    ${phaseBlock(g)}`;
}
