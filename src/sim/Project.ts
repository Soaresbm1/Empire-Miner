/**
 * Le Grand Chevalement : le grand chantier du camp, en cinq phases (voir `data/project.ts`).
 *
 * À chaque phase, il faut livrer des matériaux, verser de l'argent aux ouvriers et avoir honoré assez de commandes. La phase
 * se termine toute seule dès que tout est réuni : la tour grandit et la phase suivante commence. Quand la dernière est
 * terminée, le monument est achevé.
 *
 * Ce module ne connaît que le chantier : l'argent, le sac et les événements passent par `GameState`.
 */
import { PHASES, type PhaseNeed, type PhaseSpec } from '../data/project';
import { hasResource } from '../data/resources';

export interface ProjectSave {
  /** Phase en cours (nombre de phases terminées). */
  phase: number;
  /** Livré à la phase en cours, par ressource. */
  delivered: Record<string, number>;
  /** Argent déjà versé pour la phase en cours ($). */
  funded: number;
  /** Temps de jeu (s) où chaque phase terminée l'a été. */
  doneAt: number[];
}

/** Avantages cumulés des phases terminées. */
export interface Perks {
  slots: number;
  offers: number;
  premium: number;
}

export class Project {
  /** Phase en cours : le nombre de phases terminées (`PHASES.length` : le monument est achevé). */
  phase = 0;
  delivered: Record<string, number> = {};
  funded = 0;
  doneAt: number[] = [];

  /** Le monument est-il achevé ? */
  get done(): boolean {
    return this.phase >= PHASES.length;
  }

  /** La phase en cours, ou null quand le monument est achevé. */
  get spec(): PhaseSpec | null {
    return PHASES[this.phase] ?? null;
  }

  /** Ce qui manque encore de `res` à la phase en cours. */
  need(res: string): number {
    const n = this.spec?.needs.find((x) => x.res === res);
    return n ? Math.max(0, n.qty - (this.delivered[res] ?? 0)) : 0;
  }

  /** Les matériaux que la phase en cours attend encore. */
  missing(): PhaseNeed[] {
    return (this.spec?.needs ?? []).map((n) => ({ res: n.res, qty: this.need(n.res) })).filter((n) => n.qty > 0);
  }

  /** Argent qui reste à verser pour la phase en cours ($). */
  moneyLeft(): number {
    return this.spec ? Math.max(0, this.spec.money - this.funded) : 0;
  }

  /** Avancement de la phase en cours (0 à 1) : chaque matériau, et l'argent, comptent pour une part égale. */
  progress(): number {
    const spec = this.spec;
    if (!spec) return 1;
    const parts = spec.needs.length + (spec.money > 0 ? 1 : 0);
    if (!parts) return 1;
    let sum = 0;
    for (const n of spec.needs) sum += Math.min(1, (this.delivered[n.res] ?? 0) / n.qty);
    if (spec.money > 0) sum += Math.min(1, this.funded / spec.money);
    return sum / parts;
  }

  /** Matériaux et argent sont réunis (il ne reste à avoir que le nombre de commandes honorées, `contracts`). */
  supplied(): boolean {
    return !!this.spec && this.missing().length === 0 && this.moneyLeft() === 0;
  }

  /** La phase peut-elle se terminer, avec `contracts` commandes honorées ? */
  ready(contracts: number): boolean {
    return this.supplied() && contracts >= this.spec!.contracts;
  }

  /** Livre jusqu'à `n` unités de `res` à la phase en cours. Renvoie la quantité acceptée. */
  deliver(res: string, n: number): number {
    const k = Math.min(Math.floor(n), this.need(res));
    if (k <= 0) return 0;
    this.delivered[res] = (this.delivered[res] ?? 0) + k;
    return k;
  }

  /** Verse jusqu'à `amount` $ à la phase en cours. Renvoie la somme acceptée. */
  fund(amount: number): number {
    const k = Math.min(Math.floor(amount), this.moneyLeft());
    if (k <= 0) return 0;
    this.funded += k;
    return k;
  }

  /** Termine la phase en cours (à n'appeler que si elle est prête) : la suivante commence à zéro. */
  advance(time: number): PhaseSpec {
    const spec = this.spec!;
    this.doneAt.push(time);
    this.phase++;
    this.delivered = {};
    this.funded = 0;
    return spec;
  }

  /** Avantages accordés par les phases terminées. */
  perks(): Perks {
    const p: Perks = { slots: 0, offers: 0, premium: 0 };
    for (let i = 0; i < Math.min(this.phase, PHASES.length); i++) {
      const perk = PHASES[i].perk;
      p.slots += perk.slots ?? 0;
      p.offers += perk.offers ?? 0;
      p.premium += perk.premium ?? 0;
    }
    return p;
  }

  // ------------------------------------------------------------------ sauvegarde

  serialize(): ProjectSave {
    return { phase: this.phase, delivered: { ...this.delivered }, funded: this.funded, doneAt: [...this.doneAt] };
  }

  /** Recharge le chantier sauvegardé ; les valeurs aberrantes sont ignorées. Sans données (ancienne sauvegarde), tout repart à zéro. */
  load(data: ProjectSave | undefined): void {
    this.phase = 0;
    this.delivered = {};
    this.funded = 0;
    this.doneAt = [];
    if (!data || typeof data !== 'object') return;
    const phase = Number(data.phase);
    this.phase = Number.isInteger(phase) ? Math.min(PHASES.length, Math.max(0, phase)) : 0;
    this.doneAt = (Array.isArray(data.doneAt) ? data.doneAt : [])
      .slice(0, this.phase)
      .map(Number)
      .filter((t) => Number.isFinite(t) && t >= 0);
    // Une liste trop courte (sauvegarde abîmée) : les phases sans date comptent comme terminées au début.
    while (this.doneAt.length < this.phase) this.doneAt.push(0);
    const spec = this.spec;
    if (spec) {
      for (const n of spec.needs) {
        const d = Number(data.delivered?.[n.res]);
        if (hasResource(n.res) && Number.isFinite(d) && d > 0) this.delivered[n.res] = Math.min(n.qty, Math.floor(d));
      }
      const f = Number(data.funded);
      this.funded = Number.isFinite(f) && f > 0 ? Math.min(spec.money, Math.floor(f)) : 0;
    }
  }
}
