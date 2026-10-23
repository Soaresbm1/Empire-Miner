import { describe, expect, it } from 'vitest';
import { PHASES, PHASES_II } from '../src/data/project';
import { GameState } from '../src/sim/GameState';
import { ordersTimeline, phaseValue, rawNeeds, rawOf, supplyTotal, worldSupply } from '../src/sim/Balance';

/** Équilibrage : ce que les chantiers demandent doit rester possible dans toutes les mines, et leur rythme raisonnable. */

describe('équilibrage : matières premières', () => {
  it('un produit se ramène à des minerais : lingots (un pour un), recettes, acier à deux lingots de fer', () => {
    expect(rawOf('iron_ingot', 3)).toEqual({ iron: 3 });
    expect(rawOf('steel', 10)).toEqual({ iron: 20 });
    expect(rawOf('gold_plate', 4)).toEqual({ gold: 4 });
    expect(rawOf('cut_diamond', 2)).toEqual({ diamond: 2 });
    expect(rawOf('coal', 7)).toEqual({ coal: 7 });
  });

  it('les besoins du Grand Chevalement, en minerais', () => {
    expect(rawNeeds(PHASES)).toEqual({ coal: 80, copper: 190, iron: 280, silver: 220, gold: 140, diamond: 12 });
  });

  it('la valeur marchande des matériaux monte de phase en phase', () => {
    for (const specs of [PHASES, PHASES_II]) {
      const values = specs.map(phaseValue);
      for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1] * 0.9);
    }
    expect(phaseValue(PHASES_II[0])).toBeGreaterThan(phaseValue(PHASES[2]));
  });

  it('chaque mine contient de quoi finir les deux actes, avec de la marge (la plus pauvre de 60 mines comprise)', () => {
    const need = rawNeeds([...PHASES, ...PHASES_II]);
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const supplies = seeds.map((seed) => worldSupply(new GameState(seed).world));
    for (const [res, n] of Object.entries(need)) {
      // La mine la plus pauvre en ce minerai (le diamant, surtout : certaines n'en cachent qu'une vingtaine).
      const poor = Math.min(...supplies.map((s) => supplyTotal(s, res)));
      expect(poor, `${res} : ${n} demandés, ${Math.round(poor)} dans une mine pauvre`).toBeGreaterThanOrEqual(n / 0.8);
    }
  }, 120_000);
});

describe('équilibrage : le rythme des commandes', () => {
  const targets = PHASES_II.map((p) => ({ contracts: p.contracts, faithful: p.faithful ?? 0 }));
  const free = PHASES_II.map((p) => ({ contracts: p.contracts, faithful: 0 }));
  const minutes = (m: { at: number | null }[]) => m.map((x) => (x.at === null ? Infinity : x.at / 60));

  it('même sans aucune attente de production, l’acte II prend plus d’une heure ; avec 10 minutes par commande, quelques heures', () => {
    const fast = minutes(ordersTimeline(7, targets, 0));
    const slow = minutes(ordersTimeline(7, targets, 600));
    expect(fast[4]).toBeGreaterThan(45);
    expect(fast[4]).toBeLessThan(180);
    expect(slow[4]).toBeGreaterThan(150);
    expect(slow[4]).toBeLessThan(480);
    for (const m of [fast, slow]) for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThanOrEqual(m[i - 1]);
  }, 60_000);

  it('les clients fidèles ne retardent guère un joueur qui choisit ses clients (au plus une heure)', () => {
    for (const seed of [1, 2, 3]) {
      const withLoyalty = minutes(ordersTimeline(seed, targets, 600));
      const without = minutes(ordersTimeline(seed, free, 600));
      for (let i = 0; i < targets.length; i++) expect(withLoyalty[i] - without[i], `seed ${seed} phase ${i + 1}`).toBeLessThanOrEqual(60);
    }
  }, 120_000);
});
