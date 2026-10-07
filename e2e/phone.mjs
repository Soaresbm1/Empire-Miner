/**
 * Mise en page sur téléphone : le jeu est ouvert dans Chromium avec l'émulation d'un écran tactile, à plusieurs tailles
 * d'écran (iPhone en travers avec ou sans les barres de Safari, plein écran, petit et grand téléphone, portrait, tablette),
 * avec les marges de sécurité de l'encoche. À chaque étape (menus, jeu, construction, panneaux), le test vérifie :
 *   - rien ne dépasse de l'écran ni de la zone sûre ;
 *   - les cadres du HUD et les boutons ne se recouvrent pas ;
 *   - les menus tiennent sans défilement (ou, pour les panneaux, défilent au doigt) ;
 *   - les boutons ont une taille de doigt.
 * Des captures sont enregistrées dans e2e/screenshots/phone/.
 *
 *   npm run build && node e2e/phone.mjs [--only=iphone-court] [--scene=game] [--quiet]
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('./screenshots/phone/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

/**
 * Écrans à essayer. `w` × `h` : la partie de l'écran que le navigateur laisse à la page (sans barres) ; `safe` : marges
 * de sécurité [haut, gauche, bas, droite] (encoche, barre d'accueil), comme `env(safe-area-inset-*)`.
 */
const DEVICES = [
  { id: 'iphone-court', label: 'iPhone en travers, Safari avec barre d’adresse et onglets', w: 874, h: 282, safe: [0, 62, 21, 62] },
  { id: 'iphone-safari', label: 'iPhone en travers, Safari', w: 874, h: 335, safe: [0, 62, 21, 62] },
  { id: 'iphone-plein', label: 'iPhone en travers, plein écran', w: 874, h: 402, safe: [0, 62, 21, 62] },
  { id: 'iphone-max', label: 'grand iPhone en travers, plein écran', w: 932, h: 430, safe: [0, 59, 21, 59] },
  { id: 'iphone-se', label: 'petit iPhone en travers', w: 667, h: 375, safe: [0, 0, 0, 0] },
  { id: 'android', label: 'Android en travers', w: 915, h: 412, safe: [0, 0, 0, 0] },
  { id: 'android-court', label: 'Android en travers, barres du navigateur', w: 740, h: 330, safe: [0, 0, 0, 0] },
  { id: 'portrait', label: 'iPhone debout, Safari', w: 393, h: 660, safe: [0, 0, 0, 0] },
  { id: 'portrait-plein', label: 'iPhone debout, plein écran', w: 402, h: 874, safe: [62, 0, 34, 0] },
  { id: 'portrait-se', label: 'petit iPhone debout', w: 375, h: 550, safe: [0, 0, 0, 0] },
  { id: 'ipad', label: 'iPad en travers', w: 1024, h: 768, safe: [0, 0, 0, 0] },
];

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4210, strictPort: false }, logLevel: 'silent' });
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

/** Mesures prises dans la page : rectangle de chaque élément visible dont on surveille la place. */
const MEASURE = () => {
  const R = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const shown = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const items = [];
  const add = (name, sel, kind, opts = {}) => {
    for (const el of document.querySelectorAll(sel)) {
      if (!shown(el)) continue;
      if (opts.nonEmpty && !el.textContent.trim() && !el.querySelector('canvas,img')) continue;
      items.push({ name: opts.name ? opts.name(el) : name, kind, ...R(el) });
    }
  };
  // Cadres du HUD
  add('statut', '.hud-left', 'hud');
  add('objectif', '#hud-objective', 'hud', { nonEmpty: true });
  add('mini-carte', '#minimap-box', 'hud');
  add('repère suivi', '#hud-track', 'hud', { nonEmpty: true });
  add('invite', '.prompt', 'hud', { nonEmpty: true });
  add('barre de construction', '#hud-build > *', 'hud', { nonEmpty: true });
  add('bandeau d’attente', '#net-stall', 'hud');
  // Boutons à l'écran
  add('stick', '.tc-base', 'ctl');
  add('barre rapide', '.tc-quick', 'ctl');
  add('Agir', '.tc-act', 'ctl');
  add('Miner', '.tc-mine', 'ctl');
  add('extras', '.tc-extra', 'ctl');
  add('construction', '.tc-build', 'ctl');
  add('menu ☰', '.tc-sheet', 'overlay');
  // Messages (passagers : on les mesure à part)
  add('message', '#toasts .toast', 'toast');
  const btns = [...document.querySelectorAll('.tc-btn, .tc-base, #ui .btn, #ui .sp, #ui .tab, .panel .close')].filter(shown).map((el) => ({ name: (el.textContent || el.className).trim().slice(0, 20), ...R(el) }));
  return { items, btns, w: innerWidth, h: innerHeight };
};

const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/** Vérifie une mesure : dans la zone sûre, sans recouvrement, taille de doigt, monde visible. */
function checkLayout(dev, scene, m, opts = {}) {
  const [st, sl, sb, sr] = dev.safe;
  const inside = (it) => it.l >= sl - 0.6 && it.r <= m.w - sr + 0.6 && it.t >= st - 0.6 && it.b <= m.h - sb + 0.6;
  const tag = `${dev.id} · ${scene}`;
  for (const it of m.items) {
    if (it.kind === 'toast') continue;
    if (!inside(it)) check(false, `${tag} : « ${it.name} » sort de la zone sûre (${Math.round(it.l)},${Math.round(it.t)} → ${Math.round(it.r)},${Math.round(it.b)} ; zone ${sl},${st} → ${m.w - sr},${m.h - sb})`);
  }
  const solid = m.items.filter((i) => i.kind !== 'toast' && i.kind !== 'overlay');
  let overlaps = 0;
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      const area = inter(a, b);
      if (area > 4) {
        overlaps++;
        check(false, `${tag} : « ${a.name} » et « ${b.name} » se recouvrent (${Math.round(area)} px²)`);
      }
    }
  if (!overlaps) check(true, `${tag} : aucun recouvrement (${solid.length} éléments)`);
  // Messages : ne doivent pas cacher le joueur (centre de l'écran) ni les boutons.
  for (const t of m.items.filter((i) => i.kind === 'toast')) {
    for (const c of solid.filter((i) => i.kind === 'ctl' || i.kind === 'hud')) {
      if (inter(t, c) > 4) check(false, `${tag} : un message recouvre « ${c.name} »`);
    }
  }
  if (!opts.noTouchSize) {
    const small = m.btns.filter((b) => Math.min(b.w, b.h) < 30);
    check(small.length === 0, `${tag} : boutons de taille de doigt${small.length ? ` — trop petits : ${small.map((b) => `${b.name} ${Math.round(b.w)}×${Math.round(b.h)}`).join(', ')}` : ''}`);
  }
  // Part de l'écran laissée au monde (hors cadres et boutons).
  const cells = 60;
  let free = 0;
  for (let x = 0; x < cells; x++)
    for (let y = 0; y < cells; y++) {
      const px = ((x + 0.5) / cells) * m.w;
      const py = ((y + 0.5) / cells) * m.h;
      if (!solid.some((i) => px >= i.l && px <= i.r && py >= i.t && py <= i.b)) free++;
    }
  const pct = Math.round((free / (cells * cells)) * 100);
  if (opts.minFree) check(pct >= opts.minFree, `${tag} : ${pct} % de l'écran reste au monde (au moins ${opts.minFree} %)`);
  return pct;
}

const shot = (page, dev, name) => page.screenshot({ path: `${SHOTS}${dev.id}-${name}.png` });

/** Un menu ou un panneau tient-il dans l'écran, sans défilement ? Sinon, peut-il défiler ? */
const MENU_FIT = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const root = document.querySelector('#menu-root');
  return {
    l: r.left, t: r.top, r: r.right, b: r.bottom,
    scroll: root ? root.scrollHeight - root.clientHeight : 0,
    w: innerWidth, h: innerHeight,
    btns: [...el.querySelectorAll('.btn, .join-input')].map((b) => { const q = b.getBoundingClientRect(); return { name: (b.textContent || b.id).trim().slice(0, 24), t: q.top, b: q.bottom, w: q.width, h: q.height, l: q.left, r: q.right }; }),
  };
};

function checkMenu(dev, scene, m) {
  const [st, sl, sb, sr] = dev.safe;
  const tag = `${dev.id} · ${scene}`;
  check(!!m, `${tag} : le menu est affiché`);
  if (!m) return;
  check(m.scroll <= 1, `${tag} : le menu tient sans défilement${m.scroll > 1 ? ` (dépasse de ${Math.round(m.scroll)} px)` : ''}`);
  const out = m.btns.filter((b) => b.t < st - 0.6 || b.b > m.h - sb + 0.6 || b.l < sl - 0.6 || b.r > m.w - sr + 0.6);
  check(out.length === 0, `${tag} : tous les boutons sont dans la zone sûre${out.length ? ` — dehors : ${out.map((b) => b.name).join(', ')}` : ''}`);
  const small = m.btns.filter((b) => b.h < 30);
  check(small.length === 0, `${tag} : boutons du menu de taille de doigt${small.length ? ` — trop petits : ${small.map((b) => `${b.name} ${Math.round(b.h)}`).join(', ')}` : ''}`);
}

/** Un panneau : dans l'écran, corps défilable. */
const PANEL_FIT = () => {
  const p = document.querySelector('#panel-root .panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const body = p.querySelector('.panel-body');
  const close = p.querySelector('.close');
  const cr = close?.getBoundingClientRect();
  return {
    l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight,
    bodyScrollable: body ? body.scrollHeight > body.clientHeight + 1 : false,
    bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
    close: cr ? { w: cr.width, h: cr.height, l: cr.left, t: cr.top, r: cr.right, b: cr.bottom } : null,
    bodyH: body ? body.clientHeight : 0,
  };
};

function checkPanel(dev, scene, m) {
  const [st, sl, sb, sr] = dev.safe;
  const tag = `${dev.id} · ${scene}`;
  check(!!m, `${tag} : le panneau est affiché`);
  if (!m) return;
  check(m.l >= sl - 0.6 && m.r <= m.w - sr + 0.6 && m.t >= st - 0.6 && m.b <= m.h - sb + 0.6, `${tag} : le panneau tient dans la zone sûre (${Math.round(m.l)},${Math.round(m.t)} → ${Math.round(m.r)},${Math.round(m.b)})`);
  check(!m.bodyScrollable || m.bodyOverflowY === 'auto' || m.bodyOverflowY === 'scroll', `${tag} : le contenu du panneau défile s'il est long`);
  check(m.bodyH >= Math.min(90, m.h * 0.3), `${tag} : le contenu garde de la place (${Math.round(m.bodyH)} px de haut)`);
  if (m.close) check(Math.min(m.close.w, m.close.h) >= 34, `${tag} : bouton de fermeture de taille de doigt (${Math.round(m.close.w)}×${Math.round(m.close.h)})`);
}

const only = args.only ? String(args.only).split(',') : null;
const scenes = args.scene ? String(args.scene).split(',') : null;
const want = (s) => !scenes || scenes.includes(s);

for (const dev of DEVICES) {
  if (only && !only.includes(dev.id)) continue;
  console.log(`\n▶ ${dev.id} — ${dev.label} (${dev.w}×${dev.h}, marges ${dev.safe.join('/')})`);
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  const [st, sl, sb, sr] = dev.safe;
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: st, left: sl, bottom: sb, right: sr } });
  await page.goto(`${url.replace(/\/$/, '')}/?debug&net=local`);
  await page.waitForSelector('#menu-root .btn', { timeout: 15000 });
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------- menus
  if (want('menu')) {
    await shot(page, dev, '01-menu');
    checkMenu(dev, 'menu principal', await page.evaluate(MENU_FIT, '#menu-root .menu'));
    await page.evaluate(() => window.__EM.onAction('play2', ''));
    await page.waitForTimeout(250);
    await shot(page, dev, '02-jouer-a-deux');
    checkMenu(dev, 'jouer à deux', await page.evaluate(MENU_FIT, '#menu-root .menu'));
  }

  // ---------------------------------------------------------------- partie
  await page.evaluate(() => window.__EM.newGame(7));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__EM.debug = false;
  });
  if (want('game')) {
    await shot(page, dev, '03-camp');
    checkLayout(dev, 'camp', await page.evaluate(MEASURE), { minFree: 60 });
  }

  // Le plus de choses possible dans le HUD : la pire mise en page.
  if (want('full')) {
    await page.evaluate(() => {
      const E = window.__EM;
      const g = E.state;
      g.money = 1234567;
      g.stats.autoSold = 500;
      g.hp = 40;
      g.inventory.add('coal', 6);
      g.inventory.add('copper', 3);
      g.hasJackhammer = true;
      g.tool = 'jackhammer';
      g.gear.add('helmet');
      g.gear.add('mask');
      g.stats.maxDepth = 80;
      // En bas de la puits, dans l'eau profonde (alerte de danger), avec un repère suivi.
      g.player.x = 50.5 * 16;
      g.player.y = (12 + 20) * 16;
      E.renderer.snapCamera();
      const mk = g.addMarker('ore', 52, 36);
      if (mk) g.markers.toggleTrack(mk.id);
      E.startHosting?.();
      const w = g.world;
      w.water[w.idx(50, 32)] = 220;
      E.ui.toast('Vendu 12 minerais pour 340 $.', 'good');
      E.ui.toast('Sac plein ! Vendez au comptoir ou videz-le dans un coffre.', 'warn');
    });
    await page.waitForTimeout(900);
    await shot(page, dev, '04-hud-plein');
    checkLayout(dev, 'HUD plein', await page.evaluate(MEASURE), { minFree: dev.id === 'portrait-se' ? 50 : 55 });
  }

  // ---------------------------------------------------------------- construction
  if (want('build')) {
    await page.evaluate(() => {
      const E = window.__EM;
      const g = E.state;
      g.inventory.addKit('conveyor', 30);
      g.inventory.addKit('drill', 3);
      g.inventory.addKit('storage', 2);
      g.inventory.addKit('furnace', 1);
      E.setBuildMode(true);
    });
    await page.waitForTimeout(700);
    await shot(page, dev, '05-construction');
    checkLayout(dev, 'construction', await page.evaluate(MEASURE), { minFree: 45 });
    await page.evaluate(() => window.__EM.setBuildMode(false));
    await page.waitForTimeout(200);
  }

  // ---------------------------------------------------------------- menu ☰
  if (want('sheet')) {
    await page.evaluate(() => {
      const E = window.__EM;
      E.state.player.x = 50.5 * 16;
      E.state.player.y = 8 * 16;
      E.renderer.snapCamera();
    });
    await page.waitForTimeout(500);
    const more = await page.$('.tc-more');
    if (more) {
      await more.tap();
      await page.waitForTimeout(250);
      await shot(page, dev, '06-menu-plus');
      checkLayout(dev, 'menu ☰', await page.evaluate(MEASURE), {});
      await more.tap();
    }
  }

  // ---------------------------------------------------------------- panneaux
  if (want('panels')) {
    const open = (kind, finder) =>
      page.evaluate(
        ([kind, finder]) => {
          const E = window.__EM;
          const g = E.state;
          const target = finder ? g.structures.list.find((s) => s.type === finder) ?? null : null;
          // Le jeu referme un panneau quand on s'éloigne de la machine : on se place à côté.
          if (target) {
            g.player.x = (target.x + target.w / 2) * 16;
            g.player.y = (target.y + target.h + 0.4) * 16;
            E.renderer.snapCamera();
          }
          E.ui.closePanel();
          E.ui.openPanel(kind, target);
          E.ui.renderPanel(g, 0, true);
        },
        [kind, finder],
      );
    for (const [i, [kind, finder, label]] of [
      ['inventory', null, 'sac'],
      ['map', null, 'carte'],
      ['help', null, 'aide'],
      ['workshop', 'workshop', 'atelier'],
      ['counter', 'counter', 'comptoir'],
      ['board', 'board', 'tableau'],
    ].entries()) {
      await open(kind, finder);
      await page.waitForTimeout(350);
      await shot(page, dev, `07-${String(i).padStart(2, '0')}-${label}`);
      checkPanel(dev, `panneau ${label}`, await page.evaluate(PANEL_FIT));
    }
    await page.evaluate(() => window.__EM.ui.closePanel());
  }

  // ---------------------------------------------------------------- menu pause
  if (want('pause')) {
    await page.evaluate(() => window.__EM.ui.showPauseMenu(false, 'medium', null));
    await page.waitForTimeout(250);
    await shot(page, dev, '08-pause');
    checkMenu(dev, 'menu pause', await page.evaluate(MENU_FIT, '#menu-root .menu'));
    await page.evaluate(() => window.__EM.ui.showPauseMenu(false, 'medium', { role: 'host', code: 'ABCDE', peer: 'Invité', playing: true }));
    await page.waitForTimeout(250);
    await shot(page, dev, '09-pause-deux');
    checkMenu(dev, 'menu pause à deux', await page.evaluate(MENU_FIT, '#menu-root .menu'));
  }

  check(errors.length === 0, `${dev.id} : aucune erreur dans la console${errors.length ? ` — ${errors[0]}` : ''}`);
  await ctx.close();
}

await browser.close();
await server?.close();
console.log(failures ? `\n${failures} problème(s) sur ${total} vérifications :\n - ${problems.join('\n - ')}` : `\nTout est bon (${total} vérifications).`);
process.exit(failures ? 1 : 0);
