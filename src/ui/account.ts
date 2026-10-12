/**
 * L'écran « Compte » : se connecter ou créer un compte, voir l'état de la synchronisation, choisir quelle partie garder quand
 * l'appareil et le compte en ont chacun une, reprendre la partie mise de côté, se déconnecter, supprimer le compte.
 * Des fonctions pures qui rendent du HTML : l'état vient de la synchronisation (src/cloud/sync.ts) et du formulaire.
 */
import { playTime, type Brief } from '../cloud/brief';
import { CLOUD_ERROR_TEXT } from '../cloud/client';
import type { Ask, SyncView } from '../cloud/sync';
import { esc, money } from './format';

/** Ce que le joueur est en train de faire dans l'écran (le reste vient de la synchronisation). */
export interface AccountForm {
  /** L'adresse tapée, gardée quand l'écran se redessine. */
  email: string;
  error: string;
  info: string;
  /** Une requête est en cours : les boutons attendent. */
  busy: boolean;
  /** « Supprimer mon compte » : on demande le mot de passe avant. */
  confirmDelete: boolean;
}

export interface AccountModel {
  view: SyncView;
  form: AccountForm;
  /** La partie mise de côté peut être reprise (pas pendant une partie en cours). */
  canTakeAside: boolean;
}

export const emptyForm = (): AccountForm => ({ email: '', error: '', info: '', busy: false, confirmDelete: false });

/** « 12/10/2026 11:30 » ; vide si la date est illisible. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Les trois lignes qui font reconnaître une partie : quand, combien d'argent et de profondeur, combien de temps de jeu. */
function facts(b: Brief, device = '', tag = ''): string {
  const date = when(b.savedAt);
  return `<ul class="acct-facts">
    <li>${date ? `Enregistrée le ${esc(date)}` : 'Date inconnue'}${device ? ` · depuis ${esc(device)}` : ''}${tag ? ` <span class="tag">${esc(tag)}</span>` : ''}</li>
    <li><b>${esc(money(b.money))}</b> · profondeur ${Math.floor(b.depth)} m</li>
    <li>Temps de jeu : ${esc(playTime(b.time))}</li>
  </ul>`;
}

const WHY: Record<Ask['why'], string> = {
  first: 'Cet appareil a déjà une partie, et votre compte en garde une autre.',
  diverged: 'Vous avez joué ici et ailleurs depuis la dernière synchronisation : les deux parties ont avancé.',
  replaced: 'Une autre partie a été envoyée sur votre compte depuis un autre appareil (une nouvelle partie, par exemple) : ce n’est pas la suite de celle-ci.',
  newer: 'Votre compte contient une partie plus récente, venue d’un autre appareil. Vous jouez en ce moment l’ancienne.',
};

function askHtml(ask: Ask): string {
  // D'une même partie, celle qui a le plus de temps de jeu est la plus avancée.
  const sameGame = ask.cloud.seed === ask.local.seed;
  const cloudFurther = sameGame && ask.cloud.time > ask.local.time;
  const localFurther = sameGame && ask.local.time > ask.cloud.time;
  return `<div class="menu main-menu play-menu account-menu">
    <h2 class="play-title">Quelle partie garder ?</h2>
    <div class="acct-why">${esc(WHY[ask.why])}</div>
    <div class="menu-buttons">
      <div class="play-box">
        <h3>Sur le compte</h3>
        ${facts(ask.cloud, ask.cloud.device, cloudFurther ? 'la plus avancée' : '')}
        <button class="btn primary big" data-action="accountKeep" data-arg="cloud">Garder celle du compte</button>
      </div>
      <div class="play-box">
        <h3>Sur cet appareil</h3>
        ${facts(ask.local, '', localFurther ? 'la plus avancée' : '')}
        <button class="btn big" data-action="accountKeep" data-arg="local">Garder celle de cet appareil</button>
      </div>
      <p class="muted">L’autre n’est pas perdue : elle est mise de côté, et vous pourrez la reprendre dans « Compte ».</p>
      <div class="acct-row">
        <button class="btn" data-action="accountBack">Plus tard</button>
        <button class="btn" data-action="accountOut" title="Les deux parties restent où elles sont">Se déconnecter</button>
      </div>
    </div>
  </div>`;
}

function formHtml(f: AccountForm): string {
  const off = f.busy ? ' disabled' : '';
  return `<div class="menu main-menu play-menu account-menu narrow">
    <h2 class="play-title">Compte</h2>
    <p class="tagline">Gardez votre partie en ligne : retrouvez-la sur n’importe quel appareil, sans exporter ni importer.</p>
    <div class="menu-buttons">
      <div class="play-box wide">
        <label class="acct-label" for="acct-email">Adresse e-mail</label>
        <input id="acct-email" class="acct-input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="120" value="${esc(f.email)}">
        <label class="acct-label" for="acct-pass">Mot de passe <span class="muted">(6 signes au moins)</span></label>
        <input id="acct-pass" class="acct-input" type="password" autocomplete="current-password" maxlength="120">
        ${f.error ? `<div class="acct-msg bad">${esc(f.error)}</div>` : ''}
        ${f.info ? `<div class="acct-msg good">${esc(f.info)}</div>` : ''}
        ${f.busy ? '<div class="net-spinner" aria-hidden="true"></div>' : ''}
        <button class="btn primary big" data-action="accountIn"${off}>Se connecter</button>
        <button class="btn" data-action="accountUp"${off}>Créer un compte</button>
        <button class="btn" data-action="accountReset"${off}>Mot de passe oublié</button>
      </div>
      <button class="btn" data-action="accountBack">Retour</button>
    </div>
    <p class="muted acct-privacy">Votre e-mail et votre partie sont gardés chez Google (Firebase) et ne servent qu’à cela.</p>
  </div>`;
}

function deleteHtml(f: AccountForm, email: string): string {
  const off = f.busy ? ' disabled' : '';
  return `<div class="menu main-menu play-menu account-menu narrow">
    <h2 class="play-title">Supprimer le compte ?</h2>
    <p class="tagline">Le compte ${esc(email)} et la partie gardée en ligne seront effacés pour de bon. La partie de cet appareil n’est pas touchée.</p>
    <div class="menu-buttons">
      <div class="play-box wide">
        <label class="acct-label" for="acct-del">Tapez votre mot de passe pour confirmer</label>
        <input id="acct-del" class="acct-input" type="password" autocomplete="current-password" maxlength="120">
        ${f.error ? `<div class="acct-msg bad">${esc(f.error)}</div>` : ''}
        ${f.busy ? '<div class="net-spinner" aria-hidden="true"></div>' : ''}
        <button class="btn danger big" data-action="accountDeleteYes"${off}>Supprimer définitivement</button>
      </div>
      <button class="btn" data-action="accountDeleteNo">Annuler</button>
    </div>
  </div>`;
}

/** Le texte d'état de la synchronisation, et sa couleur. */
export function stateLine(v: SyncView): { text: string; tone: 'good' | 'warn' | 'bad' | '' } {
  switch (v.phase) {
    case 'busy':
      return { text: 'Synchronisation…', tone: '' };
    case 'offline':
      return { text: 'Pas de connexion : la partie reste sur cet appareil et partira dès que possible.', tone: 'warn' };
    case 'error':
      return { text: v.error ? CLOUD_ERROR_TEXT[v.error.code] : 'La synchronisation a échoué.', tone: 'bad' };
  }
  if (v.ask) return { text: 'Deux parties différentes : il faut choisir.', tone: 'warn' };
  if (!v.syncedAt) return { text: 'Pas encore synchronisé.', tone: '' };
  const at = new Date(v.syncedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return { text: `À jour · ${at}`, tone: 'good' };
}

function signedInHtml(m: AccountModel): string {
  const { view: v, form: f } = m;
  const state = stateLine(v);
  const detail = v.phase === 'error' && v.error ? `<small>Détail : ${esc(v.error.message.slice(0, 160))}</small>` : '';
  const off = f.busy || v.phase === 'busy' ? ' disabled' : '';
  const aside = v.aside
    ? `<div class="play-box">
        <h3>Partie mise de côté</h3>
        <p class="muted">Quand deux parties se sont croisées, celle que vous n’avez pas gardée est restée ici.</p>
        ${facts(v.aside)}
        ${
          m.canTakeAside
            ? '<button class="btn" data-action="accountAside" title="Elle prend la place de la partie actuelle, qui est mise de côté à son tour">La reprendre</button>'
            : '<div class="acct-msg">Pour la reprendre, revenez au menu principal.</div>'
        }
      </div>`
    : '';
  return `<div class="menu main-menu play-menu account-menu">
    <h2 class="play-title">Compte</h2>
    <p class="tagline">Connecté : <b>${esc(v.account?.email ?? '')}</b></p>
    <div class="menu-buttons">
      <div class="play-box${v.aside ? '' : ' wide'}">
        <h3>Partie du compte</h3>
        ${v.cloud ? facts(v.cloud, v.cloud.device) : `<div class="acct-msg">${v.phase === 'busy' ? 'Recherche de la partie du compte…' : 'Pas encore de partie sur le compte.'}</div>`}
        <div class="acct-msg ${state.tone}">${esc(state.text)}${detail}</div>
        ${f.error ? `<div class="acct-msg bad">${esc(f.error)}</div>` : ''}
        <button class="btn primary" data-action="accountSync"${off}>Synchroniser maintenant</button>
      </div>
      ${aside}
      <div class="acct-row">
        <button class="btn" data-action="accountOut">Se déconnecter</button>
        <button class="btn danger" data-action="accountDelete">Supprimer mon compte…</button>
      </div>
      <button class="btn" data-action="accountBack">Retour</button>
    </div>
  </div>`;
}

export function accountHtml(m: AccountModel): string {
  if (!m.view.account) return formHtml(m.form);
  if (m.form.confirmDelete) return deleteHtml(m.form, m.view.account.email);
  if (m.view.ask) return askHtml(m.view.ask);
  return signedInHtml(m);
}
