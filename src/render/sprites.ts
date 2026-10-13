/**
 * Sprites pixel-art générés au lancement (aucun fichier externe).
 * Les dessins sont décrits en texte ; un contour sombre est ajouté automatiquement.
 */
import { TILE } from '../core/constants';
import { RESOURCES } from '../data/resources';
import { PICKAXES } from '../data/tools';
import { INK, Pen, ramp } from './art';

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

/**
 * Le mineur : 12 × 18 cases, casque jaune à lampe, salopette bleue, chemise rouge, ceinture à boucle,
 * bottes. La lumière vient d'en haut à gauche : chaque matière a un ton clair, un ton de base et une ombre.
 */
const PLAYER_PALETTE: Record<string, string> = {
  // Casque : reflet, clair, base, ombre ; lampe.
  L: '#fff2b0', Y: '#f2c230', h: '#d9a526', y: '#a87a14', W: '#fffbe6', w: '#f0a93b',
  // Peau, cheveux, yeux, bouche.
  S: '#f0c29a', s: '#c98e66', H: '#5a3a22', E: '#2a1f1a', m: '#b0583c',
  // Chemise, salopette.
  u: '#dc6a48', T: '#b8412c', t: '#8a2e20', B: '#3867b0', c: '#5b8ad0', b: '#2a4f8a',
  // Ceinture, boucle, sac à dos, bottes.
  G: '#5a3d24', g: '#e0b84a', P: '#8a6236', p: '#5e4022', K: '#3b2a1f', k: '#6a4d38',
  // Équipement : masque à gaz et ses filtres, caoutchouc jaune des cuissardes.
  M: '#8a9880', F: '#3a403a', Z: '#e6c040', z: '#a88a14',
};

const HEAD_DOWN = ['...LYYYYy...', '..LYYWWYYy..', '.LYYYWWYYYy.', 'hYYYYYYYYYYy', '.yyyyyyyyyy.', '..SSSSSSSS..', '..SSESSESS..', '..sSSmmSSs..'];
const BODY_DOWN = ['.uTBBBBBBTt.', '.uTBcBBcBTt.', '.uTBBbbBBTt.', '.SSGGggGGSS.'];
const HEAD_UP = ['...LYYYYy...', '..LYYYYYYy..', '.LYYYYYYYYy.', 'hYYYYYYYYYYy', '.yyyyyyyyyy.', '..HHHHHHHH..', '..HHHHHHHH..', '...ssSSss...'];
const BODY_UP = ['.uTPPPPPPTt.', '.uTPpPPpPTt.', '.uTPPPPPPTt.', '.SSGGGGGGSS.'];
/** Marche de face ou de dos : au repos, puis deux pas et deux passages de jambe. */
const LEGS_FRONT = [
  ['...BBBBBB...', '...BBbbBB...', '...BB..BB...', '...BB..BB...', '..kKK..kKK..', '..KKK..KKK..'],
  ['...BBBBBB...', '...BBbbBB...', '...BB..BB...', '...BB..kK...', '..kKK.......', '..KKK.......'],
  ['...BBBBBB...', '...BBbbBB...', '....BBBB....', '....BBBB....', '...kKKKKk...', '...KKKKKK...'],
  ['...BBBBBB...', '...BBbbBB...', '...BB..BB...', '...kK..BB...', '.......kKK..', '.......KKK..'],
  ['...BBBBBB...', '...BBbbBB...', '....BBBB....', '....BBBB....', '...kKKKKk...', '...KKKKKK...'],
];
const HEAD_SIDE = ['...LYYYYy...', '..LYYYYYYWy.', '.LYYYYYYYWWy', 'hYYYYYYYYYYy', '.yyyyyyyyyyy', '..HHSSSSSSS.', '..HHSSSSSESS', '...HsSSSSSs.'];
const BODY_SIDE = ['.PpuBBBBTt..', '.PPuBcBBTt..', '.PPuBBBBSS..', '..GGGGGgGG..'];
const LEGS_SIDE = [
  ['...BBBBBB...', '...BBBBBB...', '....BBBB....', '....BBBB....', '....kKKKK...', '....KKKKKK..'],
  ['...BBBBBB...', '..BBB..BBB..', '..BB....BB..', '.BB......BB.', '.kK......kK.', '.KK......KKK'],
  ['...BBBBBB...', '...BBBBBB...', '....BBBB....', '....BB.kK...', '....kKK.....', '....KKK.....'],
  ['...BBBBBB...', '..BBBB.BBB..', '.BBB....BB..', '.BB.....BB..', '.kK.....kK..', '.KKK....KKK.'],
  ['...BBBBBB...', '...BBBBBB...', '....BBBB....', '....kK.BB...', '.....KKK....', '.....KKK....'],
];

/** Dessins du mineur, exposés pour vérifier leurs dimensions (tests). */
export const PLAYER_ART = { HEAD_DOWN, BODY_DOWN, HEAD_UP, BODY_UP, LEGS_FRONT, HEAD_SIDE, BODY_SIDE, LEGS_SIDE };

export interface PlayerSprites {
  /** [direction][image] : direction 0 E, 1 S, 2 O, 3 N ; image 0 immobile, 1 à 4 marche (pas, passage, pas, passage). */
  frames: HTMLCanvasElement[][];
  /** Immobile, yeux fermés (clignement), par direction. */
  blink: HTMLCanvasElement[];
}

/** Yeux fermés : la case des yeux prend le ton d'ombre de la peau. */
const closeEyes = (rows: string[]) => rows.map((r) => r.replace(/E/g, 's'));

/** Ce que le mineur porte (équipement de protection de l'Atelier) : chaque pièce se voit sur le personnage. */
export interface PlayerGear {
  helmet?: boolean;
  mask?: boolean;
  boots?: boolean;
  suit?: boolean;
  /** Ouvrier : les couleurs de son métier (casque, chemise et salopette) à la place de celles du mineur. */
  crew?: 'picker' | 'refueler' | 'driller';
  /** L'autre joueur (partie à deux) : chemise verte, pour ne pas le confondre avec soi. */
  friend?: boolean;
}

/**
 * Ramasseur : casque vert, chemise claire, salopette brune. Ravitailleur : casque orange, chemise grise, salopette
 * charbon. Foreur : casque bleu, chemise blanche, salopette bleu nuit.
 */
const CREW_COLORS: Record<'picker' | 'refueler' | 'driller', Record<string, string>> = {
  picker: { L: '#d8f5c0', Y: '#6cc04a', h: '#4e9a34', y: '#346e22', u: '#e9ecea', T: '#bfc7c3', t: '#8c9692', B: '#8a6236', c: '#b08350', b: '#5e4022' },
  refueler: { L: '#ffd2b0', Y: '#e8662a', h: '#c24a18', y: '#8a3010', u: '#8a8a98', T: '#62626f', t: '#42424e', B: '#3b3b44', c: '#5a5a66', b: '#26262c' },
  driller: { L: '#cfe6ff', Y: '#4a8fe0', h: '#2f6fb8', y: '#1f4a80', u: '#f2f4f8', T: '#c9d0dc', t: '#939cac', B: '#2c3a5c', c: '#44587f', b: '#1a2440' },
};

/** Casque d'acier, semelles de caoutchouc, combinaison orange et argent : seules les couleurs changent. */
function playerPalette(gear: PlayerGear): Record<string, string> {
  const p = { ...PLAYER_PALETTE };
  if (gear.friend) Object.assign(p, { u: '#6cc88a', T: '#3f9a62', t: '#2a6c43' });
  if (gear.helmet) Object.assign(p, { L: '#eef4fb', Y: '#9db4cc', h: '#7c93ad', y: '#546a86' });
  if (gear.boots) Object.assign(p, { K: '#6f5a10', k: '#a88a14' });
  if (gear.suit) Object.assign(p, { u: '#f5b050', T: '#e08a28', t: '#a85c14', B: '#c8d0da', c: '#eef2f7', b: '#8a95a6' });
  if (gear.crew) Object.assign(p, CREW_COLORS[gear.crew]);
  return p;
}

/** Cuissardes : les jambes (sous la ceinture) passent au jaune. */
const waders = (legs: string[], gear: PlayerGear) => (gear.boots ? legs.map((r, i) => (i === 0 ? r : r.replace(/B/g, 'Z').replace(/b/g, 'z'))) : legs);

/** Remplace des cases d'une rangée : `at` = [colonne de départ, lettres]. */
const patch = (row: string, at: number, letters: string) => row.slice(0, at) + letters + row.slice(at + letters.length);

/**
 * Masque à gaz : de face, une pièce faciale grise et deux filtres aux joues ; de dos, la sangle ;
 * de profil, le groin filtrant qui dépasse. Les rangées 6 et 7 sont celles du nez et de la bouche.
 */
const maskDown = (head: string[]) => head.map((r, i) => (i === 6 ? patch(r, 5, 'MM') : i === 7 ? patch(r, 2, 'FMMMMMMF') : r));
const maskUp = (head: string[]) => head.map((r, i) => (i === 6 ? patch(r, 3, 'FFFFFF') : r));
const maskSide = (head: string[]) => head.map((r, i) => (i === 6 ? patch(patch(r, 4, 'F'), 10, 'MM') : i === 7 ? patch(r, 6, 'MMMMFF') : r));

/** Dessins du mineur habillé, exposés pour vérifier leurs dimensions (tests). */
export function playerArt(gear: PlayerGear = {}) {
  return {
    headDown: gear.mask ? maskDown(HEAD_DOWN) : HEAD_DOWN,
    headUp: gear.mask ? maskUp(HEAD_UP) : HEAD_UP,
    headSide: gear.mask ? maskSide(HEAD_SIDE) : HEAD_SIDE,
    legsFront: LEGS_FRONT.map((l) => waders(l, gear)),
    legsSide: LEGS_SIDE.map((l) => waders(l, gear)),
  };
}

export function buildPlayerSprites(gear: PlayerGear = {}): PlayerSprites {
  const pal = playerPalette(gear);
  const { headDown, headUp, headSide, legsFront, legsSide } = playerArt(gear);
  const down = legsFront.map((legs) => fromArt([...headDown, ...BODY_DOWN, ...legs], pal));
  const up = legsFront.map((legs) => fromArt([...headUp, ...BODY_UP, ...legs], pal));
  const right = legsSide.map((legs) => fromArt([...headSide, ...BODY_SIDE, ...legs], pal));
  const left = right.map(mirror);
  const blinkDown = fromArt(closeEyes([...headDown, ...BODY_DOWN, ...legsFront[0]]), pal);
  const blinkRight = fromArt(closeEyes([...headSide, ...BODY_SIDE, ...legsSide[0]]), pal);
  return { frames: [right, down, left, up], blink: [blinkRight, blinkDown, mirror(blinkRight), up[0]] };
}

// ------------------------------------------------------------------ trottinette

/**
 * Trottinette à moteur sous le mineur : plateau d'acier, deux roues, petit moteur de laiton à l'arrière
 * et guidon à poignées rouges. La lumière vient d'en haut à gauche comme partout ailleurs.
 */
const SCOOTER_PALETTE: Record<string, string> = {
  // Acier : reflet, face, dessous ; pneu et reflet du pneu ; moyeu ; poignées ; moteur et laiton.
  S: '#dfe5ee', s: '#aab3c2', d: '#6b7689', K: '#2f2e36', k: '#5a5a66', h: '#e6c040',
  R: '#e0483c', r: '#9a2a20', G: '#e0b84a', E: '#454b58',
};

/** Hauteur dont le mineur est surélevé sur son plateau (pixels). */
export const SCOOTER_LIFT = 4;

const pad = (n: number) => '.'.repeat(n);

/** De profil, tournée vers la droite : `frame` (0 ou 1) fait tourner le reflet des roues. */
function scooterSideArt(frame: 0 | 1): string[] {
  const top = frame ? 'KKhK' : 'KKKK';
  const mid = frame ? 'KKKK' : 'KhhK';
  return [
    pad(15) + 'RRRRRR' + pad(1),
    pad(15) + 'rrrrrr' + pad(1),
    pad(17) + 'Ss' + pad(3),
    pad(17) + 'Ss' + pad(3),
    pad(4) + 'GG' + pad(11) + 'Ss' + pad(3),
    pad(3) + 'EEEE' + pad(10) + 'Ss' + pad(3),
    'ddd' + 'EEEE' + pad(10) + 'Ss' + pad(3),
    pad(2) + 'S'.repeat(18) + pad(2),
    pad(2) + top + 's'.repeat(10) + top + pad(2),
    pad(2) + mid + pad(10) + mid + pad(2),
    pad(2) + '.KK.' + pad(10) + '.KK.' + pad(2),
  ];
}

/** De face ou de dos : le plateau vu par le bout et la roue sous les pieds. */
function scooterEndArt(frame: 0 | 1): string[] {
  return ['SSSSSSSSSS', 'ssssssssss', frame ? '...KKkK...' : '...KkkK...', '...KKKK...'];
}

/** Guidon vu de face (à dessiner par-dessus le mineur) : barre, poignées et colonne de direction. */
const SCOOTER_BARS = ['.RRSSSSSSRR.', '.rr..Ss..rr.', ...Array.from({ length: 5 }, () => '.....Ss.....')];

/** Dessins de la trottinette, exposés pour vérifier leurs dimensions (tests). */
export const SCOOTER_ART = { side: scooterSideArt(0), sideB: scooterSideArt(1), end: scooterEndArt(0), endB: scooterEndArt(1), bars: SCOOTER_BARS };

export interface ScooterSprites {
  /** [direction][image de roue] : direction 0 E, 1 S, 2 O, 3 N ; le plateau et les roues, à dessiner sous le mineur. */
  base: HTMLCanvasElement[][];
  /** Guidon vu de face, à dessiner par-dessus le mineur (direction sud seulement). */
  bars: HTMLCanvasElement;
}

export function buildScooterSprites(): ScooterSprites {
  const side = ([0, 1] as const).map((f) => fromArt(scooterSideArt(f), SCOOTER_PALETTE));
  const end = ([0, 1] as const).map((f) => fromArt(scooterEndArt(f), SCOOTER_PALETTE));
  return { base: [side, end, side.map(mirror), end], bars: fromArt(SCOOTER_BARS, SCOOTER_PALETTE) };
}

// ------------------------------------------------------------------ pioches

/**
 * Pioche pointant vers la droite, pivot (main) en (2, 8) : manche de bois veiné avec poignée de cuir,
 * virole rivetée, tête d'acier au tranchant lumineux.
 */
function pickaxeArt(head: string): HTMLCanvasElement {
  const [c, ctx] = canvas(18, 18);
  const pen = new Pen(ctx);
  const h = ramp(head);
  // Manche : contour, bois (dessus clair, dessous sombre), veines.
  pen.rect(1, 7, 13, 4, INK);
  pen.rect(2, 8, 11, 1, '#a8764a');
  pen.rect(2, 9, 11, 1, '#6b4526');
  for (const x of [6, 9, 11]) pen.px(x, 8, '#8a5a33');
  pen.px(7, 9, '#4a2f1a');
  pen.px(10, 9, '#4a2f1a');
  // Poignée de cuir : bandes sombres et claires.
  pen.rect(2, 8, 4, 2, '#3b2a1f');
  for (const x of [2, 4]) pen.px(x, 8, '#6a4d38');
  pen.px(5, 9, '#26191a');
  // Virole d'acier rivetée, à la jonction avec la tête.
  pen.rect(10, 6, 3, 6, INK);
  pen.rect(11, 7, 1, 4, '#9aa0aa');
  pen.px(11, 7, '#e3e7f0');
  pen.px(11, 10, '#5b5f68');
  // Tête en croissant, verticale au bout du manche : intérieur sombre, tranchant clair, pointes vives.
  const rows = ['....X', '...XX', '..XX.', '.XX..', 'XX...', 'XX...', 'XX...', '.XX..', '..XX.', '...XX', '....X'];
  const at = (x: number, y: number, col: string) => pen.px(12 + x, 3 + y, col);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch === 'X' && at(x, y, INK)));
  rows.forEach((r, y) => {
    const xs = [...r].map((ch, x) => (ch === 'X' ? x : -1)).filter((x) => x >= 0);
    xs.forEach((x, k) => {
      if (x === 0 && y > 0 && y < rows.length - 1) return; // le contour reste visible sur le bord gauche
      const outer = k === xs.length - 1;
      at(x - 1 < 0 ? x : x - 1, y, xs.length === 1 ? h.hi : outer ? h.light : h.shade);
    });
  });
  // Reflet sur le tranchant, et éclat au bout des pointes.
  pen.px(15, 4, '#ffffff');
  pen.px(15, 12, '#ffffff');
  pen.px(12, 7, h.hi);
  pen.px(12, 8, h.hi);
  pen.px(12, 9, h.light);
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

/** Les ressources rares (argent, or, diamant et leurs lingots) portent un éclat blanc. */
const SPARKLE = ['.wab.', 'aaabb', 'abbbc', '.bcc.'];
const SPARKLE_INGOT = ['.awaa.', 'abbbbc', 'bbcccc'];

/** Produits de la Manufacture : une plaque carrée à bord net, une poutre en I (acier), une gemme taillée. */
const PLATE = ['aaaaaa', 'abbbbc', 'abbbbc', 'cccccc'];
const SPARKLE_PLATE = ['aawaaa', 'abbbbc', 'abbbbc', 'cccccc'];
const BAR = ['aaaaaaa', '.bbbbb.', '.bbbbb.', 'ccccccc'];
const GEM = ['.awaa.', 'abbbbc', '.bbbc.', '..cc..'];

export function buildNuggetSprites(): Map<string, HTMLCanvasElement> {
  const map = new Map<string, HTMLCanvasElement>();
  for (const r of RESOURCES) {
    const rare = r.rarity === 'rare' || r.rarity === 'très rare' || r.rarity === 'légendaire';
    const art =
      r.shape === 'plate' ? (rare ? SPARKLE_PLATE : PLATE) : r.shape === 'bar' ? BAR : r.shape === 'gem' ? GEM : r.ingot ? (rare ? SPARKLE_INGOT : INGOT) : rare ? SPARKLE : NUGGET;
    map.set(r.id, fromArt(art, { a: r.light, b: r.color, c: r.dark, w: '#ffffff' }, '#120e10'));
  }
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
  const pen = new Pen(ctx);
  const wood = ramp('#7a5231');
  // Mur de planches verticales : joints sombres, reflet à gauche de chaque planche, clous.
  pen.rect(1, 13, W - 2, H - 13, INK);
  pen.rect(2, 14, W - 4, H - 14, wood.base);
  for (let x = 2; x < W - 2; x += 6) {
    pen.rect(x, 14, 1, H - 14, wood.dark);
    pen.rect(x + 1, 14, 1, H - 14, wood.light);
    pen.px(x + 3, 21, wood.dark);
    pen.px(x + 3, H - 7, wood.dark);
  }
  // Montants d'angle.
  for (const x of [1, W - 4]) {
    pen.rect(x, 13, 3, H - 13, '#4a2f1a');
    pen.rect(x, 13, 1, H - 13, '#6e4a2c');
  }
  // Ouverture de l'étal : étagères où brillent des bocaux et un sac.
  pen.rect(7, 19, W - 14, H - 34, INK);
  pen.rect(8, 20, W - 16, H - 36, '#2a1c14');
  pen.rect(8, 20, W - 16, 2, '#160e09');
  pen.rect(8, 26, W - 16, 1, '#5a3a22');
  const jars = ['#c0392b', '#3f88cf', '#6fcf6a', '#f2c230', '#c0392b', '#3f88cf'];
  jars.forEach((col, i) => {
    const jx = 10 + i * 5;
    if (jx > W - 14) return;
    pen.rect(jx, 22, 3, 4, col);
    pen.px(jx, 22, '#ffffff');
    pen.rect(jx, 22, 3, 1, ramp(col).hi);
  });
  pen.rect(W - 17, 28, 6, 4, '#a8894a');
  pen.rect(W - 17, 28, 6, 1, '#d0b070');
  // Comptoir : plateau éclairé, pièces, balance.
  pen.slab(5, H - 14, W - 10, 6, '#9b6a3e');
  pen.rect(5, H - 8, W - 10, 1, '#4a2f1a');
  for (const [cx, cy, n] of [[11, H - 16, 3], [16, H - 17, 4], [31, H - 16, 3]] as const) {
    for (let k = 0; k < n; k++) {
      pen.rect(cx, cy + (n - 1 - k) * 0 - k, 4, 1, k % 2 ? '#e0b030' : '#f7d14a');
      pen.px(cx, cy - k, '#fff3b0');
    }
  }
  pen.rect(W - 13, H - 19, 1, 5, '#8a8e99');
  pen.rect(W - 16, H - 19, 7, 1, '#b4b9c4');
  pen.rect(W - 16, H - 18, 2, 1, '#f2c230');
  pen.rect(W - 10, H - 18, 2, 1, '#f2c230');
  // Auvent rayé : plis éclairés, ombre portée dessous, bord festonné.
  for (let x = 0; x < W; x += 6) {
    const red = (x / 6) % 2 === 0;
    const base = red ? '#c0392b' : '#ece5d2';
    const r = ramp(base);
    pen.rect(x, 6, 6, 10, base);
    pen.rect(x, 6, 6, 1, r.hi);
    pen.rect(x, 7, 1, 9, r.light);
    pen.rect(x + 5, 7, 1, 9, r.shade);
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x + 3, 19);
    ctx.lineTo(x + 6, 16);
    ctx.fill();
    pen.px(x + 2, 17, r.shade);
    pen.px(x + 3, 18, r.dark);
  }
  pen.rect(0, 16, W, 1, 'rgba(0,0,0,0.3)');
  pen.rect(0, 5, W, 1, INK);
  // Enseigne surmontée d'une pièce d'or.
  pen.rect(W / 2 - 9, -0, 18, 8, INK);
  pen.rect(W / 2 - 8, 1, 16, 6, '#3b2616');
  pen.rect(W / 2 - 8, 1, 16, 1, '#5a3a22');
  pen.rect(W / 2 - 3, 1, 6, 6, '#a07410');
  pen.rect(W / 2 - 2, 2, 4, 4, '#f2c230');
  pen.px(W / 2 - 2, 2, '#fff3b0');
  pen.rect(W / 2 - 1, 3, 2, 2, '#a07410');
  return c;
}

/** Atelier : bâtiment de pierre, toit d'ardoise, cheminée, forge ouverte et fenêtre chaude. */
export function buildWorkshopSprite(): HTMLCanvasElement {
  const W = 3 * TILE;
  const H = 2 * TILE + 12;
  const [c, ctx] = canvas(W, H);
  const pen = new Pen(ctx);
  // Murs de pierre : blocs irréguliers de tons variés, joints sombres.
  pen.rect(1, 13, W - 2, H - 13, INK);
  const stone = ramp('#84796c');
  pen.rect(2, 14, W - 4, H - 14, stone.dark);
  for (let row = 0, y = 14; y < H; row++, y += 5) {
    let x = 2 - ((row * 5) % 8);
    while (x < W - 2) {
      const w = 5 + ((x * 3 + row * 7) % 4);
      const bx = Math.max(2, x);
      const bw = Math.min(W - 2, x + w) - bx;
      if (bw > 0) {
        const tone = Math.abs(x * 5 + row * 11) % 4;
        pen.rect(bx, y, bw, Math.min(4, H - y), tone === 0 ? stone.light : tone === 3 ? stone.shade : stone.base);
        pen.rect(bx, y, bw, 1, stone.hi);
      }
      x += w + 1;
    }
  }
  // Montants d'angle en pierre de taille.
  for (const x of [1, W - 4]) {
    pen.rect(x, 13, 3, H - 13, '#5e574d');
    pen.rect(x, 13, 1, H - 13, '#a09686');
  }
  // Toit d'ardoise : rangées d'écailles de deux tons, arête claire à gauche.
  const roof = ramp('#443f4c');
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-2, 17);
  ctx.lineTo(W / 2, 1);
  ctx.lineTo(W + 2, 17);
  ctx.fill();
  ctx.fillStyle = roof.base;
  ctx.beginPath();
  ctx.moveTo(-1, 16);
  ctx.lineTo(W / 2, 3);
  ctx.lineTo(W + 1, 16);
  ctx.fill();
  for (let y = 5; y <= 15; y += 2) {
    const half = ((y - 3) / 13) * (W / 2 + 1);
    for (let x = Math.ceil(W / 2 - half); x < W / 2 + half - 1; x += 4) {
      const alt = (((y - 5) / 2) | 0) % 2 ? 2 : 0;
      pen.rect(x + alt, y, 3, 1, roof.light);
      pen.px(x + alt + 3, y, roof.dark);
    }
  }
  pen.rect(0, 14, W, 3, '#5b5766');
  pen.rect(0, 14, W, 1, '#8a8598');
  pen.rect(0, 17, W, 1, 'rgba(0,0,0,0.35)');
  // Cheminée de pierre, coiffée et noircie.
  pen.slab(W - 12, 0, 6, 11, '#6a5a54');
  pen.rect(W - 13, 0, 8, 2, '#3f3230');
  pen.rect(W - 10, 3, 1, 7, '#4a3c38');
  // Porte ouverte sur la forge : arche de pierre, braises au sol, lueur qui monte.
  pen.rect(W / 2 - 8, H - 20, 16, 20, INK);
  pen.rect(W / 2 - 7, H - 19, 14, 19, '#1e1512');
  pen.rect(W / 2 - 8, H - 20, 16, 2, '#8a8074');
  pen.rect(W / 2 - 7, H - 7, 14, 4, '#7a3a18');
  pen.rect(W / 2 - 6, H - 5, 12, 3, '#e8792a');
  pen.rect(W / 2 - 4, H - 4, 8, 1, '#ffc163');
  pen.dither(W / 2 - 7, H - 10, 14, 3, '#1e1512', '#5a2a14');
  pen.rect(W / 2 - 3, H - 12, 6, 2, '#0a0708'); // silhouette d'enclume
  pen.rect(W / 2 - 2, H - 10, 4, 3, '#0a0708');
  // Fenêtre à croisillons, éclairée de l'intérieur.
  pen.rect(5, 23, 10, 9, INK);
  pen.rect(6, 24, 8, 7, '#f0b850');
  pen.rect(6, 24, 8, 2, '#ffe0a0');
  pen.rect(9, 24, 2, 7, '#5a3a22');
  pen.rect(6, 27, 8, 1, '#5a3a22');
  pen.rect(5, 32, 10, 1, '#5e574d');
  // Enseigne suspendue : une enclume.
  pen.rect(W - 18, 20, 12, 10, INK);
  pen.rect(W - 17, 21, 10, 8, '#3b2616');
  pen.rect(W - 17, 21, 10, 1, '#5a3a22');
  pen.rect(W - 16, 23, 8, 2, '#b4b9c4');
  pen.rect(W - 14, 25, 4, 3, '#8a8e99');
  pen.px(W - 16, 23, '#ffffff');
  // Tonneau cerclé de fer contre le mur.
  pen.slab(W - 24, H - 10, 6, 10, '#8a5a33');
  pen.rect(W - 24, H - 8, 6, 1, '#565a64');
  pen.rect(W - 24, H - 3, 6, 1, '#565a64');
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

export function buildLanternSprite(): HTMLCanvasElement {
  return fromArt(['..K..', '.KKK.', 'KYLYK', 'KLLLK', 'KYLYK', '.KKK.'], { K: '#3a2d22', Y: '#f2a93b', L: '#fff3b0' });
}

// ------------------------------------------------------------------ chantier du Grand Chevalement

/** Le chantier : 4 × 3 tuiles de socle, et une tour qui monte jusqu'à 128 px au-dessus du sol. */
const SITE_W = 4 * TILE;
const SITE_H = 128;
/** Sommet de la tour (les jambes s'y rejoignent), base des jambes, et rangées d'entretoises, de bas en haut. */
const SITE_TOP = 34;
const SITE_BASE = 104;
const SITE_BRACES = [96, 84, 72, 60, 50, 42, 36];

/** Segment épais de `w` pixels entre deux points, en pixels entiers. */
function beam(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  ctx.fillStyle = color;
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n - w / 2), Math.round(y0 + ((y1 - y0) * i) / n - w / 2), w, w);
}

/** Abscisse de l'axe de la jambe gauche à la hauteur `y` (la droite en est le miroir). */
const legX = (y: number): number => 9 + ((27 - 9) * (SITE_BASE - y)) / (SITE_BASE - SITE_TOP);

/** Disque ou anneau de pixels (sans crénelage adouci), éclairé en haut à gauche. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, thick: number, tones: { hi: string; base: string; dark: string }): void {
  for (let y = -r - 1; y <= r + 1; y++)
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.hypot(x, y);
      if (d > r + 0.4 || d < r - thick + 0.4) continue;
      ctx.fillStyle = x + y < -r * 0.6 ? tones.hi : x + y > r * 0.5 ? tones.dark : tones.base;
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
}

/** Les six états du chantier : terrain (0), fondations (1), charpente (2), treuil (3), poulies dorées (4), couronnement (5). */
export function buildSiteSprites(): HTMLCanvasElement[] {
  const stages: HTMLCanvasElement[] = [];
  const steel = ramp('#5d6577');
  const gold = ramp('#f2c230');
  for (let stage = 0; stage <= 5; stage++) {
    const [c, ctx] = canvas(SITE_W, SITE_H);
    const pen = new Pen(ctx);
    const gilded = stage >= 4;
    // Terrain battu, gravillons.
    pen.slab(1, 111, SITE_W - 2, 15, '#6e5a46');
    pen.dither(2, 113, SITE_W - 4, 4, '#6e5a46', '#7d6850');
    pen.rect(2, 118, SITE_W - 4, 1, 'rgba(0,0,0,0.25)');

    if (stage === 0) {
      // Panneau de chantier : le plan de la tour sur papier bleu, sous un petit auvent.
      for (const x of [12, 49]) {
        pen.rect(x, 90, 3, 22, '#5a3a22');
        pen.rect(x, 90, 1, 22, '#7a5231');
      }
      pen.rect(7, 62, 50, 34, INK);
      pen.rect(8, 63, 48, 32, '#7a5231');
      pen.rect(9, 67, 46, 27, '#2f5f9a');
      pen.rect(9, 67, 46, 1, '#5b8ad0');
      pen.rect(5, 59, 54, 5, INK);
      pen.rect(6, 60, 52, 3, '#a8894a');
      pen.rect(6, 60, 52, 1, '#d0b070');
      // Le plan : une tour en fil blanc, sa roue et la ligne du sol.
      beam(ctx, 24, 91, 30, 71, 1, '#e8f0ff');
      beam(ctx, 40, 91, 34, 71, 1, '#e8f0ff');
      for (const y of [86, 80, 75]) pen.rect(Math.round(24 + (91 - y) * 0.3) + 1, y, Math.round(16 - (91 - y) * 0.6), 1, '#e8f0ff');
      ring(ctx, 32, 70, 3, 1, { hi: '#e8f0ff', base: '#e8f0ff', dark: '#e8f0ff' });
      pen.rect(14, 92, 36, 1, '#e8f0ff');
      for (const [x, w] of [[12, 5], [18, 3], [22, 7]]) pen.rect(x, 64, w, 1, '#9dc0ee');
      // Pierres de taille en tas, et sacs de ciment.
      pen.slab(3, 100, 8, 8, '#8d857c');
      pen.slab(8, 104, 8, 6, '#b9b1a6');
      pen.slab(2, 106, 7, 5, '#84796c');
      pen.slab(52, 100, 9, 10, '#c9bd9c');
      pen.slab(54, 94, 7, 6, '#d6cba8');
    }

    if (stage >= 1) {
      // Socle de pierre et boulons d'ancrage.
      pen.slab(3, 100, SITE_W - 6, 11, '#84796c');
      for (let x = 6; x < SITE_W - 6; x += 9) pen.rect(x, 102, 1, 8, '#5e574d');
      pen.rect(3, 105, SITE_W - 6, 1, '#5e574d');
      for (const x of [8, 18, 44, 54]) {
        pen.px(x, 99, '#c9bd9c');
        pen.px(x, 98, '#8a8e99');
      }
    }
    if (stage === 1) {
      // Acier d'attente : des fers à béton dressés, rouillés, et une poutre posée à terre.
      for (const x of [9, 13, 50, 54]) pen.rect(x, 82, 1, 17, '#a5654e');
      pen.rect(26, 94, 14, 3, INK);
      pen.rect(27, 95, 12, 1, steel.light);
      pen.rect(21, 90, 22, 3, INK);
      pen.rect(22, 91, 20, 1, steel.light);
    }

    if (stage >= 2) {
      const top = stage >= 3 ? SITE_TOP : 66;
      // Jambes inclinées, accotées l'une à l'autre vers le haut.
      for (const mirrorIt of [false, true]) {
        const X = (x: number) => (mirrorIt ? SITE_W - 1 - x : x);
        beam(ctx, X(legX(SITE_BASE)), SITE_BASE, X(legX(top)), top, 6, INK);
        beam(ctx, X(legX(SITE_BASE)), SITE_BASE, X(legX(top)), top, 4, steel.base);
        beam(ctx, X(legX(SITE_BASE) - 1), SITE_BASE, X(legX(top) - 1), top, 1, steel.light);
        beam(ctx, X(legX(SITE_BASE) + 1), SITE_BASE, X(legX(top) + 1), top, 1, steel.dark);
        for (let y = SITE_BASE - 8; y >= top; y -= 14) pen.rivet(Math.round(X(legX(y))), y, '#8a8e99');
      }
      // Entretoises et croix de Saint-André entre les jambes.
      const rows = SITE_BRACES.filter((y) => y >= top);
      rows.forEach((y, i) => {
        const x0 = Math.round(legX(y)) + 2;
        const x1 = SITE_W - 1 - x0;
        pen.rect(x0, y - 1, x1 - x0 + 1, 3, INK);
        pen.rect(x0, y, x1 - x0 + 1, 1, steel.light);
        pen.rect(x0, y + 1, x1 - x0 + 1, 1, steel.dark);
        const up = rows[i + 1];
        if (up !== undefined) {
          const u0 = Math.round(legX(up)) + 2;
          beam(ctx, x0, y, SITE_W - 1 - u0, up, 1, steel.base);
          beam(ctx, x1, y, u0, up, 1, steel.base);
        }
      });
    }
    if (stage === 2) {
      // Plancher de chantier en haut de l'ouvrage, garde-corps et une échelle.
      const x0 = Math.round(legX(66)) + 1;
      pen.rect(x0, 63, SITE_W - 2 * x0, 3, INK);
      pen.rect(x0 + 1, 64, SITE_W - 2 * x0 - 2, 1, '#c9a46a');
      for (const x of [x0 + 2, SITE_W - x0 - 3]) pen.rect(x, 55, 1, 8, '#e8792a');
      pen.rect(x0 + 2, 55, SITE_W - 2 * x0 - 4, 1, '#e8792a');
      pen.rect(30, 66, 2, 34, '#a8894a');
      for (let y = 69; y < 98; y += 5) pen.rect(30, y, 6, 1, '#a8894a');
    }

    if (stage >= 3) {
      const tones = gilded ? { hi: gold.hi, base: gold.base, dark: gold.dark } : { hi: '#e3e7f0', base: '#b4b9c4', dark: '#5b5f68' };
      // Plate-forme du sommet, axe et grande poulie (la molette) : anneau, rayons, moyeu.
      pen.rect(21, 33, SITE_W - 42, 4, INK);
      pen.rect(22, 34, SITE_W - 44, 1, gilded ? gold.hi : steel.light);
      pen.rect(22, 35, SITE_W - 44, 1, gilded ? gold.dark : steel.dark);
      ring(ctx, 32, 24, 9, 2, tones);
      for (const [dx, dy] of [[0, 7], [5, 5], [7, 0], [5, -5], [0, -7], [-5, -5], [-7, 0], [-5, 5]]) beam(ctx, 32, 24, 32 + dx, 24 + dy, 1, tones.base);
      pen.rect(30, 22, 5, 5, INK);
      pen.rect(31, 23, 3, 3, tones.hi);
      pen.px(33, 25, tones.dark);
      // Câble de la cage : il descend du sommet et pend, avec sa cage, au milieu de la tour.
      pen.rect(32, 36, 1, 60, '#2a2024');
      pen.slab(28, 96, 9, 9, '#8a8e99');
      pen.rect(29, 99, 7, 1, '#3f4049');
      pen.rect(29, 102, 7, 1, '#3f4049');
      // Salle des machines : briques, toit d'ardoise, fenêtre éclairée, cheminée.
      pen.slab(43, 86, 19, 24, '#9a4a3a');
      for (let y = 89; y < 109; y += 4) pen.rect(44, y, 17, 1, '#6e2f24');
      for (let y = 87; y < 109; y += 8) for (let x = 45; x < 60; x += 6) pen.px(x + ((y >> 3) % 2) * 3, y + 1, '#c0684f');
      pen.rect(41, 83, 23, 4, INK);
      pen.rect(42, 80, 21, 5, '#443f4c');
      pen.rect(42, 80, 21, 1, '#8a8598');
      pen.rect(47, 92, 6, 6, INK);
      pen.rect(48, 93, 4, 4, '#f0b850');
      pen.rect(50, 93, 1, 4, '#5a3a22');
      pen.rect(55, 98, 4, 11, INK);
      pen.rect(56, 99, 2, 10, '#1e1512');
      pen.slab(55, 66, 5, 15, '#6a5a54');
      pen.rect(54, 65, 7, 2, '#3f3230');
      // Le câble de traction rejoint la salle des machines.
      beam(ctx, 41, 26, 56, 88, 1, '#2a2024');
    }

    if (gilded) {
      // Dorures : coiffes des jambes, garde-corps du sommet, lanternes aux angles du socle.
      for (const mirrorIt of [false, true]) {
        const x = Math.round(mirrorIt ? SITE_W - 1 - legX(SITE_TOP) : legX(SITE_TOP));
        pen.rect(x - 2, SITE_TOP - 2, 5, 3, gold.base);
        pen.rect(x - 2, SITE_TOP - 2, 5, 1, gold.hi);
      }
      for (const x of [4, SITE_W - 6]) {
        pen.rect(x, 90, 2, 10, '#4a3020');
        pen.slab(x - 1, 86, 4, 5, '#fff3b0');
        pen.px(x, 87, '#ffffff');
      }
      for (const y of [101, 107]) for (let x = 6; x < SITE_W - 6; x += 18) pen.px(x, y, gold.base);
    }

    if (stage === 5) {
      // Couronnement : un diamant taillé sur le sommet, et deux fanions.
      const diamond = fromArt(
        ['...WW...', '..WCCW..', '.WCCCCW.', 'WCCWWCCW', '.dCCCCd.', '..dCCd..', '...dd...'],
        { W: '#ffffff', C: '#8fe3ee', d: '#2f7f92' },
      );
      ctx.drawImage(diamond, 23, 1);
      for (const [x, dir] of [[21, -1], [42, 1]] as const) {
        pen.rect(x, 20, 1, 14, '#4a3020');
        for (let i = 0; i < 5; i++) pen.rect(x + (dir > 0 ? 1 : -i), 21 + i, dir > 0 ? 5 - i : i + 1, 1, '#c0392b');
        pen.px(x, 19, gold.hi);
      }
    }
    stages.push(c);
  }
  return stages;
}
