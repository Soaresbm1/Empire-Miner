/**
 * La Manufacture et ses produits, dans un vrai navigateur, avec de vrais clics et de vraies touches :
 *   - l'Atelier la propose (onglet Machines) et la vend ; la barre de construction la range dans « Usine » ;
 *   - on la pose, E ouvre son panneau : recette choisie au clic, charbon et lingots déposés depuis le sac, produits récupérés ;
 *   - changer de recette rend les lingots qu'elle n'utilise pas ;
 *   - un convoyeur la nourrit et un coffre reçoit ses produits ;
 *   - une commande de plaques se livre à la main, le Tableau d'affichage donne le prix des produits ;
 *   - sauvegarde, rechargement, et une partie d'avant (chantier qui a changé : les lingots livrés reviennent).
 *
 *   npm run build && node e2e/crafter.mjs
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
  server = await preview({ preview: { port: 4290, strictPort: false }, logLevel: 'silent' });
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
const crafter = () => ev(() => {
  const c = window.__EM.state.structures.list.find((s) => s.type === 'crafter');
  return c ? { x: c.x, y: c.y, recipe: c.recipe, input: { ...c.input }, output: [...c.output], fuel: c.fuelUnits, made: c.made, status: c.status } : null;
});
const teleport = (tx, ty) =>
  ev(([x, y]) => {
    const g = window.__EM.state;
    g.player.x = (x + 0.5) * 16;
    g.player.y = (y + 0.5) * 16;
    window.__EM.renderer.snapCamera();
  }, [tx, ty]);
/** Le doigt posé au centre de l'élément le touche-t-il (« devant ») ? */
const front = (sel) =>
  ev((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }, sel);
const goTo = (type) =>
  ev((type) => {
    const E = window.__EM;
    const g = E.state;
    const b = g.structures.list.find((s) => s.type === type);
    g.player.x = (b.x + b.w / 2) * 16;
    g.player.y = (b.y + b.h + 0.5) * 16;
    E.renderer.snapCamera();
  }, type);
const pressE = async () => {
  await page.keyboard.press('KeyE');
  await sleep(300);
};

/** Attend que la caméra soit immobile. */
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
/** En mode construction : ouvre l'onglet du kit (Tab) puis le choisit (touche 1 à 9). */
async function chooseKit(kit) {
  const slot = await ev((k) => window.__EM.kitSlot(window.__EM.state, k), kit);
  if (!slot) throw new Error(`kit ${kit} absent`);
  for (let i = 0; i < 8 && (await ev(() => window.__EM.buildCat)) !== slot.cat; i++) {
    await page.keyboard.press('Tab');
    await nextFrames();
  }
  await page.keyboard.press(`Digit${slot.index + 1}`);
  await nextFrames();
  if ((await ev(() => window.__EM.buildKit)) !== kit) throw new Error(`kit ${kit} non choisi`);
}
async function placeAt(kit, tx, ty, dir = 0) {
  await chooseKit(kit);
  const p = await tileScreen(tx, ty);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(40);
  const cur = await ev(() => window.__EM.buildDir);
  for (let i = 0; i < (dir - cur + 4) % 4; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(30);
  }
  await nextFrames();
  await page.mouse.down();
  await page.mouse.up();
  await nextFrames();
  await page.waitForTimeout(80);
}

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await ev(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

// Un joueur qui a de quoi : Pioche améliorée (la Manufacture s'ouvre avec elle), de l'argent, un grand sac, et du métal déjà fondu.
await ev(() => {
  const g = window.__EM.state;
  g.pickaxeLevel = 2;
  g.money = 5000;
  g.setBagLevel(2);
  g.stats.collected.coal = 5;
  g.stats.collected.copper = 5;
  for (const r of ['copper_ingot', 'iron_ingot', 'gold_ingot']) if (!g.stats.discovered.includes(r)) g.stats.discovered.push(r);
});

// ---------------------------------------------------------------- l'Atelier et la barre de construction
console.log('\n▶ Atelier');
await goTo('workshop');
await sleep(250);
await pressE();
await page.waitForSelector('#panel-root .panel');
await page.click('#panel-root .tab[data-arg="machines"]');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'machines');
const shopText = await ev(() => document.querySelector('#panel-root')?.textContent ?? '');
check(/Manufacture/.test(shopText), 'l’onglet Machines de l’Atelier propose la Manufacture');
check(await ev(() => !!document.querySelector('#panel-root [data-action="buyKit"][data-arg="crafter:1"]')), 'avec son bouton d’achat (la Pioche améliorée suffit)');
await page.screenshot({ path: `${SHOTS}crafter-01-atelier.png` });
const money0 = await ev(() => window.__EM.state.money);
await page.click('#panel-root [data-action="buyKit"][data-arg="crafter:1"]');
check(await until(() => window.__EM.state.inventory.kitCount('crafter') === 1), 'un clic sur « Acheter » met la machine en stock');
check((await ev(() => window.__EM.state.money)) === money0 - 900, 'elle coûte 900 $');
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- la pose
console.log('\n▶ Pose');
const spot = await ev(() => {
  const g = window.__EM.state;
  const free = (x, y) => g.world.isOpen(x, y) && !g.structures.at(x, y) && !g.borerAt(x, y);
  // Salle du fond : de la place pour le coffre, le convoyeur, la machine (2×2), son convoyeur et un coffre ; et le joueur dessous.
  for (let x = 48; x <= 49; x++) {
    let ok = free(x, 27);
    for (let dx = -2; dx <= 3; dx++) for (let y = 25; y <= 26; y++) ok = ok && free(x + dx, y);
    if (ok) return { x, y: 25 };
  }
  return null;
});
check(!!spot, 'une place libre dans la salle du fond');
await teleport(spot.x, spot.y + 2);
await page.keyboard.press('KeyB');
await sleep(150);
check(await ev(() => [...document.querySelectorAll('.bb-tab')].some((t) => t.dataset.arg === 'traitement' && /Usine/.test(t.textContent))), 'la barre de construction range la Manufacture dans l’onglet « Usine »');
await placeAt('crafter', spot.x, spot.y, 0);
await page.screenshot({ path: `${SHOTS}crafter-02-pose.png` });
await page.keyboard.press('Escape');
await sleep(200);
const placed = await crafter();
check(!!placed && placed.x === spot.x && placed.y === spot.y, `la Manufacture est posée (${spot.x}, ${spot.y})`);
check(placed.recipe === null && placed.status === 'norecipe', 'sans recette au départ : elle attend qu’on choisisse');
check(await ev(([x, y]) => [0, 1].every((dx) => [0, 1].every((dy) => window.__EM.state.structures.at(x + dx, y + dy)?.type === 'crafter')), [spot.x, spot.y]), 'elle occupe 2×2 cases');

// ---------------------------------------------------------------- le panneau
console.log('\n▶ Panneau');
await ev(() => {
  const g = window.__EM.state;
  g.inventory.items = {};
  g.inventory.add('coal', 3);
  g.inventory.add('iron_ingot', 4);
});
await teleport(spot.x, spot.y + 2);
await sleep(250);
await pressE();
check(await page.isVisible('.panel-crafter'), 'E ouvre le panneau de la Manufacture');
const empty = (await page.textContent('.panel-crafter')) ?? '';
check(/Choisissez ce que la Manufacture fabrique/.test(empty), 'sans recette, il invite à en choisir une');
check(await ev(() => !!document.querySelector('.panel-crafter [data-action="crafterDeposit"][disabled]')), 'et le dépôt est grisé tant que rien n’est choisi');
const recipes = await ev(() => [...document.querySelectorAll('.panel-crafter [data-action="crafterRecipe"]')].map((b) => b.dataset.arg));
check(recipes.includes('iron_plate') && recipes.includes('copper_plate') && recipes.includes('steel'), `les recettes dont on connaît les lingots sont proposées (${recipes.join(', ')})`);
check(!recipes.includes('cut_diamond') && !recipes.includes('silver_plate'), 'pas celles dont on ne connaît pas encore la matière');
check(await front('.panel-crafter [data-action="crafterRecipe"][data-arg="iron_plate"]'), 'les boutons de recette sont devant, cliquables');
await page.screenshot({ path: `${SHOTS}crafter-03-panneau.png` });
await page.click('.panel-crafter [data-action="crafterRecipe"][data-arg="iron_plate"]');
check(await until(() => window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.recipe === 'iron_plate'), 'un clic sur « Plaque de fer » règle la recette');
check(await until(() => /btn small on/.test(document.querySelector('.panel-crafter [data-action="crafterRecipe"][data-arg="iron_plate"]')?.className ?? '')), 'le bouton s’allume');
await page.click('.panel-crafter [data-action="crafterFuel"]');
check(await until(() => window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.fuelUnits === 3), 'le charbon du sac est chargé');
await page.click('.panel-crafter [data-action="crafterDeposit"]');
check(await until(() => window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.made >= 1, null, 8000), 'les lingots déposés se transforment : une plaque est sortie');
check(await until(() => /Fabrique : Plaque de fer/.test(document.querySelector('.panel-crafter')?.textContent ?? ''), null, 8000) || (await crafter()).made >= 4, 'le panneau dit ce qu’elle fabrique');
check(await until(() => window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.made >= 4, null, 15000), 'quatre lingots, quatre plaques de fer');
await page.screenshot({ path: `${SHOTS}crafter-04-travail.png` });
await page.click('.panel-crafter [data-action="crafterCollect"]');
check(await until(() => window.__EM.state.inventory.count('iron_plate') === 4), 'les plaques sont récupérées dans le sac');
check(await ev(() => window.__EM.state.stats.crafted >= 4 && window.__EM.state.stats.discovered.includes('iron_plate')), 'elles comptent dans les statistiques et rejoignent le carnet');

// Changer de recette rend ce que la nouvelle n'utilise pas.
await ev(() => {
  const g = window.__EM.state;
  g.inventory.items = {};
  g.inventory.add('iron_ingot', 2);
});
await page.click('.panel-crafter [data-action="crafterDeposit"]');
check(await until(() => (window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.input.iron_ingot ?? 0) >= 1), 'deux lingots de fer attendent dans la machine');
await page.click('.panel-crafter [data-action="crafterRecipe"][data-arg="copper_plate"]');
check(await until(() => window.__EM.state.structures.list.find((s) => s.type === 'crafter')?.recipe === 'copper_plate'), 'changer pour « Plaque de cuivre »…');
check(await until(() => window.__EM.state.inventory.count('iron_ingot') >= 1), '… rend les lingots de fer qu’elle n’utilise pas, dans le sac');
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- la chaîne : coffre → convoyeur → Manufacture → convoyeur → coffre
console.log('\n▶ Chaîne');
const chain = await ev(([x, y]) => {
  const g = window.__EM.state;
  for (const k of ['storage', 'storage', 'conveyor', 'conveyor']) g.inventory.addKit(k, 1);
  const put = (kit, tx, ty, d = 0) => {
    const s = g.place(kit, tx, ty, d);
    if (!s) throw new Error(`${kit} @${tx},${ty} : ${g.canPlace(kit, tx, ty).reason}`);
    return s;
  };
  put('storage', x - 2, y);
  put('conveyor', x - 1, y, 0);
  put('conveyor', x + 2, y, 0);
  put('storage', x + 3, y);
  const c = g.structures.at(x, y);
  g.setCrafterRecipe(c, 'steel');
  c.addFuel(4);
  const src = g.structures.at(x - 2, y);
  src.put('iron_ingot', 4);
  return true;
}, [spot.x, spot.y]);
check(chain, 'un coffre de lingots de fer, un convoyeur, la Manufacture réglée sur l’acier, un convoyeur et un coffre à la sortie');
check(
  await until(([x, y]) => (window.__EM.state.structures.at(x + 3, y)?.items.steel ?? 0) >= 2, [spot.x, spot.y], 20000),
  'les 4 lingots de fer voyagent, deux aciers arrivent dans le coffre de sortie (2 lingots pour 1 acier)',
);
check(await ev(([x, y]) => (window.__EM.state.structures.at(x - 2, y)?.items.iron_ingot ?? 0) === 0, [spot.x, spot.y]), 'le coffre d’entrée est vide');
await page.screenshot({ path: `${SHOTS}crafter-05-chaine.png` });

// ---------------------------------------------------------------- une commande de plaques, livrée à la main
console.log('\n▶ Commande');
const order = await ev(() => {
  const g = window.__EM.state;
  g.inventory.items = {};
  g.inventory.add('iron_plate', 4);
  g.contracts.list.length = 0;
  const c = { id: 9001, client: 0, lines: [{ res: 'iron_plate', qty: 3, done: 0 }], reward: 330, premium: 0.4, hot: false, limit: 900, until: Math.ceil(g.time) + 900, accepted: true };
  g.contracts.list.push(c);
  return { money: g.money, honored: g.stats.contracts };
});
await goTo('board');
await sleep(250);
await pressE();
await page.waitForSelector('#panel-root .panel-board');
await page.click('#panel-root .tab[data-arg="orders"]');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'orders');
check(/plaque de fer/i.test((await page.textContent('#panel-root .panel-board')) ?? ''), 'la commande de plaques de fer s’affiche au Tableau');
await page.click('#panel-root [data-action="contractDeliver"]');
check(await until(() => window.__EM.state.stats.contracts === 1), 'livrer le sac honore la commande');
check((await ev(() => window.__EM.state.money)) === order.money + 330, 'le client paie la récompense (+330 $)');
check((await ev(() => window.__EM.state.inventory.count('iron_plate'))) === 1, 'la plaque en trop reste dans le sac');
await page.click('#panel-root .tab[data-arg="market"]');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'market');
await ev(() => {
  const g = window.__EM.state;
  g.stats.collected.iron = 1;
  g.stats.discovered.push('iron_ingot');
});
await sleep(500);
const market = (await page.textContent('#panel-root .panel-board')) ?? '';
check(/Plaque : /.test(market) && /Lingot : /.test(market), 'le marché donne le prix du lingot et de la plaque, sur la ligne du fer');
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- sauvegarde
console.log('\n▶ Sauvegarde');
// On fige la machine (plus de charbon, rien en sortie) : ce qui est sauvegardé est exactement ce qu'on doit retrouver.
await ev(() => {
  const g = window.__EM.state;
  const c = g.structures.list.find((s) => s.type === 'crafter');
  g.setCrafterRecipe(c, 'gold_plate');
  c.fuelUnits = 0;
  c.burn = 0;
  c.output.length = 0;
  c.addInput('gold_ingot', 3);
});
const before = await crafter();
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);
const after = await crafter();
check(!!after && after.recipe === 'gold_plate' && after.input.gold_ingot === 3 && after.fuel === 0 && after.made === before.made, 'après rechargement : même recette, mêmes lingots en attente, mêmes compteurs');
check(await ev(() => window.__EM.state.stats.crafted >= 6 && window.__EM.state.stats.discovered.includes('steel')), 'les statistiques et le carnet sont retrouvés');

// ---------------------------------------------------------------- une partie d'avant : le chantier a changé
console.log('\n▶ Ancienne sauvegarde');
await ev(() => {
  // Le jeu se sauvegarde en quittant la page : sans cela, il écraserait la sauvegarde fabriquée ici.
  window.__EM.autoSaveNow = () => {};
  const data = JSON.parse(localStorage.getItem('empire-miner.save'));
  // Ce que la version d'avant écrivait : de l'or livré en lingots à la quatrième phase, aucune trace de produits fabriqués.
  data.project = { phase: 3, delivered: { gold_ingot: 6, silver_ingot: 10, iron_ingot: 40 }, funded: 0, doneAt: [10, 20, 30] };
  data.structures = data.structures.filter((s) => s.type !== 'crafter');
  data.inventory = {};
  delete data.stats.crafted;
  for (const slot of data.production ?? []) delete slot.f;
  localStorage.setItem('empire-miner.save', JSON.stringify(data));
});
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
await sleep(500);
const old = await ev(() => {
  const g = window.__EM.state;
  const bag = (res) => g.inventory.count(res) + g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);
  return { phase: g.project.phase, delivered: { ...g.project.delivered }, gold: bag('gold_ingot'), iron: bag('iron_ingot'), crafted: g.stats.crafted };
});
check(old.phase === 3 && old.delivered.silver_ingot === 10 && old.delivered.gold_ingot === undefined && old.delivered.iron_ingot === undefined, 'la quatrième phase garde ce qu’elle attend encore (l’argent) et n’attend plus les lingots d’or et de fer');
check(old.gold === 6 && old.iron === 40, 'les lingots d’or et de fer livrés autrefois sont rendus : rien ne se perd');
check(old.crafted === 0, 'et le compteur de produits fabriqués repart à zéro, sans erreur');

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
