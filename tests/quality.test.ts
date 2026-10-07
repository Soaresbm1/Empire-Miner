import { describe, expect, it } from 'vitest';
import { Fx } from '../src/render/fx';
import { PROFILES, QUALITY_LABEL, QUALITY_ORDER, loadQuality, nextQuality, parseQuality, saveQuality } from '../src/render/quality';

describe('réglage de la qualité graphique', () => {
  it('tourne Élevée → Moyenne → Basse → Élevée', () => {
    expect(QUALITY_ORDER.map((q) => QUALITY_LABEL[q])).toEqual(['Élevée', 'Moyenne', 'Basse']);
    expect(nextQuality('high')).toBe('medium');
    expect(nextQuality('medium')).toBe('low');
    expect(nextQuality('low')).toBe('high');
  });

  it('une valeur inconnue ou absente donne la qualité élevée ; le stockage indisponible ne casse rien', () => {
    expect(parseQuality(null)).toBe('high');
    expect(parseQuality('ultra')).toBe('high');
    expect(parseQuality('low')).toBe('low');
    // Pas de navigateur dans les tests : la lecture et l'écriture échouent sans bruit.
    expect(loadQuality()).toBe('high');
    // Un appareil tactile sans réglage mémorisé démarre en « Moyenne ».
    expect(loadQuality('medium')).toBe('medium');
    expect(() => saveQuality('low')).not.toThrow();
  });

  it('chaque cran d’économie retire des effets', () => {
    const { high, medium, low } = PROFILES;
    expect(high.particles).toBeGreaterThan(medium.particles);
    expect(medium.particles).toBeGreaterThan(low.particles);
    expect(high.menuMotes).toBeGreaterThan(medium.menuMotes);
    expect(low.menuMotes).toBe(0);
    expect([high.glow, medium.glow, low.glow]).toEqual([true, true, false]);
    expect([high.detail, medium.detail, low.detail]).toEqual([true, false, false]);
  });

  it('les particules sont émises selon la densité, en moyenne', () => {
    const count = (density: number) => {
      const fx = new Fx();
      fx.density = density;
      for (let i = 0; i < 4000; i++) fx.emit('dust', 0, 0, '#fff', 1);
      return fx.particles.length;
    };
    expect(count(1)).toBe(4000);
    expect(count(0.5)).toBeGreaterThan(1800);
    expect(count(0.5)).toBeLessThan(2200);
    expect(count(0.2)).toBeLessThan(1000);
    const fx = new Fx();
    fx.density = 0.5;
    fx.emit('spark', 0, 0, '#fff', 10); // 10 grains d'un coup : la moitié sort
    expect(fx.particles.length).toBe(5);
  });
});
