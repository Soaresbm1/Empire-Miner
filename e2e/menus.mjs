/**
 * Les panneaux ouverts depuis un menu (« Commandes » du menu principal et du menu pause) passent devant : le menu s'efface le
 * temps de les lire, et revient à leur fermeture (croix ou Échap). Avant, le panneau s'ouvrait DERRIÈRE le menu, illisible.
 * Seul, le jeu reste figé tant qu'on est passé par le menu pause, même pendant la lecture du panneau.
 *
 * De vrais clics et de vraies touches, et ce que l'œil verrait : un élément est « devant » si c'est lui que touche un doigt posé à
 * son centre.
 *
 *   npm run build && node e2e/menus.mjs
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
  server = await preview({ preview: { port: 4251, strictPort: false }, logLevel: 'silent' });
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

/** Le doigt posé au centre de l'élément touche-t-il l'élément (« devant »), autre chose (« masqué par … »), ou rien (« absent ») ? */
const hit = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (el.contains(e)) return 'devant';
    return `masqué par ${e ? `${e.tagName.toLowerCase()} (${e.closest('#menu-root') ? 'menu' : e.closest('#panel-root') ? 'panneau' : 'autre'})` : 'rien'}`;
  }, sel);
const menuVisibility = () => page.evaluate(() => getComputedStyle(document.querySelector('#menu-root')).visibility);
const panelOpen = () => page.evaluate(() => !!document.querySelector('#panel-root .panel'));
const time = () => page.evaluate(() => window.__EM.state.time);

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await page.waitForSelector('#menu-root [data-action="new"]');

// ---------------------------------------------------------------- menu principal
console.log('\n▶ menu principal');
check((await hit('#menu-root [data-action="help"]')) === 'devant', '« Commandes » est devant, cliquable');
await page.click('#menu-root [data-action="help"]');
await page.waitForSelector('#panel-root .panel');
check((await hit('#panel-root .panel .close')) === 'devant', 'le panneau « Commandes » s’ouvre devant : sa croix est cliquable');
check((await hit('#panel-root .panel h2')) === 'devant', 'son titre est devant, pas masqué par le menu');
check((await menuVisibility()) === 'hidden', 'le menu s’efface pendant qu’on lit');
check((await hit('#menu-root [data-action="new"]')) !== 'devant', 'le menu ne reçoit plus les clics (« Nouvelle partie » n’est pas touchée)');
await page.screenshot({ path: `${SHOTS}menus-01-commandes-depuis-le-menu.png` });
await page.click('#panel-root .close');
check(!(await panelOpen()), 'la croix ferme le panneau');
check((await menuVisibility()) === 'visible' && (await hit('#menu-root [data-action="new"]')) === 'devant', 'le menu principal revient, cliquable');

await page.click('#menu-root [data-action="help"]');
await page.waitForSelector('#panel-root .panel');
await page.keyboard.press('Escape');
check(await until(() => !document.querySelector('#panel-root .panel')), 'Échap ferme le panneau');
check((await menuVisibility()) === 'visible' && (await hit('#menu-root [data-action="new"]')) === 'devant', 'et le menu principal revient');

// « Plein écran… » (iPhone) ouvre un autre panneau depuis le menu : même traitement.
await page.evaluate(() => window.__EM.onAction('install', ''));
await page.waitForSelector('#panel-root .panel');
check((await menuVisibility()) === 'hidden' && (await hit('#panel-root .panel .close')) === 'devant', 'le panneau « Plein écran » passe aussi devant le menu');
await page.keyboard.press('Escape');
check(await until(() => !document.querySelector('#panel-root .panel')), 'Échap le ferme');
check((await menuVisibility()) === 'visible', 'et le menu revient');

// ---------------------------------------------------------------- menu pause, seul : le jeu reste figé
console.log('\n▶ menu pause (seul)');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(300);
await page.keyboard.press('Escape');
await page.waitForSelector('.pause-menu');
const t0 = await time();
await sleep(400);
check((await time()) === t0, 'le menu pause fige le jeu');
check((await hit('.pause-menu [data-action="help"]')) === 'devant', '« Commandes » est devant, cliquable');
await page.click('.pause-menu [data-action="help"]');
await page.waitForSelector('#panel-root .panel');
check((await hit('#panel-root .panel .close')) === 'devant', 'le panneau « Commandes » s’ouvre devant : sa croix est cliquable');
check((await hit('#panel-root .panel h2')) === 'devant', 'son titre est devant, pas masqué par le menu');
check((await menuVisibility()) === 'hidden', 'le menu pause s’efface pendant qu’on lit');
check((await hit('.pause-menu [data-action="resume"]')) !== 'devant', 'et ne reçoit plus les clics');
await sleep(600);
check((await time()) === t0, 'le jeu reste figé pendant la lecture (seul, depuis le menu pause)');
await page.screenshot({ path: `${SHOTS}menus-02-commandes-depuis-la-pause.png` });
await page.keyboard.press('Escape');
check(await until(() => !document.querySelector('#panel-root .panel')), 'Échap ferme le panneau');
check((await menuVisibility()) === 'visible' && (await hit('.pause-menu [data-action="resume"]')) === 'devant', 'et le menu pause revient, cliquable');
check((await time()) === t0, 'le jeu est toujours figé (le menu pause est là)');

await page.click('.pause-menu [data-action="help"]');
await page.waitForSelector('#panel-root .panel');
await page.click('#panel-root .close');
check(!(await panelOpen()) && (await menuVisibility()) === 'visible', 'la croix aussi ramène le menu pause');
await page.click('.pause-menu [data-action="resume"]');
check(await until(() => !document.querySelector('#menu-root .pause-menu')), '« Reprendre » ferme le menu');
await sleep(500);
check((await time()) > t0, 'le jeu repart');

// ---------------------------------------------------------------- en jeu, sans menu : la touche H n'a pas changé
console.log('\n▶ en jeu, sans menu');
await page.keyboard.press('KeyH');
await page.waitForSelector('#panel-root .panel');
check((await hit('#panel-root .panel .close')) === 'devant', 'H ouvre « Commandes » devant le jeu');
check(await page.evaluate(() => !document.querySelector('#menu-root').children.length), 'sans aucun menu');
const before = await time();
await sleep(400);
check((await time()) > before, 'le jeu continue pendant qu’on lit (comme avant)');
await page.keyboard.press('KeyH');
check(await until(() => !document.querySelector('#panel-root .panel')), 'H le referme');

// ---------------------------------------------------------------- Échap ouvre le menu pause même après un panneau
await page.keyboard.press('Escape');
await page.waitForSelector('.pause-menu');
check((await menuVisibility()) === 'visible', 'Échap ouvre le menu pause, visible');

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
