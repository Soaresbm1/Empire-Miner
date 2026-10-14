/**
 * Commandes et Grand Chevalement, dans un vrai navigateur, avec de vrais clics et de vraies touches :
 *   - le Tableau d'affichage : onglet « Commandes » (touche 2), pastille sur l'onglet, accepter, livrer, abandonner (avec
 *     confirmation), la ligne du HUD ;
 *   - la caisse d'expédition : le bouton « Commandes » règle la caisse, qui livre à son prochain passage ;
 *   - le chantier : verser, livrer, la tour qui change à chaque phase, l'écran de fin à la dernière ;
 *   - la sauvegarde : tout est retrouvé après un rechargement de la page.
 *
 *   npm run build && node e2e/orders.mjs
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
  server = await preview({ preview: { port: 4270, strictPort: false }, logLevel: 'silent' });
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
/** Le doigt posé au centre de l'élément le touche-t-il (« devant ») ? */
const front = (sel) =>
  ev((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }, sel);

/** Le joueur se place devant un bâtiment du camp (ou une machine), prêt à appuyer sur E. */
const goTo = (type) =>
  ev((type) => {
    const E = window.__EM;
    const g = E.state;
    const b = g.structures.list.find((s) => s.type === type);
    g.player.x = (b.x + b.w / 2) * 16;
    g.player.y = (b.y + b.h + 0.5) * 16;
    E.renderer.snapCamera();
  }, type);

await page.goto(`${url.replace(/\/$/, '')}/?debug`);
await page.waitForSelector('#menu-root [data-action="new"]');
await page.click('#menu-root [data-action="new"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);

// Le joueur a déjà trouvé du charbon et du cuivre (les clients ne demandent que ce qu'on connaît) ; quelques minutes passent.
await ev(() => {
  const g = window.__EM.state;
  g.stats.collected.coal = 5;
  g.stats.collected.copper = 5;
  g.money = 3000;
  g.setBagLevel(2);
  g.inventory.items = { coal: 80, copper: 30 };
  const I = { mx: 0, my: 0, mine: false, target: null };
  for (let i = 0; i < 60 * 60 * 2; i++) g.update(1 / 60, I); // deux minutes de jeu
  g.events.length = 0;
});
check(await ev(() => window.__EM.state.contracts.offers().length >= 2), 'au bout de deux minutes, des clients ont laissé des propositions');

// ---------------------------------------------------------------- le Tableau d'affichage
console.log('\n▶ Tableau d’affichage');
await goTo('board');
await sleep(250);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
check((await page.textContent('#panel-root .panel h2')).includes("Tableau d'affichage"), 'E ouvre le Tableau d’affichage');
check(await ev(() => !!document.querySelector('#panel-root .tab[data-arg="orders"] .badge')), 'une pastille sur « Commandes » dit que des propositions attendent');
await page.keyboard.press('Digit2');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'orders');
check(await ev(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'orders'), 'la touche 2 ouvre l’onglet Commandes');
check(await ev(() => !document.querySelector('#panel-root .tab[data-arg="orders"] .badge')), 'la pastille disparaît quand on est sur l’onglet');
check((await ev(() => document.querySelectorAll('#panel-root .card.offer').length)) >= 2, 'les propositions s’affichent en cartes');
check(await front('#panel-root .card.offer [data-action="contractAccept"]'), 'le bouton « Accepter » est devant, cliquable');
await page.screenshot({ path: `${SHOTS}orders-01-propositions.png` });
await page.keyboard.press('Digit3');
await page.keyboard.press('Digit1');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'market');
check(await ev(() => !!document.querySelector('#panel-root .tab[data-arg="orders"] .badge')), 'de retour sur le marché, la pastille revient');
await page.click('#panel-root .tab[data-arg="orders"]');
await until(() => document.querySelector('#panel-root .tab.active')?.dataset.arg === 'orders');

// Accepter une proposition d'un vrai clic.
const offer = await ev(() => {
  const o = window.__EM.state.contracts.offers()[0];
  return { id: o.id, res: o.lines[0].res, qty: o.lines[0].qty, reward: o.reward };
});
await page.click(`#panel-root [data-action="contractAccept"][data-arg="${offer.id}"]`);
check(await until((id) => window.__EM.state.contracts.get(id)?.accepted === true, offer.id), 'un clic sur « Accepter » accepte la commande');
check(await until(() => !!document.querySelector('#panel-root .card.st-active')), 'elle passe dans « Vos commandes »');
check(await ev(() => !!document.querySelector('.ord-hud')), 'la ligne du HUD annonce la commande en cours');
check(await ev(() => /\d+\/\d+/.test(document.querySelector('.ord-hud')?.textContent ?? '')), 'avec son avancement et son décompte');

// La livrer du sac : le sac contient largement de quoi (charbon 80, cuivre 30).
await ev((o) => {
  const g = window.__EM.state;
  g.inventory.items[o.res] = o.qty + 3;
}, offer);
const money0 = await ev(() => window.__EM.state.money);
check(await front(`#panel-root [data-action="contractDeliver"][data-arg="${offer.id}"]`), 'le bouton « Livrer mon sac » est devant');
await page.click(`#panel-root [data-action="contractDeliver"][data-arg="${offer.id}"]`);
check(await until((id) => !window.__EM.state.contracts.get(id), offer.id), 'la commande livrée disparaît du Tableau');
check((await ev(() => window.__EM.state.money)) - money0 === offer.reward, `la récompense est versée (+${offer.reward} $)`);
check((await ev(() => window.__EM.state.stats.contracts)) === 1, 'une commande honorée de plus au compteur');
check(await until(() => /Commande honorée/.test(document.querySelector('#toasts')?.textContent ?? '')), 'un message annonce la commande honorée');
check((await ev((o) => window.__EM.state.inventory.count(o.res), offer)) === 3, 'le surplus reste dans le sac');
await page.screenshot({ path: `${SHOTS}orders-02-honoree.png` });

// Réputation : le client se souvient (un point, niveau « Connaissance »), et le Tableau montre « Vos clients ».
check(await ev(() => window.__EM.state.contracts.reputation.reduce((a, b) => a + b, 0) === 1), 'le client de la commande honorée a gagné un point de confiance');
check(await until(() => /vous fait désormais confiance : Connaissance/.test(document.querySelector('#toasts')?.textContent ?? '')), 'un message dit que le client vous fait désormais confiance');
check(await until(() => !!document.querySelector('#panel-root .ord-clients .tag.trust.t1')), 'la liste « Vos clients » montre le niveau de confiance');
check(await ev(() => /Vos clients/.test(document.querySelector('#panel-root')?.textContent ?? '')), 'avec son titre');
await page.screenshot({ path: `${SHOTS}orders-02b-clients.png` });

// Un nouveau rang : le client le plus fidèle laisse une commande exclusive, annoncée et marquée sur sa carte.
await ev(() => {
  const g = window.__EM.state;
  g.stats.contracts = 3; // rang Fournisseur
  for (const o of g.contracts.offers()) g.contracts.decline(o.id, g.time);
  for (let t = Math.ceil(g.time); !g.contracts.offers().some((o) => o.exclusive) && t < g.time + 600; t += 5) g.contracts.update(t);
  g.events.length = 0;
});
check(await ev(() => window.__EM.state.contracts.offers().filter((o) => o.exclusive).length === 1), 'au nouveau rang, une commande exclusive arrive');
check(await ev(() => window.__EM.state.contracts.offers().find((o) => o.exclusive).client === window.__EM.state.contracts.regulars()[0].client), 'elle vient du client le plus fidèle');
check(await until(() => !!document.querySelector('#panel-root .card .tag.excl')), 'la carte porte la marque « Exclusive »');
await page.screenshot({ path: `${SHOTS}orders-02c-exclusive.png` });

// Abandonner demande une confirmation.
const second = await ev(() => window.__EM.state.contracts.offers()[0]?.id);
await page.click(`#panel-root [data-action="contractAccept"][data-arg="${second}"]`);
await until((id) => window.__EM.state.contracts.get(id)?.accepted === true, second);
await page.click(`#panel-root [data-action="contractAbandon"][data-arg="${second}"]`);
check(await until(() => /Sûr/.test(document.querySelector('#panel-root [data-action="contractAbandon"]')?.textContent ?? '')), 'le premier appui sur « Abandonner » demande confirmation');
check(await ev((id) => window.__EM.state.contracts.get(id)?.accepted === true, second), 'la commande est toujours là');
await page.click(`#panel-root [data-action="contractAbandon"][data-arg="${second}"]`);
check(await until((id) => !window.__EM.state.contracts.get(id), second), 'le second appui l’abandonne');
// Refuser une proposition.
const third = await ev(() => window.__EM.state.contracts.offers()[0]?.id);
if (third) {
  await page.click(`#panel-root [data-action="contractDecline"][data-arg="${third}"]`);
  check(await until((id) => !window.__EM.state.contracts.get(id), third), '« Refuser » retire la proposition');
}
await page.keyboard.press('Escape');
await until(() => !document.querySelector('#panel-root .panel'));

// ---------------------------------------------------------------- la caisse d'expédition
console.log('\n▶ Caisse d’expédition');
const wanted = await ev(() => {
  const g = window.__EM.state;
  for (let t = g.time; g.contracts.offers().length === 0 && t < g.time + 400; t += 10) g.contracts.update(t);
  const o = g.contracts.offers()[0];
  teleport();
  g.contracts.accept(o.id, g.time);
  g.inventory.addKit('shipping', 1);
  g.player.x = 52.5 * 16;
  g.player.y = 8.5 * 16;
  const c = g.place('shipping', 53, 9, 0);
  window.__EM.renderer.snapCamera();
  return { id: o.id, res: o.lines[0].res, qty: o.lines[0].qty, crate: !!c };
  function teleport() {
    const b = g.structures.list.find((s) => s.type === 'board');
    g.player.x = (b.x + 1) * 16;
    g.player.y = (b.y + b.h + 0.5) * 16;
  }
});
check(wanted.crate, 'une caisse d’expédition est posée au camp');
await ev(() => {
  const g = window.__EM.state;
  g.player.x = 52.5 * 16;
  g.player.y = 8.5 * 16;
});
await sleep(250);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
check((await page.textContent('#panel-root .panel h2')).includes("Caisse d'expédition"), 'E ouvre la caisse');
check(await ev(() => document.querySelector('#panel-root [data-action="shipMode"][data-arg="market"]')?.classList.contains('on')), 'elle vend au marché par défaut');
await page.click('#panel-root [data-action="shipMode"][data-arg="orders"]');
check(await until(() => window.__EM.state.structures.at(53, 9)?.mode === 'orders'), 'un clic sur « Commandes » règle la caisse');
check(await ev(() => document.querySelector('#panel-root [data-action="shipMode"][data-arg="orders"]')?.classList.contains('on')), 'le bouton s’allume');
await page.screenshot({ path: `${SHOTS}orders-03-caisse.png` });
// On y met de quoi servir la commande ; au passage du transporteur, elle est livrée.
await ev((w) => {
  const c = window.__EM.state.structures.at(53, 9);
  c.put(w.res, Math.min(w.qty, 20));
  c.timer = 1;
}, wanted);
check(await until((w) => (window.__EM.state.contracts.get(w.id)?.lines[0].done ?? w.qty) >= Math.min(w.qty, 20) || !window.__EM.state.contracts.get(w.id), wanted, 6000), 'au passage du transporteur, la commande est servie');
check(await ev(() => window.__EM.state.structures.at(53, 9).items && Object.keys(window.__EM.state.structures.at(53, 9).items).length === 0), 'la caisse est vidée');
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- le chantier
console.log('\n▶ Grand Chevalement');
await goTo('site');
await sleep(250);
await page.keyboard.press('KeyE');
await page.waitForSelector('#panel-root .panel');
check((await page.textContent('#panel-root .panel h2')).includes('Grand Chevalement'), 'E devant le chantier ouvre son panneau');
check((await ev(() => document.querySelectorAll('#panel-root .site-steps li').length)) === 5, 'la frise montre les cinq phases');
check(await ev(() => document.querySelector('#panel-root .site-steps li.now i')?.textContent === '1'), 'la phase 1 est en cours');
const needs = await ev(() => window.__EM.state.project.missing());
await ev((needs) => {
  const g = window.__EM.state;
  g.setBagLevel(2);
  for (const n of needs) g.inventory.items[n.res] = n.qty;
}, needs);
await page.click('#panel-root [data-action="siteDeliver"]');
check(await until((needs) => needs.every((n) => (window.__EM.state.project.delivered[n.res] ?? 0) >= n.qty), needs), 'livrer le sac apporte les matériaux au chantier');
check(await ev(() => window.__EM.state.inventory.isEmpty() || Object.keys(window.__EM.state.inventory.items).length >= 0), 'le sac a été vidé de ce qui servait');
const money1 = await ev(() => window.__EM.state.money);
await page.click('#panel-root [data-action="siteFund"]');
check(await until(() => window.__EM.state.project.phase === 1), 'verser les salaires termine la phase (matériaux, argent, aucune commande exigée)');
check((await ev(() => window.__EM.state.money)) < money1, 'l’argent a bien été versé');
check(await until(() => /terminée/.test(document.querySelector('#toasts')?.textContent ?? '')), 'un message annonce la phase terminée');
check(await until(() => document.querySelector('#panel-root .site-steps li.done')), 'la frise coche la phase 1');
await page.screenshot({ path: `${SHOTS}orders-04-chantier.png` });
await page.keyboard.press('Escape');
await sleep(250);

// La tour change à chaque phase : le dessin n'est pas le même.
const shot = async (phase) => {
  await ev((k) => {
    const E = window.__EM;
    E.state.project.phase = k;
    E.state.player.x = 63.5 * 16;
    E.state.player.y = 11 * 16;
    E.renderer.zoom = 2;
    E.renderer.snapCamera();
  }, phase);
  await sleep(350);
  return (await page.screenshot({ clip: { x: 440, y: 0, width: 400, height: 420 } })).toString('base64');
};
const looks = [];
for (let k = 0; k <= 5; k++) looks.push(await shot(k));
check(new Set(looks).size === 6, 'la tour est dessinée autrement à chacune des six étapes');
await ev(() => {
  window.__EM.state.project.phase = 1;
  window.__EM.renderer.zoom = 3;
});

// L'écran de fin : la dernière phase l'ouvre toute seule.
await ev(() => {
  const g = window.__EM.state;
  g.stats.contracts = 99;
  g.stats.playTime = 7385;
  goTo();
  function goTo() {
    const b = g.structures.list.find((s) => s.type === 'board');
    g.player.x = (b.x + 1) * 16;
    g.player.y = (b.y + b.h + 0.5) * 16;
  }
  for (let i = 0; i < 6 && !g.project.done; i++) {
    for (const n of g.project.missing()) g.project.deliver(n.res, n.qty);
    g.project.fund(g.project.moneyLeft());
    g.update(0.1, { mx: 0, my: 0, mine: false, target: null });
  }
});
check(await until(() => /Empereur de la mine/.test(document.querySelector('#panel-root .victory-title')?.textContent ?? '')), 'achever le monument ouvre l’écran de fin tout seul, devant le jeu');
check(await ev(() => /2 h 03 min/.test(document.querySelector('#panel-root')?.textContent ?? '')), 'il donne les chiffres de la partie (temps de jeu)');
check(await front('#panel-root [data-action="close"].btn'), '« Continuer à jouer » est devant, cliquable');
await page.screenshot({ path: `${SHOTS}orders-05-victoire.png` });
await page.click('#panel-root [data-action="close"].btn');
check(await until(() => !document.querySelector('#panel-root .panel')), '« Continuer à jouer » ferme l’écran de fin');
check(await ev(() => window.__EM.mode === 'playing' && window.__EM.state.project.done), 'la partie continue, le monument reste achevé');

// ---------------------------------------------------------------- la sauvegarde
console.log('\n▶ Sauvegarde');
await ev(() => {
  const r = window.__EM.state.contracts.reputation;
  r[2] = 5; // un habitué (l'abandon plus haut avait ramené le premier client à zéro)
  r[7] = 12;
});
const before = await ev(() => {
  const g = window.__EM.state;
  return { contracts: JSON.stringify(g.contracts.serialize()), project: JSON.stringify(g.project.serialize()), honored: g.stats.contracts, mode: g.structures.at(53, 9)?.mode };
});
await ev(() => window.__EM.onAction('save', ''));
await sleep(300);
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
await sleep(400);
const after = await ev(() => {
  const g = window.__EM.state;
  return { contracts: JSON.stringify(g.contracts.serialize()), project: JSON.stringify(g.project.serialize()), honored: g.stats.contracts, mode: g.structures.at(53, 9)?.mode };
});
check(after.project === before.project && JSON.parse(after.project).phase === 5, 'après rechargement, le chantier est achevé');
check(after.honored === before.honored, 'et le compteur de commandes honorées est le même');
check(after.mode === 'orders', 'la caisse est toujours réglée sur « Commandes »');
const bc = JSON.parse(before.contracts);
const ac = JSON.parse(after.contracts);
check(ac.n === bc.n && JSON.stringify(ac.list.map((c) => c.id)) === JSON.stringify(bc.list.map((c) => c.id)), 'les commandes (propositions et en cours) sont les mêmes');
check(JSON.stringify(ac.rep) === JSON.stringify(bc.rep) && ac.rep?.[2] === 5 && ac.rep?.[7] === 12 && ac.x === bc.x && ac.x >= 1, 'la confiance des clients et le rang de la dernière exclusive sont retrouvés');

// ---------------------------------------------------------------- une partie d'avant les commandes et le chantier
console.log('\n▶ Ancienne sauvegarde');
// On fabrique ce qu'une ancienne version aurait écrit : ni commandes, ni chantier, ni compteurs ; une caisse d'expédition posée
// là où le chantier se dresse maintenant, avec du charbon dedans ; et le joueur qui s'y tenait debout.
await ev(() => {
  // Le jeu se sauvegarde en quittant la page : sans cela, il écraserait la sauvegarde fabriquée ici par la partie en cours.
  window.__EM.autoSaveNow = () => {};
  const data = JSON.parse(localStorage.getItem('empire-miner.save'));
  delete data.contracts;
  delete data.project;
  delete data.stats.contracts;
  delete data.stats.contractMoney;
  data.structures = data.structures.filter((s) => !(s.type === 'shipping'));
  data.structures.push({ type: 'shipping', x: 63, y: 6, dir: 0, items: { coal: 4 }, timer: 6, soldTotal: 0 });
  data.kits = {};
  data.inventory = {};
  data.player.x = 64.5 * 16;
  data.player.y = 6.5 * 16;
  localStorage.setItem('empire-miner.save', JSON.stringify(data));
});
await page.reload();
await page.waitForSelector('#menu-root [data-action="continue"]');
await page.click('#menu-root [data-action="continue"]');
await until(() => window.__EM.mode === 'playing');
await sleep(500);
const old = await ev(() => {
  const g = window.__EM.state;
  return {
    phase: g.project.phase,
    contracts: g.contracts.list.length,
    honored: g.stats.contracts,
    site: g.structures.at(63, 6)?.type,
    crate: g.structures.list.some((s) => s.type === 'shipping'),
    kit: g.inventory.kitCount('shipping'),
    // Le charbon tombe à l'entrée de la mine, là où le joueur est remis : il l'a déjà ramassé, ou il est encore au sol.
    coal: g.inventory.count('coal') + g.drops.list.filter((d) => d.res === 'coal').reduce((n, d) => n + d.count, 0),
    px: g.player.tileX,
    py: g.player.tileY,
    spawn: g.layout.spawn,
    blocked: g.isBlocked(g.player.x - g.player.halfW, g.player.y - g.player.halfH, g.player.x + g.player.halfW - 0.001, g.player.y + g.player.halfH - 0.001),
  };
});
check(old.phase === 0 && old.contracts === 0 && old.honored === 0, 'une partie d’avant se charge avec un chantier à zéro et aucune commande');
check(old.site === 'site' && !old.crate, 'le chantier est à sa place ; la caisse qui y était n’y est plus');
check(old.kit === 1 && old.coal === 4, `son kit est revenu dans le stock, et ses 4 charbons sont dans le sac ou au sol (${old.coal})`);
check(old.px === old.spawn.x && old.py === old.spawn.y && !old.blocked, 'le joueur qui se tenait dans le chantier est remis à l’entrée de la mine, libre de ses mouvements');
await ev(() => {
  const g = window.__EM.state;
  g.stats.collected.coal = 3;
  const I = { mx: 0, my: 0, mine: false, target: null };
  for (let i = 0; i < 60 * 60; i++) g.update(1 / 60, I);
});
check(await ev(() => window.__EM.state.contracts.offers().length > 0), 'et les clients arrivent, comme dans une partie neuve');
await page.keyboard.down('ArrowDown');
await sleep(500);
await page.keyboard.up('ArrowDown');
check(await ev(() => window.__EM.state.player.y > window.__EM.state.layout.spawn.y * 16), 'le joueur peut marcher');

check(errors.length === 0, `aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
