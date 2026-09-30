import { describe, expect, it } from 'vitest';
import { PLAYER_ART, playerArt } from '../src/render/sprites';

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

/** L'équipement se lit sur le mineur : chaque pièce change des cases précises, sans rien décaler. */
describe('mineur équipé', () => {
  const base = playerArt();
  const all = playerArt({ helmet: true, mask: true, boots: true, suit: true });
  const rowsOf = (a: ReturnType<typeof playerArt>) => [a.headDown, a.headUp, a.headSide, ...a.legsFront, ...a.legsSide];

  it('sans équipement, ce sont exactement les dessins de base', () => {
    expect(base.headDown).toBe(PLAYER_ART.HEAD_DOWN);
    expect(base.headUp).toBe(PLAYER_ART.HEAD_UP);
    expect(base.headSide).toBe(PLAYER_ART.HEAD_SIDE);
    expect(base.legsFront).toEqual(PLAYER_ART.LEGS_FRONT);
    expect(base.legsSide).toEqual(PLAYER_ART.LEGS_SIDE);
  });

  it('les rangées habillées gardent la même largeur, le même nombre et les lettres de la palette', () => {
    const allowed = new Set('.LYhyWwSsHEmuTtBcbGgPpKkMFZz');
    for (const [i, rows] of rowsOf(all).entries()) {
      expect(rows.length, `dessin ${i}`).toBe(rowsOf(base)[i].length);
      for (const r of rows) {
        expect(r.length, r).toBe(12);
        for (const ch of r) expect(allowed.has(ch), `${ch} dans ${r}`).toBe(true);
      }
    }
  });

  it('le masque ne touche que le visage : de face, de dos et de profil', () => {
    const m = playerArt({ mask: true });
    const changed = (a: string[], b: string[]) => a.flatMap((r, i) => (r === b[i] ? [] : [i]));
    expect(changed(m.headDown, base.headDown)).toEqual([6, 7]);
    expect(changed(m.headUp, base.headUp)).toEqual([6]);
    expect(changed(m.headSide, base.headSide)).toEqual([6, 7]);
    expect(m.legsFront).toEqual(base.legsFront);
    expect(m.headDown[7]).toBe('..FMMMMMMF..');
    // Les yeux restent visibles.
    expect(m.headDown[6].match(/E/g)?.length).toBe(2);
    expect(m.headSide[6]).toContain('E');
  });

  it('les cuissardes ne touchent que les jambes, et laissent la ceinture', () => {
    const b = playerArt({ boots: true });
    expect(b.headDown).toBe(base.headDown);
    for (const [legs, plain] of [...b.legsFront.map((l, i) => [l, base.legsFront[i]]), ...b.legsSide.map((l, i) => [l, base.legsSide[i]])] as [string[], string[]][]) {
      expect(legs[0]).toBe(plain[0]);
      expect(legs.slice(1).join('')).toContain('Z');
      expect(legs.slice(1).join('')).not.toMatch(/[Bb]/);
    }
  });
});
