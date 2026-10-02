import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/constants';
import { HEALTH } from '../src/data/hazards';
import { SPEEDS, SPEED_LIMITS, advance, isSpeed, keepsUp, nextSpeed, smoothRate, speedDanger, stepCap } from '../src/game/speed';
import { GameState, NO_INTENT } from '../src/sim/GameState';
import { helpPanel } from '../src/ui/panels';
import { speedBar } from '../src/ui/speedBar';
import { teleport } from './helpers';

const keys = { pause: 'P', speed: 'X' };
const view = (over: Partial<Parameters<typeof speedBar>[0]> = {}) => ({ speed: 1 as const, paused: false, rate: 1, keepsUp: true, keys, ...over });

describe('vitesse de jeu : règles', () => {
  it('trois vitesses, ×1 ×2 ×4, et la suivante fait le tour', () => {
    expect([...SPEEDS]).toEqual([1, 2, 4]);
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(1);
    expect(nextSpeed(1, -1)).toBe(4);
    expect(nextSpeed(4, -1)).toBe(2);
  });

  it('isSpeed refuse tout ce qui n’est pas une vitesse', () => {
    expect([1, 2, 4].every(isSpeed)).toBe(true);
    expect([0, 3, 8, -1, NaN].some(isSpeed)).toBe(false);
  });

  it('plafond de pas par image : celui d’avant à ×1, plus large ensuite, jamais au-delà du maximum', () => {
    expect(stepCap(1)).toBe(8);
    expect(stepCap(2)).toBe(16);
    expect(stepCap(4)).toBe(32);
    expect(stepCap(4)).toBeLessThanOrEqual(SPEED_LIMITS.maxSteps);
  });

  it('smoothRate converge vers la vitesse réellement obtenue', () => {
    let r = 4;
    for (let i = 0; i < 200; i++) r = smoothRate(r, 2, SIM_DT, 1 / 60); // 2 pas par image à 60 i/s : ×2
    expect(r).toBeCloseTo(2, 1);
    expect(smoothRate(3, 5, SIM_DT, 0)).toBe(3);
  });

  it('keepsUp : à ×1 toujours ; au-delà, tant qu’on atteint 80 % de la vitesse demandée', () => {
    expect(keepsUp(1, 0.2)).toBe(true);
    expect(keepsUp(4, 4)).toBe(true);
    expect(keepsUp(4, 3.3)).toBe(true);
    expect(keepsUp(4, 3.1)).toBe(false);
    expect(keepsUp(2, 1.5)).toBe(false);
  });
});

describe('vitesse de jeu : la simulation', () => {
  /** Une seconde d'horloge en 60 images. */
  const second = (g: GameState, speed: 1 | 2 | 4, clock?: () => number) => {
    const time = { acc: 0 };
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += advance(g, time, 1 / 60, speed, NO_INTENT, clock);
    return steps;
  };

  it('une seconde d’horloge fait 1, 2 ou 4 secondes de jeu', () => {
    for (const speed of [1, 2, 4] as const) {
      const g = new GameState(4);
      const t0 = g.time;
      const steps = second(g, speed, () => 0);
      expect(g.time - t0).toBeCloseTo(speed, 1);
      expect(steps).toBeGreaterThanOrEqual(60 * speed - 1);
      expect(steps).toBeLessThanOrEqual(60 * speed + 1);
    }
  });

  it('aller vite ne change pas la partie : même état qu’à vitesse normale pour le même nombre de pas', () => {
    const slow = new GameState(7);
    const fast = new GameState(7);
    second(slow, 1, () => 0);
    second(slow, 1, () => 0);
    second(slow, 1, () => 0);
    second(slow, 1, () => 0);
    second(fast, 4, () => 0);
    expect(fast.time).toBeCloseTo(slow.time, 1);
    expect(fast.market.price('copper')).toBeCloseTo(slow.market.price('copper'), 5);
    expect(JSON.stringify(fast.stats.collected)).toBe(JSON.stringify(slow.stats.collected));
  });

  it('à ×1, une image très longue ne rattrape pas plus de huit pas et oublie le reste', () => {
    const g = new GameState(4);
    const time = { acc: 0 };
    const steps = advance(g, time, 0.5, 1, NO_INTENT, () => 0);
    expect(steps).toBe(8);
    expect(time.acc).toBe(0);
  });

  it('budget de calcul : à ×4, une image lente s’arrête tôt et le retard est oublié', () => {
    const g = new GameState(4);
    let now = 0;
    const clock = () => (now += 5); // chaque pas « coûte » 5 ms
    const time = { acc: 0 };
    const steps = advance(g, time, 0.1, 4, NO_INTENT, clock);
    expect(steps).toBeLessThan(stepCap(4));
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(time.acc).toBe(0);
  });

  it('le budget ne s’applique pas à vitesse normale', () => {
    const g = new GameState(4);
    let now = 0;
    const steps = advance(g, { acc: 0 }, 0.1, 1, NO_INTENT, () => (now += 50));
    expect(steps).toBe(6);
  });

  it('pas de temps de reste perdu quand l’ordinateur suit : 60 images à ×2 = 120 pas', () => {
    const g = new GameState(4);
    expect(second(g, 2, () => 0)).toBeGreaterThanOrEqual(119);
  });
});

describe('vitesse de jeu : frein de sécurité', () => {
  const miner = () => {
    const g = new GameState(4);
    teleport(g, 50, 30);
    return g;
  };

  it('rien à signaler : aucune raison de ralentir', () => {
    expect(speedDanger(miner())).toBeNull();
  });

  it('santé basse', () => {
    const g = miner();
    g.hp = HEALTH.max * SPEED_LIMITS.lowHealth - 1;
    expect(speedDanger(g)).toBe('santé basse');
    g.hp = HEALTH.max * SPEED_LIMITS.lowHealth + 1;
    expect(speedDanger(g)).toBeNull();
  });

  it('plafond qui craque à côté', () => {
    const g = miner();
    g.hazards.pending.push({ x: g.player.tileX + 2, y: g.player.tileY, t: 3 });
    expect(speedDanger(g)).toBe('le plafond craque');
    g.hazards.pending.length = 0;
    g.hazards.pending.push({ x: g.player.tileX + 30, y: g.player.tileY, t: 3 });
    expect(speedDanger(g)).toBeNull();
  });

  it('grisou nocif et eau profonde sur place', () => {
    const g = miner();
    const i = g.world.idx(g.player.tileX, g.player.tileY);
    g.world.gas[i] = 200;
    expect(speedDanger(g)).toBe('grisou');
    g.world.gas[i] = 0;
    g.world.water[i] = 250;
    expect(speedDanger(g)).toBe('eau profonde');
    g.world.water[i] = 0;
    expect(speedDanger(g)).toBeNull();
  });
});

describe('vitesse de jeu : bandeau', () => {
  it('quatre boutons : pause, ×1, ×2, ×4, avec leurs touches', () => {
    const html = speedBar(view());
    for (const arg of ['0', '1', '2', '4']) expect(html).toContain(`data-action="speed" data-arg="${arg}"`);
    expect(html).toContain('Pause (P)');
    expect(html).toContain('X : vitesse suivante');
    expect(html).toMatch(/class="sp on" data-action="speed" data-arg="1"/);
    expect(html).not.toContain('sp-note');
  });

  it('la vitesse choisie est allumée, et le bandeau passe en « fast » à vitesse rapide', () => {
    const html = speedBar(view({ speed: 4 }));
    expect(html).toMatch(/class="sp on" data-action="speed" data-arg="4"/);
    expect(html).toMatch(/class="sp " data-action="speed" data-arg="1"/);
    expect(html).toContain('speedbar fast');
    expect(speedBar(view())).not.toContain(' fast');
  });

  it('en pause : seul le bouton de pause est allumé, avec une note qui dit ce qui reste possible', () => {
    const html = speedBar(view({ speed: 2, paused: true }));
    expect(html).toMatch(/class="sp sp-pause on"/);
    expect(html).not.toMatch(/class="sp on" data-action="speed" data-arg="2"/);
    expect(html).toContain('speedbar paused');
    expect(html).toContain('En pause');
    expect(html).toContain('Reprendre (P)');
  });

  it('quand l’ordinateur ne suit pas, le bandeau donne la vitesse réelle', () => {
    const html = speedBar(view({ speed: 4, rate: 2.64, keepsUp: false }));
    expect(html).toContain('tourne à ×2,6');
    expect(speedBar(view({ speed: 4, rate: 4, keepsUp: true }))).not.toContain('tourne à');
    // À vitesse normale, jamais de note de lenteur.
    expect(speedBar(view({ speed: 1, rate: 0.5, keepsUp: true }))).not.toContain('tourne à');
  });

  it('l’aide explique la vitesse et la pause', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => c.replace('Key', '') });
    expect(html).toContain('Vitesse de jeu et pause');
    expect(html).toContain('×4');
    expect(html).toContain('danger');
  });
});
