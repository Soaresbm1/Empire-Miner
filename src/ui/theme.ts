/**
 * Thème de l'interface en pixel art : cadres à rivets, textures de fond et petites icônes,
 * dessinés au lancement (aucun fichier externe) et exposés en variables CSS ou en images.
 *
 * Le CSS prévoit des valeurs de secours : sans ces textures, l'interface reste lisible.
 */
import { INK } from '../render/art';
import { PICK_ANGLES, buildNuggetSprites, buildPickaxeSprites, fromArt } from '../render/sprites';

const icons = new Map<string, string>();

/** Icône enregistrée (URL de données) : « coin », « heart », « bag », « pick0 »… ou « res:<id> ». Vide si absente. */
export function icon(name: string): string {
  return icons.get(name) ?? '';
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

const cssUrl = (c: HTMLCanvasElement) => `url(${c.toDataURL()})`;

/** Bruit déterministe (0 à 1) par case : les textures sont les mêmes à chaque lancement. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface FramePalette {
  /** Une couleur par épaisseur, du bord extérieur vers l'intérieur : [côté éclairé, côté ombré]. */
  layers: [string, string][];
  /** Rivet des coins : reflet et ombre. */
  rivet: [string, string];
  /** Coins coupés (pixels transparents) : nombre de cases par côté. */
  chamfer: number;
}

/**
 * Cadre pour `border-image` : image de (3 × taille)² dont le centre reste transparent. Le haut et la
 * gauche sont éclairés, le bas et la droite dans l'ombre ; chaque coin porte un rivet.
 */
function frameImage(size: number, p: FramePalette): HTMLCanvasElement {
  const n = size * 3;
  const [c, ctx] = canvas(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const inX = x >= size && x < 2 * size;
      const inY = y >= size && y < 2 * size;
      if (inX && inY) continue; // centre : transparent
      const dl = x;
      const dr = n - 1 - x;
      const dt = y;
      const db = n - 1 - y;
      // Distance au bord le plus proche (dans la bande concernée) et côté qui décide de l'éclairage.
      const cands: [number, boolean][] = [];
      if (x < size) cands.push([dl, true]);
      if (x >= 2 * size) cands.push([dr, false]);
      if (y < size) cands.push([dt, true]);
      if (y >= 2 * size) cands.push([db, false]);
      const [d, lit] = cands.reduce((a, b) => (b[0] < a[0] ? b : a));
      const corner = (x < size || x >= 2 * size) && (y < size || y >= 2 * size);
      if (corner) {
        const cx = Math.min(dl, dr);
        const cy = Math.min(dt, db);
        if (cx + cy < p.chamfer) continue; // coin coupé
      }
      const layer = p.layers[Math.min(d, p.layers.length - 1)];
      ctx.fillStyle = d === 0 ? INK : layer[lit ? 0 : 1];
      ctx.fillRect(x, y, 1, 1);
    }
  // Rivets aux quatre coins.
  const r = Math.floor(size / 2) + 1;
  for (const [rx, ry] of [[r, r], [n - 1 - r, r], [r, n - 1 - r], [n - 1 - r, n - 1 - r]]) {
    ctx.fillStyle = p.rivet[1];
    ctx.fillRect(rx, ry + 1, 1, 1);
    ctx.fillStyle = p.rivet[0];
    ctx.fillRect(rx, ry, 1, 1);
  }
  return c;
}

/** Tuile de fond : petit grain de cuir sombre (opaque) ou de voile (transparent). */
function noiseTile(kind: 'panel' | 'veil'): HTMLCanvasElement {
  const [c, ctx] = canvas(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const h = hash(x, y, kind === 'panel' ? 3 : 9);
      if (kind === 'panel') {
        ctx.fillStyle = h < 0.1 ? '#271d20' : h > 0.94 ? '#151012' : '#1e1619';
        ctx.fillRect(x, y, 1, 1);
      } else if (h < 0.1) {
        ctx.fillStyle = 'rgba(255,240,220,0.05)';
        ctx.fillRect(x, y, 1, 1);
      } else if (h > 0.9) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  return c;
}

const ICON_PALETTE: Record<string, string> = {
  Y: '#f2c230', L: '#fff1a0', y: '#a07410',
  R: '#e0483c', P: '#ff9d8a', r: '#8a2018',
  B: '#9a6c3c', b: '#c89a64', k: '#5a3a20', g: '#e8c050',
  T: '#7fd0f0', t: '#2f6f96',
  // Équipement : acier, blanc, orange, masque, caoutchouc jaune.
  S: '#c4ccd6', s: '#8f99a8', d: '#4b5566', W: '#f4f6fa',
  O: '#f0a040', o: '#c8741a',
  M: '#8a9880', m: '#5d6a58', F: '#3a403a',
  Z: '#e6c040', z: '#a88a14',
  // Trottinette : pneu.
  K: '#2f2e36',
};

const COIN = ['..YYYY..', '.YLLYYy.', 'YLLYYYYy', 'YLYyyYYy', 'YLYyyYYy', 'YYYYYYyy', '.YYYYyy.', '..yyyy..'];
const HEART = ['.RR...RR.', 'RPRR.RRRR', 'RPRRRRRRR', 'RRRRRRRRr', '.RRRRRRr.', '..RRRRr..', '...RRr...', '....r....'];
const BAG = ['..kkkkk..', '.kBBBBBk.', 'kBbbBBBBk', 'kBbBBBBBk', 'kBBBBgBBk', 'kBBBBBBBk', 'kBBBBBBBk', '.kkkkkkk.'];
const DROP = ['...T...', '..TT...', '.TTTT..', 'TTbTTT.', 'TTTTTT.', '.TTTt..', '..tt...'];

/** Marteau-piqueur (poignée en haut, corps orange, burin en bas) et trottinette à moteur (de profil, guidon à droite). */
const TOOL_ICONS: Record<string, string[]> = {
  jackhammer: ['.dd...dd.', '.dSSSSSd.', '..oOOOo..', '..oOWOo..', '..oOOOo..', '...sSs...', '...sSs...', '....S....', '....S....', '....s....'],
  scooter: ['.......RR.', '.......Sd.', '.......S..', '..OO...S..', '.OOOO..S..', 'SSSSSSSSS.', '.KK....KK.'],
};

/** Équipement de protection : casque d'acier à lampe, masque à gaz, cuissardes, combinaison à bandes réfléchissantes. */
const GEAR_ICONS: Record<string, string[]> = {
  helmet: ['...SSS...', '..SWWSs..', '.SWSYYSs.', 'SSSSYYSSs', 'SSSSSSSss', 'ddddddddd', '.ddddddd.'],
  mask: ['.mmmmmmm.', 'mMMMMMMMm', 'MTTMMMTTM', 'MTTMMMTTM', 'mMMMFFMMm', '.mMFFFMm.', '..mFFFm..', '...FFF...'],
  boots: ['ZZ..ZZ...', 'ZZ..ZZ...', 'ZZ..ZZ...', 'zZ..zZ...', 'zZZZzZZZ.', 'zZZZzZZZZ', 'kkkkkkkkk'],
  suit: ['.OOOOOOO.', 'OOOSSSOOO', 'OOOOSOOOO', 'OoSSSSSoO', '.oOOSOOo.', '.oSSSSSo.', '..ooSoo..', '...oSo...'],
};

/** Recadre l'image sur ses pixels non transparents (pour tirer une icône d'un sprite plus grand). */
function crop(src: HTMLCanvasElement): HTMLCanvasElement {
  const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width;
  let y0 = src.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      if (d[(y * src.width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return src;
  const [c, ctx] = canvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx.drawImage(src, -x0, -y0);
  return c;
}

// ------------------------------------------------------------------ logo

/** Lettres du logo, en 5 × 7 cases. */
const GLYPHS: Record<string, string[]> = {
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
};

interface WordStyle {
  /** Couleur de la face, de la première à la dernière rangée de la lettre. */
  face: string[];
  /** Épaisseur (côté ombré), et reflet sur les arêtes éclairées. */
  side: string;
  glint: string;
}

const GOLD: WordStyle = {
  face: ['#fff2a8', '#ffe066', '#f7c934', '#f2b820', '#e0a010', '#c88a0c', '#a8700a'],
  side: '#8a5510',
  glint: '#fffbe6',
};
const STEEL: WordStyle = {
  face: ['#f6f9fd', '#dbe1ea', '#bfc7d4', '#a3adbc', '#8a95a7', '#727e92', '#5b677c'],
  side: '#3a4457',
  glint: '#ffffff',
};

/** Un mot en grosses lettres : contour, épaisseur en biais, face dégradée, reflets sur les arêtes. */
function drawWord(ctx: CanvasRenderingContext2D, word: string, x0: number, y0: number, S: number, style: WordStyle): void {
  const cells: [number, number, number][] = []; // [colonne globale, rangée, rangée dans la lettre]
  [...word].forEach((ch, li) => GLYPHS[ch].forEach((row, y) => [...row].forEach((c, x) => c === 'X' && cells.push([li * 6 + x, y, y]))));
  const has = (cx: number, cy: number) => cells.some(([x, y]) => x === cx && y === cy);
  const D = 5; // épaisseur, en pixels
  for (let d = D; d >= 0; d--)
    for (const [cx, cy] of cells) {
      const x = x0 + cx * S + d;
      const y = y0 + cy * S + d;
      ctx.fillStyle = INK;
      ctx.fillRect(x - 1, y - 1, S + 2, S + 2);
    }
  for (let d = D; d >= 1; d--)
    for (const [cx, cy] of cells) {
      ctx.fillStyle = d === D ? '#5a3608' : style.side;
      if (style === STEEL) ctx.fillStyle = d === D ? '#262d3b' : style.side;
      ctx.fillRect(x0 + cx * S + d, y0 + cy * S + d, S, S);
    }
  for (const [cx, cy, ly] of cells) {
    const x = x0 + cx * S;
    const y = y0 + cy * S;
    ctx.fillStyle = style.face[ly];
    ctx.fillRect(x, y, S, S);
    if (!has(cx, cy - 1)) {
      ctx.fillStyle = style.glint;
      ctx.fillRect(x, y, S, 1);
    }
    if (!has(cx - 1, cy)) {
      ctx.fillStyle = style.glint;
      ctx.fillRect(x, y, 1, S);
    }
  }
}

/** Logo « EMPIRE MINER » : l'or au-dessus, l'acier en dessous. Dessiné avec des pixels de 4 px (affiché en pixels nets). */
function logoImage(): HTMLCanvasElement {
  const S = 4;
  const W = 35 * S + 24;
  const [c, ctx] = canvas(W, 2 * (7 * S + 12) + 4);
  drawWord(ctx, 'EMPIRE', 8, 6, S, GOLD);
  drawWord(ctx, 'MINER', 8 + 3 * S, 7 * S + 22, S, STEEL);
  return c;
}

/** À appeler une fois au lancement, avant de créer l'interface. */
export function installTheme(): void {
  const root = document.documentElement.style;
  // Cadres : fin pour le HUD, plus large et laitonné pour les panneaux.
  root.setProperty(
    '--frame-hud',
    cssUrl(
      frameImage(5, {
        layers: [['', ''], ['#b08b5f', '#3a2b21'], ['#8a6a4c', '#4a382b'], ['#6b5039', '#3a2b21'], ['#2a1f18', '#2a1f18']],
        rivet: ['#f0d8a0', '#3a2b21'],
        chamfer: 2,
      }),
    ),
  );
  root.setProperty(
    '--frame-panel',
    cssUrl(
      frameImage(8, {
        layers: [
          ['', ''],
          ['#e0b86e', '#3a2a1c'],
          ['#b58a4a', '#5a4030'],
          ['#8a6a4c', '#4a382b'],
          ['#6b5039', '#3a2b21'],
          ['#4a382b', '#2a1f18'],
          ['#2a1f18', '#1a1210'],
          ['#1a1210', '#120e10'],
        ],
        rivet: ['#fff0b8', '#5a3a1c'],
        chamfer: 3,
      }),
    ),
  );
  root.setProperty('--tex-panel', cssUrl(noiseTile('panel')));
  root.setProperty('--tex-veil', cssUrl(noiseTile('veil')));

  // Icônes dessinées à la main.
  const draw = (name: string, art: string[]) => icons.set(name, fromArt(art, ICON_PALETTE).toDataURL());
  draw('coin', COIN);
  draw('heart', HEART);
  draw('bag', BAG);
  draw('drop', DROP);
  for (const [id, art] of Object.entries(GEAR_ICONS)) draw(`gear:${id}`, art);
  for (const [id, art] of Object.entries(TOOL_ICONS)) draw(`tool:${id}`, art);
  for (const [name, url] of [['coin', icons.get('coin')], ['heart', icons.get('heart')], ['bag', icons.get('bag')]] as const)
    if (url) root.setProperty(`--ico-${name}`, `url(${url})`);

  icons.set('logo', logoImage().toDataURL());

  // Minerais et lingots : les mêmes sprites que dans la mine.
  for (const [id, sprite] of buildNuggetSprites()) icons.set(`res:${id}`, sprite.toDataURL());

  // Pioches : l'outil en diagonale, recadré.
  buildPickaxeSprites().forEach((angles, level) => icons.set(`pick${level}`, crop(angles[Math.round(PICK_ANGLES * 0.875)]).toDataURL()));
}
