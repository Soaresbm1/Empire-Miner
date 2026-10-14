/**
 * PostToolUse (Edit, Write) : contrôle immédiat d'un fichier de simulation qu'on vient d'écrire.
 * - Déterminisme (src/sim, src/net/digest.ts) : mêmes fonctions interdites et mêmes exceptions que le test
 *   « la simulation n'utilise aucune fonction mathématique qui varie d'un moteur à l'autre » (tests/multiplayer-sim.test.ts).
 *   Garder les deux listes identiques.
 * - Séparation (src/sim, src/data) : aucun import de la présentation (ui, render, game, audio, cloud), aucun objet du navigateur.
 * Ne dit rien quand tout va bien ; sinon le message revient à Claude, qui corrige avant de continuer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readEvent, reply, repoPath } from './lib.mjs';

const ev = await readEvent();
const rel = repoPath(ev.tool_input?.file_path);
if (!rel || !rel.endsWith('.ts')) process.exit(0);

const deterministic = rel.startsWith('src/sim/') || rel === 'src/net/digest.ts';
const pure = rel.startsWith('src/sim/') || rel.startsWith('src/data/');
if (!deterministic && !pure) process.exit(0);

let text;
try {
  text = readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '');
} catch {
  process.exit(0);
}

const banned = /Math\.(hypot|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|cbrt|random)\b|\*\*/;
const allowed = new Set(['src/sim/GameState.ts:Math.atan2', 'src/sim/Drops.ts:Math.random']);
const presentation = /from\s+['"](\.\.\/)+(ui|render|game|audio|cloud)\//;
const browser = /\b(window|document|localStorage|sessionStorage|navigator)\./;

const problems = [];
text.split('\n').forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '').replace(/^\s*(\*|\/\*).*$/, '');
  if (deterministic) {
    const m = banned.exec(code);
    if (m && !allowed.has(`${rel}:${m[0]}`)) problems.push(`${rel}:${i + 1} « ${m[0]} » varie d'un moteur JavaScript à l'autre : utiliser core/dmath.ts (hyp, dexp, dlog, smallCosSin) ou les tirages de la simulation.`);
  }
  if (pure && presentation.test(code)) problems.push(`${rel}:${i + 1} la simulation importe la présentation : passer par un SimEvent ou par Game.`);
  if (pure && browser.test(code)) problems.push(`${rel}:${i + 1} objet du navigateur dans la simulation : elle doit tourner sous Node, sans DOM.`);
});

if (problems.length) {
  reply({
    decision: 'block',
    reason: `Règles de la simulation (CLAUDE.md) non respectées :\n${problems.slice(0, 12).join('\n')}${problems.length > 12 ? `\n… et ${problems.length - 12} autres` : ''}`,
  });
}
