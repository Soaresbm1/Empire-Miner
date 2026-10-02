import { describe, expect, it } from 'vitest';
import { MAP_MAX_CELL, clampAxis, viewTileAt, zoomAround, type View } from '../src/render/MineMap';
import { GameState } from '../src/sim/GameState';
import { helpPanel, mapPanel } from '../src/ui/panels';

/** Canvas de 600 × 400 px, tuile « tout voir » de 4 px, tuile maximale de 40 px. */
const limits = { fitCell: 4, maxCell: 40, width: 600, height: 400 };
const fit: View = { x0: 0, y0: 0, cell: 4, ox: 0, oy: 0 };

/** Vue obtenue après un zoom : même calcul que `drawFull` (début = centre − demi-vue). */
function viewAfter(z: NonNullable<ReturnType<typeof zoomAround>>): View {
  return { x0: z.cx - limits.width / z.cell / 2, y0: z.cy - limits.height / z.cell / 2, cell: z.cell, ox: 0, oy: 0 };
}

describe('carte : zoom', () => {
  it('clampAxis : ramène la vue dans le monde, ou la centre quand le monde est plus petit', () => {
    expect(clampAxis(10, 30, 100)).toBe(10);
    expect(clampAxis(-5, 30, 100)).toBe(0);
    expect(clampAxis(90, 30, 100)).toBe(70);
    expect(clampAxis(0, 140, 100)).toBe(-20);
    expect(clampAxis(33, 100, 100)).toBe(0);
  });

  it('zoomAround : la case sous le curseur ne bouge pas', () => {
    for (const [px, py, factor] of [[300, 200, 2], [90, 310, 3.5], [560, 40, 1.35]] as const) {
      const z = zoomAround(fit, px, py, factor, limits)!;
      expect(z).not.toBeNull();
      const before = { x: fit.x0 + px / fit.cell, y: fit.y0 + py / fit.cell };
      const v = viewAfter(z);
      expect(z.cell).toBeCloseTo(4 * factor, 6);
      expect(v.x0 + px / v.cell).toBeCloseTo(before.x, 6);
      expect(v.y0 + py / v.cell).toBeCloseTo(before.y, 6);
    }
  });

  it('zoomAround : zoomer puis dézoomer autour du même point revient au départ', () => {
    const z1 = zoomAround(fit, 220, 130, 3, limits)!;
    const z2 = zoomAround(viewAfter(z1), 220, 130, 1 / 3, limits);
    expect(z2).toBeNull(); // retour à « tout voir » (cadrage automatique)
  });

  it('zoomAround : le zoom est borné — tuile maximale en haut, « tout voir » en bas', () => {
    const big = zoomAround(fit, 100, 100, 1000, limits)!;
    expect(big.cell).toBe(limits.maxCell);
    expect(zoomAround(fit, 100, 100, 0.2, limits)).toBeNull();
    expect(zoomAround(fit, 100, 100, 1, limits)).toBeNull();
    const inner = zoomAround({ x0: 5, y0: 5, cell: 12, ox: 0, oy: 0 }, 10, 10, 0.1, limits);
    expect(inner).toBeNull();
    expect(MAP_MAX_CELL).toBeGreaterThanOrEqual(20);
  });

  it('zoomAround : fonctionne aussi depuis une vue déjà zoomée et décalée', () => {
    const v: View = { x0: 31.5, y0: 12.25, cell: 10, ox: 0, oy: 0 };
    const z = zoomAround(v, 123, 77, 1.5, limits)!;
    const after = viewAfter(z);
    expect(z.cell).toBeCloseTo(15, 6);
    expect(after.x0 + 123 / after.cell).toBeCloseTo(31.5 + 12.3, 6);
    expect(after.y0 + 77 / after.cell).toBeCloseTo(12.25 + 7.7, 6);
    // La case désignée est la même avant et après.
    const t0 = viewTileAt(v, 123, 77);
    const t1 = viewTileAt(after, 123, 77);
    expect(t1).toEqual(t0);
  });
});

describe('carte : panneau', () => {
  const colors = { player: '#fff', gallery: '#aaa', rock: '#333', building: '#ddd', drill: '#fc0', borer: '#f55', furnace: '#d42', safety: '#ca6', water: '#36b', gas: '#8a3', belt: '#99a', storage: '#c93', shipping: '#e82', track: '#b63', wagon: '#fff' };

  it('quatre boutons de zoom : −, +, Tout voir, Me retrouver', () => {
    const html = mapPanel(new GameState(4), colors);
    for (const arg of ['out', 'in', 'reset', 'me']) expect(html).toContain(`data-action="mapZoom" data-arg="${arg}"`);
    expect(html).toContain('Tout voir');
    expect(html).toContain('Me retrouver');
  });

  it('la carte n’agit plus au premier appui (le glissé sert à la déplacer) : le canvas n’a pas de data-action', () => {
    const html = mapPanel(new GameState(4), colors);
    const canvas = html.match(/<canvas id="map-canvas"[^>]*>/)![0];
    expect(canvas).not.toContain('data-action');
    expect(canvas).toContain('molette');
  });

  it('le panneau et l’aide expliquent la molette, le glissé et la touche 0', () => {
    const html = mapPanel(new GameState(4), colors);
    expect(html).toContain('Molette');
    expect(html).toContain('glissez pour déplacer');
    const help = helpPanel({ move: 'ZQSD', label: (c) => c });
    expect(help).toContain('Molette');
    expect(help).toContain('Me retrouver');
  });
});
