/** Petits utilitaires de couleur (RGB 0-255). */
export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function hex(h: string): RGB {
  let c = cache.get(h);
  if (!c) {
    const v = h.replace('#', '');
    const full = v.length === 3 ? v.split('').map((x) => x + x).join('') : v;
    c = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    cache.set(h, c);
  }
  return c;
}

export function scale(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(c: RGB, a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
