/**
 * Le Grand Chevalement à l'écran : le panneau du chantier (phase en cours, matériaux, salaires, commandes honorées) et, une fois
 * le monument achevé, l'écran de fin avec les chiffres de la partie. Rien ici ne modifie la partie.
 */
import { REPUTATION } from '../data/contracts';
import { FAITHFUL_LEVEL, PHASES, PHASES_II, PROJECT_TITLE, PROJECT_TITLE_II, type PhaseSpec } from '../data/project';
import { getResource } from '../data/resources';
import { projectForecast } from '../sim/Forecast';
import type { GameState } from '../sim/GameState';
import type { Project } from '../sim/Project';
import { needTag, projectForecastHtml } from './forecast';
import { esc, money, num, resIcon } from './format';
import { btn } from './widgets';

/** « 2 h 05 min » ou « 47 min » : un temps de jeu. */
export function duration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

const PHASES_BY_ACT = [PHASES, PHASES_II] as const;

/** Nom du chantier de l'acte `act` (1 : le Grand Chevalement, 2 : le Grand Ascenseur). */
export const workName = (act: 1 | 2): string => (act === 2 ? 'Grand Ascenseur' : 'Grand Chevalement');

/** Annonce faite quand une phase se termine (`act` : le chantier concerné). */
export function siteNews(phase: number, last: boolean, act: 1 | 2 = 1, specs: readonly PhaseSpec[] = PHASES_BY_ACT[act - 1]): string {
  const ph = specs[phase];
  if (!ph) return `${workName(act)} : phase terminée !`;
  if (last && act === 2) return `Le Grand Ascenseur est inauguré ! ${PROJECT_TITLE_II} : la mine est à vous, jusqu'au fond.`;
  if (last) return `Le Grand Chevalement est achevé ! ${PROJECT_TITLE} : la mine est à vous. Le chantier se poursuit : le Grand Ascenseur vous attend.`;
  return `${workName(act)} : « ${ph.name} » est terminée ! ${ph.perk.text}.`;
}

/** Une ligne d'avancement : ce que c'est, où l'on en est, une barre. */
function row(label: string, n: number, of: number, extra = '', fmt: (v: number) => string = String): string {
  const pct = of > 0 ? Math.min(100, (n / of) * 100) : 100;
  return `<li class="site-row ${n >= of ? 'ok' : ''}"><span class="ord-what">${label}</span><b class="ord-n ${n >= of ? 'ok' : ''}">${fmt(Math.min(n, of))} / ${fmt(of)}</b>${extra}<div class="ord-meter"><i style="width:${pct}%"></i></div></li>`;
}

/** Les cinq phases en frise : terminées, en cours, à venir. */
function steps(p: Project): string {
  return `<ol class="site-steps">${p.specs.map((ph, i) => {
    const st = i < p.phase ? 'done' : i === p.phase ? 'now' : 'next';
    return `<li class="${st}" title="${esc(`${ph.name} : ${ph.perk.text}`)}"><i>${st === 'done' ? '✓' : i + 1}</i><span>${esc(ph.name)}</span></li>`;
  }).join('')}</ol>`;
}

/** Les avantages déjà gagnés par les phases terminées (des deux chantiers). */
function earned(g: GameState): string {
  const list = [...g.project.specs.slice(0, g.project.phase), ...g.project2.specs.slice(0, g.project2.phase)].map((ph) => `<li>${esc(ph.perk.text)}</li>`);
  return list.length ? `<h4>Acquis</h4><ul class="site-perks">${list.join('')}</ul>` : '';
}

/** Petite ligne sous un besoin : ce qu'il y a dans le sac, et le temps qu'il faut encore au rythme actuel. */
function note(...parts: string[]): string {
  const shown = parts.filter(Boolean);
  return shown.length ? `<small class="ord-bag">${shown.join(' · ')}</small>` : '';
}

/** La phase en cours : matériaux, salaires, commandes honorées, boutons. */
function phaseBlock(g: GameState): string {
  const p = g.work;
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
  const faithful = g.contracts.faithfulCount();
  const loyal = spec.faithful
    ? row(
        'Clients fidèles',
        faithful,
        spec.faithful,
        `<small class="ord-bag" title="${esc(`Un client devient « ${REPUTATION.levels[FAITHFUL_LEVEL].name} » à ${REPUTATION.levels[FAITHFUL_LEVEL].at} points de confiance : une commande honorée à temps lui en donne un.`)}">niveau « ${esc(REPUTATION.levels[FAITHFUL_LEVEL].name)} » ou mieux</small>`,
      )
    : '';
  const bagUseful = p.missing().some((n) => g.inventory.count(n.res) > 0);
  const pay = Math.min(g.money, p.moneyLeft());
  const waitingOrders = p.supplied() && (g.stats.contracts < spec.contracts || faithful < (spec.faithful ?? 0));
  // Des produits de la Manufacture au programme : on dit d'où ils viennent.
  const made = spec.needs.filter((n) => getResource(n.res).product);
  const where = made.length
    ? `<p class="hint">${made.length > 1 ? 'Ces produits se fabriquent' : 'Ce produit se fabrique'} à la <b>Manufacture</b> (Atelier, onglet Machines), à partir de lingots ou de diamants bruts : posez-en une sur votre ligne, puis réglez une caisse d'expédition sur « Chantier » à sa sortie.</p>`
    : '';
  return `
    <p class="sub">${esc(spec.blurb)}</p>
    ${
      waitingOrders
        ? `<div class="status warn">Tout est livré et payé. Les ouvriers attendent ${
            g.stats.contracts < spec.contracts ? `que vous ayez honoré ${spec.contracts} commande${spec.contracts > 1 ? 's' : ''} (${g.stats.contracts} pour l'instant)` : ''
          }${g.stats.contracts < spec.contracts && faithful < (spec.faithful ?? 0) ? ' et ' : ''}${
            faithful < (spec.faithful ?? 0) ? `que ${spec.faithful} client${(spec.faithful ?? 0) > 1 ? 's' : ''} vous fasse${(spec.faithful ?? 0) > 1 ? 'nt' : ''} confiance (${faithful} pour l'instant)` : ''
          } : voyez le Tableau d'affichage.</div>`
        : ''
    }
    <h4>Matériaux, salaires, commandes</h4>
    <ul class="site-rows">${rows}${wages}${orders}${loyal}</ul>
    ${projectForecastHtml(fc)}
    ${where}
    <div class="panel-footer">
      <span class="muted">Récompense : <b class="gold">${esc(spec.perk.text)}</b></span>
      <span class="site-acts">${btn('siteFund', pay > 0 ? `Verser ${money(pay)}` : 'Verser des salaires', { disabled: p.moneyLeft() <= 0 || g.money <= 0, title: p.moneyLeft() <= 0 ? 'Les ouvriers sont payés pour cette phase' : g.money <= 0 ? "Vous n'avez pas d'argent" : undefined })}${btn('siteDeliver', 'Livrer mon sac', { cls: 'primary', disabled: !bagUseful, title: bagUseful ? undefined : "Rien dans votre sac que cette phase n'attend" })}</span>
    </div>
    ${earned(g)}
    <p class="hint">Plus besoin de revenir ici à chaque fois : posez une caisse d'expédition au camp, réglez-la sur <b>Chantier</b> (son panneau), et amenez-y vos lingots par convoyeur. Son transporteur livre au chantier ce que la phase attend, et vend le reste.</p>`;
}

/** Écran de fin d'un acte : le Grand Chevalement (acte 1) ou le Grand Ascenseur (acte 2), avec les chiffres de la partie. */
function victory(g: GameState, act: 1 | 2): string {
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
    ['Clients fidèles', num(g.contracts.faithfulCount(), 0)],
    ['Machines posées', num(st.structuresBuilt, 0)],
    ['Ouvriers', num(g.workers.count, 0)],
  ];
  const p = act === 2 ? g.project2 : g.project;
  const when = p.specs.map((ph, i) => `<li><b>${esc(ph.name)}</b><span>après ${duration(p.doneAt[i] ?? 0)} de jeu</span></li>`).join('');
  const intro =
    act === 2
      ? "L'ascenseur descend jusqu'au fond de la mine : de l'acier, des plaques d'or, des diamants taillés, des clients qui ne jurent que par vous et une équipe de douze ouvriers. Vous pouvez continuer à jouer : les commandes et les caisses d'expédition continuent comme avant."
      : "Le Grand Chevalement domine la mine : cinq phases, des tonnes de lingots, de l'acier, des plaques d'or et un diamant taillé au sommet. Vous pouvez continuer à jouer : les commandes et les caisses d'expédition continuent comme avant.";
  const next =
    act === 1
      ? `<p class="hint"><b>Le chantier se poursuit.</b> Le Grand Ascenseur (acte II) s'ouvre : il demande bien plus de produits de la Manufacture et d'argent, des commandes honorées et des <b>clients fidèles</b>. En échange, il agrandit l'équipe jusqu'à 12 ouvriers.</p>`
      : '';
  return `
    <div class="victory">
      <p class="victory-title">★ ${esc(act === 2 ? PROJECT_TITLE_II : PROJECT_TITLE)} ★</p>
      <p class="sub">${intro}</p>
    </div>
    ${steps(p)}
    ${next}
    <h4>Votre empire en chiffres</h4>
    <div class="stats-grid">${cells.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
    <h4>Le chantier, phase par phase</h4>
    <ul class="site-when">${when}</ul>
    <div class="panel-footer"><span class="muted">Merci d'avoir creusé jusque-là.</span>${act === 1 ? btn('tab', 'Ouvrir le Grand Ascenseur', { arg: 'work', cls: 'primary' }) : btn('close', 'Continuer à jouer', { cls: 'primary' })}</div>`;
}

/** Titre du panneau du chantier : celui de l'acte en cours (le dernier, une fois tout achevé). */
export function siteTitle(g: GameState, view = ''): string {
  if (view === 'victory') return workName(g.project2.done ? 2 : 1);
  if (view === 'victory1' && g.project.done) return workName(1);
  return workName(g.project.done ? 2 : 1);
}

/**
 * Corps du panneau du chantier. Onglet `view` : « victory » pour l'écran de fin de l'acte qui vient de s'achever, « work » (ou
 * rien) pour le chantier en cours ; quand tout est achevé, l'écran de fin de l'acte II.
 */
export function sitePanel(g: GameState, view = ''): string {
  if (view === 'victory') return victory(g, g.project2.done ? 2 : 1);
  if (view === 'victory1' && g.project.done) return victory(g, 1);
  if (g.worksDone) return victory(g, 2);
  const p = g.work;
  const act = g.project.done ? 2 : 1;
  const banner =
    act === 2
      ? `<div class="site-act"><b>Acte II — ${workName(2)}</b><span>Le chantier se poursuit après le Grand Chevalement.</span>${
          p.phase === 0 ? btn('tab', 'Revoir l’acte I', { arg: 'victory1', cls: 'small' }) : ''
        }</div>`
      : '';
  return `
    ${banner}
    <div class="site-head"><b>Phase ${p.phase + 1} sur ${p.specs.length}</b> — ${esc(p.spec!.name)}<span class="site-pct">${Math.round(p.progress() * 100)} %</span></div>
    ${steps(p)}
    ${phaseBlock(g)}`;
}
