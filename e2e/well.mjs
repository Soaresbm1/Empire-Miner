/**
 * Le puits de l'Ascenseur de puits, dans un vrai navigateur :
 *   - au magasin de l'Atelier (onglet Machines), le puits est verrouillé tant que la phase « Machine d'extraction » n'est pas
 *     terminée, puis s'achète (une fois le chantier avancé) ;
 *   - posé au camp, E ouvre son panneau : il dit « plus de charbon », puis « plus de mécanisme » ;
 *   - « Charger le charbon » et « Déposer mes mécanismes » (vrais clics) le mettent en marche : il remonte du minerai dans un coffre ;
 *   - le dessin, la pastille « machine à l'arrêt » quand il s'arrête.
 *
 *   npm run build && node e2e/well.mjs
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4293, strictPort: false }, logLevel: 'silent' });
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
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = async (fn, arg, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return true;
  } catch {
    return false;
  }
};
const advance = (seconds) =>
  ev((s) => {
    const g = window.__EM.state;
    for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
  }, seconds);
const panelText = () => ev(() => (document.querySelector('#panel-root')?.textContent ?? '').replace(/\s+/g, ' '));

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await ev(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

console.log('\n▶ Au magasin de l’Atelier');
await ev(() => {
  const g = window.__EM.state;
  g.money = 500000;
  g.project.phase = 6;
  const b = g.structures.list.find((s) => s.type === 'workshop');
  g.player.x = (b.x + 1) * 16;
  g.player.y = (b.y + b.h + 0.5) * 16;
  window.__EM.renderer.snapCamera();
});
await sleep(300);
await page.keyboard.press('KeyE');
await until(() => !!document.querySelector('#panel-root .panel'), null, 5000);
await page.click('#panel-root [data-action="tab"][data-arg="machines"]');
await sleep(300);
let text = await panelText();
check(/Puits/.test(text), 'le puits figure au magasin');
check(/Machine d’extraction/.test(text) && /🔒/.test(text), 'il est verrouillé : le texte nomme la phase « Machine d’extraction »');
check(!(await ev(() => !!document.querySelector('#panel-root [data-action="buyKit"][data-arg="well:1"]'))), 'aucun bouton d’achat tant qu’il est verrouillé');
await ev(() => {
  window.__EM.state.project.phase = 7;
});
await until(() => !!document.querySelector('#panel-root [data-action="buyKit"][data-arg="well:1"]'), null, 5000);
check(await ev(() => !!document.querySelector('#panel-root [data-action="buyKit"][data-arg="well:1"]:not([disabled])')), 'la phase terminée, le bouton d’achat apparaît (60 000 $)');
await page.click('#panel-root [data-action="buyKit"][data-arg="well:1"]');
await until(() => window.__EM.state.inventory.kitCount('well') === 1, null, 5000);
check((await ev(() => window.__EM.state.inventory.kitCount('well'))) === 1, 'un puits en stock, payé 60 000 $');
check((await ev(() => window.__EM.state.money)) === 440000, 'l’argent a baissé de 60 000 $');
await page.screenshot({ path: `${SHOTS}well-01-magasin.png` });
await page.keyboard.press('Escape');
await sleep(200);

console.log('\n▶ Posé au camp');
const spot = await ev(() => {
  const g = window.__EM.state;
  for (let y = 0; y + 3 <= 10; y++)
    for (let x = 6; x < 80; x++) {
      let ok = true;
      for (let yy = y; yy < y + 3 && ok; yy++) for (let xx = x; xx < x + 5 && ok; xx++) ok = g.world.isOpen(xx, yy) && !g.structures.at(xx, yy);
      if (ok) return { x, y };
    }
  return null;
});
check(!!spot, 'une place libre au camp');
await ev(([x, y]) => {
  const g = window.__EM.state;
  g.player.x = (x + 1.5) * 16;
  g.player.y = (y + 3.6) * 16;
  window.__EM.renderer.snapCamera();
  g.inventory.addKit('storage', 1);
  const w = g.place('well', x, y, 0);
  if (!w) throw new Error(g.canPlace('well', x, y).reason);
  if (!g.place('storage', x + 3, y + 1, 0)) throw new Error('coffre');
  g.setBagLevel(2); // la brouette de départ ne porte pas dix charbons et deux mécanismes
  g.inventory.add('coal', 10);
  g.inventory.add('mechanism', 2);
}, [spot.x, spot.y]);
await advance(1);
await sleep(300);
await page.screenshot({ path: `${SHOTS}well-02-camp.png` });
await page.keyboard.press('KeyE');
await until(() => /Puits/.test(document.querySelector('#panel-root .panel')?.textContent ?? ''), null, 5000);
text = await panelText();
check(/plus de mécanisme/.test(text) || /plus de charbon/.test(text), `le panneau du puits dit pourquoi il est arrêté (« ${text.slice(0, 90)}… »)`);
await page.click('#panel-root [data-action="wellFuel"]');
await page.click('#panel-root [data-action="wellDeposit"]');
await until(() => {
  const w = window.__EM.state.structures.list.find((s) => s.type === 'well');
  return w.fuelUnits === 10 && w.mech === 2;
}, null, 5000);
const loaded = await ev(() => {
  const w = window.__EM.state.structures.list.find((s) => s.type === 'well');
  return { coal: w.fuelUnits, mech: w.mech + (w.life > 0 ? 1 : 0), bag: window.__EM.state.inventory.count('coal') + window.__EM.state.inventory.count('mechanism') };
});
// Le jeu tourne déjà : le puits a pu entamer un charbon et mettre un mécanisme en place (compté avec ceux en réserve).
check(loaded.coal >= 9 && loaded.mech === 2 && loaded.bag === 0, `les vrais clics chargent 10 charbons et 2 mécanismes depuis le sac (${loaded.coal} charbons, ${loaded.mech} mécanismes, sac : ${loaded.bag})`);

console.log('\n▶ Il remonte du minerai');
await advance(60);
await sleep(400);
text = await panelText();
check(/Remonte du minerai/.test(text), 'le panneau dit qu’il remonte du minerai');
const got = await ev(([x, y]) => {
  const c = window.__EM.state.structures.at(x + 3, y + 1);
  return { n: Object.values(c.items).reduce((a, b) => a + b, 0), iron: c.items.iron ?? 0, diamond: c.items.diamond ?? 0 };
}, [spot.x, spot.y]);
check(got.n >= 12 && got.n <= 14 && got.iron >= 4, `environ 12 morceaux dans le coffre après une minute (${got.n}, dont ${got.iron} de fer)`);
await page.screenshot({ path: `${SHOTS}well-03-panneau.png` });
await page.keyboard.press('Escape');

console.log('\n▶ Il s’arrête : la pastille le signale');
await ev(() => {
  const w = window.__EM.state.structures.list.find((s) => s.type === 'well');
  w.mech = 0;
  w.life = 0;
});
await until(() => window.__EM.stalls.since.size > 0, null, 5000);
await advance(30);
await until(() => /Puits/.test(document.querySelector('#hud-alert .alert')?.getAttribute('title') ?? ''), null, 5000);
check(await ev(() => /1 machine à l’arrêt/.test(document.querySelector('#hud-alert .alert')?.textContent ?? '')), 'la pastille « 1 machine à l’arrêt » apparaît');
check(await ev(() => /Puits : plus de mécanisme/.test(document.querySelector('#hud-alert .alert')?.getAttribute('title') ?? '')), 'et nomme le puits et la cause');
await sleep(400);
await page.screenshot({ path: `${SHOTS}well-04-arret.png` });

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
