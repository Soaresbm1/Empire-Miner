import { describe, expect, it } from 'vitest';
import { TILE } from '../src/core/constants';
import { WORKERS } from '../src/data/workers';
import { GameState } from '../src/sim/GameState';
import { Storage } from '../src/sim/structures/Storage';
import { cargoLine, stuckWorkers, workerStatus } from '../src/ui/crew';
import { helpPanel } from '../src/ui/panels';
import { productionStats } from '../src/ui/stats';
import { WORKSHOP_TABS, offers, tabBadges, workshopAdvice, workshopPanel, DEFAULT_VIEW } from '../src/ui/workshop';
import { run } from './helpers';

function rich(): GameState {
  const g = new GameState(4);
  g.money = 5000;
  g.pickaxeLevel = 1;
  return g;
}

describe('ouvriers : onglet de l’Atelier', () => {
  it('l’onglet Ouvriers est le cinquième, avec sa touche', () => {
    expect(WORKSHOP_TABS.map(([id]) => id)).toEqual(['tools', 'transport', 'gear', 'machines', 'crew']);
    const html = workshopPanel(rich(), 'tools');
    expect(html).toContain('data-arg="crew"');
    expect(html).toContain('Ouvriers');
    expect(html).toContain('touche 5');
  });

  it('deux fiches de recrutement, avec le prix du prochain et un bouton d’achat', () => {
    const g = rich();
    const html = workshopPanel(g, 'crew');
    expect(html).toContain('Ramasseur');
    expect(html).toContain('Ravitailleur');
    expect(html).toContain('data-action="hireWorker" data-arg="picker"');
    expect(html).toContain('data-action="hireWorker" data-arg="refueler"');
    expect(html).toContain('Recruter');
    expect(html).toContain('300');
    expect(html).toContain('Votre équipe : 0 sur 6');
    expect(html).toContain('Personne ne travaille');
  });

  it('verrouillé sans la pioche améliorée ; grisé sans argent', () => {
    const g = rich();
    g.pickaxeLevel = 0;
    const locked = workshopPanel(g, 'crew');
    expect(locked).toContain('Nécessite la Pioche améliorée');
    expect(locked).not.toContain('data-action="hireWorker"');
    const poor = rich();
    poor.money = 10;
    expect(workshopPanel(poor, 'crew')).toMatch(/data-action="hireWorker"[^>]*disabled/);
  });

  it('l’équipe est listée avec son métier, ce qu’elle fait, et les boutons', () => {
    const g = rich();
    const a = g.workers.add('picker', g);
    const b = g.workers.add('refueler', g);
    a.cargo = { copper: 2 };
    const html = workshopPanel(g, 'crew');
    expect(html).toContain('Votre équipe : 2 sur 6');
    expect(html).toContain(`data-action="workerJob" data-arg="${a.id}:refueler"`);
    expect(html).toContain(`data-action="workerJob" data-arg="${b.id}:picker"`);
    expect(html).toContain(`data-action="fireWorker" data-arg="${a.id}"`);
    expect(html).toContain('Congédier');
    expect(html).toContain('crew-cargo');
  });

  it('congédier demande confirmation', () => {
    const g = rich();
    const a = g.workers.add('picker', g);
    expect(workshopPanel(g, 'crew', undefined, { ...DEFAULT_VIEW, fire: null })).not.toContain('Confirmer ?');
    const html = workshopPanel(g, 'crew', undefined, { ...DEFAULT_VIEW, fire: a.id });
    expect(html).toContain('Confirmer ?');
    expect(html).toContain('btn small danger');
  });

  it('équipe complète : plus de bouton de recrutement', () => {
    const g = rich();
    for (let i = 0; i < WORKERS.max; i++) g.workers.add('picker', g);
    const html = workshopPanel(g, 'crew');
    expect(html).toContain('équipe complète');
    expect(html).not.toContain('data-action="hireWorker"');
    expect(html).toContain(`Votre équipe : ${WORKERS.max} sur ${WORKERS.max}`);
  });

  it('conseil du premier ouvrier (en dernier), et pastille quand on peut en recruter un', () => {
    const g = rich();
    const list = offers(g);
    expect(list[list.length - 1].key).toBe('worker');
    expect(list.find((o) => o.key === 'worker')).toMatchObject({ tab: 'crew', action: 'hireWorker', arg: 'picker', price: 300 });
    expect(tabBadges(g).crew).toBe(1);
    // Une fois acheté, plus de conseil ; la pastille suit l'argent restant.
    g.workers.add('picker', g);
    expect(offers(g).some((o) => o.key === 'worker')).toBe(false);
    g.money = 100;
    expect(tabBadges(g).crew).toBe(0);
    g.pickaxeLevel = 0;
    g.money = 5000;
    expect(tabBadges(g).crew).toBe(0);
    expect(workshopAdvice(g)?.key).not.toBe('worker');
  });
});

describe('ouvriers : ce qu’ils font', () => {
  it('une phrase par tâche, et les causes de blocage', () => {
    const g = rich();
    const w = g.workers.add('picker', g);
    expect(workerStatus(g, w)).toEqual({ text: 'Attend des minerais par terre', tone: 'idle' });
    w.task = { kind: 'store', x: 46, y: 10 };
    expect(workerStatus(g, w)).toEqual({ text: 'Rapporte sa charge au coffre', tone: 'ok' });
    const d = g.drops.spawn('copper', 1, 56 * TILE, 10 * TILE, false);
    w.task = { kind: 'pick', drop: d.id };
    expect(workerStatus(g, w).text).toBe('Va ramasser : cuivre');
    w.task = null;
    w.flag = 'nostore';
    expect(workerStatus(g, w)).toMatchObject({ tone: 'warn' });
    expect(workerStatus(g, w).text).toContain('Aucun coffre');
    const r = g.workers.add('refueler', g);
    expect(workerStatus(g, r).text).toBe('Toutes les machines ont du charbon');
    r.flag = 'nocoal';
    expect(workerStatus(g, r).text).toContain('Plus de charbon');
    r.task = { kind: 'fuel', x: 56, y: 9 };
    expect(workerStatus(g, r).tone).toBe('ok');
  });

  it('la charge se lit en icônes, avec le poids en infobulle', () => {
    const g = rich();
    const w = g.workers.add('picker', g);
    expect(cargoLine(w)).toBe('');
    w.cargo = { iron: 2 };
    expect(cargoLine(w)).toContain('chip');
    expect(cargoLine(w)).toMatch(/6\s*kg/);
  });

  it('les ouvriers bloqués sont signalés au Tableau d’affichage', () => {
    const g = rich();
    expect(stuckWorkers(g)).toEqual([]);
    const a = g.workers.add('picker', g);
    g.workers.add('picker', g);
    const c = g.workers.add('refueler', g);
    a.flag = 'nostore';
    g.workers.list[1].flag = 'nostore';
    c.flag = 'nocoal';
    const stuck = stuckWorkers(g);
    expect(stuck).toContainEqual({ text: 'Ramasseur : aucun coffre accessible', n: 2 });
    expect(stuck).toContainEqual({ text: 'Ravitailleur : plus de charbon dans les coffres', n: 1 });
    const html = productionStats(g);
    expect(html).toContain('2 ×</b> Ramasseur : aucun coffre accessible');
    expect(html).toContain('ouvrier');
  });

  it('en vrai : un ramasseur sans coffre finit par apparaître dans « machines à surveiller »', () => {
    const g = rich();
    g.workers.add('picker', g);
    g.drops.spawn('copper', 1, 56 * TILE, 10.5 * TILE, false);
    run(g, 15);
    expect(productionStats(g)).toContain('Ramasseur : aucun coffre accessible');
    g.structures.add(new Storage(46, 10, 1));
    run(g, 15);
    expect(productionStats(g)).not.toContain('aucun coffre accessible');
  });

  it('l’aide parle des ouvriers', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => c });
    expect(html).toContain('Ouvriers');
    expect(html).toContain('ramasseur');
    expect(html).toContain('ravitailleur');
  });
});
