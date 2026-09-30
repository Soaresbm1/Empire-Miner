/**
 * Boîte à outils de pixel art : rampes de couleurs et petites formes éclairées.
 *
 * La lumière vient toujours d'en haut à gauche. Chaque couleur de base donne une rampe
 * (reflet, clair, base, ombre, sombre) : les machines ont ainsi toutes le même modelé.
 */
import { hex, mix } from './color';

/** Contour commun à tous les sprites. */
export const INK = '#1a1418';

export interface Ramp {
  /** Reflet vif (arête éclairée). */
  hi: string;
  /** Face éclairée. */
  light: string;
  base: string;
  /** Face à l'ombre. */
  shade: string;
  /** Creux, dessous. */
  dark: string;
}

const cache = new Map<string, Ramp>();

function toHex(c: [number, number, number]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** Rampe de cinq tons dérivée d'une couleur de base (les ombres tirent un peu vers le violet). */
export function ramp(base: string): Ramp {
  let r = cache.get(base);
  if (!r) {
    const b = hex(base);
    const white: [number, number, number] = [255, 250, 235];
    const cool: [number, number, number] = [30, 18, 44];
    r = {
      hi: toHex(mix(b, white, 0.55)),
      light: toHex(mix(b, white, 0.25)),
      base,
      shade: toHex(mix(b, cool, 0.28)),
      dark: toHex(mix(b, cool, 0.55)),
    };
    cache.set(base, r);
  }
  return r;
}

/** Pinceau : formes éclairées sur un contexte 2D, en pixels entiers. */
export class Pen {
  constructor(public ctx: CanvasRenderingContext2D) {}

  px(x: number, y: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, w, h);
  }

  /**
   * Bloc éclairé : contour sombre, arête haute et gauche claires, bas et droite dans l'ombre.
   * `outline: false` pour un bloc collé à un autre.
   */
  slab(x: number, y: number, w: number, h: number, base: string, outline = true): void {
    const r = ramp(base);
    if (outline) this.rect(x - 1, y - 1, w + 2, h + 2, INK);
    this.rect(x, y, w, h, r.base);
    if (w > 2 && h > 2) {
      this.rect(x, y, w, 1, r.hi);
      this.rect(x, y + 1, 1, h - 1, r.light);
      this.rect(x + w - 1, y + 1, 1, h - 1, r.shade);
      this.rect(x + 1, y + h - 1, w - 1, 1, r.dark);
    } else {
      this.rect(x, y, w, 1, r.light);
    }
  }

  /** Cylindre : bande éclairée au centre-gauche, ombre à droite. `vertical` : axe vertical. */
  tube(x: number, y: number, w: number, h: number, base: string, vertical = true): void {
    const r = ramp(base);
    this.rect(x, y, w, h, r.base);
    if (vertical) {
      this.rect(x, y, 1, h, r.shade);
      this.rect(x + 1, y, Math.max(1, Math.floor(w / 3)), h, r.light);
      if (w > 4) this.rect(x + 1, y, 1, h, r.hi);
      this.rect(x + w - 1, y, 1, h, r.dark);
    } else {
      this.rect(x, y, w, 1, r.shade);
      this.rect(x, y + 1, w, Math.max(1, Math.floor(h / 3)), r.light);
      if (h > 4) this.rect(x, y + 1, w, 1, r.hi);
      this.rect(x, y + h - 1, w, 1, r.dark);
    }
  }

  /** Rivet : un point sombre avec son reflet. */
  rivet(x: number, y: number, base = '#8a8e99'): void {
    const r = ramp(base);
    this.px(x, y, r.dark);
    this.px(x, y - 1, r.hi);
  }

  /** Damier de deux couleurs (dégradé pixelisé). */
  dither(x: number, y: number, w: number, h: number, a: string, b: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, (i + j) % 2 ? b : a);
  }

  /** Ombre portée ovale, sous une machine. */
  shadow(x: number, y: number, w: number, alpha = 0.32): void {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(6,4,10,${alpha})`;
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.fillRect(x, y + 1, w, 2);
    ctx.fillRect(x + 1, y + 3, w - 2, 1);
  }
}
