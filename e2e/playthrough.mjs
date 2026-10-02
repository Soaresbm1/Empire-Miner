/**
 * Test de bout en bout : joue la tranche verticale dans un vrai navigateur
 * avec de vraies entrées clavier/souris, et capture des images dans e2e/screenshots/.
 *
 *   npm run build && npm run e2e
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 * Les téléportations (`__EM`, via ?debug) servent uniquement à raccourcir les trajets.
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const S = 12; // SURFACE_ROWS

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4174, strictPort: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  ev(() => {
    const g = window.__EM.state;
    return {
      money: g.money,
      pick: g.pickaxeLevel,
      inv: { ...g.inventory.items },
      weight: g.inventory.weight(),
      cap: g.inventory.capacity,
      tx: g.player.tileX,
      ty: g.player.tileY,
      depth: g.playerDepth(),
    };
  });
const teleport = (tx, ty) =>
  ev(([x, y]) => {
    const g = window.__EM.state;
    g.player.x = (x + 0.5) * 16;
    g.player.y = (y + 0.5) * 16;
    window.__EM.renderer.snapCamera();
  }, [tx, ty]);
/** Attend que la caméra soit immobile (elle glisse, par exemple, quand la barre de construction s'ouvre). */
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
const isSolid = (tx, ty) => ev(([x, y]) => window.__EM.state.world.isSolid(x, y), [tx, ty]);

/** Mine une tuile avec le clic gauche maintenu ; renvoie la durée en secondes. */
async function mineTile(tx, ty, maxMs = 12000) {
  const p = await tileScreen(tx, ty);
  await page.mouse.move(p.x, p.y);
  const t0 = Date.now();
  await page.mouse.down();
  while ((await isSolid(tx, ty)) && Date.now() - t0 < maxMs) await page.waitForTimeout(30);
  await page.mouse.up();
  return (Date.now() - t0) / 1000;
}

/**
 * Attend que le jeu ait traité deux images : une touche et un clic envoyés dans la même image
 * seraient traités touche d'abord (sur une machine chargée, 40 ms ne suffisent pas toujours).
 */
const nextFrames = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

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

/** En mode construction : choisit le kit, oriente la pose puis clique sur la tuile. */
async function placeAt(kit, tx, ty, dir = 0) {
  await chooseKit(kit);
  await page.waitForTimeout(40);
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

async function pressE() {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
}

try {
  await page.goto(`${url}?debug`);
  await ev(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await shot('01-menu');

  // 1. Lancer une partie
  await page.click('[data-action="new"]');
  await page.waitForTimeout(600);
  check((await ev(() => window.__EM.mode)) === 'playing', 'une nouvelle partie démarre');
  await shot('02-camp');

  // 2-3. Contrôler le personnage, explorer
  const before = await state();
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyS');
  const after = await state();
  check(after.ty > before.ty && after.depth > 0, `le personnage descend dans la mine (${after.depth} m)`);

  // 4-8. Miner le filon de cuivre de la galerie est, faire tomber et ramasser les ressources
  await teleport(58, S + 10);
  await page.waitForTimeout(300);
  const slow = await mineTile(59, S + 10);
  check(!(await isSolid(59, S + 10)), `la vieille pioche détruit le cuivre en ${slow.toFixed(2)} s`);
  const dropped = await ev(() => window.__EM.state.drops.list.filter((d) => d.res === 'copper').length);
  check(dropped > 0, 'des ressources tombent physiquement au sol');
  await page.waitForTimeout(250);
  await shot('03-mining');
  await page.waitForTimeout(1500);
  check(((await state()).inv.copper ?? 0) > 0, 'le joueur ramasse le cuivre en passant à proximité');

  // Continue le filon jusqu'à remplir le sac (inventaire limité)
  const vein = [[59, S + 11], [60, S + 10], [60, S + 11], [59, S + 12], [60, S + 9], [61, S + 11]];
  for (const [x, y] of vein) {
    if (!(await isSolid(x, y))) continue;
    // Se place sur une case voisine ouverte
    const spot = await ev(([tx, ty]) => {
      const w = window.__EM.state.world;
      for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) if (w.isOpen(tx + dx, ty + dy)) return [tx + dx, ty + dy];
      return null;
    }, [x, y]);
    if (!spot) continue;
    await teleport(spot[0], spot[1]);
    await page.waitForTimeout(150);
    await mineTile(x, y);
    await page.waitForTimeout(1200);
  }
  const loaded = await state();
  check(loaded.weight <= loaded.cap, `le sac respecte sa capacité (${loaded.weight} / ${loaded.cap} kg)`);
  await shot('04-vein-mined');

  // 9-11. Remonter vendre au comptoir
  await teleport(41, 8);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-counter'), 'le comptoir s’ouvre avec E');
  await shot('05-counter');
  await page.click('[data-action="sellAll"]');
  await page.waitForTimeout(200);
  const sold = await state();
  check(sold.money > 0 && Object.keys(sold.inv).length === 0, `vente : ${sold.money} $ gagnés`);
  await page.keyboard.press('Escape');

  // Deuxième voyage si nécessaire : le filon de charbon de la galerie ouest
  if (sold.money < 60) {
    const coal = [[41, S + 5], [41, S + 6], [40, S + 5], [40, S + 6], [41, S + 4], [40, S + 4], [39, S + 6]];
    for (const [x, y] of coal) {
      if (!(await isSolid(x, y))) continue;
      const spot = await ev(([tx, ty]) => {
        const w = window.__EM.state.world;
        for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) if (w.isOpen(tx + dx, ty + dy)) return [tx + dx, ty + dy];
        return null;
      }, [x, y]);
      if (!spot) continue;
      await teleport(spot[0], spot[1]);
      await page.waitForTimeout(150);
      await mineTile(x, y);
      await page.waitForTimeout(1200);
    }
    await teleport(41, 8);
    await page.waitForTimeout(300);
    await pressE();
    await page.click('[data-action="sellAll"]');
    await page.keyboard.press('Escape');
  }
  const rich = await state();
  check(rich.money >= 60, `assez d'argent pour la pioche améliorée (${rich.money} $)`);

  // 12. Acheter une meilleure pioche
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-workshop'), 'l’atelier s’ouvre avec E');
  await shot('06-workshop');
  await page.click('[data-action="buyPickaxe"]');
  await page.waitForTimeout(200);
  check((await state()).pick === 1, 'la pioche améliorée est achetée');
  await page.keyboard.press('Escape');

  // 13. Constater qu'elle mine plus vite (même type de bloc, même endroit)
  await ev(() => {
    const g = window.__EM.state;
    const copper = g.world.tiles[g.world.idx(45, 12 + 14)]; // filon de la salle du fond
    g.world.set(59, 12 + 10, copper);
  });
  await teleport(58, S + 10);
  await page.waitForTimeout(300);
  const fast = await mineTile(59, S + 10);
  check(fast < slow * 0.65, `la pioche améliorée mine plus vite : ${slow.toFixed(2)} s → ${fast.toFixed(2)} s`);
  // Et elle perce maintenant le fer
  await teleport(51, S + 15);
  await page.waitForTimeout(200);
  const iron = await mineTile(51, S + 16, 8000);
  check(!(await isSolid(51, S + 16)), `le fer devient minable (${iron.toFixed(2)} s)`);
  await page.waitForTimeout(1200);

  // 14. Sauvegarder et charger
  await page.keyboard.press('Escape');
  await page.click('[data-action="save"]');
  await page.waitForTimeout(200);
  const saved = await state();
  const minedBefore = await isSolid(59, S + 10);
  await page.reload();
  await page.waitForTimeout(800);
  await shot('07-menu-continue');
  await page.click('[data-action="continue"]');
  await page.waitForTimeout(500);
  const restored = await state();
  check(
    restored.money === saved.money && restored.pick === saved.pick && restored.tx === saved.tx && restored.ty === saved.ty,
    'la sauvegarde restaure argent, pioche et position',
  );
  check((await isSolid(59, S + 10)) === minedBefore && !(await isSolid(51, S + 16)), 'les roches détruites restent détruites après chargement');

  // Automatisation : foreuse + convoyeurs + coffre, achetés à l'atelier
  await ev(() => {
    const g = window.__EM.state;
    g.money += 600;
    g.inventory.items = {}; // sac vidé : le charbon doit y tenir quel que soit le hasard des ramassages
    g.inventory.add('coal', 6);
  });
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="drill:1"]');
  await page.click('[data-action="buyKit"][data-arg="conveyor:10"]');
  await page.click('[data-action="buyKit"][data-arg="storage:1"]');
  await page.waitForTimeout(150);
  await shot('08-workshop-machines');
  await page.keyboard.press('Escape');
  const kits = await ev(() => ({ ...window.__EM.state.inventory.kits }));
  check(kits.drill === 1 && kits.conveyor === 10 && kits.storage === 1, 'kits achetés : foreuse, 10 convoyeurs, coffre');

  // Pose dans la galerie est : foreuse sur le gisement (59, S+10) orientée vers l'ouest.
  await teleport(56, S + 11);
  await page.waitForTimeout(300);
  check((await ev(([x, y]) => window.__EM.state.world.depositAt(x, y), [59, S + 10])) === 'copper', 'le filon miné a laissé un gisement de cuivre');
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(60);
  // Barre de construction : un onglet par catégorie, les machines de l'onglet, une ligne d'état.
  const tabs = await ev(() => [...document.querySelectorAll('.bb-tab')].map((t) => t.dataset.arg));
  check(tabs.join() === 'extraction,transport,stockage', `barre de construction : onglets ${tabs.join(', ')}`);
  await page.click('[data-action="buildCat"][data-arg="stockage"]');
  await nextFrames();
  check((await ev(() => window.__EM.buildKit)) === 'storage', 'clic sur un onglet : le coffre est choisi');
  await chooseKit('drill');
  check(!(await ev(() => window.__EM.ui.panel)), 'Tab change d’onglet sans ouvrir le sac');
  await page.waitForTimeout(60);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyR'); // direction ouest
  await page.waitForTimeout(100);
  let p = await tileScreen(57, S + 10);
  await page.mouse.move(p.x, p.y);
  await nextFrames();
  const badStatus = await ev(() => document.querySelector('.bb-status')?.className + ' ' + document.querySelector('.bb-status')?.textContent);
  check(/bad/.test(badStatus) && /gisement/.test(badStatus), `ligne d'état : pose refusée expliquée (${badStatus.trim()})`);
  p = await tileScreen(59, S + 10);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
  check(!!(await ev(() => document.querySelector('.bb-status.ok'))), "ligne d'état : pose possible sur le gisement");
  await page.mouse.down();
  await page.mouse.up();
  // Laisse passer une image : un clic et une touche dans la même image seraient traités touche d'abord.
  await page.waitForTimeout(100);
  // Convoyeurs tracés en glissant de x=58 à x=54
  await chooseKit('conveyor');
  p = await tileScreen(58, S + 10);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let x = 57; x >= 54; x--) {
    const q = await tileScreen(x, S + 10);
    await page.mouse.move(q.x, q.y, { steps: 3 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  // Coffre au bout
  await page.waitForTimeout(100);
  await chooseKit('storage');
  p = await tileScreen(53, S + 10);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  await shot('09a-build-mode');
  await page.keyboard.press('Escape');
  const built = await ev(() => window.__EM.state.structures.list.filter((s) => s.removable).map((s) => `${s.type}@${s.x},${s.y}:${s.dir}`));
  console.log('   structures :', built.join(' '));
  check(built.includes('drill@59,22:2') && built.includes('storage@53,22:1') && built.filter((b) => b.startsWith('conveyor')).length === 5, 'foreuse, 5 convoyeurs et coffre posés');

  // Charger la foreuse en charbon via son panneau
  await teleport(58, S + 11);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-drill'), 'le panneau de la foreuse s’ouvre');
  await page.click('[data-action="drillFuel"]');
  await page.waitForTimeout(100);
  await shot('09-drill-panel');
  await page.keyboard.press('Escape');
  await teleport(55, S + 11);
  await page.waitForTimeout(6000);
  const onBelts = await ev(() => window.__EM.state.structures.list.filter((s) => s.isBelt).reduce((n, c) => n + c.items.length, 0));
  check(onBelts > 0, `du minerai circule visiblement sur les convoyeurs (${onBelts} objets)`);
  await shot('10-automation');
  await page.waitForTimeout(12000);
  const stored = await ev(() => ({ ...window.__EM.state.structures.at(53, 22).items }));
  check((stored.copper ?? 0) > 0, `le minerai arrive dans le coffre (${stored.copper ?? 0} cuivre)`);
  await shot('11-automation-later');
  await teleport(54, S + 11);
  await page.waitForTimeout(300);
  await pressE();
  await shot('12-storage-panel');
  await page.click('[data-action="storageTakeAll"]');
  check(((await state()).inv.copper ?? 0) > 0, 'le joueur récupère la production du coffre');
  await page.keyboard.press('Escape');

  // Vente automatique : caisse d'expédition en surface, reliée par convoyeurs remontant le puits.
  await ev(() => (window.__EM.state.money += 400));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="shipping:1"]');
  await page.click('[data-action="buyKit"][data-arg="conveyor:10"]');
  await page.click('[data-action="buyKit"][data-arg="conveyor:10"]');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.inventory.kitCount('shipping'))) === 1, "caisse d'expédition achetée");

  await teleport(49, 17);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 120); // dézoome pour voir le puits en entier
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  // Démontage au clic droit : pose un convoyeur de trop puis le retire.
  await chooseKit('conveyor');
  await page.waitForTimeout(60);
  p = await tileScreen(51, S + 11);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(150);
  check(!(await ev(() => window.__EM.state.structures.at(51, 23))), 'un convoyeur est démonté au clic droit');
  // Le coffre reste en place : les convoyeurs partent de lui (ouest jusqu'au puits, puis nord jusqu'à la surface).
  const path = [];
  for (let x = 52; x >= 50; x--) path.push([x, S + 10]);
  for (let y = S + 9; y >= S - 1; y--) path.push([50, y]);
  p = await tileScreen(...path[0]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) {
    const q = await tileScreen(x, y);
    await page.mouse.move(q.x, q.y, { steps: 2 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
  await chooseKit('shipping');
  await page.waitForTimeout(60);
  p = await tileScreen(50, S - 2);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  const line = await ev(() => {
    const g = window.__EM.state;
    const belts = [];
    for (let y = 11; y <= 22; y++) belts.push(g.structures.at(50, y)?.type === 'conveyor' && g.structures.at(50, y).dir === 3);
    return { crate: g.structures.at(50, 10)?.type, shaft: belts.every(Boolean), turn: g.structures.at(51, 22)?.dir };
  });
  check(line.crate === 'shipping' && line.shaft && line.turn === 2, 'convoyeurs tracés du coffre jusqu’à la caisse en surface');

  // Ce qu'on dépose dans le coffre repart sur le convoyeur collé.
  await teleport(53, S + 11);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-storage'), 'le coffre s’ouvre');
  const bag = await ev(() => Object.values(window.__EM.state.inventory.items).reduce((a, b) => a + b, 0));
  await page.click('[data-action="storageDeposit"]');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  const inChest = await ev(() => Object.values(window.__EM.state.structures.at(53, 22).items).reduce((a, b) => a + b, 0));
  await page.waitForTimeout(6000);
  const leftInChest = await ev(() => Object.values(window.__EM.state.structures.at(53, 22).items).reduce((a, b) => a + b, 0));
  check(bag > 0 && inChest > 0 && leftInChest < inChest, `le sac déposé dans le coffre part sur le convoyeur (${inChest} → ${leftInChest} dans le coffre)`);

  // Le joueur reste au fond de la mine : l'argent doit rentrer tout seul.
  await teleport(47, S + 14);
  const money0 = (await state()).money;
  let autoSold = 0;
  for (let i = 0; i < 60 && autoSold === 0; i++) {
    await page.waitForTimeout(1000);
    autoSold = await ev(() => window.__EM.state.stats.autoSold);
  }
  const money1 = (await state()).money;
  check(autoSold > 0 && money1 - money0 === autoSold, `vente automatique pendant que le joueur est dans la mine (+${autoSold} $)`);
  await teleport(48, 9);
  await page.waitForTimeout(2500);
  await shot('13-shipping-surface');
  await teleport(49, 10);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-shipping'), "le panneau de la caisse d'expédition s'ouvre");
  await shot('14-shipping-panel');
  await page.keyboard.press('Escape');

  // Convoyeurs rapides : on améliore toute la ligne du puits en glissant dessus.
  await ev(() => (window.__EM.state.money += 400));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="conveyor_fast:10"]');
  await page.click('[data-action="buyKit"][data-arg="conveyor_fast:10"]');
  await page.waitForTimeout(100);
  await shot('15a-fast-belts-shop');
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.inventory.kitCount('conveyor_fast'))) === 20, 'convoyeurs rapides achetés');
  const basicKits = await ev(() => window.__EM.state.inventory.kitCount('conveyor'));
  await teleport(49, 17);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await chooseKit('conveyor_fast');
  await page.waitForTimeout(60);
  p = await tileScreen(50, S + 10);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  for (let y = S + 9; y >= S - 1; y--) {
    const q = await tileScreen(50, y);
    await page.mouse.move(q.x, q.y, { steps: 2 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  const upgraded = await ev(() => {
    const g = window.__EM.state;
    let ok = 0;
    for (let y = 11; y <= 22; y++) if (g.structures.at(50, y)?.type === 'conveyor_fast' && g.structures.at(50, y).dir === 3) ok++;
    return { ok, kits: g.inventory.kitCount('conveyor') };
  });
  check(upgraded.ok === 12 && upgraded.kits === basicKits + 12, `ligne du puits améliorée sur place (${upgraded.ok} convoyeurs rapides, anciens rendus au stock)`);
  const soldBefore = await ev(() => window.__EM.state.stats.autoSold);
  let soldAfter = soldBefore;
  for (let i = 0; i < 40 && soldAfter === soldBefore; i++) {
    await page.waitForTimeout(1000);
    soldAfter = await ev(() => window.__EM.state.stats.autoSold);
  }
  check(soldAfter > soldBefore, `le minerai circule sur les convoyeurs rapides jusqu'à la vente (+${soldAfter - soldBefore} $)`);
  await teleport(49, 18);
  await page.waitForTimeout(600);
  await shot('15b-fast-belts');

  // Coffre de charbon collé à la foreuse : il la recharge.
  await ev(() => (window.__EM.state.money += 100));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="storage:1"]');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await teleport(57, S + 11);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await chooseKit('storage');
  await page.waitForTimeout(60);
  p = await tileScreen(59, S + 11); // juste sous la foreuse
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(59, 23)?.type)) === 'storage', 'coffre posé contre la foreuse');
  await ev(() => {
    const g = window.__EM.state;
    const d = g.structures.at(59, 22);
    d.fuelUnits = 0;
    d.burn = 0;
    g.inventory.items = { coal: 8 };
  });
  await teleport(59, S + 12);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-storage'), 'le coffre voisin de la foreuse s’ouvre');
  await page.click('[data-action="storageDeposit"]');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const fuel = await ev(() => {
    const d = window.__EM.state.structures.at(59, 22);
    return { units: d.fuelUnits, burning: d.burn > 0, status: d.status, left: window.__EM.state.structures.at(59, 23).items.coal ?? 0 };
  });
  check(fuel.units + (fuel.burning ? 1 : 0) === 8 && fuel.left === 0 && fuel.status === 'ok', `le charbon déposé dans le coffre recharge la foreuse (${fuel.units} en réserve, en marche)`);
  await teleport(58, S + 12);
  await page.waitForTimeout(400);
  await shot('15-coal-chest');

  // Séparateur et ponts, construits en surface.
  await ev(() => (window.__EM.state.money += 600));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="splitter:1"]');
  await page.click('[data-action="buyKit"][data-arg="bridge:2"]');
  for (let i = 0; i < 8; i++) await page.click('[data-action="buyKit"][data-arg="storage:1"]');
  await page.waitForTimeout(100);
  await shot('16-workshop-logistics');
  await page.keyboard.press('Escape');
  const kits2 = await ev(() => ({ ...window.__EM.state.inventory.kits }));
  check(kits2.splitter === 1 && kits2.bridge === 2 && kits2.storage >= 8, 'séparateur et paire de ponts achetés');

  await teleport(49, 7);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  // Séparateur : coffre source → séparateur → avant / gauche / droite
  await placeAt('storage', 44, 4);
  await placeAt('splitter', 45, 4, 0);
  await placeAt('conveyor', 46, 4, 0);
  await placeAt('storage', 47, 4);
  await placeAt('conveyor', 45, 3, 3);
  await placeAt('storage', 45, 2);
  await placeAt('conveyor', 45, 5, 1);
  await placeAt('storage', 45, 6);
  // Croisement : ligne est-ouest (cuivre) qui passe au-dessus d'une ligne nord-sud (fer)
  await placeAt('storage', 49, 4);
  await placeAt('conveyor', 50, 4, 0);
  await placeAt('bridge', 51, 4, 0);
  await placeAt('storage', 52, 2);
  await placeAt('conveyor', 52, 3, 1);
  await placeAt('conveyor', 52, 4, 1);
  await placeAt('conveyor', 52, 5, 1);
  await placeAt('storage', 52, 6);
  // Aperçu de liaison avant de poser le second pont
  await chooseKit('bridge');
  p = await tileScreen(53, 4);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(200);
  await shot('16a-bridge-preview');
  await placeAt('bridge', 53, 4, 0);
  await placeAt('conveyor', 54, 4, 0);
  await placeAt('storage', 55, 4);
  await page.keyboard.press('Escape');
  const layout = await ev(() => {
    const g = window.__EM.state;
    const t = (x, y) => g.structures.at(x, y)?.type ?? null;
    return [t(44, 4), t(45, 4), t(47, 4), t(45, 2), t(45, 6), t(51, 4), t(53, 4), t(52, 4), t(55, 4), t(52, 6)].join(',');
  });
  check(layout === 'storage,splitter,storage,storage,storage,bridge,bridge,conveyor,storage,storage', `démonstrations posées à la souris (${layout})`);
  await ev(() => {
    const g = window.__EM.state;
    g.structures.at(44, 4).put('coal', 30);
    g.structures.at(49, 4).put('copper', 20);
    g.structures.at(52, 2).put('iron', 20);
  });
  await page.waitForTimeout(5000);
  await shot('16b-splitter-bridge');
  await page.waitForTimeout(15000);
  const res = await ev(() => {
    const g = window.__EM.state;
    const items = (x, y) => ({ ...g.structures.at(x, y).items });
    return { linked: g.structures.at(51, 4).target === g.structures.at(53, 4), F: items(47, 4), L: items(45, 2), R: items(45, 6), A2: items(55, 4), B2: items(52, 6) };
  });
  check(res.linked, 'les deux ponts se sont reliés');
  check(res.F.coal === 10 && res.L.coal === 10 && res.R.coal === 10, `le séparateur répartit à parts égales (${res.F.coal ?? 0} / ${res.L.coal ?? 0} / ${res.R.coal ?? 0})`);
  check(JSON.stringify(res.A2) === '{"copper":20}' && JSON.stringify(res.B2) === '{"iron":20}', 'le pont croise les deux lignes sans les mélanger');

  // Trieur : un coffre de charbon et de cuivre mélangés ; le charbon part tout droit, le cuivre sur le côté.
  await ev(() => (window.__EM.state.money += 300));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="sorter:1"]');
  for (let i = 0; i < 3; i++) await page.click('[data-action="buyKit"][data-arg="storage:1"]');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await teleport(38, 7);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('storage', 36, 3);
  await placeAt('sorter', 37, 3, 0);
  await placeAt('conveyor', 38, 3, 0);
  await placeAt('storage', 39, 3);
  await placeAt('conveyor', 37, 4, 1);
  await placeAt('storage', 37, 5);
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(37, 3)?.type)) === 'sorter', 'trieur posé');
  await teleport(37, 3); // debout sur le trieur
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-sorter'), 'le panneau du trieur s’ouvre avec E');
  await page.click('[data-action="sorterFilter"][data-arg="coal"]');
  await page.waitForTimeout(150);
  await shot('17-sorter-panel');
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(37, 3).filter)) === 'coal', 'filtre réglé sur le charbon');
  await ev(() => {
    const c = window.__EM.state.structures.at(36, 3);
    c.put('coal', 10);
    c.put('copper', 10);
  });
  await teleport(38, 7);
  await page.waitForTimeout(4000);
  await shot('17a-sorter');
  await page.waitForTimeout(12000);
  const sorted = await ev(() => {
    const g = window.__EM.state;
    return { front: { ...g.structures.at(39, 3).items }, side: { ...g.structures.at(37, 5).items } };
  });
  check(JSON.stringify(sorted.front) === '{"coal":10}' && JSON.stringify(sorted.side) === '{"copper":10}', `le trieur sépare le charbon du cuivre (${JSON.stringify(sorted)})`);

  // Wagonnet et rails : de la galerie ouest jusqu'à la caisse d'expédition, en remontant le puits.
  await ev(() => (window.__EM.state.money += 400));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="rail:50"]');
  await page.click('[data-action="buyKit"][data-arg="wagon:1"]');
  await page.click('[data-action="buyKit"][data-arg="rail_load:1"]');
  await page.click('[data-action="buyKit"][data-arg="rail_unload:1"]');
  await page.waitForTimeout(100);
  await shot('18-shop-rails');
  await page.keyboard.press('Escape');
  const kits3 = await ev(() => ({ ...window.__EM.state.inventory.kits }));
  check(kits3.rail === 50 && kits3.wagon === 1 && kits3.rail_load === 1 && kits3.rail_unload === 1, 'rails, wagonnet et quais achetés');

  const drag = async (path) => {
    const q0 = await tileScreen(...path[0]);
    await page.mouse.move(q0.x, q0.y);
    await page.waitForTimeout(60);
    await page.mouse.down();
    for (const [x, y] of path.slice(1)) {
      const q = await tileScreen(x, y);
      await page.mouse.move(q.x, q.y, { steps: 2 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  await teleport(46, S + 6);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('rail_load', 43, S + 5);
  await chooseKit('rail');
  const lower = [];
  for (let x = 44; x <= 49; x++) lower.push([x, S + 5]);
  for (let y = S + 4; y >= S; y--) lower.push([49, y]);
  await drag(lower);
  await placeAt('wagon', 45, S + 5, 2);
  await page.keyboard.press('Escape');
  await teleport(48, 9);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('rail', 49, S - 1);
  await placeAt('rail_unload', 49, S - 2);
  await page.keyboard.press('Escape');
  const track = await ev(() => {
    const g = window.__EM.state;
    let n = 0;
    for (let x = 44; x <= 49; x++) if (g.structures.at(x, 17)?.isTrack) n++;
    for (let y = 10; y <= 16; y++) if (g.structures.at(49, y)?.isTrack) n++;
    return { n, load: g.structures.at(43, 17)?.type, unload: g.structures.at(49, 10)?.type, wagons: g.wagons.list.length };
  });
  check(track.n === 13 && track.load === 'rail_load' && track.unload === 'rail_unload' && track.wagons === 1, `ligne posée à la souris (${track.n} pièces de voie, 1 wagonnet)`);

  // Le joueur vide son sac dans le quai de chargement.
  await ev(() => (window.__EM.state.inventory.items = { silver: 8 }));
  await teleport(43, S + 6);
  await page.waitForTimeout(1500);
  await pressE();
  check(await page.isVisible('.panel-station'), 'le quai de chargement s’ouvre avec E');
  await page.click('[data-action="stationDeposit"]');
  await page.waitForTimeout(150);
  await shot('18a-station-panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2600);
  await teleport(47, 13);
  await page.waitForTimeout(700);
  await shot('18b-wagon-shaft');
  let delivered = 0;
  for (let i = 0; i < 20 && delivered < 8; i++) {
    await page.waitForTimeout(500);
    delivered = await ev(() => window.__EM.state.wagons.list[0].delivered);
  }
  check(delivered === 8, `le wagonnet remonte l'argent jusqu'au quai de déchargement (${delivered} livrés)`);
  await page.waitForTimeout(3000);
  await shot('18c-wagon-surface');

  // Voyage : monter dans le wagonnet au fond de la galerie et remonter à la surface.
  await page.waitForTimeout(3000); // retour du wagonnet au quai de chargement
  await teleport(44, S + 6);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(100);
  check((await ev(() => !!window.__EM.state.riding)), 'le joueur monte dans le wagonnet (F)');
  let top = 99;
  for (let i = 0; i < 20 && top > 10; i++) {
    await page.waitForTimeout(300);
    top = await ev(() => window.__EM.state.player.tileY);
  }
  await shot('18d-riding');
  check(top <= 10 && (await ev(() => !!window.__EM.state.riding)), `le wagonnet emmène le joueur jusqu'à la surface (case y=${top})`);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(150);
  const off = await ev(() => {
    const g = window.__EM.state;
    const p = g.player;
    return { riding: !!g.riding, free: !g.isBlocked(p.x - p.halfW, p.y - p.halfH, p.x + p.halfW - 0.001, p.y + p.halfH - 0.001) };
  });
  check(!off.riding && off.free, 'le joueur descend sur une case libre (F)');

  // Aiguillage en alternance : une ligne, deux quais de déchargement.
  await ev(() => (window.__EM.state.money += 400));
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  for (const arg of ['rail:10', 'rail_switch:1', 'rail_load:1', 'rail_unload:1', 'rail_unload:1', 'wagon:1', 'storage:1', 'storage:1']) {
    await page.click(`[data-action="buyKit"][data-arg="${arg}"]`);
  }
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await teleport(60, 7);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('rail_load', 56, 3);
  await chooseKit('rail');
  await drag([[57, 3], [58, 3], [59, 3]]);
  await placeAt('rail_switch', 60, 3, 0);
  await chooseKit('rail');
  await drag([[61, 3], [62, 3]]);
  await placeAt('rail_unload', 63, 3);
  await placeAt('storage', 64, 3);
  await placeAt('rail', 60, 4);
  await placeAt('rail_unload', 60, 5);
  await placeAt('storage', 61, 5);
  await placeAt('wagon', 58, 3, 2);
  await page.keyboard.press('Escape');
  const sw = await ev(() => {
    const g = window.__EM.state;
    return { type: g.structures.at(60, 3)?.type, dir: g.structures.at(60, 3)?.dir, a: g.structures.at(63, 3)?.type, b: g.structures.at(60, 5)?.type };
  });
  const around = await ev(() => [[59, 3], [61, 3], [62, 3], [60, 4]].map(([x, y]) => window.__EM.state.structures.at(x, y)?.type ?? '-').join(','));
  check(
    sw.type === 'rail_switch' && sw.dir === 0 && sw.a === 'rail_unload' && sw.b === 'rail_unload' && around === 'rail,rail,rail,rail',
    `aiguillage, rails et deux quais posés à la souris (voisins : ${around})`,
  );
  await teleport(60, 3); // debout sur l'aiguillage
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-switch'), 'le panneau de l’aiguillage s’ouvre avec E');
  await page.click('[data-action="switchSet"][data-arg="alt"]');
  await page.waitForTimeout(150);
  await shot('19-switch-panel');
  await page.keyboard.press('Escape');
  await teleport(60, 7);
  await ev(() => window.__EM.state.structures.at(56, 3).put('coal', 10));
  await page.waitForTimeout(3200);
  await shot('19a-switch');
  await page.waitForTimeout(4000);
  await ev(() => window.__EM.state.structures.at(56, 3).put('iron', 10));
  await page.waitForTimeout(9000);
  const split = await ev(() => {
    const g = window.__EM.state;
    return { A: { ...g.structures.at(64, 3).items }, B: { ...g.structures.at(61, 5).items } };
  });
  check(JSON.stringify(split.A) === '{"coal":10}' && JSON.stringify(split.B) === '{"iron":10}', `l'aiguillage alterne entre les deux quais (${JSON.stringify(split)})`);

  // Foreuse améliorée : niveau 2 (gauche + droite) puis niveau 3 (+ derrière), achetés sur la machine.
  // Salle du fond : foreuse en (47,26) flèche vers l'est, coffre devant ; gisements de fer tout autour.
  await ev(() => {
    const g = window.__EM.state;
    for (const [x, y] of [[47, 26], [47, 25], [47, 27], [46, 26]]) g.world.setDeposit(x, y, 3, 500); // 3 = fer
    g.money += 1600;
  });
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="drill:1"]');
  await page.click('[data-action="buyKit"][data-arg="storage:1"]');
  await page.keyboard.press('Escape');
  await teleport(46, 26);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('drill', 47, 26, 0);
  await placeAt('storage', 48, 26);
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(47, 26)?.type)) === 'drill', 'foreuse posée dans la salle du fond');
  await ev(() => window.__EM.state.structures.at(47, 26).addFuel(10));
  const reserveAt = (x, y) => ev(([a, b]) => window.__EM.state.world.reserve[window.__EM.state.world.idx(a, b)], [x, y]);
  await page.waitForTimeout(3000);
  const l1 = { under: await reserveAt(47, 26), left: await reserveAt(47, 25), right: await reserveAt(47, 27) };
  check(l1.under < 500 && l1.left === 500 && l1.right === 500, `niveau 1 : seule la case sous la foreuse est forée (${JSON.stringify(l1)})`);
  await pressE();
  check(await page.isVisible('.panel-drill .drill-levels'), 'le panneau de la foreuse montre ses niveaux');
  const cols = await page.$$eval('.drill-levels .dl', (els) => els.map((e) => e.className.replace('dl ', '')));
  check(cols.join(',') === 'current,next,later', `trois niveaux : actuel, suivant, plus tard (${cols.join(',')})`);
  const moneyUp = await ev(() => window.__EM.state.money);
  await page.click('[data-action="drillUpgrade"]');
  await page.waitForTimeout(200);
  const lvl2 = await ev(() => ({ level: window.__EM.state.structures.at(47, 26).level, money: window.__EM.state.money }));
  check(lvl2.level === 2 && moneyUp - lvl2.money === 280, `foreuse améliorée au niveau 2 depuis son panneau (−${moneyUp - lvl2.money} $)`);
  const lock = await page.$eval('.dl.next', (e) => ({ disabled: e.querySelector('button').disabled, text: e.textContent }));
  check(lock.disabled && lock.text.includes('Pioche en fer'), 'le niveau 3 attend la pioche en fer');
  await shot('20-drill-upgrade-panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(4000);
  const l2 = { left: await reserveAt(47, 25), right: await reserveAt(47, 27), back: await reserveAt(46, 26) };
  check(l2.left < 500 && l2.right < 500 && l2.back === 500, `niveau 2 : les cases de gauche et de droite sont forées (${JSON.stringify(l2)})`);
  await ev(() => window.__EM.renderer.adjustZoom(2));
  await page.waitForTimeout(300);
  await shot('20a-drill-level2');
  // Pioche en fer à l'atelier, puis niveau 3.
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="tools"]');
  await page.waitForTimeout(100);
  while ((await state()).pick < 2) {
    await page.click('[data-action="buyPickaxe"]');
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  await teleport(46, 26);
  await page.waitForTimeout(400);
  await pressE();
  await page.click('[data-action="drillUpgrade"]');
  await page.waitForTimeout(200);
  check((await ev(() => window.__EM.state.structures.at(47, 26).level)) === 3, 'foreuse améliorée au niveau 3');
  await shot('20b-drill-level3-panel');
  await page.keyboard.press('Escape');
  await teleport(49, 25);
  await page.waitForTimeout(4000);
  const l3 = await ev(() => ({ back: window.__EM.state.world.reserve[window.__EM.state.world.idx(46, 26)], heads: window.__EM.state.structures.at(47, 26).heads }));
  check(l3.back < 500 && l3.heads === 4, `niveau 3 : la case derrière est forée aussi (${l3.heads} têtes actives)`);
  await shot('20c-drill-level3');
  await ev(() => window.__EM.renderer.adjustZoom(-2));

  // Démontée (clic droit) puis reposée ailleurs, la foreuse garde son niveau. Le joueur n'a plus
  // aucun kit en stock : le mode construction s'ouvre quand même pour démonter.
  await ev(() => {
    const g = window.__EM.state;
    g.world.setDeposit(51, 26, 3, 500);
    g.inventory.kits = {};
    window.__EM.renderer.snapCamera(); // le zoom vient de changer : la caméra doit être en place
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(150);
  check(await ev(() => window.__EM.buildMode), 'sans aucun kit, le mode construction s’ouvre pour démonter');
  const drillAt = await tileScreen(47, 26);
  await page.mouse.move(drillAt.x, drillAt.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  const kitsLvl = await ev(() => ({ kits: { ...window.__EM.state.inventory.kits }, gone: !window.__EM.state.structures.at(47, 26) }));
  check(kitsLvl.gone && kitsLvl.kits['drill@3'] === 1, 'la foreuse niveau 3 démontée revient dans le stock avec son niveau');
  check((await page.textContent('#hud-build')).includes('niv. 3'), 'la barre de construction propose la « Foreuse à charbon niv. 3 »');
  await placeAt('drill@3', 51, 26, 0);
  await shot('20d-drill-replaced');
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(51, 26)?.level)) === 3, 'reposée ailleurs, elle est toujours au niveau 3');

  // Pierres au sol : elles clignotent puis s'effritent ; le minerai posé à côté reste.
  await ev(() => {
    const g = window.__EM.state;
    for (const [res, x] of [['stone', 52.5], ['copper', 53.5]]) g.drops.spawn(res, 2, x * 16, 27.5 * 16, false).age = 57;
  });
  await page.waitForTimeout(500);
  await shot('21-stone-crumbling');
  await page.waitForTimeout(3500);
  const left = await ev(() => window.__EM.state.drops.list.filter((d) => d.x > 52 * 16 && d.y > 27 * 16).map((d) => d.res));
  check(!left.includes('stone') && left.includes('copper'), `les pierres au sol s'effritent, pas le minerai (reste : ${left.join(', ')})`);

  // Marteau-piqueur : acheté à l'Atelier (pioche en fer), il creuse un front de 3 cases ; T repasse à la pioche.
  await ev(() => {
    const g = window.__EM.state;
    g.money += 2500;
    g.inventory.items = {};
  });
  await teleport(58, 8);
  await page.waitForTimeout(300);
  await pressE();
  await page.click('.tab[data-arg="tools"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyJackhammer"]');
  await page.waitForTimeout(150);
  await page.click('.tab[data-arg="machines"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="borer:1"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="buyKit"][data-arg="furnace:1"]');
  await page.keyboard.press('Escape');
  check((await ev(() => ({ j: window.__EM.state.hasJackhammer, t: window.__EM.state.tool }))).t === 'jackhammer', 'marteau-piqueur acheté et pris en main');
  // Mur sud de la salle du fond : trois cases de roche tendre (bloc n° 4) sous le joueur.
  await ev(() => {
    const g = window.__EM.state;
    for (const x of [47, 48, 49]) g.world.set(x, 28, 4);
    g.inventory.add('coal', 20);
  });
  await teleport(48, 27);
  await page.waitForTimeout(400);
  const wallAt = await tileScreen(48, 28);
  await page.mouse.move(wallAt.x, wallAt.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await shot('23-jackhammer');
  await page.waitForTimeout(500);
  await page.mouse.up();
  const front = await ev(() => [47, 48, 49].map((x) => window.__EM.state.world.isSolid(x, 28)));
  check(front.every((solid) => !solid), `le marteau-piqueur ouvre un front de 3 cases d'un coup (${front.join(',')})`);
  check((await ev(() => window.__EM.state.inventory.count('coal'))) < 20, 'le marteau-piqueur brûle le charbon du sac');
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(150);
  check((await ev(() => window.__EM.state.tool)) === 'pickaxe' && (await page.textContent('#hud-equip')).includes('Pioche'), 'T repasse à la pioche');

  // Foreuse de percement : base posée dans la salle du fond vers l'est, 10 cases, démarrée depuis son panneau ;
  // la foreuse sort percer le tunnel puis rentre à la base.
  await ev(() => {
    const g = window.__EM.state;
    for (let x = 54; x <= 66; x++) g.world.set(x, 26, 4);
  });
  await teleport(51, 25);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('borer', 53, 26, 0);
  await page.keyboard.press('Escape');
  check((await ev(() => window.__EM.state.structures.at(53, 26)?.type)) === 'borer', 'foreuse de percement posée face à la roche');
  await teleport(52, 25);
  await page.waitForTimeout(300);
  await pressE();
  check(await page.isVisible('.panel-borer'), 'le panneau de la foreuse de percement s’ouvre avec E');
  await page.click('[data-action="borerFuel"]');
  await page.click('[data-action="borerLength"][data-arg="10"]');
  await page.waitForTimeout(100);
  await page.click('[data-action="borerStart"]');
  await page.waitForTimeout(200);
  await shot('24-borer-panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(4000);
  const sortie = await ev(() => {
    const g = window.__EM.state;
    const b = g.structures.borers[0];
    return { dist: b.dist, base: g.structures.at(53, 26) === b, status: b.status };
  });
  check(sortie.dist > 0 && sortie.base, `la foreuse sort de sa base, qui reste en place (${JSON.stringify(sortie)})`);
  await teleport(56, 25);
  await ev(() => window.__EM.renderer.adjustZoom(2));
  await page.waitForTimeout(1500);
  await shot('24a-borer');
  await ev(() => window.__EM.renderer.adjustZoom(-2));
  let bore = null;
  for (let i = 0; i < 40; i++) {
    bore = await ev(() => {
      const b = window.__EM.state.structures.borers[0];
      return { x: b.x, home: b.home, tunnel: b.tunnel, status: b.status, dug: b.totalDug };
    });
    if (bore.status === 'done') break;
    await page.waitForTimeout(500);
  }
  const tunnel = await ev(() => {
    const w = window.__EM.state.world;
    let open = 0;
    for (let x = 54; x <= 63; x++) if (!w.isSolid(x, 26) && w.explored[w.idx(x, 26)]) open++;
    return open;
  });
  check(
    bore.status === 'done' && bore.home && bore.x === 53 && bore.tunnel === 10 && tunnel === 10,
    `la foreuse perce seule un tunnel de 10 cases puis rentre à sa base (${JSON.stringify(bore)}, ${tunnel} cases ouvertes et révélées)`,
  );

  // Amélioration de la foreuse de percement depuis le panneau de sa base : niveau 2 (moteur renforcé).
  await teleport(52, 25);
  await page.waitForTimeout(300);
  await pressE();
  await page.waitForTimeout(150);
  await page.click('[data-action="borerUpgrade"]');
  await page.waitForTimeout(200);
  const borerLevel = await ev(() => window.__EM.state.structures.borers[0].level);
  const borerText = (await page.textContent('.panel-borer')) ?? '';
  check(borerLevel === 2 && borerText.includes('Moteur renforcé') && borerText.includes('Benne à minerai'), `la foreuse de percement s'améliore depuis son panneau (niveau ${borerLevel})`);
  await shot('24b-borer-upgrade');
  await page.keyboard.press('Escape');

  // Four : posé dans la salle du fond, chargé depuis son panneau (charbon et cuivre du sac), lingots récupérés.
  await ev(() => {
    const g = window.__EM.state;
    g.inventory.items = {}; // sac vidé : 5 charbons et 3 cuivres tiennent dans le petit sac
    g.inventory.add('coal', 5);
    g.inventory.add('copper', 3);
  });
  const spot = await ev(() => {
    const g = window.__EM.state;
    const free = (x, y) => g.world.isOpen(x, y) && !g.structures.at(x, y) && !g.borerAt(x, y);
    // Case libre pour le four, pour le joueur dessous, et devant sa sortie (les lingots restent dans le four).
    for (let y = 25; y <= 26; y++) for (let x = 46; x <= 51; x++) if (free(x, y) && free(x, y + 1) && free(x + 1, y)) return { x, y };
    return null;
  });
  await teleport(spot.x, spot.y + 1);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('furnace', spot.x, spot.y, 0);
  await page.keyboard.press('Escape');
  check((await ev(([x, y]) => window.__EM.state.structures.at(x, y)?.type, [spot.x, spot.y])) === 'furnace', `four posé dans la mine (${spot.x}, ${spot.y})`);
  await pressE();
  check(await page.isVisible('.panel-furnace'), 'le panneau du four s’ouvre avec E');
  await page.click('[data-action="smelterFuel"]');
  await page.waitForTimeout(100);
  await page.click('[data-action="smelterDeposit"]');
  for (let i = 0; i < 60; i++) {
    if ((await ev(([x, y]) => window.__EM.state.structures.at(x, y).smelted, [spot.x, spot.y])) >= 3) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(200);
  await shot('24c-furnace');
  await page.click('[data-action="smelterCollect"]');
  await page.waitForTimeout(150);
  const ingots = await ev(() => window.__EM.state.inventory.count('copper_ingot'));
  const furnace = await ev(([x, y]) => {
    const f = window.__EM.state.structures.at(x, y);
    return { smelted: f.smelted, output: f.output.length, input: f.input.length, status: f.status };
  }, [spot.x, spot.y]);
  check(ingots === 3, `le four fond le cuivre en lingots, récupérés dans le sac (${ingots} lingots, ${JSON.stringify(furnace)})`);
  await page.keyboard.press('Escape');

  // Dangers, à 100 m : une salle creusée à la main craque sous la pioche, un étai posé à temps la retient ;
  // une poche de grisou percée blesse le joueur et s'affiche dans le HUD.
  const DY = S + 39;
  await ev((y) => {
    const g = window.__EM.state;
    const w = g.world;
    for (let yy = y; yy <= y + 8; yy++)
      for (let x = 20; x <= 30; x++) {
        w.set(x, yy, 4);
        w.pocket[w.idx(x, yy)] = 0;
        w.setExplored(x, yy);
      }
    w.set(24, y + 2, 0); // niche naturelle où se tient le joueur
    for (let yy = y + 3; yy <= y + 4; yy++) for (let x = 22; x <= 26; x++) g.breakTile(x, yy); // 10 cases creusées
    g.inventory.items = {};
    g.inventory.addKit('prop', 1);
    g.tool = 'pickaxe';
  }, DY);
  await teleport(24, DY + 4);
  await page.waitForTimeout(400);
  const crackAt = await tileScreen(24, DY + 5);
  await page.mouse.move(crackAt.x, crackAt.y);
  await page.mouse.down();
  for (let i = 0; i < 20 && (await ev((y) => window.__EM.state.world.isSolid(24, y + 5), DY)); i++) await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const warned = await ev(() => window.__EM.state.hazards.pending.length);
  const hudWarn = (await page.textContent('#hud-equip')) ?? '';
  await shot('25-cave-in-warning');
  check(warned === 1 && hudWarn.includes('plafond craque'), `creuser une grande salle en profondeur fait craquer le plafond (alerte dans le HUD : ${warned})`);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  await placeAt('prop', 23, DY + 3, 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(4500);
  const held = await ev((y) => {
    const g = window.__EM.state;
    let rubble = 0;
    // Tout ce qui n'est ni vide ni la roche posée (bloc n° 4) serait de l'éboulis.
    for (let yy = y; yy <= y + 8; yy++) for (let x = 20; x <= 30; x++) if (![0, 4].includes(g.world.get(x, yy))) rubble++;
    return { pending: g.hazards.pending.length, rubble, prop: g.structures.at(23, y + 3)?.type, hp: g.hp };
  }, DY);
  check(held.prop === 'prop' && held.pending === 0 && held.rubble === 0 && held.hp === 100, `un étai posé à temps empêche l'éboulement (${JSON.stringify(held)})`);
  // Grisou : une poche cachée dans la paroi, percée à la pioche.
  await ev((y) => {
    const g = window.__EM.state;
    g.world.pocket[g.world.idx(27, y + 3)] = 1;
  }, DY);
  await teleport(26, DY + 3);
  await page.waitForTimeout(300);
  const gasAt = await tileScreen(27, DY + 3);
  await page.mouse.move(gasAt.x, gasAt.y);
  await page.mouse.down();
  for (let i = 0; i < 20 && (await ev((y) => window.__EM.state.world.isSolid(27, y + 3), DY)); i++) await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const gassed = await ev(() => ({ hp: window.__EM.state.hp, gas: window.__EM.state.hazards.hasGas }));
  const hudGas = (await page.textContent('#hud-equip')) ?? '';
  await shot('25a-gas');
  check(gassed.gas && gassed.hp < 100 && hudGas.includes('Grisou'), `une poche de grisou percée blesse le joueur et s'affiche dans le HUD (${JSON.stringify(gassed)})`);
  await teleport(50, S + 10); // hors du nuage

  // Carte : mini-carte dans le HUD, carte complète avec M (ou clic sur la mini-carte).
  const colorsIn = (sel) =>
    ev((q) => {
      const c = document.querySelector(q);
      if (!c || !c.width) return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    }, sel);
  await teleport(50, S + 10);
  await page.waitForTimeout(600);
  check((await page.isVisible('#minimap')) && (await colorsIn('#minimap')) > 6, `la mini-carte montre la mine autour du joueur (${await colorsIn('#minimap')} couleurs)`);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  check(await page.isVisible('.panel-map'), 'la touche M ouvre la carte de la mine');
  check((await colorsIn('#map-canvas')) > 10, `la carte dessine les galeries, les minerais et les machines (${await colorsIn('#map-canvas')} couleurs)`);
  await shot('22-map');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  check(!(await page.isVisible('.panel-map')), 'M referme la carte');
  await page.click('#minimap-box');
  await page.waitForTimeout(300);
  check(await page.isVisible('.panel-map'), 'un clic sur la mini-carte ouvre la carte');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await shot('22a-minimap');

  // Repères : N marque la position du joueur ; sur la carte, un clic pose un repère du type choisi ;
  // « Suivre » affiche le repère sous la mini-carte et une flèche au bord de l'écran.
  await teleport(50, S + 14);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(200);
  const here = await ev(() => window.__EM.state.markers.list.map((m) => ({ x: m.x, y: m.y, label: m.label })));
  check(here.length === 1 && here[0].x === 50 && here[0].y === S + 14, `N pose un repère là où se trouve le joueur (${JSON.stringify(here)})`);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  await page.click('[data-action="markerKind"][data-arg="ore"]');
  await page.waitForTimeout(150);
  const target = await ev(() => {
    // Un point du canvas de la carte qui tombe sur la surface, près de l'atelier.
    const c = document.getElementById('map-canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.1 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(250);
  const placed = await ev(() => window.__EM.state.markers.list.map((m) => ({ kind: m.kind, label: m.label })));
  check(placed.length === 2 && placed[1].kind === 'ore', `un clic sur la carte pose un repère du type choisi (${JSON.stringify(placed)})`);
  await page.click('[data-action="markerTrack"]');
  await page.waitForTimeout(200);
  await shot('26-map-markers');

  // Zoom de la carte : molette autour du curseur, glissé pour déplacer (sans poser de repère), clic pour poser, « Tout voir ».
  {
    const box = await page.$eval('#map-canvas', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const zoom = () => ev(() => window.__EM.map.zoomLevel);
    const tileAt = (sx, sy) =>
      ev(([sx, sy, box]) => {
        const c = document.getElementById('map-canvas');
        return window.__EM.map.tileAt(((sx - box.x) * c.width) / box.w, ((sy - box.y) * c.height) / box.h);
      }, [sx, sy, box]);
    const markers = () => ev(() => window.__EM.state.markers.list.length);
    const cx = box.x + box.w * 0.55;
    const cy = box.y + box.h * 0.5;
    check((await zoom()) === 1, 'la carte s’ouvre sur « tout voir » (zoom ×1)');
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(120);
    }
    const zin = await zoom();
    check(zin > 2.5, `la molette zoome la carte (×${zin.toFixed(2)})`);
    await shot('26b-map-zoomed');
    const m0 = await markers();
    const t0 = await tileAt(cx, cy);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 70, cy + 40, { steps: 6 });
    await page.mouse.move(cx + 140, cy + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const t1 = await tileAt(cx, cy);
    check(t1.x < t0.x && t1.y < t0.y && (await markers()) === m0, `un glissé déplace la carte sans poser de repère (${JSON.stringify(t0)} → ${JSON.stringify(t1)})`);
    const hit = await tileAt(cx, cy);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(250);
    const mk = await ev(() => window.__EM.state.markers.list.at(-1));
    check((await markers()) === m0 + 1 && mk.x === hit.x && mk.y === hit.y, `un clic sur la carte zoomée pose le repère sur la case visée (${mk.x},${mk.y})`);
    await page.click('[data-action="mapZoom"][data-arg="reset"]');
    await page.waitForTimeout(200);
    check((await zoom()) === 1, '« Tout voir » revient au cadrage complet');
    await page.keyboard.press('Equal');
    await page.waitForTimeout(150);
    const zk = await zoom();
    await page.keyboard.press('Digit0');
    await page.waitForTimeout(150);
    check(zk > 1.2 && (await zoom()) === 1, `les touches + et 0 zooment et remettent tout en vue (×${zk.toFixed(2)} puis ×1)`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await teleport(20, S + 60); // loin du repère suivi : la flèche le montre au bord de l'écran
  await page.waitForTimeout(600);
  const trackLine = (await page.textContent('#hud-track')) ?? '';
  await shot('26a-marker-arrow');
  check(trackLine.includes(here[0].label) && / m/.test(trackLine), `le repère suivi s'affiche sous la mini-carte avec sa distance (${trackLine.trim()})`);

  // Cours du marché : prix variables, courbes et événements au Tableau d'affichage, vente au cours du moment.
  await ev(() => {
    const g = window.__EM.state;
    g.stats.discovered = [...new Set([...g.stats.discovered, 'coal', 'copper', 'iron'])];
    g.stats.collected = { ...g.stats.collected, coal: 40, copper: 30, iron: 12 };
    // Vingt-cinq minutes de marché, avec une forte demande de cuivre au palier (le temps de jeu avance de pas en pas).
    const t0 = Math.ceil(g.time / 10) * 10;
    g.time = t0 + 1500;
    for (let t = t0 + 10; t <= g.time; t += 10) g.market.update(t);
    const now = g.market.step;
    g.market.load({ ...g.market.serialize(), e: [{ n: 0, res: 'copper', start: now - 5, rise: 2, hold: 8, fall: 4, amp: 0.42 }] }, g.time);
    g.events = [];
    g.inventory.add('copper', 6);
    const b = g.structures.list.find((s) => s.type === 'board');
    g.player.x = (b.x + 1) * 16;
    g.player.y = (b.y + b.h + 0.6) * 16;
    window.__EM.renderer.snapCamera();
  });
  await page.waitForTimeout(500);
  const hudMarket = (await page.textContent('#hud-market')) ?? '';
  check(/Cuivre/.test(hudMarket), `le HUD annonce l'événement du marché sous l'argent (${hudMarket.trim()})`);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  const boardText = await ev(() => document.querySelector('.panel-board')?.textContent ?? '');
  check(/Marché/.test(boardText) && /Production/.test(boardText), "le Tableau d'affichage a les onglets Marché et Production");
  // La mine est tirée au hasard : d'autres minerais (or…) ont pu être découverts en route, d'où « au moins » ces trois-là.
  const sparkNames = () => page.$$eval('.panel-board svg.spark', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const hasCurves = (names) => ['Charbon', 'Cuivre', 'Fer'].every((n) => names.some((l) => l.startsWith(n)));
  const curves = await sparkNames();
  check(hasCurves(curves), `une courbe par minerai connu, dont charbon, cuivre et fer (${curves.length} courbes)`);
  check(/Forte demande de cuivre/.test(boardText), "l'événement en cours est listé, avec le conseil de vente");
  await shot('27-market-board');
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);
  check(/Gains des 10 dernières minutes/.test(await ev(() => document.querySelector('.panel-board')?.textContent ?? '')), "la touche 2 ouvre l'onglet Production");
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check(hasCurves(await sparkNames()), 'la flèche gauche revient au Marché');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await ev(() => {
    const g = window.__EM.state;
    const c = g.structures.list.find((s) => s.type === 'counter');
    g.player.x = (c.x + 1) * 16;
    g.player.y = (c.y + c.h + 0.6) * 16;
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  check(/Prix du jour/.test(await ev(() => document.querySelector('.panel-counter')?.textContent ?? '')), 'le Comptoir affiche le prix du jour');
  const expectedSale = await ev(() => {
    const g = window.__EM.state;
    return Object.entries(g.inventory.items).reduce((sum, [res, n]) => sum + g.quote(res, n), 0);
  });
  const moneyBefore = (await state()).money;
  await page.click('[data-action="sellAll"]');
  await page.waitForTimeout(400);
  const gained = (await state()).money - moneyBefore;
  check(gained === expectedSale && expectedSale > 0, `« tout vendre » paie exactement le cours du moment (+${gained} $)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // Ouvriers : on les recrute à l'Atelier (touche 5), un ramasseur range des tas dans un coffre, un ravitailleur recharge un four.
  await ev(() => {
    const g = window.__EM.state;
    g.money = Math.max(g.money, 5000);
    g.pickaxeLevel = Math.max(g.pickaxeLevel, 1);
    const w = g.structures.list.find((s) => s.type === 'workshop');
    g.player.x = (w.x + 1) * 16;
    g.player.y = (w.y + w.h + 0.6) * 16;
    window.__EM.renderer.snapCamera();
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(450);
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(350);
  const crewText = await ev(() => document.querySelector('.panel-workshop')?.textContent ?? '');
  check(/Ramasseur/.test(crewText) && /Ravitailleur/.test(crewText) && /Votre équipe/.test(crewText), "la touche 5 ouvre l'onglet Ouvriers");
  const crewBefore = await ev(() => window.__EM.state.workers.count);
  const moneyBeforeHire = (await state()).money;
  await page.click('[data-action="hireWorker"][data-arg="picker"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="hireWorker"][data-arg="refueler"]');
  await page.waitForTimeout(300);
  const crewAfter = await ev(() => window.__EM.state.workers.count);
  check(crewAfter - crewBefore === 2, `deux ouvriers recrutés au clic (${crewAfter - crewBefore})`);
  check(moneyBeforeHire - (await state()).money > 0, `un achat unique : ${moneyBeforeHire - (await state()).money} $ débités une fois`);
  await shot('28-crew-tab');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const staged = await ev(() => {
    const g = window.__EM.state;
    g.pickaxeLevel = 3;
    g.player.x = 50.5 * 16;
    g.player.y = 10.5 * 16;
    g.inventory.addKit('storage', 1);
    g.inventory.addKit('furnace', 1);
    const chest = g.place('storage', 44, 10, 1);
    const furnace = g.place('furnace', 57, 8, 1);
    if (!chest || !furnace) return null;
    chest.put('coal', 12);
    // Dans un camp chargé, le ramasseur range dans le coffre le plus proche, pas forcément celui-ci : on suit les tas eux-mêmes.
    const piles = [['copper', 2, 60, 10], ['iron', 1, 62, 10]].map(([res, n, x, y]) => g.drops.spawn(res, n, (x + 0.5) * 16, (y + 0.5) * 16, false).id);
    const stock = () => g.structures.list.reduce((n, s) => n + ((s.items?.copper ?? 0) + (s.items?.iron ?? 0)), 0);
    window.__crewTest = { piles, before: stock() + g.stats.autoSold, stock };
    g.player.x = 30.5 * 16;
    return { cx: chest.x, cy: chest.y, fx: furnace.x, fy: furnace.y };
  });
  check(!!staged, 'un coffre avec du charbon, un four vide et des minerais par terre sont prêts');
  if (staged) {
    let done = true;
    try {
      await page.waitForFunction(
        (p) => {
          const g = window.__EM.state;
          const f = g.structures.at(p.fx, p.fy);
          const gone = window.__crewTest.piles.every((id) => !g.drops.list.some((d) => d.id === id));
          const empty = g.workers.list.every((w) => Object.entries(w.cargo).every(([res, n]) => res === 'coal' || n === 0));
          return gone && empty && f && f.fuelUnits > 0;
        },
        staged,
        { timeout: 120000, polling: 500 },
      );
    } catch {
      done = false;
    }
    const res = await ev((p) => {
      const g = window.__EM.state;
      const f = g.structures.at(p.fx, p.fy);
      const t = window.__crewTest;
      return { fuel: f.fuelUnits, left: t.piles.filter((id) => g.drops.list.some((d) => d.id === id)).length, gained: t.stock() + g.stats.autoSold - t.before };
    }, staged);
    check(done && res.left === 0 && res.gained >= 3, `le ramasseur a ramassé les deux tas et les a rangés dans un coffre (${res.gained} unités de plus en stock, ${res.left} tas restants)`);
    check(res.fuel > 0, `le ravitailleur recharge le four (${res.fuel} unités)`);
    await shot('29-crew-working');
  }

  // Filtre de coffre : le panneau règle ce que le coffre accepte (clic sur un minerai, puis sur « Tout »).
  if (staged) {
    await ev((p) => {
      const g = window.__EM.state;
      g.player.x = (p.cx + 0.5) * 16;
      g.player.y = (p.cy + 1.6) * 16;
      window.__EM.renderer.snapCamera();
    }, staged);
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(450);
    const chestText = await ev(() => document.querySelector('.panel-storage')?.textContent ?? '');
    check(/Ce que ce coffre accepte/.test(chestText) && /Accepte tout/.test(chestText), 'le panneau du coffre propose de choisir ce qu’il accepte');
    await page.click('[data-action="storageAllow"][data-arg="copper"]');
    await page.waitForTimeout(300);
    const allowed = await ev((p) => [...window.__EM.state.structures.at(p.cx, p.cy).allow], staged);
    check(JSON.stringify(allowed) === '["copper"]', `un clic sur le cuivre : le coffre n'accepte plus que du cuivre (${JSON.stringify(allowed)})`);
    check(/Accepte seulement/.test(await ev(() => document.querySelector('.panel-storage')?.textContent ?? '')), 'le panneau dit « Accepte seulement : cuivre »');
    await shot('30-chest-filter');
    await page.click('[data-action="storageAllow"][data-arg=""]');
    await page.waitForTimeout(300);
    const cleared = await ev((p) => [...window.__EM.state.structures.at(p.cx, p.cy).allow], staged);
    check(cleared.length === 0, 'le bouton « Tout » remet le coffre à « accepte tout »');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }

  // Régler plusieurs coffres : touche C, réglage choisi dans la barre, rectangle tracé à la souris, bouton « Appliquer ».
  if (staged) {
    const grid = await ev(() => {
      const g = window.__EM.state;
      g.inventory.addKit('storage', 12);
      g.player.x = 24.5 * 16;
      g.player.y = 10.5 * 16;
      const mine = [];
      for (let y = 8; y <= 10; y++) for (let x = 20; x <= 24; x++) if (g.canPlace('storage', x, y).ok) mine.push(g.place('storage', x, y, 1));
      g.player.x = 27.5 * 16;
      window.__EM.renderer.snapCamera();
      const xs = mine.map((c) => c.x), ys = mine.map((c) => c.y);
      return { n: mine.length, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    check(grid.n >= 4, `une grille de coffres est posée pour tester la sélection (${grid.n} coffres)`);
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(1200);
    check(!!(await page.$('.chestbar')) && (await ev(() => window.__EM.chestMode)), 'la touche C ouvre le mode « Régler les coffres » et sa barre');
    await page.click('[data-action="chestDraft"][data-arg="copper"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="chestDraft"][data-arg="iron"]');
    await page.waitForTimeout(250);
    const px = (tx, ty) =>
      ev(([tx, ty]) => {
        const p = window.__EM.renderer.worldToScreen(tx * 16, ty * 16);
        const r = document.getElementById('game').getBoundingClientRect();
        return { x: p.x + r.left, y: p.y + r.top };
      }, [tx, ty]);
    const a = await px(grid.x0, grid.y0);
    const b = await px(grid.x1 + 1, grid.y1 + 1);
    await page.mouse.move(a.x - 4, a.y - 4);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
    await page.mouse.move(b.x + 4, b.y + 4, { steps: 6 });
    await page.waitForTimeout(150);
    await shot('31-chest-multi-drag');
    await page.mouse.up();
    await page.waitForTimeout(250);
    const picked = await ev(() => window.__EM.chestSel.size);
    check(picked === grid.n, `le rectangle tracé à la souris choisit les ${grid.n} coffres de la zone (${picked})`);
    const before = await ev((p) => [...window.__EM.state.structures.at(p.cx, p.cy).allow], staged);
    await page.click('[data-action="chestApply"]');
    await page.waitForTimeout(300);
    const applied = await ev((g) => {
      const gs = window.__EM.state;
      const inside = gs.storages().filter((s) => s.x >= g.x0 && s.x <= g.x1 && s.y >= g.y0 && s.y <= g.y1);
      return { inside: inside.length, ok: inside.filter((s) => s.allow.join('+') === 'copper+iron').length };
    }, grid);
    check(applied.inside === grid.n && applied.ok === grid.n, `« Appliquer » règle les ${grid.n} coffres choisis sur cuivre + fer (${applied.ok}/${applied.inside})`);
    const after = await ev((p) => [...window.__EM.state.structures.at(p.cx, p.cy).allow], staged);
    check(JSON.stringify(after) === JSON.stringify(before), 'un coffre hors de la zone n’est pas touché');
    await shot('31-chest-multi');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(!(await ev(() => window.__EM.chestMode)) && !(await page.$('.menu')), 'Échap quitte le mode sans ouvrir le menu pause');
  }

  // Vitesse de jeu et pause : X change de vitesse, P arrête le temps, le bandeau se clique ; le temps de jeu suit.
  {
    await ev(() => {
      const g = window.__EM.state;
      g.hp = 100;
      g.player.x = 50.5 * 16;
      g.player.y = 10.5 * 16;
      window.__EM.renderer.snapCamera();
    });
    await page.waitForTimeout(400);
    // Secondes de jeu écoulées par seconde d'horloge (le camp est chargé : on reste large sur les vitesses rapides).
    const rate = async (ms = 2500) => {
      const t0 = await ev(() => window.__EM.state.time);
      const w0 = Date.now();
      await page.waitForTimeout(ms);
      return ((await ev(() => window.__EM.state.time)) - t0) / ((Date.now() - w0) / 1000);
    };
    check(!!(await page.$('.speedbar')), 'le bandeau de vitesse est affiché');
    const r1 = await rate();
    check(r1 > 0.8 && r1 < 1.2, `à vitesse normale, une seconde de jeu par seconde (${r1.toFixed(2)})`);
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(300);
    const r2 = await rate();
    check((await ev(() => window.__EM.speed)) === 2 && r2 > 1.5, `X passe à ×2 : le temps de jeu va plus vite (${r2.toFixed(2)})`);
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(300);
    const r4 = await rate();
    check((await ev(() => window.__EM.speed)) === 4 && r4 > 2.2, `X passe à ×4 : encore plus vite (${r4.toFixed(2)})`);
    await shot('32-speed-x4');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    const p0 = await ev(() => window.__EM.state.time);
    await page.waitForTimeout(1200);
    const p1 = await ev(() => window.__EM.state.time);
    check(p0 === p1 && (await ev(() => window.__EM.userPaused)), `P met en pause : le temps de jeu s'arrête (${p0.toFixed(2)} → ${p1.toFixed(2)})`);
    check(/En pause/.test(await page.textContent('#hud-speed')), 'le bandeau dit « En pause »');
    await shot('33-speed-pause');
    await page.click('[data-action="speed"][data-arg="1"]');
    await page.waitForTimeout(300);
    const r5 = await rate(2000);
    check(!(await ev(() => window.__EM.userPaused)) && (await ev(() => window.__EM.speed)) === 1 && r5 > 0.8 && r5 < 1.2, `un clic sur ×1 reprend à vitesse normale (${r5.toFixed(2)})`);
    // Danger : à ×4, une santé basse ramène à ×1 et refuse ×4.
    await page.click('[data-action="speed"][data-arg="4"]');
    await page.waitForTimeout(250);
    await ev(() => { window.__EM.state.hp = 15; });
    await page.waitForTimeout(400);
    check((await ev(() => window.__EM.speed)) === 1, 'santé basse : le jeu repasse tout seul à ×1');
    await ev(() => { window.__EM.state.hp = 100; });
  }

  // Foreuse de percement, niveau 5 « tête de diamant » : elle perce tout, toujours tout droit (diamant, socle rocheux, falaise, arbre).
  {
    const B = { AIR: 0, BEDROCK: 1, CLIFF: 2, TREE: 3, SOFT: 4, DIAMOND: 14 };
    const at = { x: 70, y: 80 }; // en profondeur, loin de tout ce que le parcours a posé
    await ev(([at, B]) => {
      const g = window.__EM.state;
      g.money = 50000;
      g.pickaxeLevel = 3;
      g.inventory.addKit('borer', 1);
      g.inventory.add('coal', 20);
      for (let x = at.x - 3; x <= at.x; x++) for (const y of [at.y - 1, at.y, at.y + 1]) g.world.set(x, y, B.AIR);
      for (let x = at.x + 1; x <= at.x + 30; x++) for (const y of [at.y - 1, at.y, at.y + 1]) g.world.set(x, y, B.SOFT);
      g.world.set(at.x + 3, at.y, B.DIAMOND);
      g.world.set(at.x + 4, at.y - 1, B.DIAMOND);
      g.world.set(at.x + 6, at.y, B.BEDROCK);
      g.world.set(at.x + 7, at.y + 1, B.BEDROCK);
      g.world.set(at.x + 9, at.y, B.CLIFF);
      g.world.set(at.x + 11, at.y, B.TREE);
      g.player.x = (at.x - 1 + 0.5) * 16;
      g.player.y = (at.y + 0.5) * 16;
      g.place('borer', at.x, at.y, 0);
      window.__EM.renderer.snapCamera();
    }, [at, B]);
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(450);
    check(/Foreuse de percement/.test(await ev(() => document.querySelector('.panel')?.textContent ?? '')), 'le panneau de la foreuse de percement s’ouvre (niveau 5)');
    await page.click('[data-action="borerFuel"]');
    await page.waitForTimeout(200);
    for (let i = 2; i <= 5; i++) {
      await page.click('[data-action="borerUpgrade"]');
      await page.waitForTimeout(250);
    }
    const lvl5 = await ev(() => window.__EM.state.structures.borers.at(-1).level);
    const text5 = await ev(() => document.querySelector('.panel')?.textContent ?? '');
    check(lvl5 === 5 && /Tête de diamant/.test(text5) && /perce tout/.test(text5), `quatre améliorations au clic jusqu'à la tête de diamant (niveau ${lvl5})`);
    check(!(await page.$('[data-action="borerUpgrade"]')), 'plus de bouton d’amélioration au niveau maximal');
    await shot('34-borer-level5-panel');
    await page.click('[data-action="borerLength"][data-arg="25"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="borerStart"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    let reached = false;
    try {
      await page.waitForFunction((at) => window.__EM.state.structures.borers.some((b) => b.x === at.x && b.y === at.y && b.tunnel >= 14), at, { timeout: 90000, polling: 500 });
      reached = true;
    } catch {
      /* mesuré plus bas */
    }
    const tun = await ev(([at, B]) => {
      const g = window.__EM.state;
      const b = g.structures.borers.find((o) => o.x === at.x && o.y === at.y);
      return {
        status: b.status,
        reason: b.blockReason,
        tunnel: b.tunnel,
        row: [...Array(14).keys()].map((k) => g.world.get(at.x + 1 + k, at.y) === B.AIR),
        sides: [g.world.get(at.x + 4, at.y - 1) === B.AIR, g.world.get(at.x + 7, at.y + 1) === B.AIR],
      };
    }, [at, B]);
    check(reached && tun.row.every(Boolean), `la foreuse perce tout le tunnel : diamant, socle rocheux, falaise et arbre (${tun.tunnel} cases, ${tun.status})`);
    check(tun.sides.every(Boolean), 'la tête large perce aussi le diamant et le socle rocheux des côtés');
    await shot('35-borer-level5-tunnel');
  }
} catch (e) {
  failures++;
  console.error(e);
}

check(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`);
await browser.close();
if (server) await server.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTranche verticale validée.');
process.exit(failures ? 1 : 0);
