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
const tileScreen = (tx, ty) => ev(([x, y]) => window.__EM.renderer.worldToScreen((x + 0.5) * 16, (y + 0.5) * 16), [tx, ty]);
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

/** En mode construction : choisit le kit, oriente la pose puis clique sur la tuile. */
async function placeAt(kit, tx, ty, dir = 0) {
  const idx = await ev((k) => window.__EM.availableKits(window.__EM.state).indexOf(k), kit);
  if (idx < 0) throw new Error(`kit ${kit} absent`);
  await page.keyboard.press(`Digit${idx + 1}`);
  await page.waitForTimeout(40);
  const p = await tileScreen(tx, ty);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(40);
  const cur = await ev(() => window.__EM.buildDir);
  for (let i = 0; i < (dir - cur + 4) % 4; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(30);
  }
  await page.mouse.down();
  await page.mouse.up();
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
  await page.keyboard.press('Digit2'); // foreuse (ordre : convoyeur, foreuse, coffre)
  await page.waitForTimeout(60);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyR'); // direction ouest
  await page.waitForTimeout(100);
  let p = await tileScreen(59, S + 10);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  // Convoyeurs tracés en glissant de x=58 à x=54
  await page.keyboard.press('Digit1');
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
  const storageIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('storage'));
  await page.keyboard.press(`Digit${storageIdx + 1}`);
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
  await page.keyboard.press('Digit1');
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
  const shipIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('shipping'));
  await page.keyboard.press(`Digit${shipIdx + 1}`);
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
  const fastIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('conveyor_fast'));
  await page.keyboard.press(`Digit${fastIdx + 1}`);
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
  const chestIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('storage'));
  await page.keyboard.press(`Digit${chestIdx + 1}`);
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
  const bidx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('bridge'));
  await page.keyboard.press(`Digit${bidx + 1}`);
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
  const railIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('rail'));
  await page.keyboard.press(`Digit${railIdx + 1}`);
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
  const rIdx = await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('rail'));
  await page.keyboard.press(`Digit${rIdx + 1}`);
  await drag([[57, 3], [58, 3], [59, 3]]);
  await placeAt('rail_switch', 60, 3, 0);
  await page.keyboard.press(`Digit${(await ev(() => window.__EM.availableKits(window.__EM.state).indexOf('rail'))) + 1}`);
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
  check(sw.type === 'rail_switch' && sw.dir === 0 && sw.a === 'rail_unload' && sw.b === 'rail_unload', 'aiguillage et deux quais posés à la souris');
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
} catch (e) {
  failures++;
  console.error(e);
}

check(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`);
await browser.close();
if (server) await server.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTranche verticale validée.');
process.exit(failures ? 1 : 0);
