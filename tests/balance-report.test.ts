/**
 * Rapport d'équilibrage : `npm run balance` écrit `docs/BALANCE.md` (coût de chaque phase, ce que les mines contiennent, le
 * rythme des commandes, le temps pour payer). Sans la variable `VITE_BALANCE_REPORT`, ce test est ignoré.
 */
import { describe, expect, it } from 'vitest';
import { PHASES, PHASES_II, type PhaseSpec } from '../src/data/project';
import { getRecipe, hasRecipe } from '../src/data/recipes';
import { getResource } from '../src/data/resources';
import { GameState } from '../src/sim/GameState';
import { ordersTimeline, phaseValue, rawNeeds, supplyTotal, worldSupply, type Amounts } from '../src/sim/Balance';

const SEEDS = 80;
const money = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} $`;
const min = (s: number | null) => (s === null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`);
const list = (a: Amounts) => Object.entries(a).map(([r, n]) => `${Math.round(n)} ${getResource(r).name.toLowerCase()}`).join(', ');
const percentile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];

function phaseTable(title: string, specs: readonly PhaseSpec[]): string {
  const rows = specs.map((ph, i) => {
    const mats = ph.needs.map((n) => `${n.qty} ${getResource(n.res).name.toLowerCase()}`).join(', ');
    // Fabrications à la Manufacture : temps de machine pour tout produire (une machine à la cadence normale).
    const machineSeconds = ph.needs.reduce((s, n) => s + (hasRecipe(n.res) ? getRecipe(n.res).time * n.qty : 0), 0);
    return `| ${i + 1}. ${ph.name} | ${mats} | ${money(phaseValue(ph))} | ${money(ph.money)} | ${ph.contracts} | ${ph.faithful ?? 0} | ${min(machineSeconds)} |`;
  });
  return `### ${title}\n\n| Phase | Matériaux | Valeur marchande | Salaires | Commandes | Clients fidèles | Machine (1 Manufacture) |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n`;
}

describe.skipIf(!import.meta.env.VITE_BALANCE_REPORT)('rapport d’équilibrage', () => {
  it('écrit docs/BALANCE.md', async () => {
    const parts: string[] = [
      '# Équilibrage des chantiers\n',
      "Rapport généré par `npm run balance` (ne pas modifier à la main). Les garde-fous qui le suivent sont dans `tests/balance.test.ts`. Les chiffres viennent des données du jeu (`src/data/project.ts`, `recipes.ts`, `resources.ts`) et de vraies simulations (`src/sim/Balance.ts`).\n",
      phaseTable('Acte I — Grand Chevalement', PHASES),
      phaseTable('Acte II — Grand Ascenseur', PHASES_II),
    ];

    // Ce que les mines contiennent, face à ce que les deux actes demandent.
    const need = rawNeeds([...PHASES, ...PHASES_II]);
    const supplies = Array.from({ length: SEEDS }, (_, i) => worldSupply(new GameState(i + 1).world));
    const rows = Object.entries(need).map(([res, n]) => {
      const totals = supplies.map((s) => supplyTotal(s, res));
      const veins = supplies.map((s) => s.veins[res] ?? 0);
      return `| ${getResource(res).name} | ${Math.round(n)} | ${Math.round(percentile(totals, 0.05))} | ${Math.round(percentile(totals, 0.5))} | ${Math.round(percentile(veins, 0.5))} | ${(percentile(totals, 0.05) / n).toFixed(1)}× |`;
    });
    parts.push(
      `## Minerais : besoins des deux actes et contenu des mines\n\nSur ${SEEDS} mines. « Total » = filons + réserves des gisements (ces dernières demandent des foreuses). Le garde-fou exige que la mine la plus pauvre des 60 premières contienne au moins 1,25 fois le besoin (le diamant est le point sensible : certaines mines n'en cachent qu'une vingtaine).\n\n| Minerai | Besoin (A I + A II) | Total, mine pauvre (5 %) | Total, médiane | Filons seuls, médiane | Marge, mine pauvre |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n`,
    );
    parts.push(`Besoins de l'acte II seul : ${list(rawNeeds(PHASES_II))}.\n`);

    // Le rythme des commandes (le plus court possible : la production n'est jamais le goulot).
    const targets = PHASES_II.map((p) => ({ contracts: p.contracts, faithful: p.faithful ?? 0 }));
    const lines = [0, 300, 600].map((delay) => {
      const runs = [1, 2, 3].map((seed) => ordersTimeline(seed, targets, delay));
      const cells = PHASES_II.map((_, i) => min(percentile(runs.map((r) => r[i].at ?? Infinity), 0.5)));
      return `| ${delay === 0 ? 'livrée tout de suite' : `${delay / 60} min pour la livrer`} | ${cells.join(' | ')} |`;
    });
    parts.push(
      `## Le rythme des commandes (acte II)\n\nTemps de jeu minimal pour atteindre, à chaque phase, les commandes honorées et les clients fidèles demandés : un joueur qui accepte toutes les propositions (celles de ses clients de confiance d'abord) et met le délai indiqué à livrer chacune. Médiane de 3 mines.\n\n| Livraison | ${PHASES_II.map((p) => p.name).join(' | ')} |\n| --- | ${PHASES_II.map(() => '---:').join(' | ')} |\n${lines.join('\n')}\n`,
    );

    // Le temps pour payer.
    const incomes = [1000, 3000, 10000];
    const cost = PHASES_II.map((p) => phaseValue(p) + p.money);
    const total = cost.reduce((a, b) => a + b, 0);
    parts.push(
      `## Le temps pour payer (acte II)\n\nMatériaux à leur valeur marchande plus salaires, au revenu indiqué (argent par minute que la production et les ventes rapportent). Total : ${money(total)}.\n\n| Revenu | ${PHASES_II.map((p) => p.name).join(' | ')} | Total |\n| --- | ${PHASES_II.map(() => '---:').join(' | ')} | ---: |\n${incomes.map((r) => `| ${money(r)} / min | ${cost.map((c) => min((c / r) * 60)).join(' | ')} | ${min((total / r) * 60)} |`).join('\n')}\n`,
    );
    // Le rapport est un « snapshot de fichier » : `-u` (voir `npm run balance`) le réécrit.
    await expect(parts.join('\n')).toMatchFileSnapshot('../docs/BALANCE.md');
  }, 300_000);
});
