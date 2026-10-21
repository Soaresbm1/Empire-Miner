/**
 * Le livreur, dans un vrai navigateur : recrutement au clic à l'Atelier (onglet Ouvriers), puis il prend dans un coffre ce
 * qu'une commande acceptée et le chantier attendent et le porte lui-même au Tableau d'affichage et au chantier.
 *
 *   npm run build && node e2e/courier.mjs
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
  server = await preview({ preview: { port: 4271, strictPort: false }, logLevel: 'silent' });
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

console.log('\n▶ Recrutement');
await ev(() => {
  const g = window.__EM.state;
  g.money = 5000;
  g.pickaxeLevel = 1;
  g.stats.collected.coal = 5;
  g.stats.collected.copper = 5;
  g.stats.collected.gold = 5;
  const w = g.structures.list.find((s) => s.type === 'workshop');
  g.player.x = (w.x + 1) * 16;
  g.player.y = (w.y + w.h + 0.6) * 16;
  window.__EM.renderer.snapCamera();
});
await sleep(300);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
await page.keyboard.press('Digit5');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'crew' && !!document.querySelector('#panel-root [data-action="hireWorker"]'));
check(await ev(() => /Livreur/.test(document.querySelector('#panel-root .panel')?.textContent ?? '')), 'l’onglet Ouvriers propose un Livreur');
// La quatrième fiche est plus bas : on fait défiler le panneau comme le ferait le joueur.
await ev(() => document.querySelector('#panel-root [data-action="hireWorker"][data-arg="courier"]')?.scrollIntoView({ block: 'center' }));
await sleep(150);
check(await front('#panel-root [data-action="hireWorker"][data-arg="courier"]'), 'son bouton « Recruter » est devant, cliquable (après défilement)');
await page.screenshot({ path: `${SHOTS}courier-01-recrutement.png` });
const money0 = await ev(() => window.__EM.state.money);
await page.click('#panel-root [data-action="hireWorker"][data-arg="courier"]');
check(await until(() => window.__EM.state.workers.list.some((w) => w.job === 'courier')), 'un clic recrute un livreur');
check((await ev(() => window.__EM.state.money)) < money0, 'achat unique, débité');
check(await until(() => /Livreur/.test(document.querySelector('#panel-root .crew')?.textContent ?? '')), 'il apparaît dans l’équipe, avec son métier');
await page.screenshot({ path: `${SHOTS}courier-02-equipe.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

console.log('\n▶ Tournée');
const setup = await ev(() => {
  const g = window.__EM.state;
  // Un coffre au camp qui contient de l'or ; une commande acceptée en demande.
  g.inventory.addKit('storage', 1);
  g.player.x = 50.5 * 16;
  g.player.y = 10.5 * 16;
  let chest = null;
  for (const x of [44, 46, 40, 38, 36]) {
    chest = g.place('storage', x, 10, 1);
    if (chest) break;
  }
  if (!chest) return null;
  chest.put('gold', 12);
  chest.put('coal', 60);
  const c = {
    id: 777,
    client: 1,
    lines: [{ res: 'gold', qty: 8, done: 0 }],
    reward: 400,
    premium: 0.4,
    hot: false,
    limit: 900,
    until: Math.ceil(g.time) + 900,
    accepted: true,
  };
  g.contracts.list.push(c);
  g.events.length = 0;
  return { x: chest.x, y: chest.y, reward: c.reward, money: g.money, coal: g.project.delivered.coal ?? 0 };
});
check(!!setup, 'un coffre garni est posé au camp');
// On laisse le jeu tourner en vrai : le livreur marche, prend, livre.
check(await until(() => !window.__EM.state.contracts.get(777), null, 60000), 'le livreur honore la commande tout seul (marche, prend, livre)');
check((await ev(() => window.__EM.state.money)) - setup.money >= setup.reward, 'la récompense est versée');
check(await until(() => /Commande honorée/.test(document.querySelector('#toasts')?.textContent ?? '')), 'un message annonce la commande honorée');
await page.screenshot({ path: `${SHOTS}courier-03-livree.png` });
check(
  await until((c) => (window.__EM.state.project.delivered.coal ?? 0) > c, setup.coal, 60000),
  'il apporte aussi du charbon au chantier du Grand Chevalement',
);
check(await ev((p) => window.__EM.state.structures.at(p.x, p.y).items.gold === 4, setup), 'le surplus d’or reste dans le coffre');

console.log('\n▶ Sauvegarde');
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
check(await ev(() => window.__EM.state.workers.list.some((w) => w.job === 'courier')), 'après rechargement, le livreur est toujours là');
check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ` : ${errors.slice(0, 3).join(' | ')}` : ''));

await browser.close();
if (server) await server.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
