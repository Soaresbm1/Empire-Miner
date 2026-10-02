import { describe, expect, it } from 'vitest';
import { ROPE } from '../src/data/tools';
import { ROPE_HANG, ROPE_LAND_HEIGHT, ROPE_LAND_TIME, ROPE_SINK, landLift, ropeFrame } from '../src/render/ropeAnim';

const T = ROPE.channel;
/** Hauteur qu'il faut au mineur pour sortir de l'écran par le haut (exemple : 180 px). */
const REACH = 180;
const steps = Array.from({ length: 61 }, (_, i) => (i / 60) * T);

describe('montée à la corde : le mineur monte avec elle', () => {
  it('commence au sol, sans corde déroulée', () => {
    const f = ropeFrame('up', 0, T, REACH);
    expect(f.lift).toBe(0);
    expect(f.unroll).toBe(0);
    expect(f.shadow).toBe(1);
  });

  it('la corde est entièrement déroulée avant que le mineur ne décolle vraiment', () => {
    const f = ropeFrame('up', 0.5, T, REACH);
    expect(f.unroll).toBe(1);
    expect(f.lift).toBeLessThan(ROPE_HANG + 1);
    expect(f.lift).toBeGreaterThanOrEqual(ROPE_HANG - 0.001);
  });

  it('ne cesse jamais de monter, et de plus en plus vite', () => {
    const lifts = steps.map((t) => ropeFrame('up', t, T, REACH).lift);
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).toBeGreaterThanOrEqual(lifts[i - 1]);
    // Vitesse (écart d'une image à l'autre) : plus grande à la fin qu'au milieu de la montée.
    const gap = (i: number) => lifts[i + 1] - lifts[i];
    expect(gap(55)).toBeGreaterThan(gap(30));
  });

  it('sort de l\'écran à la fin de la manœuvre : la hauteur atteinte couvre la distance au bord haut', () => {
    const f = ropeFrame('up', T, T, REACH);
    expect(f.lift).toBeGreaterThanOrEqual(REACH);
  });

  it('l\'ombre qu\'il laisse au sol s\'efface en montant', () => {
    expect(ropeFrame('up', T, T, REACH).shadow).toBe(0);
    const shadows = steps.map((t) => ropeFrame('up', t, T, REACH).shadow);
    for (let i = 1; i < shadows.length; i++) expect(shadows[i]).toBeLessThanOrEqual(shadows[i - 1]);
  });

  it('un temps hors de la manœuvre est ramené dans ses bornes', () => {
    expect(ropeFrame('up', -1, T, REACH).lift).toBe(0);
    expect(ropeFrame('up', T + 5, T, REACH)).toEqual(ropeFrame('up', T, T, REACH));
  });

  it('une hauteur d\'écran négative (caméra étrange) ne le fait pas descendre', () => {
    expect(ropeFrame('up', T, T, -50).lift).toBeGreaterThanOrEqual(0);
  });
});

describe('descente à la corde : le mineur s\'enfonce dans un trou', () => {
  it('commence au sol, le trou s\'ouvre tout de suite', () => {
    const start = ropeFrame('down', 0, T, REACH);
    expect(start.lift).toBeCloseTo(0, 5);
    expect(start.hole).toBe(0);
    expect(ropeFrame('down', 0.4, T, REACH).hole).toBe(1);
  });

  it('s\'enfonce de plus en plus, jusqu\'à disparaître sous le sol', () => {
    const lifts = steps.map((t) => ropeFrame('down', t, T, REACH).lift);
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).toBeLessThanOrEqual(lifts[i - 1]);
    expect(lifts[lifts.length - 1]).toBe(-ROPE_SINK);
    // Plus profond que le mineur n'est haut (20 px environ) : il n'en reste rien à l'écran.
    expect(ROPE_SINK).toBeGreaterThanOrEqual(22);
  });

  it('l\'ombre disparaît avec lui', () => {
    expect(ropeFrame('down', T, T, REACH).shadow).toBe(0);
  });
});

describe('arrivée', () => {
  it('le mineur se pose : de la hauteur de chute à zéro', () => {
    expect(landLift(ROPE_LAND_TIME)).toBe(ROPE_LAND_HEIGHT);
    expect(landLift(0)).toBe(0);
    expect(landLift(-1)).toBe(0);
    expect(landLift(ROPE_LAND_TIME * 5)).toBe(ROPE_LAND_HEIGHT);
    const mid = landLift(ROPE_LAND_TIME / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(ROPE_LAND_HEIGHT);
  });
});
