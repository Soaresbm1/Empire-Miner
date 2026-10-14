/**
 * Rendement des lignes, dans un vrai navigateur, avec de vraies touches et un vrai pointeur :
 *   - une ligne coffre → convoyeur → four → coffre (le four est le goulot) : l'infobulle de chaque maillon donne son débit réel ;
 *   - G ouvre la vue « goulots » : légende en bas, machines et convoyeurs teints (le convoyeur bloqué vire au rouge), G la referme ;
 *   - le panneau du four (E) montre « Débit réel » et la mention de goulot ;
 *   - le Grand Chevalement et les commandes disent dans combien de temps, et ce qui retient ;
 *   - une partie d'avant (sans aucun de ces chiffres) se charge sans erreur.
 *
 *   npm run build && node e2e/flow.mjs
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
  server = await preview({ preview: { port: 4291, strictPort: false }, logLevel: 'silent' });
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
const nextFrames = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const teleport = (tx, ty) =>
  ev(([x, y]) => {
    const g = window.__EM.state;
    g.player.x = (x + 0.5) * 16;
    g.player.y = (y + 0.5) * 16;
    window.__EM.renderer.snapCamera();
  }, [tx, ty]);
const goTo = (type) =>
  ev((type) => {
    const E = window.__EM;
    const b = E.state.structures.list.find((s) => s.type === type);
    E.state.player.x = (b.x + b.w / 2) * 16;
    E.state.player.y = (b.y + b.h + 0.5) * 16;
    E.renderer.snapCamera();
  }, type);
const pressE = async () => {
  await page.keyboard.press('KeyE');
  await sleep(300);
};
async function settleCamera() {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const c = await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r([window.__EM.renderer.camX, window.__EM.renderer.camY])))));
    if (prev && Math.abs(c[0] - prev[0]) < 0.2 && Math.abs(c[1] - prev[1]) < 0.2) return;
    prev = c;
  }
}
const tileScreen = async (tx, ty) => {
  await settleCamera();
  return ev(([x, y]) => window.__EM.renderer.worldToScreen((x + 0.5) * 16, (y + 0.5) * 16), [tx, ty]);
};
/** La simulation avance de `seconds` s de jeu d'un coup (la partie reste affichée telle quelle). */
const advance = (seconds) =>
  ev((s) => {
    const g = window.__EM.state;
    for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
  }, seconds);
/** Teinte moyenne (r, g, b) d'un petit carré dans le coin d'une tuile, lue sur le canvas. */
const pixel = async (tx, ty) => {
  await settleCamera();
  return ev(([tx, ty]) => {
    const c = document.getElementById('game');
    const p = window.__EM.renderer.worldToScreen(tx * 16 + 3, ty * 16 + 3);
    const dpr = c.width / window.innerWidth;
    const d = c.getContext('2d').getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 3, 3).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return [r / n, g / n, b / n];
  }, [tx, ty]);
};
const tooltip = async (tx, ty) => {
  const p = await tileScreen(tx, ty);
  await page.mouse.move(p.x, p.y);
  await sleep(250);
  await page.mouse.move(p.x + 1, p.y + 1);
  await until(() => document.getElementById('tooltip')?.textContent, null, 3000);
  return ev(() => (document.getElementById('tooltip')?.textContent ?? '').replace(/\u00a0/g, ' '));
};

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await ev(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

await ev(() => {
  const g = window.__EM.state;
  g.pickaxeLevel = 2;
  g.money = 5000;
  g.setBagLevel(2);
  g.stats.collected.coal = 5;
  g.stats.collected.copper = 5;
  g.stats.structuresBuilt = Math.max(g.stats.structuresBuilt, 4);
});

// ---------------------------------------------------------------- la ligne
console.log('\n▶ La ligne : coffre → convoyeur → four → coffre');
const line = await ev(() => {
  const g = window.__EM.state;
  const free = (x, y) => g.world.isOpen(x, y) && !g.structures.at(x, y) && !g.borerAt(x, y);
  for (const y of [26, 25, 27])
    for (let x = 46; x <= 50; x++) if ([0, 1, 2, 3].every((d) => free(x + d, y)) && free(x + 1, y + 1)) return { x, y };
  return null;
});
check(!!line, 'une place libre pour quatre cases dans la salle du fond');
await teleport(line.x + 1, line.y + 1);
await ev(([x, y]) => {
  const g = window.__EM.state;
  for (const k of ['storage', 'storage', 'conveyor', 'furnace']) g.inventory.addKit(k, 1);
  const put = (kit, tx, ty, d = 0) => {
    const s = g.place(kit, tx, ty, d);
    if (!s) throw new Error(`${kit} @${tx},${ty} : ${g.canPlace(kit, tx, ty).reason}`);
    return s;
  };
  const src = put('storage', x, y);
  put('conveyor', x + 1, y, 0);
  put('furnace', x + 2, y, 0);
  put('storage', x + 3, y);
  src.put('coal', 6);
  src.put('copper', 50);
}, [line.x, line.y]);
await teleport(line.x + 1, line.y + 1);
check(await ev(([x, y]) => window.__EM.state.structures.at(x + 2, y)?.type === 'furnace', [line.x, line.y]), 'la ligne est posée');

// Tant que la mesure n'a pas de recul, les infobulles le disent.
await advance(2);
let tip = await tooltip(line.x + 2, line.y);
check(/mesure en cours/.test(tip), `au début, l’infobulle du four dit « mesure en cours » (« ${tip.replace(/\s+/g, ' ').slice(0, 90)}… »)`);

await advance(90);
await sleep(300);
const furnaceTile = [line.x + 2, line.y];
const beltTile = [line.x + 1, line.y];
tip = await tooltip(...furnaceTile);
check(/Débit : (1[89]|2[0-2]) \/min sur 20 possibles/.test(tip.replace(/ /g, ' ')), `l’infobulle du four donne son débit réel sur son maximum (« ${tip.replace(/\s+/g, ' ')} »)`);
check(/Goulot/.test(tip), 'et le dit goulot : sa file d’attente est pleine');
await page.screenshot({ path: `${SHOTS}flow-01-infobulle-four.png` });
tip = await tooltip(...beltTile);
check(/Passent : (1[89]|2[0-2]) \/min \(135 au plus\)/.test(tip.replace(/ /g, ' ')), `l’infobulle du convoyeur donne ce qui passe (« ${tip.replace(/\s+/g, ' ')} »)`);
check(/bloqué \d+ %/.test(tip), 'et le temps qu’il passe bloqué');
tip = await tooltip(line.x + 3, line.y);
check(/Entre : (1[89]|2[0-2]) \/min/.test(tip.replace(/ /g, ' ')), `le coffre de sortie dit ce qui y entre (« ${tip.replace(/\s+/g, ' ')} »)`);
await page.mouse.move(5, 5);

// ---------------------------------------------------------------- la vue « goulots »
console.log('\n▶ Vue goulots');
check(await ev(() => window.__EM.flowView === false), 'la vue est fermée au départ');
check(await ev(() => document.getElementById('hud-flow').textContent === ''), 'sans légende');
const hint = await ev(() => document.getElementById('hud-hints')?.textContent ?? '');
check(/Goulots/.test(hint), 'la barre de touches propose « G Goulots » (il y a des machines)');
const beltBefore = await pixel(...beltTile);
const furnaceBefore = await pixel(...furnaceTile);
await page.keyboard.press('KeyG');
await nextFrames();
await sleep(150);
check(await ev(() => window.__EM.flowView === true), 'G ouvre la vue goulots');
const legend = await ev(() => document.getElementById('hud-flow')?.textContent ?? '');
check(/Bloqué/.test(legend) && /À sec/.test(legend) && /Ça tourne/.test(legend), `la légende apparaît (« ${legend} »)`);
check(await ev(() => !!document.querySelector('#hud-flow .fl-dot.bad') && !!document.querySelector('#hud-flow .fl-dot.good')), 'avec ses pastilles de couleur');
const beltAfter = await pixel(...beltTile);
const furnaceAfter = await pixel(...furnaceTile);
const redness = (c) => c[0] - c[1];
check(redness(beltAfter) > redness(beltBefore) + 25, `le convoyeur bloqué vire au rouge (${beltBefore.map(Math.round)} → ${beltAfter.map(Math.round)})`);
check(furnaceAfter[1] - furnaceAfter[0] > furnaceBefore[1] - furnaceBefore[0] + 10, `le four qui tourne verdit (${furnaceBefore.map(Math.round)} → ${furnaceAfter.map(Math.round)})`);
await page.screenshot({ path: `${SHOTS}flow-02-goulots.png` });
// La vue suit la ligne : sans charbon, le four passe au rouge.
await ev(([x, y]) => {
  const f = window.__EM.state.structures.at(x + 2, y);
  f.fuelUnits = 0;
  f.burn = 0;
  const src = window.__EM.state.structures.at(x, y);
  src.items.coal = 0;
  delete src.items.coal;
}, [line.x, line.y]);
await advance(30);
await nextFrames();
const cold = await pixel(...furnaceTile);
check(redness(cold) > furnaceAfter[0] - furnaceAfter[1] + 25, `sans charbon, le four vire au rouge à son tour (${furnaceAfter.map(Math.round)} → ${cold.map(Math.round)})`);
await page.screenshot({ path: `${SHOTS}flow-03-sans-charbon.png` });
await page.keyboard.press('KeyG');
await nextFrames();
await sleep(150);
check(await ev(() => window.__EM.flowView === false), 'G la referme');
check(await ev(() => document.getElementById('hud-flow').textContent === ''), 'la légende disparaît');
// Un panneau ouvert : G ne bascule pas la vue (c'est une touche de jeu).
await ev(([x, y]) => {
  const g = window.__EM.state;
  g.structures.at(x + 2, y).addFuel(10);
  g.structures.at(x, y).put('copper', 50); // de quoi tourner encore une minute
  g.structures.at(x + 3, y).items = {};
}, [line.x, line.y]);

// ---------------------------------------------------------------- panneau du four
console.log('\n▶ Panneau du four');
await teleport(line.x + 2, line.y + 1);
await sleep(250);
await pressE();
check(await page.isVisible('.panel-furnace'), 'E ouvre le panneau du four');
await advance(75);
await sleep(400);
const furnaceText = (await page.textContent('.panel-furnace'))?.replace(/ /g, ' ') ?? '';
check(/Débit réel\s*(1[89]|2[0-2]) \/min sur 20/.test(furnaceText), `le panneau donne le débit réel (« ${furnaceText.match(/Débit réel[^A-Z]{0,30}/)?.[0] ?? '?'} »)`);
check(/Temps passé/.test(furnaceText), 'et le temps passé en marche, bloqué, à sec');
await page.screenshot({ path: `${SHOTS}flow-04-panneau-four.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- le Grand Chevalement et les commandes
console.log('\n▶ Prévisions');
await ev(() => {
  const g = window.__EM.state;
  g.project.phase = 1; // Charpente : 60 lingots de fer, 60 de cuivre, 2 500 $
  g.money = 100;
  g.inventory.items = {};
  // La production récente : 30 lingots de fer et 30 de cuivre à l'instant (60 par minute chacun) et 30 $ de ventes.
  g.production.addIngot('iron_ingot', 30);
  g.production.addIngot('copper_ingot', 30);
  g.production.addSale({ copper: 3 }, 600, true);
});
await goTo('site');
await sleep(250);
await pressE();
check(await page.isVisible('.panel-site'), 'E devant le chantier ouvre son panneau');
await until(() => /Au rythme actuel/.test(document.querySelector('.panel-site')?.textContent ?? ''), null, 4000);
const site = (await page.textContent('.panel-site'))?.replace(/ /g, ' ') ?? '';
check(/Au rythme actuel, la phase est prête dans ~\d+ min/.test(site), `le chantier annonce dans combien de temps (« ${site.match(/Au rythme actuel[^.]*/)?.[0] ?? '?'} »)`);
check(/Ce qui la retient : /.test(site), 'et ce qui la retient');
check(await ev(() => document.querySelectorAll('.panel-site .eta').length >= 2), 'chaque matériau porte sa durée');
await page.screenshot({ path: `${SHOTS}flow-05-chantier.png` });
// Plus aucune production de fer : la phase n'avance plus.
await ev(() => {
  const g = window.__EM.state;
  g.production.load([]);
});
await sleep(500);
const stalled = (await page.textContent('.panel-site')) ?? '';
check(/n'avance pas/.test(stalled) && /aucune production/.test(stalled), 'sans production, le chantier dit que rien n’avance et pourquoi');
await page.screenshot({ path: `${SHOTS}flow-06-chantier-muet.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

await ev(() => {
  const g = window.__EM.state;
  g.production.addIngot('copper_ingot', 30);
  g.contracts.list.length = 0;
  const base = { client: 0, reward: 480, premium: 0.4, hot: false, limit: 600 };
  g.contracts.list.push(
    { id: 9101, lines: [{ res: 'copper_ingot', qty: 20, done: 0 }], until: Math.ceil(g.time) + 900, accepted: true, ...base },
    { id: 9102, lines: [{ res: 'copper_ingot', qty: 24, done: 0 }], until: Math.ceil(g.time) + 400, accepted: false, ...base },
  );
});
await goTo('board');
await sleep(250);
await pressE();
await page.waitForSelector('#panel-root .panel-board');
await page.click('#panel-root .tab[data-arg="orders"]');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'orders');
await sleep(400);
const orders = (await page.textContent('#panel-root .panel-board'))?.replace(/ /g, ' ') ?? '';
check(/À votre rythme\s*~\d+ min · dans les temps/.test(orders) || /À votre rythme\s*moins d'une minute · dans les temps/.test(orders), `la commande acceptée dit si elle tient avant l’échéance (« ${orders.match(/À votre rythme[^R]{0,40}/)?.[0] ?? '?'} »)`);
check(/Réalisable \?\s*oui/.test(orders), 'la proposition dit si vos machines suffiraient');
await page.screenshot({ path: `${SHOTS}flow-07-commandes.png` });
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- l'aide, une partie d'avant
console.log('\n▶ Aide et ancienne sauvegarde');
await page.keyboard.press('KeyH');
await page.waitForSelector('#panel-root .help');
check(/Rendement des lignes/.test((await page.textContent('#panel-root .help')) ?? ''), 'l’aide explique la vue goulots');
await page.keyboard.press('Escape');
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
const saved = await ev(() => {
  window.__EM.autoSaveNow = () => {};
  return localStorage.getItem('empire-miner.save') ?? '';
});
check(saved.length > 100 && !/perMinute|"flow"|cells|meter/.test(saved), 'la sauvegarde ne contient aucun débit');
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
await sleep(500);
const reloaded = await ev(([x, y]) => {
  const f = window.__EM.state.structures.at(x + 2, y);
  return { type: f?.type, known: f?.flow.known };
}, [line.x, line.y]);
check(reloaded.type === 'furnace' && reloaded.known === false, 'après rechargement, la ligne est là et ses compteurs repartent de zéro');
await teleport(line.x + 1, line.y + 1);
await advance(20);
tip = await tooltip(line.x + 2, line.y);
check(/Débit : /.test(tip), `ils se remplissent à nouveau en quelques secondes (« ${tip.replace(/\s+/g, ' ').slice(-60)} »)`);

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
