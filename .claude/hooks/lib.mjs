/**
 * Outils communs aux hooks Claude Code d'Empire Miner (Node seul : mêmes résultats sous Git Bash, PowerShell ou Linux).
 * Un hook reçoit sur l'entrée standard un JSON décrivant l'événement et répond, s'il a quelque chose à dire, par un JSON sur
 * la sortie standard. Sans réponse, l'action continue normalement.
 */
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt : deux dossiers au-dessus de ce fichier (.claude/hooks/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Lit l'événement envoyé par Claude Code (objet vide si rien n'arrive ou si le JSON est illisible). */
export async function readEvent() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Écrit la réponse du hook et termine. */
export function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

/** Chemin relatif à la racine, avec des « / » (ou null s'il sort du dépôt). */
export function repoPath(file) {
  if (!file) return null;
  const rel = relative(ROOT, resolve(ROOT, file));
  if (!rel || rel.startsWith('..') || resolve(rel) === rel) return null;
  return rel.split(sep).join('/');
}

/** Lance une commande sans shell depuis la racine ; renvoie le code de sortie et la sortie (stdout + stderr). */
export function run(cmd, args, timeoutMs = 600_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}

/** Les dernières lignes d'un texte, sans les codes de couleur du terminal. */
export function tail(text, lines = 40) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n').slice(-lines).join('\n');
}
