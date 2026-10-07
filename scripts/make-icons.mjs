/**
 * Dessine les icônes de l'application (écran d'accueil, manifeste) : une pioche et une pépite d'or en pixels, sur fond de mine.
 * Les PNG sont enregistrés dans public/ ; à relancer si le dessin change :
 *
 *   node scripts/make-icons.mjs
 *
 * Variable : CHROME_PATH (exécutable Chromium).
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../public/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

/** Dessin sur une grille de 64 × 64 « pixels », agrandie sans lissage. `pad` : marge (zone sûre des icônes adaptatives). */
const draw = (size, pad) =>
  page.evaluate(
    ([size, pad]) => {
      const N = 64;
      const art = document.createElement('canvas');
      art.width = art.height = N;
      const g = art.getContext('2d');
      const px = (x, y, c, w = 1, h = 1) => {
        g.fillStyle = c;
        g.fillRect(Math.round(x), Math.round(y), w, h);
      };
      // Fond : roche sombre, lueur chaude au centre, grain.
      const bg = g.createLinearGradient(0, 0, 0, N);
      bg.addColorStop(0, '#2e221b');
      bg.addColorStop(1, '#0f0b0d');
      g.fillStyle = bg;
      g.fillRect(0, 0, N, N);
      const glow = g.createRadialGradient(N * 0.5, N * 0.46, 2, N * 0.5, N * 0.46, N * 0.55);
      glow.addColorStop(0, 'rgba(242,170,60,0.55)');
      glow.addColorStop(1, 'rgba(242,170,60,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, N, N);
      let seed = 7;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 90; i++) px(rnd() * N, rnd() * N, rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.25)');

      // Tout ce qui suit est dessiné dans un carré réduit si `pad` > 0.
      const k = 1 - 2 * pad;
      g.save();
      g.translate(N * pad, N * pad);
      g.scale(k, k);

      // Le manche : de bas gauche à haut droite, épaisseur de 4 pixels, contour sombre.
      const line = (x0, y0, x1, y1, w, c) => {
        const steps = 120;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          px(x0 + (x1 - x0) * t - w / 2, y0 + (y1 - y0) * t - w / 2, c, w, w);
        }
      };
      line(10, 55, 41, 22, 8, '#120c0a');
      line(10, 55, 41, 22, 6, '#6b4524');
      line(9, 54, 40, 21, 2, '#a9733d');
      line(12, 56, 43, 23, 2, '#43290f');
      // La tête : un arc d'acier, du haut gauche au bas droit, qui passe au bout du manche.
      const bez = (t, p0, p1, p2) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
      const arc = (w, c, dx = 0, dy = 0) => {
        for (let i = 0; i <= 200; i++) {
          const [x, y] = bez(i / 200, [11, 24], [47, 5], [59, 41]);
          px(x - w / 2 + dx, y - w / 2 + dy, c, w, w);
        }
      };
      arc(11, '#120c0a');
      arc(9, '#7c8a9c');
      arc(7, '#a8b4c4');
      arc(3, '#e4ecf6', -1, -1);
      arc(3, '#56647a', 1, 2);
      // Pointes de la tête : un pixel d'acier de plus au bout, avec son contour.
      px(8, 26, '#120c0a', 4, 3);
      px(9, 26, '#9aa8ba', 3, 2);
      px(58, 42, '#120c0a', 3, 4);
      px(58, 42, '#9aa8ba', 2, 3);
      // Bague au croisement de la tête et du manche.
      px(37, 19, '#120c0a', 9, 9);
      px(38, 20, '#c89a3a', 7, 7);
      px(38, 20, '#f2d27a', 7, 2);
      px(38, 25, '#8a6212', 7, 2);

      // Une pépite d'or et un peu de minerai, en bas à droite.
      const nug = (x, y, w, h, c0, c1, c2) => {
        px(x - 1, y - 1, '#120c0a', w + 2, h + 2);
        px(x, y, c1, w, h);
        px(x, y, c0, w, 1);
        px(x, y, c0, 1, h);
        px(x, y + h - 1, c2, w, 1);
        px(x + w - 1, y, c2, 1, h);
      };
      nug(45, 47, 9, 7, '#fff3b0', '#f2c230', '#a8780a');
      nug(53, 52, 6, 5, '#ffe9a0', '#e0a820', '#8a5a08');
      nug(38, 52, 6, 5, '#f0b080', '#c46a2a', '#7a3a10');
      g.restore();

      const out = document.getElementById('c');
      out.width = out.height = size;
      const o = out.getContext('2d');
      o.imageSmoothingEnabled = false;
      o.drawImage(art, 0, 0, size, size);
      return out.toDataURL('image/png');
    },
    [size, pad],
  );

const files = [
  ['icon-512.png', 512, 0],
  ['icon-192.png', 192, 0],
  ['apple-touch-icon.png', 180, 0],
  ['icon-maskable-512.png', 512, 0.12],
];
for (const [name, size, pad] of files) {
  const url = await draw(size, pad);
  writeFileSync(OUT + name, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`✔ public/${name} (${size}×${size})`);
}
await browser.close();
