/**
 * Test de bout en bout du jeu à deux : deux pages du même navigateur (canal local BroadcastChannel, ?net=local) jouent
 * ensemble : création de la partie, invitation par lien, entrées des deux joueurs, actions, départ et retour de l'invité
 * (ses affaires lui sont rendues), détection d'une divergence et resynchronisation, coupure de réseau.
 *
 *   npm run build && node e2e/coop.mjs
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
  server = await preview({ preview: { port: 4180, strictPort: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
const host = await ctx.newPage();
const guest = await ctx.newPage();
const errors = [];
for (const [name, p] of [['hôte', host], ['invité', guest]]) {
  p.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name} : ${m.text()}`));
}

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (page, fn, arg, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const status = (p) => p.evaluate(() => window.__EM.session?.status ?? 'none');
const base = `${url.replace(/\/$/, '')}/?debug&net=local`;

// ---------------------------------------------------------------- l'hôte crée la partie
await host.goto(base);
await host.waitForSelector('[data-action="play2"]');
await host.click('[data-action="play2"]');
await host.waitForSelector('[data-action="hostNew"]');
await host.screenshot({ path: `${SHOTS}coop-01-menu.png` });
await host.click('[data-action="hostNew"]');
await until(host, () => window.__EM.session?.status === 'waiting');
const code = await host.evaluate(() => window.__EM.session.code);
check(/^[A-Z2-9]{5}$/.test(code), `l'hôte obtient un code à 5 signes (${code})`);
check(await until(host, (c) => (document.getElementById('hud-net')?.textContent ?? '').includes(c), code, 5000), 'la pastille du HUD montre le code');
await sleep(1500);
const t0 = await host.evaluate(() => window.__EM.state.time);
await sleep(500);
check((await host.evaluate(() => window.__EM.state.time)) > t0, "en attendant l'ami, la partie de l'hôte avance");

// ---------------------------------------------------------------- l'invité rejoint par le lien
await guest.goto(`${base}&join=${code}`);
await guest.waitForSelector('[data-action="join"]');
check((await guest.textContent('.main-menu')).includes(code), "le lien d'invitation affiche le code");
await guest.screenshot({ path: `${SHOTS}coop-02-invitation.png` });
await guest.click('[data-action="join"]');
const both = async () => (await until(host, () => window.__EM.session?.status === 'playing', null, 20000)) && (await until(guest, () => window.__EM.session?.status === 'playing', null, 20000));
check(await both(), 'les deux appareils sont « en jeu »');
await sleep(1500);
const counts = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ n: window.__EM.state.playerCount, others: window.__EM.state.otherPlayers().length, local: window.__EM.state.local }))));
check(counts[0].n === 2 && counts[1].n === 2, 'deux joueurs dans la mine des deux côtés');
check(counts[0].local === 0 && counts[1].local === 1 && counts[0].others === 1 && counts[1].others === 1, "l'hôte est l'emplacement 0, l'invité le 1, chacun voit l'autre");
check((await guest.evaluate(() => document.querySelector('#hud-net')?.textContent ?? '')).includes('À deux'), "la pastille de l'invité indique « À deux »");
await host.screenshot({ path: `${SHOTS}coop-03-host.png` });
await guest.screenshot({ path: `${SHOTS}coop-04-guest.png` });

// Enregistre l'empreinte de chaque appareil à des numéros de pas précis (dans la génération en cours), pour les comparer ensuite.
const record = () =>
  Promise.all(
    [host, guest].map((p) =>
      p.evaluate(() => {
        const s = window.__EM.session;
        window.__rec = {};
        const hooks = s.ls.hooks;
        if (hooks.__wrapped) return;
        hooks.__wrapped = true;
        const orig = hooks.step;
        hooks.step = (intents) => {
          orig(intents);
          const t = s.ls.tick + 1;
          if (t % 10 === 0) window.__rec[`${s.ls.epoch}:${t}`] = window.__digest(window.__EM.state);
        };
      }),
    ),
  );
const compare = async (label) => {
  const [a, b] = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__rec)));
  const common = Object.keys(a).filter((k) => k in b);
  const bad = common.filter((k) => a[k] !== b[k]);
  check(common.length >= 3 && bad.length === 0, `${label} : ${common.length} pas comparés, ${bad.length} écart(s)`);
};

// ---------------------------------------------------------------- les deux jouent (vraies touches)
await record();
await host.keyboard.down('d');
await guest.keyboard.down('q'); // azerty ou non, on lit event.code : 'q' → KeyQ (inutilisé) ; l'invité marche avec 'a' ensuite
await sleep(100);
await guest.keyboard.up('q');
await guest.keyboard.down('a');
await sleep(1600);
await host.keyboard.up('d');
await guest.keyboard.up('a');
await sleep(800);
const pos = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__EM.state.withSlot(0, () => [Math.round(window.__EM.state.player.x), Math.round(window.__EM.state.player.y)]))));
const spawnX = await host.evaluate(() => window.__EM.state.layout.spawn.x * 16);
check(pos[0][0] > spawnX + 8, `l'hôte a marché vers la droite (x=${pos[0][0]})`);
await compare('après les déplacements');
const hostPos1 = await host.evaluate(() => window.__EM.state.withSlot(1, () => Math.round(window.__EM.state.player.x)));
const guestSelf = await guest.evaluate(() => Math.round(window.__EM.state.player.x));
check(Math.abs(hostPos1 - guestSelf) <= 1, `l'hôte voit l'invité là où il est vraiment (${hostPos1} / ${guestSelf})`);
check(guestSelf < spawnX + 16 - 8, "l'invité a marché vers la gauche");

// ---------------------------------------------------------------- actions personnelles et communes
await guest.evaluate(() => window.__EM.act({ k: 'togglePickup', res: 'coal' }));
await host.evaluate(() => window.__EM.act({ k: 'mark', kind: 'ore', x: 0, y: 0, here: true }));
await sleep(900);
const picks = await Promise.all([host, guest].map((p) => p.evaluate(() => [window.__EM.state.withSlot(0, () => window.__EM.state.autoPickup.coal), window.__EM.state.withSlot(1, () => window.__EM.state.autoPickup.coal), window.__EM.state.markers.list.length])));
check(picks[0][0] === true && picks[0][1] === false && picks[1][0] === true && picks[1][1] === false, "le ramassage de l'invité est à lui seul, vu pareil des deux côtés");
check(picks[0][2] === 1 && picks[1][2] === 1, "un repère posé par l'hôte apparaît chez les deux");

// ---------------------------------------------------------------- pause à deux : le jeu continue
await host.keyboard.press('Escape');
await sleep(300);
check(await host.evaluate(() => window.__EM.ui.menu === 'pause'), 'le menu pause s’ouvre');
const t1 = await host.evaluate(() => window.__EM.session.tick);
const g1 = await guest.evaluate(() => window.__EM.session.tick);
await sleep(700);
check((await host.evaluate(() => window.__EM.session.tick)) > t1 + 5, 'à deux, le menu pause ne fige pas la partie');
check((await host.textContent('.pause-menu')).includes(code), 'le menu pause rappelle le code');
await host.screenshot({ path: `${SHOTS}coop-05-pause.png` });
await host.keyboard.press('Escape');
await sleep(200);

// ---------------------------------------------------------------- coupure de réseau
await record();
const cut = (p, on) => p.evaluate((on) => {
  if (on) {
    window.__post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function () {};
  } else if (window.__post) BroadcastChannel.prototype.postMessage = window.__post;
}, on);
await cut(guest, true);
await sleep(2500);
check(await host.evaluate(() => !document.getElementById('net-stall').classList.contains('hidden')), "coupure : le bandeau « En attente de l'autre joueur » apparaît");
await host.screenshot({ path: `${SHOTS}coop-06-stall.png` });
await cut(guest, false);
check(await until(host, () => document.getElementById('net-stall').classList.contains('hidden'), null, 12000), 'le réseau revient : le bandeau disparaît et la partie reprend');
await sleep(1000);
await compare('après la coupure');
check((await status(host)) === 'playing' && (await status(guest)) === 'playing', 'toujours en jeu des deux côtés après la coupure');

// ---------------------------------------------------------------- divergence provoquée : resynchronisation
const adopts = () => guest.evaluate(() => window.__adopts ?? 0);
await guest.evaluate(() => {
  window.__adopts = 0;
  const g0 = window.__EM.state;
  window.__EM.session.o.adopt = ((orig) => (g) => {
    window.__adopts++;
    orig(g);
  })(window.__EM.session.o.adopt);
  g0.money += 4242;
});
check(await until(guest, () => window.__adopts > 0, null, 15000), 'une divergence est détectée : l’invité reçoit de nouveau la partie');
await sleep(2500);
const money = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__EM.state.money)));
check(money[0] === money[1], `après resynchronisation les deux ont le même argent (${money[0]})`);
check((await status(host)) === 'playing' && (await status(guest)) === 'playing', 'toujours en jeu des deux côtés après la resynchronisation');
await record();
await sleep(1500);
await compare('après la resynchronisation');

// ---------------------------------------------------------------- l'invité s'en va et revient : ses affaires lui sont rendues
await guest.keyboard.press('Escape');
await guest.waitForSelector('[data-action="netLeave"]');
await guest.screenshot({ path: `${SHOTS}coop-07-guest-pause.png` });
check(!(await guest.evaluate(() => !!document.querySelector('[data-action="save"]'))), "l'invité n'a pas de bouton « Sauvegarder »");
await guest.click('[data-action="netLeave"]');
check(await until(host, () => window.__EM.session?.status === 'waiting', null, 12000), "l'hôte repasse en attente quand l'invité part");
check(await host.evaluate(() => window.__EM.state.playerCount === 1), "l'invité n'est plus dans la mine de l'hôte");
const t2 = await host.evaluate(() => window.__EM.state.time);
await sleep(700);
check((await host.evaluate(() => window.__EM.state.time)) > t2, "l'hôte continue seul");
await guest.goto(`${base}&join=${code}`);
await guest.waitForSelector('[data-action="join"]');
await guest.click('[data-action="join"]');
check(await both(), "l'invité rejoint de nouveau");
await sleep(1200);
const back = await guest.evaluate(() => [window.__EM.state.autoPickup.coal, window.__EM.state.local]);
check(back[1] === 1 && back[0] === false, "ses réglages personnels lui sont rendus (ramassage du charbon coupé)");
await guest.screenshot({ path: `${SHOTS}coop-08-rejoined.png` });

// ---------------------------------------------------------------- l'hôte quitte : l'invité est prévenu
await host.keyboard.press('Escape');
await host.waitForSelector('[data-action="quit"]');
await host.click('[data-action="quit"]');
check(await until(guest, () => document.querySelector('.join-text.failed') !== null, null, 12000), "l'hôte quitte : l'invité voit un message de connexion perdue");
await guest.screenshot({ path: `${SHOTS}coop-09-host-left.png` });
check(await guest.evaluate(() => !!document.querySelector('[data-action="netRetry"]')), 'et peut réessayer');

check(errors.length === 0, `aucune erreur dans la console (${errors.length})`);
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
await browser.close();
await server?.close();
console.log(failures ? `\n${failures} vérification(s) en échec` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
