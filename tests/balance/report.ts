/**
 * Rapport du banc : chaque mesure est notée par `record(section, ligne)`, puis écrite à la fin dans tests/balance/out/
 * (`rapport.json` complet, `rapport.md` lisible) et affichée dans la console. Le dossier est ignoré par git : un rapport se
 * cite (chiffres, graine, durée), il ne se commite pas.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

type Row = Record<string, string | number | boolean | null>;

const sections = new Map<string, Row[]>();
const OUT = fileURLToPath(new URL('./out/', import.meta.url));

export function record(section: string, row: Row): void {
  if (!sections.has(section)) sections.set(section, []);
  sections.get(section)!.push(row);
}

function table(rows: Row[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: Row[string] | undefined) => (v === null || v === undefined ? '—' : String(v));
  return [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`)].join('\n');
}

afterAll(() => {
  if (!sections.size) return;
  mkdirSync(OUT, { recursive: true });
  const at = new Date().toISOString();
  const json = { at, node: process.version, platform: process.platform, sections: Object.fromEntries(sections) };
  writeFileSync(`${OUT}rapport.json`, JSON.stringify(json, null, 2));
  const md = [`# Banc de simulation — ${at}`, '', `Node ${process.version}, ${process.platform}.`, ''];
  for (const [name, rows] of sections) md.push(`## ${name}`, '', table(rows), '');
  const text = md.join('\n');
  writeFileSync(`${OUT}rapport.md`, text);
  // Directement sur la sortie : Vitest ne montre pas toujours les console.log des crochets de fin.
  process.stdout.write(`\n${text}\nRapport écrit dans ${OUT}rapport.md\n`);
});
