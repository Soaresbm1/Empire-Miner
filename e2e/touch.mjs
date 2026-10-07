/**
 * Commandes au doigt : de vrais gestes tactiles (CDP `Input.dispatchTouchEvent`, comme un doigt sur l'écran) sur le jeu ouvert
 * dans Chromium en émulation de téléphone. On vérifie que :
 *   - le stick déplace le mineur, et qu'il s'arrête quand le doigt se lève ;
 *   - « Miner » tient la touche tant qu'on appuie, et le stick et « Miner » marchent ensemble (deux doigts) ;
 *   - « Agir » ouvre l'Atelier à côté de l'Atelier ; le menu ☰ ouvre le sac ;
 *   - un bouton d'un panneau agit au relâchement, et PAS quand on fait défiler la liste en partant de ce bouton ;
 *   - fermer un panneau d'un toucher ne « clique » pas dans le monde derrière (pas de souris fantôme) ;
 *   - en construction, un toucher dans le monde pose la machine ;
 *   - sur iPhone (agent utilisateur Safari), « Plein écran… » mène à la marche à suivre et l'astuce n'est donnée qu'une fois.
 *
 *   npm run build && node e2e/touch.mjs [--quiet]
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4220, strictPort: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

let failures = 0;
let total = 0;
const problems = [];
const check = (cond, msg) => {
  total++;
  if (!cond) {
    failures++;
    problems.push(msg);
    console.log(`  ✘ ${msg}`);
  } else if (!args.quiet) console.log(`  ✔ ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/** Ouvre une page « téléphone » ; renvoie de quoi lancer des gestes (coordonnées en pixels CSS). */
async function phone({ w, h, safe = [0, 0, 0, 0], ua, query = '?debug&net=local' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safe[0], left: safe[1], bottom: safe[2], right: safe[3] } });
  await page.goto(`${url.replace(/\/$/, '')}/${query}`);
  await page.waitForSelector('#menu-root .btn', { timeout: 15000 });
  await page.waitForTimeout(400);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const g = {
    page,
    ctx,
    errors,
    /** Centre d'un élément. */
    async center(sel) {
      const r = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, sel);
      if (!r) throw new Error(`introuvable : ${sel}`);
      return r;
    },
    down: (...pts) => send('touchStart', pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1 }))),
    move: (...pts) => send('touchMove', pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1 }))),
    up: () => send('touchEnd', []),
    /** Un toucher bref. */
    async tap(p, hold = 70) {
      await g.down(p);
      await sleep(hold);
      await g.up();
      await sleep(60);
    },
    async tapSel(sel, hold) {
      await g.tap(await g.center(sel), hold);
    },
    /** Un doigt qui glisse de `a` à `b`. */
    async drag(a, b, steps = 10, pause = 16) {
      await g.down(a);
      for (let i = 1; i <= steps; i++) {
        await g.move({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
        await sleep(pause);
      }
      await g.up();
      await sleep(60);
    },
    E: (fn, arg) => page.evaluate(fn, arg),
  };
  return g;
}

/** Une partie neuve, le jeu lancé. */
async function newGame(t) {
  await t.E(() => window.__EM.newGame(7));
  await t.page.waitForTimeout(1000);
  await t.E(() => {
    window.__EM.debug = false;
  });
}

// ====================================================================================================== téléphone en travers
console.log('\n▶ iPhone en travers (874×402, plein écran) — gestes au doigt');
{
  const t = await phone({ w: 874, h: 402, safe: [0, 62, 21, 62] });
  await newGame(t);
  // Compte les clics de souris fantômes sur la page (un vrai doigt n'en laisse aucun si le bouton les empêche).
  await t.E(() => {
    window.__mouse = 0;
    window.addEventListener('mousedown', () => window.__mouse++, true);
    window.__actions = [];
    const E = window.__EM;
    const real = E.onAction.bind(E);
    E.onAction = (a, arg) => {
      window.__actions.push(a);
      return real(a, arg);
    };
  });

  // ---------------------------------------------------------------- stick
  const x0 = await t.E(() => window.__EM.state.player.x);
  const base = await t.center('.tc-base');
  await t.down(base);
  await sleep(50);
  await t.move({ x: base.x + 34, y: base.y });
  await sleep(500);
  const held = await t.E(() => ({ x: window.__EM.state.player.x, d: window.__EM.input.isDown('KeyD') }));
  check(held.d, 'stick poussé vers la droite : la touche D est tenue');
  check(held.x > x0 + 6, `le mineur avance vers la droite (${Math.round(held.x - x0)} px)`);
  await t.up();
  await sleep(150);
  const x1 = await t.E(() => window.__EM.state.player.x);
  await sleep(300);
  const x2 = await t.E(() => ({ x: window.__EM.state.player.x, d: window.__EM.input.isDown('KeyD') }));
  check(!x2.d, 'doigt levé : la touche D est relâchée');
  check(Math.abs(x2.x - x1) < 1, 'doigt levé : le mineur s\'arrête');

  // ---------------------------------------------------------------- Miner + stick ensemble
  const mine = await t.center('.tc-mine');
  await t.down(mine);
  await sleep(60);
  check(await t.E(() => window.__EM.input.isDown('Space')), '« Miner » appuyé : Espace est tenu');
  await t.up();
  await sleep(80);
  check(!(await t.E(() => window.__EM.input.isDown('Space'))), '« Miner » relâché : Espace est relâché');
  const b2 = await t.center('.tc-base');
  await t.down({ x: b2.x - 30, y: b2.y, id: 1 }, { x: mine.x, y: mine.y, id: 2 });
  await sleep(120);
  const both = await t.E(() => ({ a: window.__EM.input.isDown('KeyA'), s: window.__EM.input.isDown('Space') }));
  check(both.a && both.s, 'stick (gauche) et « Miner » tenus en même temps, avec deux doigts');
  await t.up();
  await sleep(120);
  const none = await t.E(() => ({ a: window.__EM.input.isDown('KeyA'), s: window.__EM.input.isDown('Space') }));
  check(!none.a && !none.s, 'deux doigts levés : plus rien n\'est tenu');

  // ---------------------------------------------------------------- Agir près de l'Atelier
  await t.E(() => {
    const E = window.__EM;
    const w = E.state.structures.list.find((s) => s.type === 'workshop');
    E.state.player.x = (w.x + w.w / 2) * 16;
    E.state.player.y = (w.y + w.h + 0.4) * 16;
    E.renderer.snapCamera();
  });
  await sleep(500);
  check(await t.E(() => document.querySelector('.tc-act').classList.contains('lit')), 'à côté de l\'Atelier, « Agir » s\'allume');
  await t.tapSel('.tc-act');
  await sleep(300);
  check((await t.E(() => window.__EM.ui.panel?.kind)) === 'workshop', '« Agir » ouvre l\'Atelier');

  // ---------------------------------------------------------------- fermer d'un toucher : pas de souris fantôme dans le monde
  const mouseBefore = await t.E(() => window.__mouse);
  await t.tapSel('#panel-root .panel .close');
  await sleep(350);
  check((await t.E(() => window.__EM.ui.panel)) === null, 'toucher sur ✕ : le panneau se ferme');
  check((await t.E(() => window.__mouse)) === mouseBefore, 'aucun clic de souris fantôme dans le monde après la fermeture');

  // ---------------------------------------------------------------- menu ☰ → Sac
  await t.tapSel('.tc-more');
  await sleep(200);
  check(await t.E(() => !document.querySelector('.tc-sheet').classList.contains('hidden')), '☰ ouvre la fenêtre des commandes');
  const sheetSac = await t.E(() => {
    const b = [...document.querySelectorAll('.tc-sheet .tc-btn')].find((x) => x.textContent.trim() === 'Sac');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await t.tap(sheetSac);
  await sleep(300);
  check((await t.E(() => window.__EM.ui.panel?.kind)) === 'inventory', '« Sac » du menu ☰ ouvre le sac');
  check(await t.E(() => document.querySelector('.tc-sheet').classList.contains('hidden')), 'le menu ☰ se referme après le choix');
  await t.tapSel('#panel-root .panel .close');
  await sleep(300);

  // ---------------------------------------------------------------- un bouton de panneau : action au relâchement
  await t.E(() => {
    const E = window.__EM;
    E.state.money = 100000;
    const w = E.state.structures.list.find((s) => s.type === 'workshop');
    E.state.player.x = (w.x + w.w / 2) * 16;
    E.state.player.y = (w.y + w.h + 0.4) * 16;
    E.ui.openPanel('workshop', w);
    E.ui.renderPanel(E.state, 0, true);
    window.__actions.length = 0;
  });
  await sleep(400);
  const tabSel = await t.E(() => {
    const el = [...document.querySelectorAll('#panel-root .tab[data-action]')].find((b) => !b.classList.contains('active'));
    if (!el) return null;
    el.setAttribute('data-test', 'tab');
    return `${el.dataset.action}:${el.dataset.arg}`;
  });
  check(!!tabSel, 'l\'Atelier a des onglets à toucher');
  const tabPt = await t.center('[data-test="tab"]');
  await t.down(tabPt);
  await sleep(120);
  check((await t.E(() => window.__actions.length)) === 0, 'doigt posé sur un onglet : rien ne se passe encore');
  await t.up();
  await sleep(200);
  check((await t.E(() => window.__actions.join(','))) === tabSel.split(':')[0], `doigt levé : l'onglet répond, une seule fois (${tabSel})`);

  // ---------------------------------------------------------------- faire défiler en partant d'un bouton : rien d'acheté
  await t.E(() => {
    window.__actions.length = 0;
    const E = window.__EM;
    E.ui.workshopTab = 'tools';
    E.ui.renderPanel(E.state, 0, true);
  });
  await sleep(400);
  const scrollInfo = await t.E(() => {
    const body = document.querySelector('#panel-root .panel-body');
    // Un bouton d'action dans la partie visible du corps du panneau (pas un onglet).
    const r = body.getBoundingClientRect();
    const btn = [...body.querySelectorAll('[data-action]')].find((b) => {
      const q = b.getBoundingClientRect();
      return q.height > 8 && q.top > r.top + 30 && q.bottom < r.bottom - 20;
    });
    if (btn) btn.setAttribute('data-test', 'scroll-start');
    return { scrollable: body.scrollHeight > body.clientHeight + 4, top: body.scrollTop, hasBtn: !!btn, action: btn?.dataset.action };
  });
  if (scrollInfo.hasBtn && scrollInfo.scrollable) {
    const from = await t.center('[data-test="scroll-start"]');
    await t.drag(from, { x: from.x, y: from.y - 140 }, 12, 20);
    await sleep(300);
    const after = await t.E(() => ({ top: document.querySelector('#panel-root .panel-body').scrollTop, actions: window.__actions.slice() }));
    check(after.actions.length === 0, `faire défiler en partant d'un bouton (${scrollInfo.action}) n'active rien (actions : ${after.actions.join(',') || 'aucune'})`);
    check(after.top > scrollInfo.top + 20, `la liste défile au doigt (${Math.round(scrollInfo.top)} → ${Math.round(after.top)} px)`);
  } else {
    check(false, `de quoi faire défiler dans l'Atelier (bouton : ${scrollInfo.hasBtn}, défilable : ${scrollInfo.scrollable})`);
  }
  // Même geste, mais en partant d'un vrai bouton d'achat plus bas dans la liste : rien n'est acheté.
  const findBuy = () =>
    t.E(() => {
      const body = document.querySelector('#panel-root .panel-body');
      // On descend jusqu'à ce qu'un bouton qui n'est pas un onglet soit bien visible.
      for (let y = 60; y < body.scrollHeight; y += 40) {
        body.scrollTop = y;
        const r = body.getBoundingClientRect();
        const btn = [...body.querySelectorAll('[data-action]:not(.tab)')].find((b) => {
          const q = b.getBoundingClientRect();
          return !b.disabled && q.height > 8 && q.top > r.top + 40 && q.bottom < r.bottom - 60;
        });
        if (btn) {
          document.querySelectorAll('[data-test="buy-start"]').forEach((x) => x.removeAttribute('data-test'));
          btn.setAttribute('data-test', 'buy-start');
          return { action: btn.dataset.action, arg: btn.dataset.arg ?? '', top: body.scrollTop, money: window.__EM.state.money };
        }
      }
      return null;
    });
  await t.E(() => {
    window.__actions.length = 0;
    document.querySelector('#panel-root .panel-body').scrollTop = 0;
  });
  const buy = await findBuy();
  if (buy) {
    await sleep(150);
    const from = await t.center('[data-test="buy-start"]');
    await t.drag(from, { x: from.x, y: from.y - 90 }, 10, 20);
    await sleep(300);
    const after = await t.E(() => ({ top: document.querySelector('#panel-root .panel-body').scrollTop, actions: window.__actions.slice(), money: window.__EM.state.money }));
    check(after.actions.length === 0 && after.money === buy.money, `faire défiler en partant d'un bouton d'achat (${buy.action}) n'achète rien (argent ${buy.money} → ${after.money})`);
    check(after.top > buy.top + 20, `la liste défile aussi depuis ce bouton (${Math.round(buy.top)} → ${Math.round(after.top)} px)`);
    // Et un simple toucher, lui, agit une fois.
    const buy2 = await findBuy();
    await sleep(150);
    await t.tapSel('[data-test="buy-start"]');
    await sleep(300);
    const acts = await t.E(() => window.__actions.slice());
    check(acts.length === 1 && acts[0] === buy2.action, `un simple toucher sur le même bouton l'active une fois (${acts.join(',') || 'rien'})`);
  } else {
    check(false, 'un bouton d\'achat est visible quelque part dans l\'Atelier');
  }
  await t.E(() => window.__EM.ui.closePanel());

  // ---------------------------------------------------------------- carte : pincer pour zoomer, glisser pour déplacer
  await t.E(() => {
    const E = window.__EM;
    E.map.resetView();
    E.ui.openPanel('map');
    E.ui.renderPanel(E.state, 0, true);
    window.__actions.length = 0;
  });
  await sleep(500);
  const mapC = await t.center('#map-canvas');
  check((await t.E(() => window.__EM.map.zoomCell)) === null, 'carte ouverte sur « tout voir »');
  await t.down({ x: mapC.x - 30, y: mapC.y, id: 1 }, { x: mapC.x + 30, y: mapC.y, id: 2 });
  for (let i = 1; i <= 10; i++) {
    await t.move({ x: mapC.x - 30 - i * 9, y: mapC.y, id: 1 }, { x: mapC.x + 30 + i * 9, y: mapC.y, id: 2 });
    await sleep(25);
  }
  await t.up();
  await sleep(250);
  const zoomed = await t.E(() => ({ z: window.__EM.map.zoomCell, acts: window.__actions.slice() }));
  check(zoomed.z !== null, 'deux doigts qui s\'écartent zooment la carte');
  check(!zoomed.acts.includes('mapClick'), 'pincer ne pose aucun repère');
  await t.down({ x: mapC.x - 120, y: mapC.y, id: 1 }, { x: mapC.x + 120, y: mapC.y, id: 2 });
  for (let i = 1; i <= 12; i++) {
    await t.move({ x: mapC.x - 120 + i * 9, y: mapC.y, id: 1 }, { x: mapC.x + 120 - i * 9, y: mapC.y, id: 2 });
    await sleep(25);
  }
  await t.up();
  await sleep(250);
  const z2 = await t.E(() => window.__EM.map.zoomCell);
  check(z2 === null || z2 < zoomed.z, 'deux doigts qui se rapprochent dézooment la carte');
  const hint = await t.E(() => document.querySelector('#panel-root .map-zoom .hint')?.textContent ?? '');
  check(/Pincer/.test(hint) && !/Molette/.test(hint), `la carte parle de pincer, pas de molette (« ${hint} »)`);
  const zoomBtn = await t.E(() => {
    const r = document.querySelector('.map-zoom .btn').getBoundingClientRect();
    return Math.min(r.width, r.height);
  });
  check(zoomBtn >= 34, `les boutons − et + de la carte ont une taille de doigt (${Math.round(zoomBtn)} px)`);
  await t.E(() => window.__EM.ui.closePanel());

  // ---------------------------------------------------------------- construction : un toucher dans le monde pose la machine
  const placed = await t.E(() => {
    const E = window.__EM;
    const g = E.state;
    g.player.x = 50.5 * 16;
    g.player.y = 8 * 16;
    E.renderer.snapCamera();
    g.inventory.addKit('storage', 2);
    E.setBuildMode(true);
    return g.structures.list.length;
  });
  await sleep(600);
  const kit = await t.E(() => {
    const el = document.querySelector('.bb-kit[data-arg="storage"]');
    if (!el) return null;
    el.setAttribute('data-test', 'kit');
    return true;
  });
  check(!!kit, 'la barre de construction montre le coffre');
  if (kit) {
    await t.tapSel('[data-test="kit"]');
    await sleep(300);
    check(await t.E(() => document.querySelector('.bb-kit.sel')?.dataset.arg === 'storage'), 'un toucher sur la tuile choisit le coffre');
    // Un point libre du monde, à gauche du mineur, à l'écran.
    const spot = await t.E(() => {
      const E = window.__EM;
      const g = E.state;
      const bar = document.getElementById('hud-build').getBoundingClientRect();
      const cam = E.renderer;
      // Toutes les cases autour du mineur : la première où l'on peut poser.
      for (let dx = -5; dx <= 5; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const tx = Math.floor(g.player.x / 16) + dx;
          const ty = Math.floor(g.player.y / 16) + dy;
          if (!g.canPlace('storage', tx, ty).ok) continue;
          const p = cam.worldToScreen ? cam.worldToScreen((tx + 0.5) * 16, (ty + 0.5) * 16) : null;
          if (p && p.y < bar.top - 10 && p.x > 120 && p.x < innerWidth - 220) return { x: p.x, y: p.y, tx, ty };
        }
      return null;
    });
    if (spot) {
      await t.tap({ x: spot.x, y: spot.y });
      await sleep(500);
      const now = await t.E(() => window.__EM.state.structures.list.length);
      check(now === placed + 1, `un toucher dans le monde pose le coffre (${placed} → ${now} machines)`);
    } else {
      console.log('  ℹ pas de point de pose à l\'écran : essai de pose au doigt ignoré (le monde n\'expose pas worldToScreen)');
    }
  }
  await t.E(() => window.__EM.setBuildMode(false));
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

// ====================================================================================================== iPhone (Safari) : plein écran
console.log('\n▶ iPhone (agent Safari) — « Plein écran… » et l\'astuce de l\'écran d\'accueil');
{
  const t = await phone({ w: 874, h: 402, safe: [0, 62, 21, 62], ua: IPHONE_UA });
  const label = await t.E(() => [...document.querySelectorAll('#menu-root .btn')].map((b) => b.textContent.trim()));
  check(label.includes('Plein écran…'), 'menu principal : le bouton « Plein écran… » est là sur iPhone');
  await t.tapSel('#menu-root [data-action="install"]');
  await sleep(300);
  check((await t.E(() => window.__EM.ui.panel?.kind)) === 'install', 'toucher : la marche à suivre s\'ouvre');
  const how = await t.E(() => document.querySelector('#panel-root .install')?.textContent ?? '');
  check(/Partager/.test(how) && /écran d.accueil/i.test(how), 'la marche à suivre parle de Partager et de « Sur l\'écran d\'accueil »');
  await t.E(() => window.__EM.ui.closePanel());
  // L'astuce ne sort qu'une fois.
  await t.E(() => localStorage.removeItem('empire-miner.homescreen-hint'));
  await t.E(() => window.__EM.newGame(7));
  await sleep(1400);
  const first = await t.E(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent));
  check(first.some((s) => /écran d.accueil/i.test(s)), `première partie : l'astuce de l'écran d'accueil s'affiche (${first.join(' | ') || 'aucun message'})`);
  check((await t.E(() => localStorage.getItem('empire-miner.homescreen-hint'))) === '1', 'l\'astuce est notée comme vue');
  await t.E(() => {
    document.getElementById('toasts').innerHTML = '';
    window.__EM.newGame(7);
  });
  await sleep(1400);
  const second = await t.E(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent));
  check(!second.some((s) => /écran d.accueil/i.test(s)), 'deuxième partie : plus d\'astuce');
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

// ====================================================================================================== Android : API plein écran
console.log('\n▶ Android — bouton « Plein écran » (API du navigateur)');
{
  const t = await phone({ w: 915, h: 412 });
  const label = await t.E(() => [...document.querySelectorAll('#menu-root .btn')].map((b) => b.textContent.trim()));
  check(label.includes('Plein écran'), 'menu principal : le bouton « Plein écran » est là hors iPhone');
  check(!label.includes('Plein écran…'), 'pas de marche à suivre hors iPhone');
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

await browser.close();
await server?.close();
console.log(failures ? `\n${failures} problème(s) sur ${total} vérifications :\n - ${problems.join('\n - ')}` : `\nTout est bon (${total} vérifications).`);
process.exit(failures ? 1 : 0);
