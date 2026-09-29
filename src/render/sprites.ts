/**
 * Sprites pixel-art générés au lancement (aucun fichier externe).
 * Les dessins sont décrits en texte ; un contour sombre est ajouté automatiquement.
 */
import { TILE } from '../core/constants';
import { RESOURCES } from '../data/resources';
import { PICKAXES } from '../data/tools';

const OUTLINE = '#1a1418';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Convertit un dessin texte en sprite avec contour automatique (1 px de marge). */
export function fromArt(rows: string[], palette: Record<string, string>, outline = OUTLINE): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const [c, ctx] = canvas(w + 2, h + 2);
  const filled = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < rows[y].length && rows[y][x] !== '.';
  for (let y = -1; y <= h; y++)
    for (let x = -1; x <= w; x++) {
      if (filled(x, y)) continue;
      if (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1)) {
        ctx.fillStyle = outline;
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = palette[ch] ?? '#ff00ff';
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  return c;
}

function mirror(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

// ------------------------------------------------------------------ personnage

const PLAYER_PALETTE: Record<string, string> = {
  Y: '#f2c230', y: '#b98a1a', L: '#fff6c0', S: '#f0c29a', s: '#c98e66', E: '#2a1f1a',
  H: '#5a3a22', T: '#b8412c', B: '#3867b0', b: '#2a4f8a', G: '#5a3d24', g: '#e0b84a', K: '#3b2a1f',
};

const HEAD_DOWN = ['..YYYYYY..', '.YYYLLYYY.', '.YYYLLYYY.', 'yyyyyyyyyy', '.SSSSSSSS.', '.SESSSSES.', '.SSSSSSSS.', '..SSssSS..'];
const BODY_DOWN = ['TTBBBBBBTT', 'STBBBBBBTS', 'STBbBBbBTS', 'S.GGgGGG.S'];
const HEAD_UP = ['..YYYYYY..', '.YYYYYYYY.', '.YYYYYYYY.', 'yyyyyyyyyy', '.HHHHHHHH.', '.HHHHHHHH.', '.sHHHHHHs.', '..ssssss..'];
const BODY_UP = ['TTBTTTTBTT', 'STBTTTTBTS', 'STBTTTTBTS', 'S.GGGGGG.S'];
const LEGS_FRONT = [
  ['..BBBBBB..', '..BB..BB..', '..BB..BB..', '..KK..KK..'],
  ['..BBBBBB..', '..BB..BB..', '..KK..BB..', '......KK..'],
  ['..BBBBBB..', '..BB..BB..', '..BB..KK..', '..KK......'],
];
const HEAD_SIDE = ['..YYYYY...', '.YYYYYYYL.', '.YYYYYYYL.', '.yyyyyyyyy', '..HHSSSSS.', '..HSSSSES.', '..HSSSSSS.', '...sSSSs..'];
const BODY_SIDE = ['...TBBBT..', '...TBBSS..', '...TBBBT..', '...GGgG...'];
const LEGS_SIDE = [
  ['...BBBB...', '...BB.BB..', '...BB.BB..', '...KK.KKK.'],
  ['...BBBB...', '..BB..BB..', '.BB....BB.', '.KK....KK.'],
  ['...BBBB...', '....BB....', '....BB....', '....KKK...'],
];

export interface PlayerSprites {
  /** [direction][frame] — direction : 0 E, 1 S, 2 O, 3 N ; frame : 0 immobile, 1-2 marche. */
  frames: HTMLCanvasElement[][];
}

export function buildPlayerSprites(): PlayerSprites {
  const down = LEGS_FRONT.map((legs) => fromArt([...HEAD_DOWN, ...BODY_DOWN, ...legs], PLAYER_PALETTE));
  const up = LEGS_FRONT.map((legs) => fromArt([...HEAD_UP, ...BODY_UP, ...legs], PLAYER_PALETTE));
  const right = LEGS_SIDE.map((legs) => fromArt([...HEAD_SIDE, ...BODY_SIDE, ...legs], PLAYER_PALETTE));
  const left = right.map(mirror);
  return { frames: [right, down, left, up] };
}

// ------------------------------------------------------------------ pioches

/** Pioche pointant vers la droite, pivot (main) en (2, 8). */
function pickaxeArt(head: string): HTMLCanvasElement {
  const [c, ctx] = canvas(18, 18);
  ctx.fillStyle = '#6b4526';
  ctx.fillRect(2, 8, 11, 2);
  ctx.fillStyle = '#8a5a33';
  ctx.fillRect(2, 8, 11, 1);
  // Tête en croissant, verticale au bout du manche.
  const rows = ['...X', '..XX', '.XX.', 'XX..', 'XX..', 'XX..', '.XX.', '..XX', '...X'];
  ctx.fillStyle = OUTLINE;
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch === 'X' && ctx.fillRect(12 + x, 4 + y, 1, 1)));
  ctx.fillStyle = head;
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch === 'X' && x > 0 && ctx.fillRect(12 + x - 1, 4 + y, 1, 1)));
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(13, 6, 1, 1);
  ctx.fillRect(12, 8, 1, 2);
  return c;
}

/** Rotation au plus proche voisin (préserve l'aspect pixel). */
function rotateNearest(src: HTMLCanvasElement, angle: number, pivotX: number, pivotY: number, size: number): HTMLCanvasElement {
  const sctx = src.getContext('2d')!;
  const sdata = sctx.getImageData(0, 0, src.width, src.height).data;
  const [c, ctx] = canvas(size, size);
  const out = ctx.createImageData(size, size);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const sx = Math.floor(cos * dx + sin * dy + pivotX);
      const sy = Math.floor(-sin * dx + cos * dy + pivotY);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const si = (sy * src.width + sx) * 4;
      if (sdata[si + 3] === 0) continue;
      const o = (y * size + x) * 4;
      out.data[o] = sdata[si];
      out.data[o + 1] = sdata[si + 1];
      out.data[o + 2] = sdata[si + 2];
      out.data[o + 3] = sdata[si + 3];
    }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Marteau-piqueur pointant vers la droite, pivot (poignée) en (2, 8), comme les pioches. */
function jackhammerArt(): HTMLCanvasElement {
  const [c, ctx] = canvas(18, 18);
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // Contour, puis poignée en T, corps jaune, foret d'acier.
  px(1, 4, 3, 10, OUTLINE);
  px(3, 5, 10, 8, OUTLINE);
  px(12, 7, 6, 4, OUTLINE);
  px(2, 5, 1, 8, '#3a3a40');
  px(4, 6, 8, 6, '#d9a526');
  px(4, 6, 8, 1, '#f2c230');
  px(4, 10, 8, 2, '#a57a14');
  px(6, 7, 1, 3, '#26221e');
  px(9, 7, 1, 3, '#26221e');
  px(12, 8, 4, 2, '#c7ccd6');
  px(16, 8, 1, 1, '#e3e7f0');
  px(12, 9, 4, 1, '#8c929c');
  return c;
}

/** Marteau-piqueur pré-tourné : [angle], même pivot et même taille que les pioches. */
export function buildJackhammerSprites(): HTMLCanvasElement[] {
  const art = jackhammerArt();
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < PICK_ANGLES; i++) out.push(rotateNearest(art, (i / PICK_ANGLES) * Math.PI * 2, 2, 8.5, PICK_SIZE));
  return out;
}

export const PICK_ANGLES = 32;
export const PICK_SIZE = 36;

/** Pioches pré-tournées : [niveau][angle], pivot au centre de l'image. */
export function buildPickaxeSprites(): HTMLCanvasElement[][] {
  return PICKAXES.map((p) => {
    const art = pickaxeArt(p.head);
    const out: HTMLCanvasElement[] = [];
    for (let i = 0; i < PICK_ANGLES; i++) out.push(rotateNearest(art, (i / PICK_ANGLES) * Math.PI * 2, 2, 8.5, PICK_SIZE));
    return out;
  });
}

// ------------------------------------------------------------------ minerais

const NUGGET = ['.aab.', 'aaabb', 'abbbc', '.bcc.'];
/** Lingot : une barre trapézoïdale, le dessus éclairé. */
const INGOT = ['.aaaa.', 'abbbbc', 'bbcccc'];

export function buildNuggetSprites(): Map<string, HTMLCanvasElement> {
  const map = new Map<string, HTMLCanvasElement>();
  for (const r of RESOURCES) map.set(r.id, fromArt(r.ingot ? INGOT : NUGGET, { a: r.light, b: r.color, c: r.dark }, '#120e10'));
  return map;
}

// ------------------------------------------------------------------ fissures

/** Quatre stades de fissures (superposés aux blocs entamés). */
export function buildCrackSprites(): HTMLCanvasElement[] {
  const stages: HTMLCanvasElement[] = [];
  const lines: [number, number, number, number][] = [
    [8, 8, 3, 3],
    [8, 8, 13, 5],
    [8, 8, 6, 14],
    [8, 8, 14, 12],
    [3, 3, 1, 7],
    [13, 5, 15, 2],
    [6, 14, 2, 12],
    [14, 12, 11, 15],
  ];
  for (let s = 0; s < 4; s++) {
    const [c, ctx] = canvas(TILE, TILE);
    ctx.fillStyle = 'rgba(10,6,8,0.85)';
    const n = [2, 4, 6, 8][s];
    for (let k = 0; k < n; k++) {
      const [x0, y0, x1, y1] = lines[k];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(x0 + ((x1 - x0) * t) / steps);
        const y = Math.round(y0 + ((y1 - y0) * t) / steps);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    stages.push(c);
  }
  return stages;
}

// ------------------------------------------------------------------ bâtiments

/** Comptoir de vente : échoppe en bois avec auvent rayé (3×2 tuiles + toit). */
export function buildCounterSprite(): HTMLCanvasElement {
  const W = 3 * TILE;
  const H = 2 * TILE + 10;
  const [c, ctx] = canvas(W, H);
  // Murs
  ctx.fillStyle = '#7a5231';
  ctx.fillRect(2, 14, W - 4, H - 14);
  for (let y = 16; y < H; y += 4) {
    ctx.fillStyle = '#6a452a';
    ctx.fillRect(2, y, W - 4, 1);
  }
  // Comptoir
  ctx.fillStyle = '#9b6a3e';
  ctx.fillRect(6, H - 14, W - 12, 6);
  ctx.fillStyle = '#b98450';
  ctx.fillRect(6, H - 14, W - 12, 2);
  // Pièces sur le comptoir
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(12, H - 16, 3, 2);
  ctx.fillRect(16, H - 17, 3, 3);
  ctx.fillRect(30, H - 16, 3, 2);
  // Ouverture sombre
  ctx.fillStyle = '#2a1c14';
  ctx.fillRect(8, 20, W - 16, H - 36);
  // Auvent rayé
  for (let x = 0; x < W; x += 6) {
    ctx.fillStyle = (x / 6) % 2 ? '#e9e2d0' : '#c0392b';
    ctx.fillRect(x, 6, 6, 10);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 14, W, 2);
  for (let x = 0; x < W; x += 6) {
    ctx.fillStyle = (x / 6) % 2 ? '#e9e2d0' : '#c0392b';
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x + 3, 19);
    ctx.lineTo(x + 6, 16);
    ctx.fill();
  }
  // Enseigne
  ctx.fillStyle = '#3b2616';
  ctx.fillRect(W / 2 - 8, 0, 16, 7);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(W / 2 - 2, 1, 4, 5);
  ctx.fillStyle = '#a07410';
  ctx.fillRect(W / 2 - 1, 2, 2, 3);
  return c;
}

/**
 * Tableau d'affichage : deux poteaux, un petit auvent et un panneau de liège où sont épinglés un graphique
 * (mêmes couleurs que l'histogramme des gains), une note et une affichette (2×2 tuiles + auvent).
 */
export function buildBoardSprite(): HTMLCanvasElement {
  const W = 2 * TILE;
  const H = 2 * TILE + 8;
  const [c, ctx] = canvas(W, H);
  // Poteaux
  for (const x of [3, 26]) {
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(x, 12, 3, H - 12);
    ctx.fillStyle = '#7a5231';
    ctx.fillRect(x, 12, 1, H - 12);
  }
  // Cadre et panneau de liège
  ctx.fillStyle = '#3b2616';
  ctx.fillRect(1, 8, W - 2, 22);
  ctx.fillStyle = '#b08558';
  ctx.fillRect(3, 10, W - 6, 18);
  for (let y = 11; y < 28; y += 3) {
    ctx.fillStyle = '#9c7449';
    ctx.fillRect(3 + ((y / 3) % 2) * 3, y, 4, 1);
    ctx.fillRect(15 + ((y / 3) % 2) * 4, y, 3, 1);
  }
  // Auvent
  ctx.fillStyle = '#3b2616';
  ctx.fillRect(0, 3, W, 5);
  ctx.fillStyle = '#7a5231';
  ctx.fillRect(0, 3, W, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(1, 8, W - 2, 2);
  // Graphique épinglé : trois colonnes ambre et bleues, comme dans le panneau
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(5, 12, 11, 12);
  ctx.fillStyle = '#c9bd9c';
  ctx.fillRect(5, 23, 11, 1);
  ctx.fillStyle = '#b98012';
  ctx.fillRect(7, 19, 2, 4);
  ctx.fillRect(10, 16, 2, 7);
  ctx.fillRect(13, 18, 2, 5);
  ctx.fillStyle = '#3f88cf';
  ctx.fillRect(10, 14, 2, 2);
  ctx.fillRect(13, 15, 2, 3);
  // Note : quelques lignes de texte
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(18, 11, 10, 8);
  ctx.fillStyle = '#8a6a4c';
  for (const y of [13, 15, 17]) ctx.fillRect(19, y, 8, 1);
  // Affichette dorée
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(19, 21, 8, 6);
  ctx.fillStyle = '#a07410';
  ctx.fillRect(21, 22, 4, 4);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(22, 23, 2, 2);
  // Punaises
  ctx.fillStyle = '#c0392b';
  for (const [x, y] of [[10, 12], [22, 11], [22, 21]]) ctx.fillRect(x, y, 2, 2);
  return c;
}

/** Atelier : bâtiment de pierre, toit sombre, cheminée et enclume. */
export function buildWorkshopSprite(): HTMLCanvasElement {
  const W = 3 * TILE;
  const H = 2 * TILE + 12;
  const [c, ctx] = canvas(W, H);
  // Murs de pierre
  ctx.fillStyle = '#7d7468';
  ctx.fillRect(2, 14, W - 4, H - 14);
  for (let y = 14; y < H; y += 5)
    for (let x = 2 + ((y / 5) % 2) * 4; x < W - 2; x += 8) {
      ctx.fillStyle = '#6a6258';
      ctx.fillRect(x, y, 7, 1);
      ctx.fillRect(x + 7, y, 1, 5);
    }
  // Toit
  ctx.fillStyle = '#3d3a44';
  ctx.beginPath();
  ctx.moveTo(-1, 16);
  ctx.lineTo(W / 2, 3);
  ctx.lineTo(W + 1, 16);
  ctx.fill();
  ctx.fillStyle = '#524e5b';
  ctx.fillRect(0, 14, W, 3);
  // Cheminée
  ctx.fillStyle = '#5a4a40';
  ctx.fillRect(W - 12, 0, 6, 10);
  // Porte ouverte sur la forge
  ctx.fillStyle = '#1e1512';
  ctx.fillRect(W / 2 - 7, H - 18, 14, 18);
  ctx.fillStyle = '#e8792a';
  ctx.fillRect(W / 2 - 5, H - 7, 10, 3);
  ctx.fillStyle = '#ffc163';
  ctx.fillRect(W / 2 - 3, H - 6, 6, 1);
  // Enseigne : enclume
  ctx.fillStyle = '#3b2616';
  ctx.fillRect(6, 20, 10, 8);
  ctx.fillStyle = '#9aa0aa';
  ctx.fillRect(7, 22, 8, 2);
  ctx.fillRect(9, 24, 4, 3);
  return c;
}

export function buildLanternSprite(): HTMLCanvasElement {
  return fromArt(['..K..', '.KKK.', 'KYLYK', 'KLLLK', 'KYLYK', '.KKK.'], { K: '#3a2d22', Y: '#f2a93b', L: '#fff3b0' });
}
