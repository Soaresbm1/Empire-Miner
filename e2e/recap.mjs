/**
 * Le bilan de session, dans un vrai navigateur : le bouton « Bilan » du menu pause ouvre l'écran devant le menu, et à la reprise
 * d'une partie longue le bilan de la dernière session s'ouvre tout seul.
 *
 *   npm run build && node e2e/recap.mjs
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4273, strictPort: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, arg, timeout = 8000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return true;
  } catch {
    return false;
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const front = (sel) =>
  ev((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }, sel);

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

console.log('\n▶ Pendant la partie');
// Une session bien remplie : de l'argent, des commandes, des ouvriers au travail.
await ev(() => {
  const g = window.__EM.state;
  g.stats.playTime += 900;
  g.stats.earned += 4200;
  g.stats.contracts += 3;
  g.stats.tilesMined += 120;
  g.stats.crewStored += 64;
  g.stats.crewFueled += 9;
  g.pickaxeLevel = 2;
  const w = g.workers.add('courier', g);
  w.flag = 'nogoods';
});
await ev(() => window.__EM.ui.showPauseMenu(false, 'high', null));
await page.waitForSelector('#menu-root [data-action="recap"]');
check(await front('#menu-root [data-action="recap"]'), 'le menu pause a un bouton « Bilan », cliquable');
await page.click('#menu-root [data-action="recap"]');
await page.waitForSelector('#panel-root .panel');
check((await page.textContent('#panel-root .panel h2')).includes('Bilan'), 'il ouvre l’écran « Bilan »');
check(await front('#panel-root .panel [data-action="close"].btn'), 'le panneau est devant le menu (le bouton Fermer est cliquable)');
const text = await ev(() => document.querySelector('#panel-root .panel')?.textContent ?? '');
check(/Cette session/.test(text) && /Argent gagné/.test(text) && /4\s?200/.test(text), 'la session en cours : argent gagné');
check(/Commandes honorées/.test(text) && /Blocs minés/.test(text), 'commandes et blocs minés');
check(/64 objets rangés/.test(text) && /9 charges de charbon/.test(text), 'ce que les ouvriers ont fait');
check(/À surveiller/.test(text) && /Livreur : rien de ce qui est attendu/.test(text), 'un ouvrier bloqué est signalé');
check(/Grand Chevalement/.test(text), 'le chantier et sa prévision sont rappelés');
await page.screenshot({ path: `${SHOTS}recap-01-pause.png` });
await page.click('#panel-root .panel [data-action="close"].btn');
check(await until(() => !document.querySelector('#panel-root .panel')), 'on referme le bilan');
check(await ev(() => !!document.querySelector('#menu-root .pause-menu')), 'le menu pause est toujours là');
await ev(() => window.__EM.ui.hideMenu());

console.log('\n▶ À la reprise');
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
check(await ev(() => (JSON.parse(localStorage.getItem('empire-miner-save') ?? localStorage.getItem(Object.keys(localStorage).find((k) => /save/i.test(k)) ?? '') ?? '{}').recap?.earned ?? 0) >= 4200), 'la sauvegarde contient le bilan de la session');
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
check(await until(() => !!document.querySelector('#panel-root .panel'), null, 4000), 'le bilan de la dernière session s’ouvre tout seul à la reprise');
const resume = await ev(() => document.querySelector('#panel-root .panel')?.textContent ?? '');
check(/Bon retour/.test(resume) && /Dernière session/.test(resume), '« Bon retour » et la dernière session');
check(/15 min/.test(resume) && /4\s?200/.test(resume) && /64 objets rangés/.test(resume), '15 min de jeu, 4 200 $ gagnés, 64 objets rangés par les ouvriers');
await page.screenshot({ path: `${SHOTS}recap-02-reprise.png` });
await page.click('#panel-root .panel [data-action="close"].btn');
check(await until(() => !document.querySelector('#panel-root .panel')), 'on referme et la partie continue');

console.log('\n▶ Reprise d’une session trop courte');
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
check(await until(() => !!document.querySelector('#panel-root .panel'), null, 3000), 'la session de quelques secondes n’a pas effacé le bilan : il s’affiche encore');
check(/4\s?200/.test(await ev(() => document.querySelector('#panel-root .panel')?.textContent ?? '')), 'c’est toujours celui de la longue session');

check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ` : ${errors.slice(0, 3).join(' | ')}` : ''));
await browser.close();
if (server) await server.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
