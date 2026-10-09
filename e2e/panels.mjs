/**
 * Fenêtres (Atelier, Tableau d'affichage, Comptoir, Sac…) au doigt, sur un jeu qui TOURNE.
 *
 * Les revenus, les ouvriers et les cours changent ce que montre une fenêtre plusieurs fois par seconde. Quand chaque
 * changement refaisait tout le panneau, le doigt perdait l'élément qu'il tenait : la liste ne défilait plus (0 à 33 px au
 * lieu de 130) et la fenêtre paraissait figée. `touch.mjs` ne le voyait pas : son jeu est immobile, le panneau n'y change pas.
 *
 *   - `morph` (src/ui/morph.ts), dans un vrai navigateur : même résultat que `innerHTML`, mais les éléments qui restent sont
 *     les mêmes (SVG, tableaux, boutons, canevas compris), sur des milliers de paires de contenus tirées au hasard ;
 *   - l'Atelier et le Tableau d'affichage pendant que l'argent et le marché varient : le cadre et la liste ne sont pas
 *     recréés, la liste défile au doigt de bout en bout, un toucher long agit une fois, faire défiler depuis un bouton
 *     n'achète rien, un bouton qui change de sens sous le doigt agit comme au moment où on l'a touché ;
 *   - chaque fenêtre montre exactement ce qu'elle doit après des mises à jour sur place ;
 *   - la barre de construction : sa bande de machines garde son défilement quand le stock change.
 *
 *   npm run build && node e2e/panels.mjs [--quiet]
 *
 * Variables : CHROME_PATH (exécutable Chromium), E2E_URL (sinon lance `vite preview`).
 */
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

let server = null;
let url = process.env.E2E_URL;
if (!url) {
  server = await preview({ preview: { port: 4240, strictPort: false }, logLevel: 'silent' });
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

// ====================================================================================================== morph, dans un vrai navigateur
console.log('\n▶ morph : même résultat que innerHTML, mêmes éléments conservés (Chromium)');
{
  // Le module est servi tel quel (TypeScript compris) par le serveur de développement de Vite.
  const dev = await createServer({ logLevel: 'silent', server: { port: 4241, strictPort: false } });
  await dev.listen();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${dev.resolvedUrls.local[0]}manifest.webmanifest`);
  const r = await page.evaluate(async () => {
    const { morph } = await import('/src/ui/morph.ts');
    const GIFS = ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'];
    const WORDS = ['mine', 'or', 'cuivre', '12,5 kg', 'é&amp;à', '&lt;b&gt;', 'x', 'Acheter', '1 000 €'];
    const out = { pairs: 0, same: 0, kept: 0, keptPairs: 0, bad: [] };

    const lcg = (seed) => {
      let s = seed >>> 0;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    };
    /** Un contenu aléatoire : la structure vient de `ss`, les textes et les valeurs d'attributs de `vs`. */
    function gen(ss, vs) {
      const S = lcg(ss);
      const V = lcg(vs);
      const pick = (R, a) => a[Math.floor(R() * a.length)];
      const text = () => pick(V, WORDS);
      const attrs = (extra = '') => {
        let a = '';
        if (S() < 0.7) a += ` class="${pick(V, ['a', 'b c', 'btn on', 'tab active'])}"`;
        if (S() < 0.3) a += ` title="${pick(V, WORDS).replace(/"/g, '')}"`;
        if (S() < 0.3) a += ` data-action="${pick(V, ['buy', 'tab', 'sell'])}" data-arg="${pick(V, ['x', 'y', '1:2'])}"`;
        if (S() < 0.15) a += ` style="color:${pick(V, ['red', 'blue'])}"`;
        return a + extra;
      };
      const inline = (d) => {
        const n = Math.floor(S() * 4);
        let h = '';
        for (let i = 0; i < n; i++) {
          const k = S();
          if (k < 0.4) h += text();
          else if (k < 0.55) h += `<span${attrs()}>${d > 0 ? inline(d - 1) : text()}</span>`;
          else if (k < 0.65) h += `<b${attrs()}>${text()}</b>`;
          else if (k < 0.8) h += `<button${attrs(S() < 0.4 ? ' disabled' : '')}>${text()}</button>`;
          else if (k < 0.9) h += `<img src="${pick(V, GIFS)}" alt=""${attrs()}>`;
          else h += `<!--${text().replace(/&/g, '')}-->`;
        }
        return h;
      };
      const block = (d) => {
        const n = 1 + Math.floor(S() * 4);
        let h = '';
        for (let i = 0; i < n; i++) {
          const k = S();
          if (S() < 0.3) h += '\n  ';
          if (k < 0.35) h += `<div${attrs()}>${d > 0 ? block(d - 1) : inline(0)}</div>`;
          else if (k < 0.5) h += `<p${attrs()}>${inline(1)}</p>`;
          else if (k < 0.62) h += `<ul${attrs()}>${'<li>' + inline(0) + '</li>'.repeat(1)}${S() < 0.5 ? '<li>' + text() + '</li>' : ''}</ul>`;
          else if (k < 0.78) {
            const rows = 1 + Math.floor(S() * 3);
            h += `<table class="table"><thead><tr><th>${text()}</th></tr></thead><tbody>${Array.from({ length: rows }, () => `<tr${attrs()}><td${attrs()}>${inline(0)}</td><td class="num">${text()}</td></tr>`).join('')}</tbody></table>`;
          } else if (k < 0.9) {
            const pts = Array.from({ length: 2 + Math.floor(V() * 4) }, (_, j) => `${j * 10},${Math.floor(V() * 30)}`).join(' ');
            h += `<svg class="spark ${pick(V, ['up', 'down'])}" viewBox="0 0 168 38" width="168" height="38"><line class="base" x1="0" x2="168" y1="19" y2="19"/><polyline points="${pts}"/>${S() < 0.5 ? '<circle cx="5" cy="5" r="2.5"/>' : ''}</svg>`;
          } else h += `<canvas${attrs()}></canvas>`;
        }
        return h;
      };
      return block(3);
    }

    const tpl = (html) => {
      const t = document.createElement('div');
      t.innerHTML = html;
      return t;
    };
    const all = (c) => [...c.querySelectorAll('*')];
    for (let i = 1; i <= 1500; i++) {
      const structA = i * 7919;
      const sameStructure = i % 2 === 0;
      const A = gen(structA, i * 31);
      const B = sameStructure ? gen(structA, i * 31 + 17) : gen(structA + 104729, i * 31 + 17);
      const c = document.createElement('div');
      try {
        morph(c, A);
        let ok = c.isEqualNode(tpl(A));
        const before = all(c);
        morph(c, B);
        const after = all(c);
        ok = ok && c.isEqualNode(tpl(B));
        out.pairs++;
        if (ok) out.same++;
        else if (out.bad.length < 3) out.bad.push({ i, A, B, got: c.innerHTML });
        if (sameStructure) {
          out.keptPairs++;
          if (before.length === after.length && before.every((e, k) => e === after[k])) out.kept++;
          else if (out.bad.length < 3) out.bad.push({ i, kept: false, A, B });
        }
      } catch (e) {
        out.bad.push({ i, error: String(e), A, B });
      }
    }

    // Cas ciblés.
    const one = {};
    {
      const c = document.createElement('div');
      document.body.append(c);
      morph(c, '<canvas id="k" title="a"></canvas><button disabled data-arg="1">x</button>');
      const cv = c.querySelector('canvas');
      // Le jeu règle lui-même la taille de la carte, à chaque image, puis la dessine.
      cv.width = 4;
      cv.height = 4;
      cv.getContext('2d').fillRect(0, 0, 4, 4);
      const btn = c.querySelector('button');
      morph(c, '<canvas id="k" title="b"></canvas><button data-arg="2">x</button>');
      one.canvasSame = c.querySelector('canvas') === cv && cv.getAttribute('title') === 'b';
      one.canvasKeepsPixels = cv.width === 4 && cv.height === 4 && cv.getContext('2d').getImageData(1, 1, 1, 1).data[3] === 255;
      one.buttonSame = c.querySelector('button') === btn && btn.disabled === false && btn.dataset.arg === '2';
      // SVG : même élément, nouveau tracé, toujours dans l'espace de noms SVG.
      morph(c, '<svg viewBox="0 0 10 10"><polyline points="0,0 1,1"/></svg>');
      const svg = c.querySelector('svg');
      const line = c.querySelector('polyline');
      morph(c, '<svg viewBox="0 0 10 10"><polyline points="0,0 5,9"/></svg>');
      one.svgSame = c.querySelector('svg') === svg && c.querySelector('polyline') === line && line.getAttribute('points') === '0,0 5,9' && line.namespaceURI === 'http://www.w3.org/2000/svg';
      // Une liste qui raccourcit puis s'allonge.
      morph(c, '<ul><li>a</li><li>b</li><li>c</li></ul>');
      const li0 = c.querySelector('li');
      morph(c, '<ul><li>z</li></ul>');
      one.listShrinks = c.querySelectorAll('li').length === 1 && c.querySelector('li') === li0 && li0.textContent === 'z';
      morph(c, '<ul><li>1</li><li>2</li></ul>');
      one.listGrows = c.querySelectorAll('li').length === 2 && c.querySelector('li') === li0;
      // Vider.
      morph(c, '');
      one.empty = c.childNodes.length === 0;
      c.remove();
    }
    return { out, one };
  });
  check(r.out.pairs === 1500 && r.out.same === r.out.pairs, `morph donne exactement le contenu de innerHTML (${r.out.same} / ${r.out.pairs} paires aléatoires)`);
  check(r.out.keptPairs > 0 && r.out.kept === r.out.keptPairs, `à structure égale, tous les éléments sont conservés (${r.out.kept} / ${r.out.keptPairs} paires)`);
  if (r.out.bad.length) console.log('    premier écart :', JSON.stringify(r.out.bad[0]).slice(0, 700));
  check(r.one.canvasSame && r.one.canvasKeepsPixels, 'un canevas n\'est ni recréé ni effacé, et la taille que le jeu lui a donnée est respectée');
  check(r.one.buttonSame, 'un bouton garde son identité ; « disabled » et data-arg suivent');
  check(r.one.svgSame, 'une courbe SVG garde ses éléments, le nouveau tracé et son espace de noms');
  check(r.one.listShrinks && r.one.listGrows, 'une liste qui raccourcit puis s\'allonge garde ses premiers éléments');
  check(r.one.empty, 'un contenu vide vide l\'élément');
  check(errors.length === 0, `aucune erreur${errors.length ? ` — ${errors[0]}` : ''}`);
  await ctx.close();
  await dev.close();
}

// ====================================================================================================== le jeu, au doigt
/** Ouvre une page « téléphone » ; renvoie de quoi lancer des gestes (coordonnées en pixels CSS). */
async function phone({ w, h, safe = [0, 0, 0, 0] }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safe[0], left: safe[1], bottom: safe[2], right: safe[3] } });
  await page.goto(`${url.replace(/\/$/, '')}/?debug&net=local`);
  await page.waitForSelector('#menu-root .btn', { timeout: 15000 });
  await page.waitForTimeout(400);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const t = {
    page,
    ctx,
    errors,
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
    down: (p) => send('touchStart', [{ x: p.x, y: p.y, id: 1 }]),
    move: (p) => send('touchMove', [{ x: p.x, y: p.y, id: 1 }]),
    up: () => send('touchEnd', []),
    async tap(p, hold = 70) {
      await t.down(p);
      await sleep(hold);
      await t.up();
      await sleep(80);
    },
    async drag(a, b, steps = 12, pause = 20) {
      await t.down(a);
      for (let i = 1; i <= steps; i++) {
        await t.move({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
        await sleep(pause);
      }
      await t.up();
      await sleep(500);
    },
    E: (fn, arg) => page.evaluate(fn, arg),
  };
  return t;
}

/** Une partie neuve ; les actions de l'interface sont notées dans `window.__acts`. */
async function newGame(t) {
  await t.E(() => window.__EM.newGame(7));
  await t.page.waitForTimeout(1000);
  await t.E(() => {
    const E = window.__EM;
    E.debug = false;
    window.__acts = [];
    const real = E.onAction.bind(E);
    E.onAction = (a, arg) => {
      window.__acts.push(`${a}:${arg}`);
      return real(a, arg);
    };
    // Un jeu vivant : l'argent monte (revenus), le cours d'un minerai bouge, le sac se remplit.
    const g = E.state;
    window.__n = 0;
    const m = g.market;
    const price = m.price.bind(m);
    const history = m.history.bind(m);
    m.price = (r) => price(r) * (1 + (window.__n % 9) / 100);
    m.history = (r) => history(r).map((v, i, a) => (i === a.length - 1 ? v * (1 + (window.__n % 9) / 50) : v));
    window.__churn = null;
    window.__setChurn = (on) => {
      clearInterval(window.__churn);
      if (on) {
        window.__churn = setInterval(() => {
          window.__n++;
          g.money += 3;
          g.inventory.items.coal = 1 + (window.__n % 5);
        }, 80);
      }
    };
    // Tous les minerais sont connus : le marché a de quoi défiler.
    for (const id of ['coal', 'copper', 'iron', 'silver', 'gold', 'diamond']) if (!g.stats.discovered.includes(id)) g.stats.discovered.push(id);
    g.money = 100000;
  });
}

/** Ouvre la fenêtre `kind` près de sa structure ; renvoie la liste des onglets. */
async function open(t, kind, tab) {
  await t.E(
    ([k, tb]) => {
      const E = window.__EM;
      const s = E.state.structures.list.find((x) => x.type === k);
      if (s) {
        E.state.player.x = (s.x + s.w / 2) * 16;
        E.state.player.y = (s.y + s.h + 0.4) * 16;
      }
      if (k === 'workshop') E.ui.workshopTab = tb ?? 'tools';
      if (k === 'board') E.ui.boardTab = tb ?? 'market';
      E.ui.openPanel(k, s ?? null, tb);
      E.ui.renderPanel(E.state, 0, true);
    },
    [kind === 'counter' || kind === 'workshop' || kind === 'board' ? kind : kind, tab],
  );
  await sleep(350);
  return t.E(() => [...document.querySelectorAll('#panel-root .tab[data-arg]')].map((b) => b.dataset.arg));
}

/** Centre de l'élément repéré dans `window.__el` (une référence : un attribut serait retiré par la mise à jour suivante). */
const centerOfMarked = (t) =>
  t.E(() => {
    const b = window.__el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });

/** Le panneau affiché est-il exactement ce que le jeu a produit ? (`panelSig` = « type|contenu ».) */
const same = (t) =>
  t.E(() => {
    const sig = window.__EM.ui.panelSig;
    const frame = document.querySelector('#panel-root .panel');
    if (!sig || !frame) return false;
    const expected = frame.cloneNode(false);
    expected.innerHTML = sig.slice(sig.indexOf('|') + 1);
    // La taille d'un canevas est réglée par le jeu (la carte), pas par le HTML.
    const live = frame.cloneNode(true);
    for (const c of live.querySelectorAll('canvas')) {
      c.removeAttribute('width');
      c.removeAttribute('height');
    }
    return live.isEqualNode(expected);
  });

console.log('\n▶ Atelier sur un jeu qui tourne (iPhone en travers, 874×402)');
{
  const t = await phone({ w: 874, h: 402, safe: [0, 62, 21, 62] });
  await newGame(t);
  await open(t, 'workshop', 'tools');
  await t.E(() => {
    window.__setChurn(true);
    window.__frame = document.querySelector('#panel-root .panel');
    window.__body = document.querySelector('#panel-root .panel-body');
    window.__money0 = document.querySelector('#panel-root .panel-money').textContent;
  });
  await sleep(1500);
  const kept = await t.E(() => ({
    frame: document.querySelector('#panel-root .panel') === window.__frame,
    body: document.querySelector('#panel-root .panel-body') === window.__body,
    moved: document.querySelector('#panel-root .panel-money').textContent !== window.__money0,
  }));
  check(kept.moved, 'l\'argent affiché dans l\'Atelier change pendant que le jeu tourne');
  check(kept.frame && kept.body, 'le cadre et la liste de l\'Atelier ne sont pas recréés par ces mises à jour');
  check(await same(t), 'l\'Atelier affiche exactement ce que le jeu a produit');

  // ---------------------------------------------------------------- défilement au doigt, de bout en bout
  const info = await t.E(() => {
    const b = document.querySelector('#panel-root .panel-body');
    return { sh: b.scrollHeight, ch: b.clientHeight };
  });
  check(info.sh > info.ch + 150, `la liste de l'Atelier déborde de quoi défiler (${info.sh} / ${info.ch} px)`);
  const start = await t.center('#panel-root .panel-body');
  const reached = [];
  for (let k = 0; k < 5; k++) {
    await t.E(() => (document.querySelector('#panel-root .panel-body').scrollTop = 0));
    await sleep(120);
    await t.drag({ x: start.x, y: start.y + 60 }, { x: start.x, y: start.y + 60 - 144 });
    reached.push(await t.E(() => Math.round(document.querySelector('#panel-root .panel-body').scrollTop)));
  }
  check(reached.every((v) => v >= 100), `un glissé de 144 px fait défiler la liste à chaque essai, argent en mouvement (${reached.join(', ')} px)`);
  check(await t.E(() => document.querySelector('#panel-root .panel-body') === window.__body), 'la liste est restée la même pendant les glissés');

  // ---------------------------------------------------------------- toucher long sur un onglet : une seule action, la bonne
  const tabArg = await t.E(() => {
    const el = [...document.querySelectorAll('#panel-root .tab[data-action]')].find((b) => !b.classList.contains('active'));
    window.__el = el;
    return el.dataset.arg;
  });
  await t.E(() => (window.__acts.length = 0));
  await t.tap(await centerOfMarked(t), 380);
  await sleep(250);
  const acts = await t.E(() => window.__acts.slice());
  check(acts.length === 1 && acts[0] === `tab:${tabArg}`, `un toucher de 380 ms sur un onglet, pendant les mises à jour, agit une seule fois (${acts.join(',') || 'rien'})`);
  await t.E(() => {
    window.__EM.ui.setTab('tools');
    window.__EM.ui.renderPanel(window.__EM.state, 0, true);
  });
  await sleep(300);

  // ---------------------------------------------------------------- un bouton qui change de sens sous le doigt : l'action est celle du toucher
  // Le jeu est calme pour ce test (sinon la mise à jour suivante remettrait le sens d'origine avant le relâchement).
  await t.E(() => window.__setChurn(false));
  await sleep(300);
  const swap = await t.E(() => {
    const el = [...document.querySelectorAll('#panel-root .tab[data-action]')].find((b) => !b.classList.contains('active'));
    window.__el = el;
    return el.dataset.arg;
  });
  await t.E(() => (window.__acts.length = 0));
  await t.down(await centerOfMarked(t));
  await sleep(150);
  await t.E(() => {
    // Le panneau s'est mis à jour : ce même bouton a maintenant un autre sens.
    window.__el.dataset.arg = 'equipment';
  });
  await sleep(100);
  await t.up();
  await sleep(250);
  const swapped = await t.E(() => window.__acts.slice());
  check(swapped.length === 1 && swapped[0] === `tab:${swap}`, `le bouton a changé de sens avant le relâchement : l'action est celle du toucher (${swapped.join(',') || 'rien'}, attendu tab:${swap})`);
  await t.E(() => {
    window.__EM.ui.setTab('tools');
    window.__EM.ui.renderPanel(window.__EM.state, 0, true);
    window.__setChurn(true);
  });
  await sleep(300);

  // ---------------------------------------------------------------- faire défiler depuis un bouton d'achat n'achète rien
  const buyAt = await t.E(() => {
    const body = document.querySelector('#panel-root .panel-body');
    body.scrollTop = 0;
    for (let y = 0; y < body.scrollHeight; y += 30) {
      body.scrollTop = y;
      const r = body.getBoundingClientRect();
      const btn = [...body.querySelectorAll('[data-action]:not(.tab)')].find((b) => {
        const q = b.getBoundingClientRect();
        return !b.disabled && q.height > 8 && q.top > r.top + 40 && q.bottom < r.bottom - 70;
      });
      if (btn) {
        window.__el = btn;
        return { action: btn.dataset.action, top: body.scrollTop };
      }
    }
    return null;
  });
  check(!!buyAt, 'un bouton d\'achat est visible dans l\'Atelier');
  if (buyAt) {
    await t.E(() => (window.__acts.length = 0));
    await sleep(150);
    const from = await centerOfMarked(t);
    await t.drag(from, { x: from.x, y: from.y - 90 }, 10, 20);
    const after = await t.E(() => ({ acts: window.__acts.slice(), top: document.querySelector('#panel-root .panel-body').scrollTop }));
    check(after.acts.length === 0, `faire défiler depuis « ${buyAt.action} » n'active rien, argent en mouvement (${after.acts.join(',') || 'rien'})`);
    check(after.top > buyAt.top + 20, `la liste défile aussi depuis ce bouton (${Math.round(buyAt.top)} → ${Math.round(after.top)} px)`);
  }

  // ---------------------------------------------------------------- tous les onglets de l'Atelier
  const tabs = await t.E(() => [...document.querySelectorAll('#panel-root .tab[data-arg]')].map((b) => b.dataset.arg));
  let bad = [];
  const notTop = [];
  for (const tab of tabs) {
    // On est descendu dans la liste : changer d'onglet remonte en haut.
    await t.E(() => (document.querySelector('#panel-root .panel-body').scrollTop = 60));
    await t.E((x) => {
      window.__EM.ui.setTab(x);
      window.__EM.ui.renderPanel(window.__EM.state, 0, true);
    }, tab);
    await sleep(500);
    if (!(await same(t))) bad.push(tab);
    if ((await t.E(() => document.querySelector('#panel-root .panel-body').scrollTop)) !== 0) notTop.push(tab);
  }
  check(tabs.length >= 3 && bad.length === 0, `chaque onglet de l'Atelier (${tabs.join(', ')}) affiche exactement ce que le jeu a produit${bad.length ? ` — écart : ${bad.join(', ')}` : ''}`);
  check(notTop.length === 0, `changer d'onglet remonte en haut de la liste${notTop.length ? ` — pas remonté : ${notTop.join(', ')}` : ''}`);

  // ---------------------------------------------------------------- fermer puis rouvrir : un cadre neuf, son animation d'ouverture, le bon contenu
  const reopened = await t.E(() => {
    const E = window.__EM;
    const before = document.querySelector('#panel-root .panel');
    const target = E.ui.panel.target;
    E.ui.closePanel();
    const closed = document.querySelector('#panel-root .panel') === null;
    E.ui.openPanel('workshop', target);
    E.ui.renderPanel(E.state, 0, true);
    const now = document.querySelector('#panel-root .panel');
    return { closed, fresh: !!now && now !== before, pop: !!now && now.classList.contains('pop') };
  });
  await sleep(400);
  check(reopened.closed && reopened.fresh && reopened.pop, 'fermée puis rouverte, la fenêtre a un cadre neuf et rejoue son animation d\'ouverture');
  const replay = await t.E(() => {
    const E = window.__EM;
    const f = document.querySelector('#panel-root .panel');
    const before = f.getAnimations().length;
    E.state.money += 12345;
    E.ui.renderPanel(E.state, 0, true);
    const g = document.querySelector('#panel-root .panel');
    return { same: g === f, before, after: g.getAnimations().length };
  });
  check(replay.same && replay.before === 0 && replay.after === 0, `l'animation d'ouverture ne rejoue pas à chaque mise à jour (même cadre : ${replay.same}, animations en cours : ${replay.after})`);
  check(await same(t), 'la fenêtre rouverte affiche exactement ce que le jeu a produit');
  await t.E(() => window.__setChurn(false));
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

console.log('\n▶ Tableau d\'affichage et autres fenêtres sur un jeu qui tourne (iPhone en travers, 874×402)');
{
  const t = await phone({ w: 874, h: 402, safe: [0, 62, 21, 62] });
  await newGame(t);
  const tabs = await open(t, 'board', 'market');
  check(tabs.length >= 2, `le Tableau d'affichage a des onglets (${tabs.join(', ')})`);
  await t.E(() => {
    window.__setChurn(true);
    window.__body = document.querySelector('#panel-root .panel-body');
    window.__svg = document.querySelector('#panel-root svg.spark');
    window.__svgHtml = document.querySelector('#panel-root svg.spark').outerHTML;
  });
  await sleep(1200);
  const live = await t.E(() => ({
    body: document.querySelector('#panel-root .panel-body') === window.__body,
    svg: document.querySelector('#panel-root svg.spark') === window.__svg,
    moved: document.querySelector('#panel-root svg.spark').outerHTML !== window.__svgHtml,
  }));
  check(live.moved, 'les courbes du marché changent pendant que le jeu tourne');
  check(live.body && live.svg, 'la liste et les courbes du marché sont mises à jour sur place');
  check(await same(t), 'le marché affiche exactement ce que le jeu a produit');
  const info = await t.E(() => {
    const b = document.querySelector('#panel-root .panel-body');
    return { sh: b.scrollHeight, ch: b.clientHeight };
  });
  check(info.sh > info.ch + 100, `le marché déborde de quoi défiler (${info.sh} / ${info.ch} px)`);
  const start = await t.center('#panel-root .panel-body');
  const reached = [];
  for (let k = 0; k < 4; k++) {
    await t.E(() => (document.querySelector('#panel-root .panel-body').scrollTop = 0));
    await sleep(120);
    await t.drag({ x: start.x, y: start.y + 60 }, { x: start.x, y: start.y + 60 - 144 });
    reached.push(await t.E(() => Math.round(document.querySelector('#panel-root .panel-body').scrollTop)));
  }
  check(reached.every((v) => v >= 100), `le marché défile au doigt à chaque essai, cours en mouvement (${reached.join(', ')} px)`);

  // Chaque fenêtre, chacun de ses onglets : exactement le contenu produit, après des mises à jour sur place.
  const kinds = [
    ['board', 'production'],
    ['board', 'market'],
    ['counter', undefined],
    ['inventory', undefined],
    ['help', undefined],
    ['map', undefined],
  ];
  for (const [kind, tab] of kinds) {
    await open(t, kind, tab);
    await sleep(700);
    check(await same(t), `${kind}${tab ? ` (${tab})` : ''} : le contenu est exactement celui que le jeu a produit`);
  }
  await t.E(() => window.__setChurn(false));
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

console.log('\n▶ Barre de construction (iPhone SE en travers, 568×320)');
{
  const t = await phone({ w: 568, h: 320, safe: [0, 0, 0, 0] });
  await newGame(t);
  await t.E(() => {
    const E = window.__EM;
    for (const id of ['conveyor', 'conveyor_fast', 'conveyor_express', 'splitter', 'sorter', 'bridge', 'drill', 'storage', 'rail', 'wagon']) {
      try {
        E.state.inventory.addKit(id, 3);
      } catch {
        /* machine inconnue : ignorée */
      }
    }
    E.setBuildMode(true);
  });
  await sleep(500);
  // La catégorie qui a le plus de tuiles.
  let best = null;
  for (const arg of await t.E(() => [...document.querySelectorAll('.bb-tab')].map((x) => x.dataset.arg))) {
    await t.E((a) => window.__EM.onAction('buildCat', a), arg);
    await sleep(250);
    const n = await t.E(() => document.querySelectorAll('.bb-kit').length);
    if (!best || n > best.n) best = { arg, n };
  }
  await t.E((a) => window.__EM.onAction('buildCat', a), best.arg);
  await sleep(300);
  const strip = await t.E(() => {
    const k = document.querySelector('.bb-kits');
    return { sw: k.scrollWidth, cw: k.clientWidth, tiles: document.querySelectorAll('.bb-kit').length };
  });
  check(strip.sw > strip.cw + 40, `la bande des machines déborde de quoi défiler (${strip.sw} / ${strip.cw} px, ${strip.tiles} tuiles)`);
  // Le stock d'une machine de la bande change sans cesse (ouvriers, ventes) : le texte `×N` de la bande est refait.
  const kitId = await t.E(() => document.querySelector('.bb-kit').dataset.arg);
  await t.E((id) => {
    window.__bar = document.querySelector('#hud-build .buildbar');
    window.__strip = document.querySelector('.bb-kits');
    window.__count0 = document.querySelector('.bb-kit .count').textContent;
    window.__setChurn(false);
    window.__kit = setInterval(() => window.__EM.state.inventory.addKit(id, 1), 90);
  }, kitId);
  await sleep(600);
  const bar = await t.E(() => ({
    bar: document.querySelector('#hud-build .buildbar') === window.__bar,
    strip: document.querySelector('.bb-kits') === window.__strip,
    moved: document.querySelector('.bb-kit .count').textContent !== window.__count0,
  }));
  check(bar.moved, 'le stock affiché dans la bande change pendant la construction');
  check(bar.bar && bar.strip, 'la barre et sa bande de machines ne sont pas recréées par ces changements');
  check(
    await t.E(() => {
      const root = document.getElementById('hud-build');
      const expected = root.cloneNode(false);
      expected.innerHTML = window.__EM.ui.cache.get('hud-build');
      return root.isEqualNode(expected);
    }),
    'la barre de construction montre exactement ce que le jeu a produit',
  );
  const r = await t.E(() => {
    const b = document.querySelector('.bb-kits').getBoundingClientRect();
    return { x: b.left + b.width * 0.8, y: b.top + b.height / 2 };
  });
  await t.E(() => (document.querySelector('.bb-kits').scrollLeft = 0));
  await sleep(100);
  await t.drag(r, { x: r.x - 120, y: r.y }, 12, 20);
  const sl = await t.E(() => Math.round(document.querySelector('.bb-kits').scrollLeft));
  const room = strip.sw - strip.cw;
  check(sl >= Math.min(room, 120) - 12, `un glissé horizontal fait défiler la bande de bout en bout, stock en mouvement (${sl} px, ${room} possibles)`);
  await t.E(() => {
    clearInterval(window.__kit);
    window.__EM.setBuildMode(false);
  });
  check(t.errors.length === 0, `aucune erreur dans la console${t.errors.length ? ` — ${t.errors[0]}` : ''}`);
  await t.ctx.close();
}

await browser.close();
await server?.close();
console.log(failures ? `\n${failures} problème(s) sur ${total} vérifications :\n - ${problems.join('\n - ')}` : `\nTout est bon (${total} vérifications).`);
process.exit(failures ? 1 : 0);
