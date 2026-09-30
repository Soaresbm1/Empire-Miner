import { describe, expect, it } from 'vitest';
import { PLAYER_ART } from '../src/render/sprites';

/** Le mineur est dessiné en texte : une rangée trop courte ou trop longue décale tout le sprite. */
describe('dessins du mineur', () => {
  const { HEAD_DOWN, BODY_DOWN, HEAD_UP, BODY_UP, LEGS_FRONT, HEAD_SIDE, BODY_SIDE, LEGS_SIDE } = PLAYER_ART;

  it('toutes les rangées ont la même largeur', () => {
    const rows = [HEAD_DOWN, BODY_DOWN, HEAD_UP, BODY_UP, HEAD_SIDE, BODY_SIDE, ...LEGS_FRONT, ...LEGS_SIDE].flat();
    for (const r of rows) expect(r.length, r).toBe(12);
  });

  it('chaque vue fait 18 rangées, et la marche a cinq images (repos, pas, passage, pas, passage)', () => {
    expect(LEGS_FRONT.length).toBe(5);
    expect(LEGS_SIDE.length).toBe(5);
    for (const legs of [...LEGS_FRONT, ...LEGS_SIDE]) expect(legs.length).toBe(6);
    expect(HEAD_DOWN.length + BODY_DOWN.length + LEGS_FRONT[0].length).toBe(18);
    expect(HEAD_UP.length + BODY_UP.length + LEGS_FRONT[0].length).toBe(18);
    expect(HEAD_SIDE.length + BODY_SIDE.length + LEGS_SIDE[0].length).toBe(18);
  });

  it('n’utilise que des lettres de la palette', () => {
    const allowed = new Set('.LYhyWwSsHEmuTtBcbGgPpKk');
    const rows = [HEAD_DOWN, BODY_DOWN, HEAD_UP, BODY_UP, HEAD_SIDE, BODY_SIDE, ...LEGS_FRONT, ...LEGS_SIDE].flat();
    for (const r of rows) for (const ch of r) expect(allowed.has(ch), `${ch} dans ${r}`).toBe(true);
  });
});
