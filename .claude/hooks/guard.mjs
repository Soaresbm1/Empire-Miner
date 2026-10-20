/**
 * PreToolUse : garde-fous avant une commande ou une écriture.
 * - refuse (deny) ce qui détruit sans retour ou touche le réseau réel : push forcé, reset --hard, clean -f, rm -rf hors des
 *   dossiers construits, lancement de tests-net/, npm audit fix (traité à part) ; écriture dans node_modules, dist, .git ;
 * - demande (ask) ce qui engage le dépôt ou des fichiers sensibles : commit, push, merge, rebase, ajout de dépendance ;
 *   règles Firestore, configuration du compte, workflows GitHub, package.json, réglages partagés de Claude Code.
 * Tout le reste passe sans réponse (les permissions habituelles s'appliquent).
 */
import { readEvent, reply, repoPath } from './lib.mjs';

const ev = await readEvent();
const tool = ev.tool_name ?? '';
const input = ev.tool_input ?? {};

const deny = (reason) => reply({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const ask = (reason) => reply({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } });

if (tool === 'Bash' || tool === 'PowerShell') checkCommand(String(input.command ?? ''));
else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) checkFile(input.file_path ?? input.notebook_path);
process.exit(0);

function checkCommand(cmd) {
  // Chaque morceau d'une suite de commandes (`a && b ; c | d`) est jugé seul.
  for (const part of cmd.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean)) {
    if (/\bgit\s+push\b.*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S)/.test(part)) deny('Push forcé interdit : il réécrit l’historique distant.');
    if (/\bgit\s+reset\b.*--hard\b/.test(part)) deny('git reset --hard efface le travail en cours : demander à la personne.');
    if (/\bgit\s+clean\b.*\s-[a-zA-Z]*f/.test(part)) deny('git clean -f supprime des fichiers non suivis : demander à la personne.');
    if (/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/.test(part)) deny('Annuler toutes les modifications en cours : demander à la personne.');
    if (/\bnpm\s+audit\s+fix\b/.test(part)) deny('Les vulnérabilités npm sont traitées à part (voir CLAUDE.md, « Points ouverts »).');
    if (/\b(node|npx|vite-node|tsx|vitest)\b.*tests-net[\\/]/.test(part)) deny('tests-net/ touche le vrai Firebase et des courtiers MQTT publics : seulement sur demande explicite.');
    if (isWideDelete(part)) deny('Suppression récursive hors des dossiers construits (node_modules, dist*, e2e/screenshots) : demander à la personne.');
    if (/\bgit\s+(commit|push|merge|rebase)\b/.test(part)) ask('Commit, push, merge et rebase demandent l’autorisation de la personne.');
    if (/\bnpm\s+(install|i|add|uninstall|remove|rm|update|up)\b/.test(part)) ask('Changement de dépendances : demander avant (npm ci, lui, ne change rien).');
  }
}

/** rm -rf / Remove-Item -Recurse dont une cible n'est pas un dossier construit ou jetable. */
function isWideDelete(part) {
  const rm = part.match(/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+)+(.*)$/);
  const ps = part.match(/\bRemove-Item\b(.*-Recurse.*)$/i);
  if (!rm && !ps) return false;
  const targets = (rm ? rm[2] : ps[1])
    .split(/\s+/)
    .filter((t) => t && !t.startsWith('-'))
    .map((t) => t.replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
  if (!targets.length) return true;
  const disposable = /^(node_modules|dist|dist-single|dist-artifact|e2e\/screenshots)(\/.*)?$/;
  // Dossiers temporaires de la session (scratchpad de Claude Code, /tmp) : jetables par nature.
  const temporary = /(^|\/)(Temp\/claude|tmp)\//i;
  return targets.some((t) => !disposable.test(t) && !temporary.test(t));
}

function checkFile(file) {
  const rel = repoPath(file);
  if (!rel) return;
  if (/^(node_modules|dist|dist-single|dist-artifact|\.git)\//.test(rel)) deny(`${rel} : fichier généré ou interne à git, à ne pas modifier à la main.`);
  const sensitive = [
    [/^docs\/firebase\/firestore\.rules$/, 'règles de sécurité du compte en ligne'],
    [/^src\/cloud\/config\.ts$/, 'configuration du vrai projet Firebase'],
    [/^\.github\/workflows\//, 'publication du jeu (GitHub Actions)'],
    [/^package(-lock)?\.json$/, 'dépendances et scripts'],
    [/^\.claude\/settings\.json$/, 'réglages partagés de Claude Code (hooks, permissions)'],
    [/^\.gitattributes$/, 'fins de ligne de tout le dépôt'],
  ];
  for (const [re, what] of sensitive) if (re.test(rel)) ask(`${rel} : ${what}. Confirmer la modification.`);
}
