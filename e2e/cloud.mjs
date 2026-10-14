/**
 * Test de bout en bout du compte : deux appareils (deux profils de navigateur, chacun son stockage) et un faux Firebase sur cette
 * machine. Création du compte, première partie envoyée, appareil neuf qui la reprend, session gardée au rechargement, deux
 * appareils qui jouent chacun de leur côté (le jeu demande laquelle garder, la perdante est mise de côté puis reprise),
 * réseau coupé, mauvais mots de passe, déconnexion, suppression du compte.
 *
 *   npm run build && node e2e/cloud.mjs
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startFakeFirebase } from './support/fakeServer.mjs';

const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4182, strictPort: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
const fb = await startFakeFirebase();
const { fake } = fb;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const errors = [];
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Attend, côté test, qu'une condition devienne vraie (état du faux serveur). */
const untilNode = async (fn, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
};
/** Attend, côté page, qu'une condition devienne vraie. */
const until = async (page, fn, arg, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(`${name} : ${m.text()}`));
  return { name, ctx, page };
}

const base = `${url.replace(/\/$/, '')}/?debug&net=local&cloud=${encodeURIComponent(fb.url)}`;
const MAIL = 'ami@exemple.fr';
const PASS = 'motdepasse1';
const docOf = () => [...fake.docs.values()][0];
const cloudMoney = () => docOf()?.fields.money?.doubleValue;
const accountText = (p) => p.evaluate(() => document.querySelector('.account-menu')?.textContent ?? '');
const waitAccount = (p, needle, timeout = 15000) => until(p, (n) => (document.querySelector('.account-menu')?.textContent ?? '').includes(n), needle, timeout);
const continueText = (p) => p.evaluate(() => document.querySelector('[data-action="continue"]')?.textContent ?? '');
const money = (p) => p.evaluate(() => window.__EM.state?.money);
const openPause = async (p) => {
  await p.keyboard.press('Escape');
  await p.waitForSelector('.pause-menu');
};
const saveNow = async (p) => {
  await openPause(p);
  await p.click('.pause-menu [data-action="save"]');
};

const A = await device('appareil A');
const B = await device('appareil B');
const A_ = A.page;
const B_ = B.page;

// ---------------------------------------------------------------- le projet Firebase du jeu, ou pas
{
  const plain = await (await browser.newContext()).newPage();
  await plain.goto(`${url.replace(/\/$/, '')}/?debug`);
  await plain.waitForSelector('[data-action="new"]');
  const has = await plain.evaluate(() => window.__EM.cloud !== null && !!document.querySelector('[data-action="account"]'));
  check(has === fb.configured, fb.configured ? 'le projet Firebase est renseigné : le bouton « Compte » existe sans rien ajouter à l’adresse' : 'sans projet Firebase renseigné, le bouton « Compte » n’existe pas');

  // Un faux serveur hors de cette machine n'est jamais joint : ni identifiants envoyés à cette adresse, ni compte sans projet.
  const asked = [];
  plain.on('request', (r) => asked.push(r.url()));
  await plain.route(/googleapis\.com/, (route) => route.abort());
  await plain.goto(`${url.replace(/\/$/, '')}/?debug&cloud=https://pirate.example`);
  await plain.waitForSelector('[data-action="new"]');
  if (!fb.configured) {
    check(await plain.evaluate(() => window.__EM.cloud === null), 'un faux serveur hors de cette machine est refusé');
  } else {
    await plain.click('#menu-root [data-action="account"]');
    await plain.fill('#acct-email', 'ami@exemple.fr');
    await plain.fill('#acct-pass', 'motdepasse1');
    await plain.click('[data-action="accountIn"]');
    await until(plain, () => /Pas de connexion|pas disponible|incorrect/.test(document.querySelector('.account-menu')?.textContent ?? ''), null, 8000);
    check(!asked.some((u) => new URL(u).hostname === 'pirate.example'), 'un faux serveur hors de cette machine n’est jamais joint');
    check(asked.some((u) => new URL(u).hostname === 'identitytoolkit.googleapis.com'), 'la connexion passe par le vrai service de Google');
  }
  await plain.context().close();
}

// ---------------------------------------------------------------- réseau lent : l'écran du compte ne revient pas par-dessus la partie
// La connexion s'affiche dès que le service a répondu ; la première synchronisation vient après. Quitter l'écran entre les deux
// (comme avec les centaines de millisecondes de Google) ne doit pas le faire réapparaître par-dessus le menu ou la partie.
{
  const slow = await startFakeFirebase();
  slow.latency = 600;
  const S = await device('réseau lent');
  const p = S.page;
  await p.goto(`${url.replace(/\/$/, '')}/?debug&net=local&cloud=${encodeURIComponent(slow.url)}`);
  await p.waitForSelector('#menu-root [data-action="account"]');
  await p.click('#menu-root [data-action="account"]');
  await p.fill('#acct-email', 'lent@exemple.fr');
  await p.fill('#acct-pass', PASS);
  await p.click('[data-action="accountUp"]');
  check(await waitAccount(p, 'Connecté'), 'réseau lent : la connexion s’affiche dès que le service a répondu');
  await p.click('[data-action="accountBack"]');
  await p.waitForSelector('[data-action="new"]');
  await p.click('[data-action="new"]');
  await until(p, () => window.__EM.mode === 'playing');
  check(await until(p, () => window.__EM.cloud.view.phase !== 'busy', null, 15000), 'réseau lent : la première synchronisation se termine');
  await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.querySelector('.account-menu') && window.__EM.mode === 'playing'), 'réseau lent : l’écran du compte ne revient pas par-dessus la partie');
  await S.ctx.close();
  await slow.close();
}

// ---------------------------------------------------------------- A : créer le compte
await A_.goto(base);
await A_.waitForSelector('#menu-root [data-action="account"]');
check((await A_.textContent('#menu-root [data-action="account"]')).trim() === 'Compte', 'le menu propose « Compte »');
await A_.click('#menu-root [data-action="account"]');
await A_.waitForSelector('#acct-email');
await A_.screenshot({ path: `${SHOTS}cloud-01-formulaire.png` });
await A_.fill('#acct-email', MAIL);
await A_.fill('#acct-pass', '123');
await A_.click('[data-action="accountUp"]');
check(await waitAccount(A_, 'Mot de passe trop court'), 'un mot de passe trop court est refusé, avec ses mots');
check((await A_.inputValue('#acct-email')) === MAIL, 'l’adresse tapée est gardée');
await A_.fill('#acct-pass', 'faux');
await A_.click('[data-action="accountIn"]');
check(await waitAccount(A_, 'E-mail ou mot de passe incorrect'), 'un compte inconnu : « E-mail ou mot de passe incorrect »');
await A_.fill('#acct-email', 'pas-un-mail');
await A_.click('[data-action="accountReset"]');
check(await waitAccount(A_, 'bonne forme'), '« Mot de passe oublié » avec une adresse mal formée : le dit');
await A_.fill('#acct-email', MAIL);
await A_.fill('#acct-pass', PASS);
await A_.press('#acct-pass', 'Enter');
check(await waitAccount(A_, 'E-mail ou mot de passe incorrect'), 'Entrée dans le champ du mot de passe se connecte (le compte n’existe pas encore)');
await A_.fill('#acct-pass', PASS);
await A_.click('[data-action="accountUp"]');
check(await waitAccount(A_, 'Connecté'), 'le compte est créé et ouvert');
check((await accountText(A_)).includes(MAIL), 'l’écran montre l’adresse connectée');
check(fake.users.size === 1, 'le serveur a un compte');
check((await accountText(A_)).includes('Pas encore de partie sur le compte'), 'aucune partie sur le compte pour l’instant');
await A_.screenshot({ path: `${SHOTS}cloud-02-connecte.png` });
check((await A_.textContent('[data-action="accountBack"]')).trim() === 'Retour', 'un bouton « Retour »');
await A_.click('[data-action="accountBack"]');
await A_.waitForSelector('[data-action="new"]');
const connectedButton = async (p) => {
  const b = p.locator('#menu-root [data-action="account"]');
  return /✓/.test(await b.textContent()) && ((await b.getAttribute('title')) ?? '').includes(MAIL);
};
check(await connectedButton(A_), 'le bouton du menu montre qu’on est connecté (✓), l’adresse en info-bulle');

// ---------------------------------------------------------------- A : une première partie, envoyée au compte
await A_.click('[data-action="new"]');
await until(A_, () => window.__EM.mode === 'playing');
await A_.evaluate(() => {
  window.__EM.state.money = 777;
});
await saveNow(A_);
check(await untilNode(() => cloudMoney() === 777), 'la partie est envoyée sur le compte (777 $)');
check(String(docOf().fields.data.stringValue).startsWith('z:'), 'elle est compressée');
check(docOf().fields.device?.stringValue === 'Linux', 'avec le genre d’appareil');
await A_.click('.pause-menu [data-action="resume"]');

// ---------------------------------------------------------------- B : appareil neuf, il reprend la partie
await B_.goto(base);
await B_.waitForSelector('#menu-root [data-action="account"]');
check((await B_.evaluate(() => !document.querySelector('[data-action="continue"]'))), 'l’appareil B n’a aucune partie');
await B_.click('#menu-root [data-action="account"]');
await B_.fill('#acct-email', MAIL);
await B_.fill('#acct-pass', 'mauvais');
await B_.click('[data-action="accountIn"]');
check(await waitAccount(B_, 'E-mail ou mot de passe incorrect'), 'B : mauvais mot de passe refusé');
await B_.fill('#acct-pass', PASS);
await B_.click('[data-action="accountIn"]');
check(await waitAccount(B_, 'Connecté'), 'B se connecte');
check(await until(B_, () => /777/.test(document.querySelector('.account-menu')?.textContent ?? '')), 'B voit la partie du compte (777 $)');
await B_.screenshot({ path: `${SHOTS}cloud-03-appareil-neuf.png` });
await B_.click('[data-action="accountBack"]');
await B_.waitForSelector('[data-action="continue"]');
check(/777/.test(await continueText(B_)), 'B : « Continuer » propose la partie du compte');
await B_.click('[data-action="continue"]');
await until(B_, () => window.__EM.mode === 'playing');
check((await money(B_)) === 777, 'B reprend la partie : 777 $, sans export ni import');

// ---------------------------------------------------------------- B joue, A suit
await B_.evaluate(() => {
  window.__EM.state.money = 1500;
});
await saveNow(B_);
check(await untilNode(() => cloudMoney() === 1500), 'B envoie sa progression (1 500 $)');
await B_.click('.pause-menu [data-action="resume"]');

// A est resté en jeu avec 777 $ : en rouvrant la page, il prend ce que B a envoyé.
await A_.goto(base);
await A_.waitForSelector('[data-action="continue"]');
check(await until(A_, () => /1\s500/.test(document.querySelector('[data-action="continue"]')?.textContent ?? '')), 'A, rouvert plus tard : « Continuer » montre 1 500 $ (la partie de B)');
check(await connectedButton(A_), 'la session est gardée au rechargement');
await A_.screenshot({ path: `${SHOTS}cloud-04-menu-synchronise.png` });
await A_.click('[data-action="continue"]');
await until(A_, () => window.__EM.mode === 'playing');
check((await money(A_)) === 1500, 'A continue avec 1 500 $');

// ---------------------------------------------------------------- les deux jouent chacun de leur côté
await B_.evaluate(() => {
  window.__EM.state.money = 1800;
});
await saveNow(B_);
check(await untilNode(() => cloudMoney() === 1800), 'B envoie 1 800 $');
await B_.click('.pause-menu [data-action="resume"]');
// A n’a rien su : il joue de son côté et sauvegarde. (Il a rouvert sa page il y a quelques secondes : la marge qui évite la question
// pour la dernière sauvegarde d’une page fermée est réduite à zéro, pour ne pas attendre une minute et demie de plus.)
await A_.evaluate(() => {
  window.__EM.cloud.drift = 0;
  window.__EM.state.money = 2000;
});
await saveNow(A_);
check(await until(A_, () => window.__EM.cloud.view.ask?.why === 'diverged'), 'A : le compte a changé entre-temps, le jeu pose la question');
check(cloudMoney() === 1800, 'rien n’a été écrasé sur le compte (toujours 1 800 $)');
check(await A_.evaluate(() => /Quelle partie|autre partie/.test(document.querySelector('#toasts')?.textContent ?? '') || !!document.querySelector('.pause-menu')), 'un avis ou le menu est visible');
check(await until(A_, () => /⚠/.test(document.querySelector('.pause-menu [data-action="account"]')?.textContent ?? '')), 'le bouton « Compte » du menu pause signale la question');
await A_.click('.pause-menu [data-action="account"]');
await A_.waitForSelector('[data-action="accountKeep"]');
const ask = await accountText(A_);
check(/Quelle partie garder/.test(ask) && /Sur le compte/.test(ask) && /Sur cet appareil/.test(ask), 'l’écran montre les deux parties');
check(/1\s800/.test(ask) && /2\s000/.test(ask), 'avec leur argent (1 800 $ et 2 000 $)');
await A_.screenshot({ path: `${SHOTS}cloud-05-deux-parties.png` });
await A_.click('[data-action="accountKeep"][data-arg="cloud"]');
check(await until(A_, () => window.__EM.mode === 'playing' && !document.querySelector('.account-menu') && window.__EM.state.money === 1800), 'A garde celle du compte : elle est chargée en jeu (1 800 $)');
check((await A_.evaluate(() => window.__EM.cloud.view.aside?.money)) === 2000, 'la partie de A (2 000 $) est mise de côté');
check(cloudMoney() === 1800, 'le compte n’a pas bougé');

// La partie mise de côté se reprend depuis le menu principal.
await openPause(A_);
await A_.click('.pause-menu [data-action="account"]');
await A_.waitForSelector('[data-action="accountSync"]');
const playingAccount = await accountText(A_);
check(/Partie mise de côté/.test(playingAccount) && /revenez au menu principal/.test(playingAccount), 'en jeu, on ne la reprend pas : « revenez au menu principal »');
await A_.click('[data-action="accountBack"]');
await A_.waitForSelector('.pause-menu');
await A_.click('.pause-menu [data-action="quit"]');
await A_.waitForSelector('[data-action="continue"]');
await A_.click('#menu-root [data-action="account"]');
await A_.waitForSelector('[data-action="accountAside"]');
await A_.screenshot({ path: `${SHOTS}cloud-06-mise-de-cote.png` });
await A_.click('[data-action="accountAside"]');
await A_.waitForSelector('[data-action="accountSync"]');
await A_.click('[data-action="accountBack"]');
await A_.waitForSelector('[data-action="continue"]');
check(/2\s000/.test(await continueText(A_)), 'A reprend la partie mise de côté : « Continuer » montre 2 000 $');
check(await untilNode(() => cloudMoney() === 2000), 'et le compte la suit (2 000 $)');
await A_.click('[data-action="continue"]');
await until(A_, () => window.__EM.mode === 'playing');
check((await money(A_)) === 2000, 'A joue de nouveau avec 2 000 $');

// ---------------------------------------------------------------- réseau coupé
fake.down = true;
await A_.evaluate(() => {
  window.__EM.state.money = 2500;
});
await saveNow(A_);
check(await until(A_, () => window.__EM.cloud.view.phase === 'offline'), 'réseau coupé : le compte le sait');
await A_.click('.pause-menu [data-action="account"]');
check(await waitAccount(A_, 'Pas de connexion'), 'l’écran du compte le dit, avec ses mots');
await A_.screenshot({ path: `${SHOTS}cloud-07-hors-connexion.png` });
check((await A_.evaluate(() => JSON.parse(localStorage.getItem('empire-miner.save')).money)) === 2500, 'la partie est quand même sauvegardée sur l’appareil');
check(cloudMoney() === 2000, 'rien n’est parti');
fake.down = false;
await A_.click('[data-action="accountSync"]');
check(await waitAccount(A_, 'À jour'), 'le réseau revient : « Synchroniser maintenant » envoie la partie');
check(cloudMoney() === 2500, 'le compte a reçu 2 500 $');
await A_.click('[data-action="accountBack"]');
await A_.click('.pause-menu [data-action="resume"]');

// ---------------------------------------------------------------- B, resté en jeu pendant que A avançait
await openPause(B_);
await B_.click('.pause-menu [data-action="account"]');
await B_.waitForSelector('[data-action="accountKeep"]');
check(/plus récente|ont avancé/.test(await accountText(B_)), 'B, resté en jeu pendant que A avançait, se voit poser la question');
await B_.screenshot({ path: `${SHOTS}cloud-09-deux-parties-en-jeu.png` });
await B_.click('[data-action="accountKeep"][data-arg="cloud"]');
check(await until(B_, () => window.__EM.mode === 'playing' && window.__EM.state.money === 2500), 'B prend la partie du compte (2 500 $) et continue');

// ---------------------------------------------------------------- une nouvelle partie ailleurs ne fait pas disparaître celle-ci
// A, connecté, démarre une nouvelle partie : la confirmation prévient que celle du compte sera remplacée aussi.
const seedOf = () => Number(docOf()?.fields.seed?.integerValue);
const seedBefore = seedOf();
await openPause(A_);
await A_.click('.pause-menu [data-action="quit"]');
await A_.waitForSelector('[data-action="new"]');
await A_.click('[data-action="new"]');
const confirmText = await A_.textContent('#menu-root [data-action="new"]');
check(/écraser la sauvegarde, compte compris/.test(confirmText), 'connecté, la confirmation de « Nouvelle partie » prévient que la sauvegarde du compte est écrasée aussi');
await A_.screenshot({ path: `${SHOTS}cloud-10-nouvelle-partie-connecte.png` });
await A_.click('[data-action="new"]');
await until(A_, () => window.__EM.mode === 'playing');
const freshMoney = await money(A_);
await saveNow(A_);
check(await untilNode(() => seedOf() !== seedBefore), 'la nouvelle partie de A prend la place de l’ancienne sur le compte');
await A_.click('.pause-menu [data-action="resume"]');

// B joue encore l’ancienne partie : ce n’en est pas la suite, le jeu demande au lieu de la remplacer.
await openPause(B_);
await B_.click('.pause-menu [data-action="account"]');
await B_.waitForSelector('[data-action="accountKeep"]');
check(/Une autre partie a été envoyée sur votre compte/.test(await accountText(B_)), 'B : une autre partie a pris la place sur le compte, le jeu le dit');
check((await money(B_)) === 2500, 'B joue toujours sa partie (2 500 $) : rien n’a été remplacé');
await B_.screenshot({ path: `${SHOTS}cloud-11-autre-partie.png` });
await B_.click('[data-action="accountKeep"][data-arg="cloud"]');
check(await until(B_, (m) => window.__EM.mode === 'playing' && window.__EM.state.money === m, freshMoney), 'B prend la nouvelle partie du compte');
check((await B_.evaluate(() => window.__EM.cloud.view.aside?.money)) === 2500, 'et sa partie d’avant (2 500 $) est mise de côté');

// ---------------------------------------------------------------- se déconnecter, supprimer le compte
await openPause(B_);
await B_.click('.pause-menu [data-action="account"]');
await B_.waitForSelector('[data-action="accountOut"]');
await B_.click('[data-action="accountDelete"]');
await B_.waitForSelector('#acct-del');
await B_.screenshot({ path: `${SHOTS}cloud-08-supprimer.png` });
await B_.fill('#acct-del', 'mauvais');
await B_.press('#acct-del', 'Enter');
check(await waitAccount(B_, 'incorrect'), 'supprimer le compte avec un mauvais mot de passe : refusé');
check(fake.users.size === 1, 'le compte existe toujours');
await B_.fill('#acct-del', PASS);
await B_.click('[data-action="accountDeleteYes"]');
check(await waitAccount(B_, 'Se connecter'), 'après la suppression : retour au formulaire de connexion');
check(fake.users.size === 0 && fake.docs.size === 0, 'le compte et sa partie sont effacés du serveur');
check(await B_.evaluate(() => !!localStorage.getItem('empire-miner.save') && !localStorage.getItem('empire-miner.account')), 'la partie de B reste sur son appareil, sans session');
await B_.click('[data-action="accountBack"]');
await B_.waitForSelector('.pause-menu');
check(await B_.evaluate(() => /^Compte$/.test(document.querySelector('.pause-menu [data-action="account"]').textContent.trim())), 'le bouton redevient « Compte »');
await B_.click('.pause-menu [data-action="quit"]');
await B_.waitForSelector('[data-action="new"]');
await B_.click('[data-action="new"]');
const plainConfirm = await B_.textContent('#menu-root [data-action="new"]');
check(/écraser la sauvegarde/.test(plainConfirm) && !/compte/.test(plainConfirm), 'sans compte connecté, la confirmation ne parle pas du compte');

// A se déconnecte (son compte n'existe plus côté serveur, la déconnexion est locale).
await openPause(A_).catch(() => undefined);
await A_.click('.pause-menu [data-action="account"]').catch(() => undefined);
await A_.click('[data-action="accountOut"]');
check(await waitAccount(A_, 'Se connecter'), 'A se déconnecte : le formulaire revient');

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
if (errors.length > 1) console.log(errors.slice(1, 5).join('\n'));

await browser.close();
await fb.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
