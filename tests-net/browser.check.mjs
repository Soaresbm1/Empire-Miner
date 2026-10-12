/**
 * Essai réel du compte, dans un navigateur : le vrai jeu (dossier dist/) face au vrai Google (projet de src/cloud/config.ts).
 *
 * La page est servie à son adresse publique (https://soaresbm1.github.io/Empire-Miner/) : Google voit donc l'origine et la page
 * qu'il verra en production. Les requêtes vers Google sont relayées par Node, qui vérifie les certificats normalement : derrière
 * un mandataire d'entreprise ou de bac à sable, le Chromium de Playwright ne fait pas confiance à son certificat, Node si.
 * Deux appareils (deux profils de navigateur) et un compte jetable, supprimé depuis le jeu à la fin (et, si l'essai s'arrête en
 * route, par un ménage de dernier recours). Aucun e-mail n'est envoyé.
 *
 *   npm run build && node tests-net/browser.check.mjs [dossier-du-site]
 *   (derrière un mandataire : NODE_USE_ENV_PROXY=1 node …)
 *
 * Variables : CHROME_PATH (exécutable Chromium).
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const SITE = 'https://soaresbm1.github.io/Empire-Miner/';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = resolve(ROOT, process.argv[2] ?? 'dist');
const CFG = readFileSync(join(ROOT, 'src/cloud/config.ts'), 'utf8');
const API_KEY = /apiKey:\s*'([^']+)'/.exec(CFG)[1];
const PROJECT = /projectId:\s*'([^']+)'/.exec(CFG)[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const GOOGLE = new Set(['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com']);

const MAIL = `essai-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}@example.com`;
const PASS = randomBytes(9).toString('base64url');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (page, fn, arg, timeout = 20000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const untilNode = async (fn, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};

// ------------------------------------------------------------------ REST côté Node (vérifier ce que Google a vraiment gardé)
const asBrowser = { Origin: 'https://soaresbm1.github.io', Referer: SITE };
async function rest(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...asBrowser, ...(init.headers ?? {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* pas du json */
  }
  return { status: res.status, json, text };
}
const signIn = () => rest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: MAIL, password: PASS, returnSecureToken: true }) });
const docUrl = (uid) => `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/saves/${uid}`;
async function cloudDoc(idToken, uid) {
  const r = await rest(docUrl(uid), { headers: { Authorization: `Bearer ${idToken}` } });
  return r.status === 200 ? r.json : null;
}

// ------------------------------------------------------------------ le navigateur : le site local à l'adresse publique, Google par le relais
const asked = [];
const blocked = [];
async function route(ctx) {
  await ctx.route('**/*', async (rt) => {
    const req = rt.request();
    const url = new URL(req.url());
    if (req.url().startsWith(SITE) || req.url() === SITE.slice(0, -1)) {
      let path = decodeURIComponent(url.pathname.slice('/Empire-Miner/'.length));
      if (!path || path.endsWith('/')) path += 'index.html';
      const file = join(DIST, path);
      if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) return rt.fulfill({ status: 404, body: '' });
      return rt.fulfill({ status: 200, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }, body: readFileSync(file) });
    }
    if (GOOGLE.has(url.hostname)) {
      const headers = { ...req.headers() };
      for (const h of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[h];
      try {
        const res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
        const body = Buffer.from(await res.arrayBuffer());
        const out = {};
        res.headers.forEach((v, k) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v;
        });
        asked.push(`${req.method()} ${url.hostname}${url.pathname.replace(/\/saves\/[^/?]+/, '/saves/{uid}')} → ${res.status}`);
        return rt.fulfill({ status: res.status, headers: out, body });
      } catch (e) {
        asked.push(`${req.method()} ${url.hostname}${url.pathname} → ÉCHEC ${e.message}`);
        return rt.abort('failed');
      }
    }
    // La police de l'interface (déjà là avant le compte) : pas relayée, le jeu a une police de secours.
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return rt.abort('blockedbyclient');
    blocked.push(req.url());
    return rt.abort('blockedbyclient');
  });
}

const exe = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await route(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(`${name} : ${m.text()}`));
  return { ctx, page };
}
const accountText = (p) => p.evaluate(() => document.querySelector('.account-menu')?.textContent ?? '');
const waitAccount = (p, needle, timeout = 25000) => until(p, (n) => (document.querySelector('.account-menu')?.textContent ?? '').includes(n), needle, timeout);
const money = (p) => p.evaluate(() => window.__EM.state?.money);
const saveNow = async (p) => {
  await p.keyboard.press('Escape');
  await p.waitForSelector('.pause-menu');
  await p.click('.pause-menu [data-action="save"]');
};
const session = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('empire-miner.account') ?? 'null'));
const url = `${SITE}?debug`;
let uid = null;
let idToken = null;
let A = null;
let B = null;
let a = null;
let b = null;

try {
  A = await device('appareil A');
  B = await device('appareil B');
  a = A.page;
  b = B.page;

  // ---------------------------------------------------------------- A : la page publique, le bouton « Compte », la création du compte
  await a.goto(url);
  await a.waitForSelector('[data-action="new"]');
  check(await a.evaluate(() => location.origin === 'https://soaresbm1.github.io' && location.pathname === '/Empire-Miner/'), 'la page est à son adresse publique (https://soaresbm1.github.io/Empire-Miner/)');
  check(await a.evaluate(() => window.__EM.cloud !== null && !!document.querySelector('#menu-root [data-action="account"]')), 'le bouton « Compte » est là, sans réglage supplémentaire');
  await a.click('#menu-root [data-action="account"]');
  await a.waitForSelector('#acct-email');
  await a.fill('#acct-email', MAIL);
  await a.fill('#acct-pass', '123');
  await a.click('[data-action="accountUp"]');
  check(await waitAccount(a, 'Mot de passe trop court'), 'Google refuse un mot de passe trop court, le jeu le dit en français');
  await a.fill('#acct-pass', PASS);
  await a.click('[data-action="accountUp"]');
  check(await waitAccount(a, 'Connecté'), `le compte jetable est créé chez Google (${MAIL})`);
  const s = await session(a);
  uid = s?.uid ?? null;
  idToken = s?.idToken ?? null;
  check(!!uid && !!idToken, 'la session est gardée sur l’appareil (jeton, jamais le mot de passe)');
  check(!JSON.stringify(await a.evaluate(() => ({ ...localStorage }))).includes(PASS), 'le mot de passe n’est écrit nulle part dans le stockage de la page');
  await a.click('[data-action="accountBack"]');

  // ---------------------------------------------------------------- A : une partie, envoyée chez Google
  await a.waitForSelector('[data-action="new"]');
  await a.click('[data-action="new"]');
  await until(a, () => window.__EM.mode === 'playing');
  await a.evaluate(() => {
    window.__EM.state.money = 777;
  });
  await saveNow(a);
  check(await untilNode(async () => (await cloudDoc(idToken, uid))?.fields?.money?.doubleValue === 777), 'la partie (777 $) est enregistrée dans la base de Google');
  const doc = await cloudDoc(idToken, uid);
  check(String(doc?.fields?.data?.stringValue).startsWith('z:'), `elle y est compressée (${String(doc?.fields?.data?.stringValue).length} signes)`);
  check(!!doc?.fields?.device?.stringValue && Number(doc?.fields?.seed?.integerValue) > 0, `avec sa graine et le genre d’appareil (${doc?.fields?.device?.stringValue})`);
  await a.click('.pause-menu [data-action="resume"]');

  // ---------------------------------------------------------------- B : appareil neuf
  await b.goto(url);
  await b.waitForSelector('[data-action="new"]');
  check(await b.evaluate(() => !document.querySelector('[data-action="continue"]')), 'B : aucune partie sur cet appareil');
  await b.click('#menu-root [data-action="account"]');
  await b.fill('#acct-email', MAIL);
  await b.fill('#acct-pass', PASS + 'x');
  await b.click('[data-action="accountIn"]');
  check(await waitAccount(b, 'E-mail ou mot de passe incorrect'), 'B : un mauvais mot de passe est refusé par Google, avec les mots du jeu');
  await b.fill('#acct-pass', PASS);
  await b.click('[data-action="accountIn"]');
  check(await waitAccount(b, 'Connecté'), 'B se connecte');
  check(await until(b, () => /777/.test(document.querySelector('.account-menu')?.textContent ?? '')), 'B voit la partie du compte (777 $)');
  await b.click('[data-action="accountBack"]');
  await b.waitForSelector('[data-action="continue"]');
  await b.click('[data-action="continue"]');
  await until(b, () => window.__EM.mode === 'playing');
  check((await money(b)) === 777, 'B reprend la partie : 777 $, sans export ni import');

  // ---------------------------------------------------------------- B joue, A suit
  await b.evaluate(() => {
    window.__EM.state.money = 1500;
  });
  await saveNow(b);
  check(await untilNode(async () => (await cloudDoc(idToken, uid))?.fields?.money?.doubleValue === 1500), 'B envoie sa progression (1 500 $) : Google la garde');
  await b.click('.pause-menu [data-action="resume"]');
  await a.goto(url);
  await a.waitForSelector('[data-action="continue"]');
  check(await until(a, () => /1\s500/.test(document.querySelector('[data-action="continue"]')?.textContent ?? '')), 'A, rouvert : « Continuer » montre 1 500 $ (la partie de B)');
  await a.click('[data-action="continue"]');
  await until(a, () => window.__EM.mode === 'playing');
  check((await money(a)) === 1500, 'A continue avec 1 500 $');

  // ---------------------------------------------------------------- les deux jouent chacun de leur côté : la précondition de Google refuse l'écrasement
  await b.evaluate(() => {
    window.__EM.state.money = 1800;
  });
  await saveNow(b);
  check(await untilNode(async () => (await cloudDoc(idToken, uid))?.fields?.money?.doubleValue === 1800), 'B envoie 1 800 $');
  await b.click('.pause-menu [data-action="resume"]');
  await a.evaluate(() => {
    window.__EM.cloud.drift = 0;
    window.__EM.state.money = 2000;
  });
  await saveNow(a);
  check(await until(a, () => window.__EM.cloud.view.ask?.why === 'diverged', null, 30000), 'A : la base de Google refuse l’écriture périmée, le jeu pose la question');
  check((await cloudDoc(idToken, uid))?.fields?.money?.doubleValue === 1800, 'rien n’a été écrasé chez Google (toujours 1 800 $)');
  await a.click('.pause-menu [data-action="account"]');
  await a.waitForSelector('[data-action="accountKeep"]');
  check(/1\s800/.test(await accountText(a)) && /2\s000/.test(await accountText(a)), 'l’écran montre les deux parties (1 800 $ et 2 000 $)');
  await a.click('[data-action="accountKeep"][data-arg="local"]');
  check(await untilNode(async () => (await cloudDoc(idToken, uid))?.fields?.money?.doubleValue === 2000), 'A garde la sienne : elle prend la place chez Google (2 000 $)');
  check((await a.evaluate(() => window.__EM.cloud.view.aside?.money)) === 1800, 'celle de B (1 800 $) est mise de côté chez A');

  // ---------------------------------------------------------------- B, resté en jeu pendant que A gardait la sienne : « plus récente »
  await b.keyboard.press('Escape');
  await b.waitForSelector('.pause-menu');
  await b.click('.pause-menu [data-action="account"]');
  await b.waitForSelector('[data-action="accountKeep"]');
  check(/plus récente/.test(await accountText(b)) || /ont avancé/.test(await accountText(b)), 'B, resté en jeu, est prévenu que le compte a une partie plus récente (celle de A)');
  check((await money(b)) === 1800, 'et sa partie en cours n’a pas été remplacée en silence (1 800 $)');
  await b.click('[data-action="accountKeep"][data-arg="cloud"]');
  check(await until(b, () => window.__EM.mode === 'playing' && window.__EM.state.money === 2000), 'B prend la partie du compte (2 000 $) et continue');

  // ---------------------------------------------------------------- supprimer le compte, depuis le jeu
  await b.keyboard.press('Escape');
  await b.waitForSelector('.pause-menu');
  await b.click('.pause-menu [data-action="account"]');
  await b.waitForSelector('[data-action="accountDelete"]');
  await b.click('[data-action="accountDelete"]');
  await b.waitForSelector('#acct-del');
  await b.fill('#acct-del', PASS);
  await b.click('[data-action="accountDeleteYes"]');
  check(await waitAccount(b, 'Se connecter'), 'B supprime le compte depuis le jeu : retour au formulaire');
  const gone = await signIn();
  check(gone.status === 400, `Google ne connaît plus ce compte (HTTP ${gone.status}${gone.json?.error?.message ? ` ${gone.json.error.message}` : ''})`);
  const after = await rest(docUrl(uid), { headers: { Authorization: `Bearer ${idToken}` } });
  check(after.status !== 200, `la partie du compte n’est plus lisible (HTTP ${after.status})`);
  uid = null;
  check(await b.evaluate(() => !!localStorage.getItem('empire-miner.save') && !localStorage.getItem('empire-miner.account')), 'la partie de B reste sur son appareil, sans session');

  await A.ctx.close();
  await B.ctx.close();
} catch (e) {
  failures++;
  console.log(`✘ ARRÊT : ${String(e.message).split('\n')[0]}`);
  for (const [n, p] of [['A', a], ['B', b]]) {
    if (!p) continue;
    try {
      await p.screenshot({ path: join(ROOT, `e2e/screenshots/browser-check-${n}.png`) });
      console.log(`   page ${n} : mode=${await p.evaluate(() => window.__EM?.mode)} · menu : ${(await p.evaluate(() => document.querySelector('#menu-root')?.textContent ?? '')).replace(/\s+/g, ' ').slice(0, 300)}`);
      console.log(`   page ${n} : toasts : ${(await p.evaluate(() => document.querySelector('#toasts')?.textContent ?? '')).replace(/\s+/g, ' ').slice(0, 300)}`);
    } catch (err) {
      console.log(`   page ${n} : illisible (${err.message.split('\n')[0]})`);
    }
  }
} finally {
  // Ménage de dernier recours : le compte jetable ne doit pas rester chez Google.
  const s = await signIn().catch(() => null);
  if (s?.json?.idToken) {
    const del = await rest(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: s.json.idToken }) });
    console.log(`ménage : compte jetable encore là, supprimé (HTTP ${del.status})`);
    if (s.json.localId) await rest(docUrl(s.json.localId), { method: 'DELETE', headers: { Authorization: `Bearer ${s.json.idToken}` } }).catch(() => null);
  }
}

check(blocked.length === 0, `la page n’a demandé que le site et Google${blocked.length ? ` — bloqué : ${[...new Set(blocked)].slice(0, 4).join(', ')}` : ''}`);
check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
if (errors.length > 1) console.log(errors.slice(1, 5).join('\n'));
const counts = {};
for (const q of asked) counts[q] = (counts[q] ?? 0) + 1;
console.log('\nRequêtes relayées vers Google :');
for (const [q, n] of Object.entries(counts)) console.log(`  ${n} × ${q}`);
await browser.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
