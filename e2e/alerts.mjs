/**
 * Alerte « machine à l'arrêt », dans un vrai navigateur :
 *   - un four qui a du minerai mais plus de charbon : après un moment, la pastille « ⚠ 1 machine à l'arrêt » apparaît sous l'argent,
 *     un message prévient une seule fois ;
 *   - un appui sur la pastille ouvre la carte, centrée sur le four (anneau rouge) ;
 *   - le charbon revenu, la pastille disparaît ;
 *   - sur téléphone, la pastille fait au moins 44 px de haut et ne déborde pas de l'écran.
 *
 *   npm run build && node e2e/alerts.mjs
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
  server = await preview({ preview: { port: 4292, strictPort: false }, logLevel: 'silent' });
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
/** La simulation avance de `seconds` s de jeu d'un coup (la partie reste affichée telle quelle). */
const advance = (seconds) =>
  ev((s) => {
    const g = window.__EM.state;
    for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
  }, seconds);
const chip = () => ev(() => document.querySelector('#hud-alert .alert')?.textContent?.replace(/\s+/g, ' ') ?? '');

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await ev(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

console.log('\n▶ Un four sans charbon');
const spot = await ev(() => {
  const g = window.__EM.state;
  g.pickaxeLevel = 2;
  g.setBagLevel(2);
  g.stats.collected.coal = 5;
  const free = (x, y) => g.world.isOpen(x, y) && !g.structures.at(x, y) && !g.borerAt(x, y);
  for (const y of [26, 25, 27])
    for (let x = 46; x <= 50; x++) if ([0, 1, 2, 3].every((d) => free(x + d, y)) && free(x + 1, y + 1)) return { x, y };
  return null;
});
check(!!spot, 'une place libre pour quatre cases dans la salle du fond');
await ev(([x, y]) => {
  const g = window.__EM.state;
  g.player.x = (x + 1.5) * 16;
  g.player.y = (y + 1.5) * 16;
  window.__EM.renderer.snapCamera();
  for (const k of ['storage', 'storage', 'conveyor', 'furnace']) g.inventory.addKit(k, 1);
  const put = (kit, tx, ty) => {
    const s = g.place(kit, tx, ty, 0);
    if (!s) throw new Error(`${kit} @${tx},${ty} : ${g.canPlace(kit, tx, ty).reason}`);
    return s;
  };
  const src = put('storage', x, y);
  put('conveyor', x + 1, y);
  put('furnace', x + 2, y);
  put('storage', x + 3, y);
  src.put('copper', 50); // du minerai, mais pas de charbon
}, [spot.x, spot.y]);

await advance(8);
await sleep(300);
check((await chip()) === '', 'au début, aucune pastille : un arrêt de quelques secondes ne compte pas');

await advance(30);
await until(() => !!document.querySelector('#hud-alert .alert'), null, 5000);
const text = await chip();
check(/1 machine à l’arrêt/.test(text), `la pastille apparaît (« ${text} »)`);
const toasts = await ev(() => [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent));
check(toasts.filter((t) => /Four.*charbon/i.test(t)).length === 1, `un message prévient une fois (« ${toasts.join(' | ')} »)`);
await page.screenshot({ path: `${SHOTS}alerts-01-pastille.png` });

console.log('\n▶ Un appui sur la pastille');
await page.click('#hud-alert .alert');
await until(() => !!document.getElementById('map-canvas'), null, 5000);
check(await ev(() => !!document.getElementById('map-canvas')), 'la carte complète s’ouvre');
check(await ev(() => window.__EM.map.zoomed), 'et elle est zoomée sur la machine');
await sleep(500);
await page.screenshot({ path: `${SHOTS}alerts-02-carte.png` });
await page.keyboard.press('Escape');
await sleep(200);

console.log('\n▶ Le charbon revient');
await ev(() => {
  window.__EM.state.structures.list.find((s) => s.type === 'furnace').fuelUnits = 6; // directement dans le four : la file du convoyeur est pleine de cuivre
});
await advance(5);
await until(() => !document.querySelector('#hud-alert .alert'), null, 5000);
check((await chip()) === '', 'la pastille disparaît quand la machine repart');

console.log('\n▶ Sur téléphone');
await ev(() => {
  const g = window.__EM.state;
  const f = g.structures.list.find((s) => s.type === 'furnace');
  f.fuelUnits = 0;
  f.burn = 0;
  f.status = 'nofuel';
});
await page.setViewportSize({ width: 390, height: 844 });
await until(() => window.__EM.stalls.since.size > 0, null, 5000); // le relevé a vu le début de l'arrêt
await advance(30);
await until(() => !!document.querySelector('#hud-alert .alert'), null, 5000);
const box = await ev(() => {
  const r = document.querySelector('#hud-alert .alert')?.getBoundingClientRect();
  return r ? { left: r.left, right: r.right, height: r.height } : null;
});
check(!!box, 'la pastille est là en portrait');
check(box && box.height >= 44, `elle fait au moins 44 px de haut (${box ? Math.round(box.height) : '—'} px)`);
check(box && box.left >= 0 && box.right <= 390, `et ne déborde pas de l’écran (${box ? Math.round(box.left) : '—'} → ${box ? Math.round(box.right) : '—'})`);
await page.screenshot({ path: `${SHOTS}alerts-03-telephone.png` });

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
