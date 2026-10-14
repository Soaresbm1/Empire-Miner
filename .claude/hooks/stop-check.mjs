/**
 * Stop : avant que Claude rende la main, vérifie ce qui a changé, et seulement ça.
 * - Rien à faire si aucun fichier TypeScript de src/ ou tests/ n'a changé (git), ou si ces changements ont déjà été vérifiés
 *   avec succès (empreinte gardée dans le dossier temporaire du système, hors du dépôt).
 * - Sinon : `tsc --noEmit` (≈ 3 s), puis `vitest related` sur les fichiers modifiés. tests/session*.test.ts (≈ 6 min) n'est
 *   inclus que si src/net ou src/save a changé.
 * - Échec : Claude reçoit la fin de la sortie et reprend la main pour corriger. Une seule fois par arrêt (`stop_hook_active`),
 *   pour ne jamais boucler.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, readEvent, reply, run, tail } from './lib.mjs';

const ev = await readEvent();
if (ev.stop_hook_active) process.exit(0);
if (!existsSync(join(ROOT, 'node_modules', 'vitest'))) process.exit(0); // session-start a déjà signalé l'absence de npm ci

const git = (args) => run('git', args, 30_000).out.split('\n').map((s) => s.trim()).filter(Boolean);
const changed = [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])]
  .filter((f) => /^(src|tests)\/.*\.ts$/.test(f) && existsSync(join(ROOT, f)));
if (!changed.length) process.exit(0);

// Empreinte des changements : noms et contenus.
const hash = createHash('sha1');
for (const f of changed.sort()) hash.update(f).update(readFileSync(join(ROOT, f)));
const fingerprint = hash.digest('hex');
const cacheFile = join(tmpdir(), `empire-miner-stop-check-${createHash('sha1').update(ROOT).digest('hex').slice(0, 8)}.json`);
try {
  if (JSON.parse(readFileSync(cacheFile, 'utf8')).green === fingerprint) process.exit(0);
} catch {
  // pas encore de vérification réussie
}

const node = process.execPath;
const tsc = run(node, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], 120_000);
if (tsc.code !== 0) fail('Types (`npm run typecheck`)', tsc.out);

const network = changed.some((f) => f.startsWith('src/net/') || f.startsWith('src/save/'));
const args = [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'related', ...changed, '--run', '--testTimeout=120000', '--passWithNoTests', '--reporter=dot'];
if (!network) args.push('--exclude', 'tests/session.test.ts', '--exclude', 'tests/session-lifecycle.test.ts');
const tests = run(node, args, 540_000);
if (tests.code !== 0) fail(`Tests liés aux fichiers modifiés (${changed.length})`, tests.out);

writeFileSync(cacheFile, JSON.stringify({ green: fingerprint, at: new Date().toISOString() }));
process.exit(0);

function fail(what, out) {
  reply({
    decision: 'block',
    reason: `Vérification de fin de tâche : échec. ${what}.\nFichiers modifiés : ${changed.join(', ')}\n\n${tail(out)}\n\nCorriger, ou expliquer à la personne pourquoi cet échec est attendu (ne pas l'annoncer comme réussi).`,
  });
}
