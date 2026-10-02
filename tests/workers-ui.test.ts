import { describe, expect, it } from 'vitest';
import { TILE } from '../src/core/constants';
import { DRILLER_LEVELS, WORKERS } from '../src/data/workers';
import { GameState } from '../src/sim/GameState';
import { Storage } from '../src/sim/structures/Storage';
import { cargoLine, stuckWorkers, workerAt, workerStatus, workerTooltip } from '../src/ui/crew';
import { helpPanel, storagePanel } from '../src/ui/panels';
import { productionStats } from '../src/ui/stats';
import { WORKSHOP_TABS, offers, tabBadges, workshopAdvice, workshopPanel, DEFAULT_VIEW } from '../src/ui/workshop';
import { goTo, run } from './helpers';

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

  it('trois fiches de recrutement, avec le prix du prochain et un bouton d’achat', () => {
    const g = rich();
    const html = workshopPanel(g, 'crew');
    expect(html).toContain('Ramasseur');
    expect(html).toContain('Ravitailleur');
    expect(html).toContain('Foreur');
    expect(html).toContain('data-action="hireWorker" data-arg="picker"');
    expect(html).toContain('data-action="hireWorker" data-arg="refueler"');
    expect(html).toContain('data-action="hireWorker" data-arg="driller"');
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
    expect(html).toContain(`data-action="workerJob" data-arg="${a.id}:driller"`);
    expect(html).toContain(`data-action="workerJob" data-arg="${b.id}:picker"`);
    expect(html).toContain(`data-action="workerJob" data-arg="${b.id}:driller"`);
    expect(html).not.toContain(`data-arg="${a.id}:picker"`);
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
    expect(workerStatus(g, w)).toEqual({ text: 'Attend des minerais par terre ou à prendre dans les machines', tone: 'idle' });
    w.task = { kind: 'store', x: 46, y: 10 };
    expect(workerStatus(g, w)).toEqual({ text: 'Rapporte sa charge au coffre', tone: 'ok' });
    const d = g.drops.spawn('copper', 1, 56 * TILE, 10 * TILE, false);
    w.task = { kind: 'pick', drop: d.id };
    expect(workerStatus(g, w).text).toBe('Va ramasser : cuivre');
    w.task = null;
    w.flag = 'nostore';
    expect(workerStatus(g, w)).toMatchObject({ tone: 'warn' });
    expect(workerStatus(g, w).text).toContain("Aucun coffre n'accepte");
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
    expect(stuck).toContainEqual({ text: "Ramasseur : aucun coffre n'accepte ce minerai", n: 2 });
    expect(stuck).toContainEqual({ text: 'Ravitailleur : plus de charbon dans les coffres', n: 1 });
    const html = productionStats(g);
    expect(html).toContain("2 ×</b> Ramasseur : aucun coffre n'accepte ce minerai");
    expect(html).toContain('ouvrier');
  });

  it('en vrai : un ramasseur sans coffre finit par apparaître dans « machines à surveiller »', () => {
    const g = rich();
    g.workers.add('picker', g);
    g.drops.spawn('copper', 1, 56 * TILE, 10.5 * TILE, false);
    run(g, 15);
    expect(productionStats(g)).toContain("Ramasseur : aucun coffre n'accepte ce minerai");
    g.structures.add(new Storage(46, 10, 1));
    run(g, 15);
    expect(productionStats(g)).not.toContain("aucun coffre n'accepte");
  });

  it('l’aide parle des ouvriers', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => c });
    expect(html).toContain('Ouvriers');
    expect(html).toContain('ramasseur');
    expect(html).toContain('ravitailleur');
  });
});

describe('filtre de coffre : panneau', () => {
  function chestPanel(allow: string[] = []): { g: GameState; c: Storage; html: string } {
    const g = rich();
    g.stats.discovered = ['coal', 'copper', 'iron'];
    const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
    c.setAllow(allow);
    return { g, c, html: storagePanel(g, c) };
  }

  it('sans filtre : « Accepte tout », le bouton « Tout » est allumé, une puce par minerai connu', () => {
    const { html } = chestPanel();
    expect(html).toContain('Ce que ce coffre accepte');
    expect(html).toContain('Accepte tout.');
    expect(html).toMatch(/class="btn small on" data-action="storageAllow" data-arg=""[^>]*>Tout</);
    for (const res of ['stone', 'coal', 'copper', 'iron']) expect(html).toContain(`data-action="storageAllow" data-arg="${res}"`);
    expect(html).not.toContain('data-arg="gold"'); // pas encore découvert
  });

  it('avec un filtre : les minerais choisis sont allumés et nommés', () => {
    const { html } = chestPanel(['copper', 'iron']);
    expect(html).toContain('Accepte seulement');
    expect(html).toMatch(/class="btn small on" data-action="storageAllow" data-arg="copper"/);
    expect(html).toMatch(/class="btn small on" data-action="storageAllow" data-arg="iron"/);
    expect(html).toMatch(/class="btn small off" data-action="storageAllow" data-arg="coal"/);
    expect(html).toMatch(/class="btn small off" data-action="storageAllow" data-arg=""/);
  });

  it('un minerai déjà autorisé ou présent dans le coffre reste proposé, même non découvert', () => {
    const { g, c } = chestPanel(['gold']);
    c.put('gold', 1);
    expect(storagePanel(g, c)).toContain('data-arg="gold"');
  });

  it('« Tout déposer » est grisé quand rien dans le sac n’est accepté, avec la raison', () => {
    const { g, c } = chestPanel(['copper']);
    g.inventory.add('coal', 2);
    expect(storagePanel(g, c)).toMatch(/data-action="storageDeposit"[^>]*disabled[^>]*title="Rien dans votre sac que ce coffre accepte"/);
    g.inventory.add('copper', 1);
    expect(storagePanel(g, c)).not.toMatch(/data-action="storageDeposit"[^>]*disabled/);
  });
});

describe('ouvriers : pourquoi ils sont bloqués', () => {
  it('chaque cause a sa phrase, avec ce que le joueur peut faire', () => {
    const g = rich();
    const w = g.workers.add('picker', g);
    const text = (flag: typeof w.flag) => {
      w.flag = flag;
      return workerStatus(g, w);
    };
    expect(text('nostore').text).toContain("Aucun coffre n'accepte");
    expect(text('full').text).toContain('pleins');
    expect(text('full').text).toContain('videz-en un');
    expect(text('noroute').text).toContain('Aucun chemin');
    expect(text('noroute').text).toContain('dégagez le passage');
    for (const f of ['nostore', 'full', 'noroute'] as const) expect(text(f).tone).toBe('warn');
    // Trois phrases différentes : la distance ou un chemin coupé n'est plus présenté comme un problème de réglage.
    expect(new Set(['nostore', 'full', 'noroute'].map((f) => text(f as 'nostore').text)).size).toBe(3);
  });

  it('le Tableau d’affichage les distingue aussi', () => {
    const g = rich();
    for (const flag of ['nostore', 'full', 'noroute'] as const) g.workers.add('picker', g).flag = flag;
    const stuck = stuckWorkers(g).map((s) => s.text);
    expect(stuck).toContain("Ramasseur : aucun coffre n'accepte ce minerai");
    expect(stuck).toContain('Ramasseur : les coffres sont pleins');
    expect(stuck).toContain('Ramasseur : aucun chemin vers un coffre');
  });

  it('workerAt : l’ouvrier est trouvé sur sa case et juste au-dessus de sa tête (là où s’affiche le « ! »)', () => {
    const g = rich();
    const w = g.workers.add('picker', g);
    w.x = (60 + 0.5) * TILE;
    w.y = (30 + 0.5) * TILE + 1;
    expect(workerAt(g, 60, 30)).toBe(w);
    expect(workerAt(g, 60, 29)).toBe(w);
    expect(workerAt(g, 60, 31)).toBeUndefined();
    expect(workerAt(g, 61, 30)).toBeUndefined();
  });

  it('l’infobulle dit qui il est, ce qui le bloque et ce qu’il porte', () => {
    const g = rich();
    const w = g.workers.add('picker', g);
    w.flag = 'noroute';
    w.cargo = { copper: 2 };
    const html = workerTooltip(g, w);
    expect(html).toContain('Ramasseur');
    expect(html).toContain('Aucun chemin');
    expect(html).toContain('class="bad"');
    expect(html).toContain('chip');
    // Au travail : pas d'alerte.
    w.flag = null;
    w.task = { kind: 'store', x: 46, y: 10 };
    expect(workerTooltip(g, w)).not.toContain('class="bad"');
    expect(workerTooltip(g, w)).toContain('Rapporte sa charge au coffre');
  });
});

describe('foreur : fiche d’équipe', () => {
  it('le foreur affiche son niveau, ce qu’il équipe, et un bouton d’amélioration avec son prix', () => {
    const g = rich();
    goTo(g, 'workshop');
    const d = g.workers.add('driller', g);
    const html = workshopPanel(g, 'crew');
    expect(html).toContain('Niveau 1 / 4');
    expect(html).toContain('charbon');
    expect(html).not.toContain('diamant');
    expect(html).toContain(`data-action="workerUpgrade" data-arg="${d.id}"`);
    expect(html).toContain('400');
    expect(html).not.toMatch(/data-action="workerUpgrade"[^>]*disabled/);
    // Le ramasseur n'a ni niveau ni amélioration.
    const g2 = rich();
    g2.workers.add('picker', g2);
    expect(workshopPanel(g2, 'crew')).not.toContain('workerUpgrade');
  });

  it('bouton grisé, avec la raison : argent, pioche exigée, niveau maximal', () => {
    const g = rich();
    goTo(g, 'workshop');
    const d = g.workers.add('driller', g);
    g.money = 50;
    expect(workshopPanel(g, 'crew')).toMatch(/data-action="workerUpgrade"[^>]*disabled/);
    expect(workshopPanel(g, 'crew')).toContain("Pas assez d'argent");
    g.money = 100_000;
    d.level = 2;
    g.pickaxeLevel = 1;
    expect(workshopPanel(g, 'crew')).toMatch(/data-action="workerUpgrade"[^>]*disabled/);
    d.level = DRILLER_LEVELS.length;
    const max = workshopPanel(g, 'crew');
    expect(max).toContain('niveau maximal');
    expect(max).not.toContain('data-action="workerUpgrade"');
    expect(max).toContain('diamant');
  });

  it('phrases du foreur : cherche, pose, vide, et le blocage « plus de foreuse »', () => {
    const g = rich();
    const d = g.workers.add('driller', g);
    expect(workerStatus(g, d)).toMatchObject({ tone: 'idle' });
    expect(workerStatus(g, d).text).toContain('Cherche un gisement');
    d.task = { kind: 'place', x: 50, y: 20 };
    expect(workerStatus(g, d)).toMatchObject({ tone: 'ok' });
    expect(workerStatus(g, d).text).toContain('foreuse');
    d.task = { kind: 'collect', x: 50, y: 20 };
    expect(workerStatus(g, d).text).toContain('vider');
    d.task = null;
    d.flag = 'nodrill';
    expect(workerStatus(g, d)).toMatchObject({ tone: 'warn' });
    expect(workerStatus(g, d).text).toContain('foreuse');
    expect(stuckWorkers(g)).toEqual([{ text: 'Foreur : plus de foreuse en stock ni assez d’argent', n: 1 }]);
    expect(workerTooltip(g, d)).toContain('Foreur');
  });
});
