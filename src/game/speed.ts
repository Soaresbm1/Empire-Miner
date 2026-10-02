/**
 * Vitesse de jeu et pause : réglages et règles pures. La boucle de `Game` les applique ; la simulation, elle, ne change
 * pas (elle avance toujours par pas de SIM_DT, simplement plus ou moins souvent par image).
 */
import { SIM_DT } from '../core/constants';
import { GAS, HEALTH, WATER } from '../data/hazards';
import type { GameState, PlayerIntent } from '../sim/GameState';

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export const SPEED_LIMITS = {
  /** Pas de simulation au plus par image à vitesse normale ; il grandit avec la vitesse (au plus `maxSteps`). */
  stepsPerFrame: 8,
  maxSteps: 32,
  /** À vitesse accélérée : temps de calcul (ms) au-delà duquel l'image arrête d'avancer la simulation pour rester fluide. */
  budgetMs: 12,
  /** Sous cette part de la vitesse demandée, le bandeau signale que l'ordinateur n'arrive plus à suivre. */
  slowBelow: 0.8,
  /** Santé (part du maximum) sous laquelle la vitesse rapide est refusée ou coupée. */
  lowHealth: 0.4,
};

export function isSpeed(n: number): n is Speed {
  return (SPEEDS as readonly number[]).includes(n);
}

/** Vitesse suivante dans la liste (la dernière revient à la première) ; `step` négatif : la précédente. */
export function nextSpeed(cur: Speed, step = 1): Speed {
  const i = SPEEDS.indexOf(cur);
  return SPEEDS[(i + step + SPEEDS.length) % SPEEDS.length];
}

/** Nombre de pas de simulation permis dans une image à cette vitesse. */
export function stepCap(speed: Speed): number {
  return Math.min(SPEED_LIMITS.maxSteps, SPEED_LIMITS.stepsPerFrame * speed);
}

/**
 * Pourquoi le jeu accéléré serait dangereux ici : le temps de réaction se réduit d'autant. `null` quand tout va bien.
 * Santé basse, plafond qui craque à côté, grisou ou eau profonde sur place.
 */
export function speedDanger(g: GameState): string | null {
  const p = g.player;
  if (g.hp < HEALTH.max * SPEED_LIMITS.lowHealth) return 'santé basse';
  if (g.hazards.pendingNear(p.tileX, p.tileY, 4)) return 'le plafond craque';
  if (g.hazards.gasAt(p.tileX, p.tileY) >= GAS.harmful) return 'grisou';
  if (g.hazards.waterAt(p.tileX, p.tileY) >= WATER.deep) return 'eau profonde';
  return null;
}

/** Vitesse réellement obtenue, lissée : `steps` pas de simulation faits pendant `dt` secondes d'horloge. */
export function smoothRate(prev: number, steps: number, simDt: number, dt: number): number {
  if (dt <= 0) return prev;
  return prev + ((steps * simDt) / dt - prev) * 0.05;
}

/** L'ordinateur suit-il la vitesse demandée ? */
export function keepsUp(speed: Speed, rate: number): boolean {
  return speed === 1 || rate >= speed * SPEED_LIMITS.slowBelow;
}

/**
 * Avance la simulation d'une image : `dt` secondes d'horloge valent `dt × vitesse` secondes de jeu, par pas de SIM_DT.
 * `clock` (ms) sert au budget de calcul des vitesses accélérées : si l'image dure trop, elle arrête d'avancer la
 * simulation (le jeu tourne alors moins vite que demandé) plutôt que de figer l'affichage. Renvoie les pas faits.
 */
export function advance(g: GameState, time: { acc: number }, dt: number, speed: Speed, intent: PlayerIntent, clock: () => number = () => performance.now()): number {
  time.acc += dt * speed;
  const cap = stepCap(speed);
  const start = clock();
  let steps = 0;
  while (time.acc >= SIM_DT && steps < cap) {
    g.update(SIM_DT, intent);
    time.acc -= SIM_DT;
    steps++;
    if (speed > 1 && clock() - start > SPEED_LIMITS.budgetMs) break;
  }
  // Retard impossible à rattraper : on l'oublie plutôt que de s'y acharner image après image.
  if (time.acc >= SIM_DT) time.acc = 0;
  return steps;
}
