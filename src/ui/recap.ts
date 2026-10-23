/**
 * Écran « Bilan » : ce que la session a rapporté, ce que les ouvriers ont fait, et ce qui demande l'attention du joueur
 * maintenant. À la reprise d'une partie, il commence par le rappel de la dernière session. Rien ici ne modifie la partie.
 */
import { clientName, clock } from './orders';
import { projectForecastHtml } from './forecast';
import { stuckWorkers } from './crew';
import { esc, money, num } from './format';
import { duration, workName } from './site';
import { projectForecast } from '../sim/Forecast';
import type { GameState } from '../sim/GameState';
import { hasNews, type Recap } from '../sim/Recap';
import { btn } from './widgets';

/** Une commande acceptée à moins de ce temps (s) de son échéance est signalée. */
const SOON = 300;

/** Les lignes d'un bilan : seulement ce qui a bougé. */
function rows(r: Recap): [string, string][] {
  const out: [string, string][] = [['Temps de jeu', duration(r.seconds)]];
  const add = (label: string, n: number, text = num(n, 0)) => n > 0 && out.push([label, text]);
  add('Argent gagné', r.earned, `+${money(r.earned)}`);
  add('Argent dépensé', r.spent, money(r.spent));
  add('Commandes honorées', r.contracts);
  add('Blocs minés', r.mined);
  add('Minerais ramassés', r.collected);
  add('Lingots fondus', r.smelted);
  add('Produits fabriqués', r.crafted);
  add('Livré par vos machines', r.delivered);
  add('Vendu par les caisses', r.autoSold, money(r.autoSold));
  add('Machines posées', r.built);
  add('Profondeur gagnée', r.depth, `+${num(r.depth, 0)} m`);
  add('Phases de chantier terminées', r.phases);
  add('Clients devenus fidèles', r.faithful);
  return out;
}

/** Ce que les ouvriers ont fait, en une phrase (vide si rien). */
function crewLine(r: Recap): string {
  const parts: string[] = [];
  if (r.crewStored > 0) parts.push(`<b>${num(r.crewStored, 0)}</b> objet${r.crewStored > 1 ? 's' : ''} rangé${r.crewStored > 1 ? 's' : ''} dans les coffres`);
  if (r.crewDelivered > 0) parts.push(`<b>${num(r.crewDelivered, 0)}</b> objet${r.crewDelivered > 1 ? 's' : ''} livré${r.crewDelivered > 1 ? 's' : ''} au chantier et aux commandes`);
  if (r.crewFueled > 0) parts.push(`<b>${num(r.crewFueled, 0)}</b> charge${r.crewFueled > 1 ? 's' : ''} de charbon apportée${r.crewFueled > 1 ? 's' : ''} aux machines`);
  if (r.crewPlaced > 0) parts.push(`<b>${num(r.crewPlaced, 0)}</b> foreuse${r.crewPlaced > 1 ? 's' : ''} posée${r.crewPlaced > 1 ? 's' : ''}`);
  return parts.length ? `<p class="recap-crew">Vos ouvriers : ${parts.join(' · ')}.</p>` : '';
}

function block(title: string, r: Recap): string {
  if (!hasNews(r) && r.seconds <= 0) return '';
  const list = rows(r)
    .map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`)
    .join('');
  return `<h4>${esc(title)}</h4><ul class="recap-rows">${list}</ul>${crewLine(r)}`;
}

/** Ce qui demande l'attention du joueur maintenant. */
function watch(g: GameState): string {
  const items: string[] = [];
  for (const s of stuckWorkers(g)) items.push(`<li class="bad">${esc(s.text)}${s.n > 1 ? ` (×${s.n})` : ''}</li>`);
  for (const c of g.contracts.active()) {
    const left = Math.max(0, c.until - g.time);
    const done = c.lines.every((l) => l.done >= l.qty);
    if (!done && left <= SOON) items.push(`<li class="warn">Commande de ${esc(clientName(c.client))} : plus que ${clock(left)} pour la livrer.</li>`);
  }
  if (!g.worksDone && g.structures.list.some((s) => s.type === 'site')) {
    const p = g.work;
    const fc = projectForecast(p, g.money, (res) => g.inventory.count(res), g.production.recent());
    items.push(`<li><b>${esc(workName(g.project.done ? 2 : 1))}</b>, phase ${p.phase + 1} sur ${p.specs.length} : ${esc(p.spec!.name)} (${Math.round(p.progress() * 100)} %)${projectForecastHtml(fc)}</li>`);
  }
  return items.length ? `<h4>À surveiller</h4><ul class="recap-watch">${items.join('')}</ul>` : '<h4>À surveiller</h4><p class="empty">Rien à signaler : tout tourne.</p>';
}

/**
 * Corps du panneau. `view` « resume » : à la reprise, avec le rappel de la dernière session en premier ; sinon, le bilan de la
 * session en cours d'abord.
 */
export function recapPanel(g: GameState, view = ''): string {
  const last = g.lastSession;
  const now = g.sessionRecap();
  const lastHtml = last && hasNews(last) ? block('Dernière session', last) : '';
  // À la reprise, la session qui commence n'a encore rien à dire : on ne l'affiche pas.
  const nowHtml = now && (view !== 'resume' || hasNews(now)) ? block('Cette session', now) : '';
  const intro =
    view === 'resume' && lastHtml
      ? `<p class="sub">Bon retour ! Voici ce que votre mine a fait la dernière fois, et ce qui demande votre attention.</p>`
      : `<p class="sub">Ce que votre partie a rapporté depuis l'ouverture, et ce qui demande votre attention.</p>`;
  const order = view === 'resume' ? `${lastHtml}${watch(g)}${nowHtml}` : `${nowHtml}${watch(g)}${lastHtml}`;
  return `${intro}${order}<div class="panel-footer"><span class="muted">Le bilan est aussi dans le menu pause.</span>${btn('close', 'Fermer', { cls: 'primary' })}</div>`;
}
