/**
 * L'acte II du chantier (le Grand Ascenseur), dans un vrai navigateur : le panneau du chantier après le Grand Chevalement,
 * la tour dessinée à chaque phase, un chantier qui avance tout seul (livraison, salaires, commandes, clients fidèles),
 * l'équipe qui passe de 9 à 12 ouvriers, et la sauvegarde.
 *
 *   npm run build && node e2e/lift.mjs
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
  server = await preview({ preview: { port: 4272, strictPort: false }, logLevel: 'silent' });
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

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

console.log('\n▶ La tour, phase par phase');
// Le Grand Chevalement est achevé ; on regarde le chantier de près.
await ev(() => {
  const E = window.__EM;
  const g = E.state;
  g.project.phase = 5;
  g.project.doneAt = [1, 2, 3, 4, 5];
  const s = g.structures.list.find((x) => x.type === 'site');
  g.player.x = (s.x + s.w / 2) * 16;
  g.player.y = (s.y + s.h + 0.5) * 16;
  E.renderer.snapCamera();
});
for (let phase = 0; phase <= 5; phase++) {
  await ev((p) => (window.__EM.state.project2.phase = p), phase);
  await sleep(350);
  await page.screenshot({ path: `${SHOTS}lift-tour-${phase}.png` });
}
check(true, 'six images de la tour (acte II) enregistrées : lift-tour-0.png à lift-tour-5.png');
await ev(() => (window.__EM.state.project2.phase = 0));

console.log('\n▶ Le panneau');
await sleep(300);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
check((await page.textContent('#panel-root .panel h2')).includes('Grand Ascenseur'), 'E ouvre le Grand Ascenseur (le titre suit l’acte)');
check(await ev(() => /Acte II/.test(document.querySelector('#panel-root .panel')?.textContent ?? '')), 'le bandeau « Acte II » est là');
check(await ev(() => /Clients fidèles/.test(document.querySelector('#panel-root .panel')?.textContent ?? '')), 'la ligne « Clients fidèles » est là');
check((await ev(() => document.querySelectorAll('#panel-root .site-steps li').length)) === 5, 'la frise montre cinq phases');
await page.screenshot({ path: `${SHOTS}lift-01-panneau.png` });

console.log('\n▶ Une phase avance toute seule');
await ev(() => {
  const g = window.__EM.state;
  const p = g.project2;
  g.stats.contracts = 100;
  for (let i = 0; i < 3; i++) g.contracts.reputation[i] = 6;
  g.money = 1e6;
  for (const n of p.missing()) g.inventory.items[n.res] = n.qty;
});
await sleep(200);
check(await until(() => !document.querySelector('#panel-root [data-action="siteDeliver"][disabled]')), 'le bouton « Livrer mon sac » s’allume quand le sac contient ce qu’il faut');
await ev(() => {
  const g = window.__EM.state;
  // Le sac peut être trop petit : on livre directement ce qui manque (le geste du bouton).
  for (const n of g.project2.missing()) g.project2.deliver(n.res, n.qty);
});
await page.click('#panel-root [data-action="siteFund"]');
check(await until(() => window.__EM.state.project2.phase === 1), 'tout livré, payé, commandes et clients fidèles : la phase 1 se termine');
check(await until(() => /Cage d.acier.*terminée/.test(document.querySelector('#toasts')?.textContent ?? '')), 'une annonce parle du Grand Ascenseur');
check(await ev(() => window.__EM.state.maxWorkers === 10), 'la première phase ouvre une place d’équipe (10 ouvriers au plus)');
await page.screenshot({ path: `${SHOTS}lift-02-phase2.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

console.log('\n▶ L’équipe de douze');
const team = await ev(() => {
  const g = window.__EM.state;
  g.project2.phase = 5;
  g.pickaxeLevel = 3;
  const J = ['picker', 'driller', 'refueler', 'courier'];
  for (let i = 0; i < 12; i++) g.workers.add(J[i % 4], g);
  return { count: g.workers.count, max: g.maxWorkers };
});
check(team.count === 12 && team.max === 12, 'douze ouvriers, douze places');
await ev(() => {
  const E = window.__EM;
  const g = E.state;
  g.project2.phase = 4;
  const w = g.structures.list.find((x) => x.type === 'workshop');
  g.player.x = (w.x + 1) * 16;
  g.player.y = (w.y + w.h + 0.6) * 16;
  E.renderer.snapCamera();
});
await sleep(300);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
await page.keyboard.press('Digit5');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'crew');
check(await ev(() => /Votre équipe : 12 sur 12/.test(document.querySelector('#panel-root .panel')?.textContent ?? '')), 'l’Atelier affiche « Votre équipe : 12 sur 12 »');
await page.screenshot({ path: `${SHOTS}lift-03-equipe.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

console.log('\n▶ L’achèvement');
await ev(() => {
  const g = window.__EM.state;
  const s = g.structures.list.find((x) => x.type === 'site');
  g.player.x = (s.x + s.w / 2) * 16;
  g.player.y = (s.y + s.h + 0.5) * 16;
  window.__EM.renderer.snapCamera();
  g.project2.phase = 4;
  g.stats.contracts = 999;
  for (let i = 0; i < 6; i++) g.contracts.reputation[i] = 12;
  g.money = 1e6;
  const p = g.project2;
  for (const n of p.missing()) p.deliver(n.res, n.qty);
  p.fund(p.moneyLeft());
});
check(await until(() => window.__EM.state.project2.done, null, 5000), 'la dernière phase s’achève');
check(await until(() => /Roi des profondeurs/.test(document.querySelector('#panel-root .panel')?.textContent ?? '')), 'l’écran de fin du Grand Ascenseur s’ouvre tout seul');
await page.screenshot({ path: `${SHOTS}lift-04-fin.png` });
check(await ev(() => !!document.querySelector('#panel-root [data-action="close"].btn')), '« Continuer à jouer » est là');
await page.click('#panel-root [data-action="close"].btn');
check(await until(() => !document.querySelector('#panel-root .panel')), 'on referme et la partie continue');

console.log('\n▶ Sauvegarde');
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
check(await ev(() => window.__EM.state.project2.done && window.__EM.state.workers.count === 12), 'après rechargement : l’acte II achevé, douze ouvriers');
check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ` : ${errors.slice(0, 3).join(' | ')}` : ''));

await browser.close();
if (server) await server.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
