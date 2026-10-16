/**
 * L'Ascenseur de puits : le second chantier, qui prolonge la liste des phases après le couronnement du Grand Chevalement.
 * Ce qui compte : une partie déjà couronnée rouvre sur la phase suivante sans rien perdre, l'écran du couronnement n'efface pas
 * le chantier suivant, les avantages s'ajoutent, et les deux appareils d'une partie à deux restent identiques.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/constants';
import { CROWN_PHASE, PHASES, PROJECT2_TITLE, PROJECT_TITLE, STAGES, stageOf } from '../src/data/project';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { applyAction } from '../src/sim/actions';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { Project } from '../src/sim/Project';
import { siteNews, sitePanel } from '../src/ui/site';
import { goTo, run } from './helpers';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

function supply(p: Project): void {
  for (const n of p.missing()) p.deliver(n.res, n.qty);
  p.fund(p.moneyLeft());
}

/** Une partie dont le Grand Chevalement est couronné, au début du second chantier. */
function crowned(): GameState {
  const g = new GameState(7);
  g.stats.contracts = 99;
  for (let i = 0; i < CROWN_PHASE; i++) {
    supply(g.project);
    run(g, 0.1);
  }
  return g;
}

describe('Ascenseur de puits : les chantiers', () => {
  it('deux chantiers qui se suivent, sans trou ni chevauchement', () => {
    expect(STAGES.map((s) => [s.name, s.from, s.to])).toEqual([
      ['Grand Chevalement', 0, 5],
      ['Ascenseur de puits', 5, 9],
    ]);
    expect(stageOf(0).name).toBe('Grand Chevalement');
    expect(stageOf(4).name).toBe('Grand Chevalement');
    expect(stageOf(5).name).toBe('Ascenseur de puits');
    expect(stageOf(8).name).toBe('Ascenseur de puits');
    expect(stageOf(99).name).toBe('Ascenseur de puits');
  });

  it('le second chantier demande des composants fabriqués, et plus de commandes que le premier', () => {
    const second = PHASES.slice(CROWN_PHASE);
    expect(second.some((p) => p.needs.some((n) => n.res === 'mechanism'))).toBe(true);
    expect(Math.min(...second.map((p) => p.money))).toBeGreaterThan(PHASES[CROWN_PHASE - 1].money);
    expect(second[0].contracts).toBeGreaterThan(PHASES[CROWN_PHASE - 1].contracts);
  });
});

describe('Ascenseur de puits : les anciennes parties', () => {
  it('une partie sauvegardée au couronnement (cinq phases, « achevée » autrefois) rouvre sur la phase suivante, sans rien perdre', () => {
    const p = new Project();
    const refund = p.load({ phase: 5, delivered: {}, funded: 0, doneAt: [10, 20, 30, 40, 50] });
    expect(refund).toEqual({});
    expect(p.crowned).toBe(true);
    expect(p.done).toBe(false);
    expect(p.spec!.id).toBe(PHASES[CROWN_PHASE].id);
    expect(p.doneAt).toEqual([10, 20, 30, 40, 50]);
  });

  it('le chantier en cours survit à une sauvegarde, au cœur du second chantier', () => {
    const g = crowned();
    expect(g.project.phase).toBe(CROWN_PHASE);
    g.project.deliver('mechanism', 5);
    g.project.fund(1234);
    const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(g2.project.phase).toBe(CROWN_PHASE);
    expect(g2.project.delivered).toEqual({ mechanism: 5 });
    expect(g2.project.funded).toBe(1234);
    expect(g2.project.serialize()).toEqual(g.project.serialize());
  });

  it('une phase inconnue (partie venue d’une version plus avancée) est ramenée à la dernière', () => {
    const p = new Project();
    p.load({ phase: 99, delivered: {}, funded: 0, doneAt: [] });
    expect(p.phase).toBe(PHASES.length);
    expect(p.done).toBe(true);
  });
});

describe('Ascenseur de puits : l’interface', () => {
  it('au couronnement, le titre d’Empereur s’affiche en tête et le second chantier a sa propre frise', () => {
    const g = crowned();
    const html = sitePanel(g);
    expect(html).toContain(PROJECT_TITLE);
    expect(html).toContain('Ascenseur de puits : phase 1 sur 4');
    expect(html).toContain(PHASES[CROWN_PHASE].name);
    expect((html.match(/<li class="(done|now|next)"/g) ?? []).length).toBe(PHASES.length - CROWN_PHASE);
    expect(html).not.toContain(`★ ${PROJECT2_TITLE} ★`); // le titre final n'est pas encore gagné
  });

  it('une fois tout achevé : l’écran de fin porte le second titre et les neuf phases', () => {
    const g = crowned();
    g.stats.contracts = 99;
    for (let i = CROWN_PHASE; i < PHASES.length; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    expect(g.project.done).toBe(true);
    const html = sitePanel(g);
    expect(html).toContain(PROJECT2_TITLE);
    for (const ph of PHASES) expect(html).toContain(ph.name);
  });

  it('les annonces distinguent une phase, le couronnement et la fin du puits', () => {
    expect(siteNews(1, false)).toContain('Grand Chevalement');
    expect(siteNews(CROWN_PHASE, false)).toContain('Ascenseur de puits');
    expect(siteNews(CROWN_PHASE - 1, true)).toContain(PROJECT_TITLE);
    expect(siteNews(CROWN_PHASE - 1, true)).toContain('second chantier');
    expect(siteNews(PHASES.length - 1, true)).toContain(PROJECT2_TITLE);
  });
});

describe('Ascenseur de puits : les avantages', () => {
  it('les avantages des neuf phases s’ajoutent, ceux du second chantier après ceux du premier', () => {
    const g = crowned();
    const before = g.project.perks();
    supply(g.project);
    run(g, 0.1); // Fonçage : une commande de plus en parallèle
    expect(g.project.perks().slots).toBe(before.slots + 1);
    for (let i = CROWN_PHASE + 1; i < PHASES.length; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    const all = PHASES.reduce((p, ph) => ({ slots: p.slots + (ph.perk.slots ?? 0), offers: p.offers + (ph.perk.offers ?? 0), premium: p.premium + (ph.perk.premium ?? 0) }), { slots: 0, offers: 0, premium: 0 });
    const got = g.project.perks();
    expect(got.slots).toBe(all.slots);
    expect(got.offers).toBe(all.offers);
    expect(got.premium).toBeCloseTo(all.premium, 9);
  });

  it('les phases attendent les commandes honorées : 20 pour la première du second chantier', () => {
    const g = crowned();
    g.stats.contracts = PHASES[CROWN_PHASE].contracts - 1;
    supply(g.project);
    run(g, 0.1);
    expect(g.project.phase).toBe(CROWN_PHASE); // tout est livré, mais une commande manque
    g.stats.contracts = PHASES[CROWN_PHASE].contracts;
    run(g, 0.1);
    expect(g.project.phase).toBe(CROWN_PHASE + 1);
  });
});

describe('Ascenseur de puits : à deux', () => {
  /** Deux copies de la même partie, au début du second chantier, qui jouent les mêmes gestes aux mêmes pas. */
  function pair(): [GameState, GameState] {
    const g = new GameState(9);
    g.addPlayer();
    g.guestIds[1] = 'amie';
    g.stats.contracts = 99;
    g.money = 1_000_000;
    for (let i = 0; i < CROWN_PHASE; i++) {
      supply(g.project);
      run(g, 0.1);
    }
    g.inventory.items = { mechanism: 30, steel: 200 };
    goTo(g, 'site');
    const json = JSON.stringify(serialize(g));
    return [deserialize(JSON.parse(json)), deserialize(JSON.parse(json))];
  }

  it('deux appareils qui jouent le même scénario restent identiques, jusqu’à la phase suivante', () => {
    const [a, b] = pair();
    for (let tick = 0; tick < 60 * 12; tick++) {
      for (const g of [a, b]) {
        if (tick === 60) applyAction(g, { k: 'siteDeliver' });
        if (tick === 120) applyAction(g, { k: 'siteFund' });
        g.update(SIM_DT, [IDLE, IDLE]);
      }
    }
    expect(a.project.serialize()).toEqual(b.project.serialize());
    expect(a.project.doneAt).toHaveLength(CROWN_PHASE + 1);
    expect(a.project.phase).toBe(CROWN_PHASE + 1);
    expect(stateDigest(a)).toBe(stateDigest(b));
  });
});
