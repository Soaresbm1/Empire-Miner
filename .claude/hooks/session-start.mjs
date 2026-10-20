/**
 * SessionStart : quelques lignes de contexte, rien de plus.
 * - Démarrage ou reprise : dépendances installées ? branche et travail en cours.
 * - Après un résumé du contexte (`compact`) : rappel des règles qui ne se discutent pas (CLAUDE.md), qu'un résumé peut perdre.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readEvent, reply, run } from './lib.mjs';

const ev = await readEvent();
const lines = [];

if (ev.source === 'compact') {
  lines.push(
    'Rappel Empire Miner (CLAUDE.md fait foi) :',
    '1. src/sim et src/data sans DOM ni import de ui/render/game.',
    '2. Déterminisme : pas de Math.random/exp/log/sin/cos/pow/hypot ni ** dans src/sim et src/net/digest.ts (core/dmath.ts).',
    '3. Toute modification de partie passe par une SimAction (src/sim/actions.ts).',
    '4. Sauvegardes : champs nouveaux facultatifs et vérifiés, ne jamais réordonner RESOURCES (skill save-integrity).',
    '5. Tests sous Windows : npm test -- --testTimeout=120000 ; jamais tests-net/ sans accord.',
    '6. Aucun commit, push ou merge sans autorisation ; ne citer que les tests réellement lancés.',
  );
} else {
  if (!existsSync(join(ROOT, 'node_modules', 'vitest'))) lines.push('Dépendances absentes : lancer `npm ci` avant les tests (installation exacte, sans changer package-lock.json).');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) lines.push(`Node ${process.versions.node} : le CI utilise Node 22, installer une version au moins égale.`);
  const branch = run('git', ['branch', '--show-current'], 10_000).out.trim();
  const dirty = run('git', ['status', '--porcelain'], 10_000).out.split('\n').filter(Boolean).length;
  lines.push(`Branche : ${branch || '(détachée)'} ; fichiers modifiés ou nouveaux : ${dirty}.`);
  if (branch === 'main') lines.push('Sur main : créer une branche avant de modifier quoi que ce soit.');
}

reply({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
