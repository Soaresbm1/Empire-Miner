/**
 * Configuration du banc de simulation, séparée de celle des tests (`npm test` ne lance pas le banc : il dure plusieurs minutes).
 * Lancer : `npm run balance` (ou `npx vitest run --config tests/balance/vitest.config.ts`).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tests/balance/**/*.sim.ts'],
    environment: 'node',
    // Les parties simulées durent des heures de jeu : pas de limite de 5 s par essai.
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
    // Un seul fichier à la fois : les mesures de vitesse ne doivent pas se disputer le processeur.
    fileParallelism: false,
  },
});
