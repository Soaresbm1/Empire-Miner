/**
 * Prévisions : « au rythme actuel, dans combien de temps ? ». Le calcul (production récente, ce que consomment les fours et la
 * Manufacture, le sac), puis ce que les panneaux du chantier et des commandes en disent.
 */
import { describe, expect, it } from 'vitest';
import { PHASES } from '../src/data/project';
import type { Contract } from '../src/sim/Contracts';
import { FAR_MINUTES, IDLE_RATE, combine, fitIn, income, materialNeed, minutesFor, moneyNeed, orderForecast, projectForecast, supply } from '../src/sim/Forecast';
import { GameState } from '../src/sim/GameState';
import { ProductionLog, RECENT_SLOTS, type Rates } from '../src/sim/Production';
import { Project } from '../src/sim/Project';
import { eta, needTag, perMin, projectForecastHtml } from '../src/ui/forecast';
import { ordersTab } from '../src/ui/orders';
import { sitePanel } from '../src/ui/site';

/** Des débits à la main : seuls les champs donnés comptent. */
const rates = (o: Partial<Rates> = {}): Rates => ({ ore: {}, machineOre: 0, ingots: {}, made: {}, sold: {}, counter: 0, crate: 0, minutes: 2, ...o });

/** Un journal dont on avance l'horloge à la main. */
function clocked(): { log: ProductionLog; at: (t: number) => void } {
  let now = 0;
  return { log: new ProductionLog(() => now), at: (t) => (now = t) };
}

describe('production récente', () => {
  it('une ligne qu’on vient de bâtir se lit juste tout de suite', () => {
    const { log, at } = clocked();
    // Un lingot toutes les 5 s pendant 40 s : 12 par minute.
    for (let t = 260; t < 300; t += 5) {
      at(t);
      log.addIngot('silver_ingot');
    }
    at(300);
    expect(log.recent().ingots.silver_ingot).toBeCloseTo(12, 0);
    // La moyenne des 5 minutes, elle, n’a pas encore rattrapé.
    expect(log.rates().ingots.silver_ingot).toBeLessThan(2.5);
  });

  it('une ligne régulière se lit pareil sur toute la fenêtre', () => {
    const { log, at } = clocked();
    for (let t = 0; t < 400; t += 4) {
      at(t);
      log.addIngot('iron_ingot'); // 15 par minute
    }
    at(400);
    expect(log.recent().ingots.iron_ingot).toBeGreaterThan(14);
    expect(log.recent().ingots.iron_ingot).toBeLessThan(16);
  });

  it('une ligne arrêtée s’éteint quand ses derniers relevés sortent de la fenêtre', () => {
    const { log, at } = clocked();
    at(100);
    log.addIngot('gold_ingot', 10);
    at(200);
    expect(log.recent().ingots.gold_ingot).toBeCloseTo(6, 1); // 10 relevés il y a 100 s
    at(100 + RECENT_SLOTS * 10 + 12);
    expect(log.recent().ingots.gold_ingot ?? 0).toBe(0);
  });

  it('un relevé isolé ne s’emballe pas : 30 s de recul au moins', () => {
    const { log, at } = clocked();
    at(500);
    log.addIngot('iron_ingot');
    at(500.1);
    expect(log.recent().ingots.iron_ingot).toBeCloseTo(2, 5);
  });

  it('les ventes donnent un revenu par minute, par comptoir et par caisse', () => {
    const { log, at } = clocked();
    at(200);
    log.addSale({ copper: 4 }, 100, false);
    log.addSale({ copper: 4 }, 50, true);
    at(230);
    const r = log.recent();
    expect(r.counter).toBeCloseTo(100 / 30 * 60, 3);
    expect(r.crate).toBeCloseTo(50 / 30 * 60, 3);
    expect(income(r)).toBeCloseTo(300, 3);
  });

  it('sans rien produit, tout est à zéro', () => {
    const { log, at } = clocked();
    at(90);
    const r = log.recent();
    expect(r.ore).toEqual({});
    expect(r.counter).toBe(0);
    expect(r.minutes).toBeGreaterThan(0);
  });
});

describe('ce que la production laisse', () => {
  it('un lingot de cuivre, c’est ce qui sort du four', () => {
    expect(supply(rates({ ingots: { copper_ingot: 6 } }), 'copper_ingot')).toBeCloseTo(6);
  });

  it('le minerai fondu n’est plus du minerai : on retire ce que les fours prennent', () => {
    // 40 cuivre extraits, 15 fondus : 25 restent du minerai.
    expect(supply(rates({ ore: { copper: 40 }, ingots: { copper_ingot: 15 } }), 'copper')).toBeCloseTo(25);
    // Tout est fondu : il n’en reste pas.
    expect(supply(rates({ ore: { copper: 15 }, ingots: { copper_ingot: 15 } }), 'copper')).toBe(0);
  });

  it('les lingots employés par la Manufacture ne sont plus des lingots à livrer', () => {
    // 12 lingots de fer par minute ; l’acier en prend 2 chacun (3 par minute), les plaques 1 chacune (2 par minute).
    const r = rates({ ingots: { iron_ingot: 12 }, made: { steel: 3, iron_plate: 2 } });
    expect(supply(r, 'iron_ingot')).toBeCloseTo(12 - 2 * 3 - 1 * 2, 5);
    // Un produit, lui, compte pour lui-même.
    expect(supply(r, 'steel')).toBeCloseTo(3);
    expect(supply(r, 'iron_plate')).toBeCloseTo(2);
  });

  it('ne descend jamais sous zéro', () => {
    expect(supply(rates({ ingots: { iron_ingot: 2 }, made: { steel: 5 } }), 'iron_ingot')).toBe(0);
  });

  it('le minerai ramassé à la main compte aussi', () => {
    expect(supply(rates({ ore: { coal: 7 } }), 'coal')).toBeCloseTo(7);
  });
});

describe('temps pour tout réunir', () => {
  it('minutes = ce qui manque / ce qui arrive, 0 si rien ne manque, null si rien n’arrive', () => {
    expect(minutesFor(60, 6)).toBeCloseTo(10);
    expect(minutesFor(0, 0)).toBe(0);
    expect(minutesFor(-5, 3)).toBe(0);
    expect(minutesFor(10, 0)).toBeNull();
    expect(minutesFor(10, IDLE_RATE / 2)).toBeNull();
  });

  it('le sac est déduit de ce qui manque', () => {
    const r = rates({ ingots: { silver_ingot: 4 } });
    const n = materialNeed('silver_ingot', 40, 15, r);
    expect(n.left).toBe(25);
    expect(n.minutes).toBeCloseTo(25 / 4);
    expect(materialNeed('silver_ingot', 40, 99, r).minutes).toBe(0);
  });

  it('l’argent déjà en poche est déduit des salaires, le revenu des ventes fait le reste', () => {
    const r = rates({ counter: 300, crate: 100 });
    const n = moneyNeed(8000, 6000, r);
    expect(n.res).toBeNull();
    expect(n.left).toBe(2000);
    expect(n.minutes).toBeCloseTo(2000 / 400);
    expect(moneyNeed(500, 800, r).minutes).toBe(0);
    expect(moneyNeed(8000, 0, rates()).minutes).toBeNull();
  });

  it('le plus long décide, et l’on dit lequel', () => {
    const f = combine([
      { res: 'a', left: 10, rate: 5, minutes: 2 },
      { res: 'b', left: 90, rate: 3, minutes: 30 },
      { res: 'c', left: 0, rate: 0, minutes: 0 },
      { res: null, left: 100, rate: 20, minutes: 5 },
    ]);
    expect(f.minutes).toBe(30);
    expect(f.slowest?.res).toBe('b');
  });

  it('un besoin qui n’avance pas retient tout, le premier de ceux-là est cité', () => {
    const f = combine([
      { res: 'a', left: 10, rate: 5, minutes: 2 },
      { res: 'b', left: 90, rate: 0, minutes: null },
      { res: 'c', left: 50, rate: 0, minutes: null },
      { res: 'd', left: 90, rate: 1, minutes: 90 },
    ]);
    expect(f.minutes).toBeNull();
    expect(f.slowest?.res).toBe('b');
    // Même si le besoin muet n’est pas le premier de la liste.
    const g = combine([
      { res: 'd', left: 90, rate: 1, minutes: 90 },
      { res: 'b', left: 90, rate: 0, minutes: null },
    ]);
    expect(g.slowest?.res).toBe('b');
  });

  it('tout est réuni : zéro minute et rien ne retient', () => {
    const f = combine([{ res: 'a', left: 0, rate: 0, minutes: 0 }]);
    expect(f).toEqual({ needs: f.needs, slowest: null, minutes: 0 });
    expect(combine([]).minutes).toBe(0);
  });

  it('la phase du chantier : matériaux manquants et salaires', () => {
    const p = new Project();
    p.phase = 2; // Treuil : 120 lingots de fer, 40 lingots d'argent, 8 000 $
    const spec = PHASES[2];
    expect(spec.needs.map((n) => n.res)).toEqual(['iron_ingot', 'silver_ingot']);
    const r = rates({ ingots: { iron_ingot: 12, silver_ingot: 2 }, counter: 600 });
    const f = projectForecast(p, 1000, () => 0, r);
    expect(f.needs.length).toBe(3);
    // Fer : 120 / 12 = 10 min ; argent : 40 / 2 = 20 min ; salaires : 7 000 / 600 ≈ 11,7 min.
    expect(f.minutes).toBeCloseTo(20, 5);
    expect(f.slowest?.res).toBe('silver_ingot');
    // Ce qui est déjà livré ne compte plus, ni ce que le sac contient.
    p.delivered.silver_ingot = 30;
    const bag = (res: string) => (res === 'iron_ingot' ? 100 : 0);
    const g = projectForecast(p, 1000, bag, r);
    expect(g.needs.find((n) => n.res === 'iron_ingot')!.left).toBe(20);
    expect(g.needs.find((n) => n.res === 'silver_ingot')!.left).toBe(10);
    expect(g.slowest?.res).toBeNull(); // il ne reste que les salaires qui tardent (11,7 min)
    expect(g.minutes).toBeCloseTo(7000 / 600, 5);
  });

  it('une commande : seules les lignes pas encore livrées comptent', () => {
    const c: Pick<Contract, 'lines'> = { lines: [{ res: 'copper_ingot', qty: 20, done: 20 }, { res: 'iron_ingot', qty: 12, done: 4 }] };
    const f = orderForecast(c, () => 0, rates({ ingots: { iron_ingot: 4 } }));
    expect(f.needs.length).toBe(1);
    expect(f.needs[0].left).toBe(8);
    expect(f.minutes).toBeCloseTo(2);
  });

  it('tient-elle dans le temps dont on dispose ?', () => {
    const at = (minutes: number | null) => ({ needs: [], slowest: null, minutes });
    expect(fitIn(at(0), 600)).toBe('ready');
    expect(fitIn(at(null), 600)).toBe('stalled');
    expect(fitIn(at(7), 600)).toBe('ok'); // 420 s sur 600 s
    expect(fitIn(at(9), 600)).toBe('tight'); // 540 s : plus de 80 %
    expect(fitIn(at(10), 600)).toBe('tight'); // pile
    expect(fitIn(at(10.5), 600)).toBe('late');
  });
});

describe('prévisions à l’écran', () => {
  it('les durées s’écrivent à la louche', () => {
    expect(eta(0.2)).toBe("moins d'une minute");
    expect(eta(1.2)).toBe('~1 min');
    expect(eta(7.4)).toBe('~7 min');
    expect(eta(59.4)).toBe('~59 min');
    expect(eta(60)).toBe('~1 h');
    expect(eta(80)).toBe('~1 h 20');
    expect(eta(125)).toBe('~2 h 05');
    expect(eta(FAR_MINUTES)).toBe('plus de 10 h');
  });

  it('les débits s’écrivent avec une décimale sous 10', () => {
    expect(perMin(2.14)).toBe('2,1 /min');
    expect(perMin(24.4)).toBe('24 /min');
  });

  it('l’étiquette d’un besoin : rien s’il est couvert, « aucune production » s’il n’avance pas', () => {
    expect(needTag(undefined, false)).toBe('');
    expect(needTag({ res: 'iron_ingot', left: 0, rate: 0, minutes: 0 }, false)).toBe('');
    expect(needTag({ res: 'iron_ingot', left: 9, rate: 0, minutes: null }, false)).toContain('aucune production');
    expect(needTag({ res: null, left: 9, rate: 0, minutes: null }, false)).toContain('aucune vente');
    expect(needTag({ res: 'iron_ingot', left: 9, rate: 3, minutes: 3 }, false)).toContain('~3 min');
    expect(needTag({ res: 'iron_ingot', left: 9, rate: 3, minutes: 3 }, true)).toContain('slow');
  });

  /** Une partie au chantier « Treuil » avec de la production relevée. */
  function siteGame(): GameState {
    const g = new GameState(7);
    g.project.phase = 2;
    g.time = 300;
    // 15 lingots de fer par minute et 1,5 lingot d'argent par minute sur les 2 dernières minutes.
    for (let t = 180; t < 300; t += 4) {
      g.time = t;
      g.production.addIngot('iron_ingot');
    }
    for (let t = 180; t < 300; t += 40) {
      g.time = t;
      g.production.addIngot('silver_ingot');
    }
    // Et des ventes : 40 $ toutes les 4 s, soit 600 $ par minute.
    for (let t = 180; t < 300; t += 4) {
      g.time = t;
      g.production.addSale({ copper: 2 }, 40, true);
    }
    g.time = 300;
    return g;
  }

  it('le panneau du chantier dit dans combien de temps, et ce qui retient', () => {
    const g = siteGame();
    const html = sitePanel(g);
    expect(html).toContain('Au rythme actuel, la phase est prête dans');
    expect(html).toContain('Ce qui la retient : ');
    expect(html).toMatch(/class="forecast/);
    // Les lignes de matériaux portent leur propre durée.
    expect(html).toMatch(/class="eta[^"]*"[^>]*>~\d+ min/);
  });

  it('sans production, le chantier dit que rien n’avance et pourquoi', () => {
    const g = new GameState(7);
    g.project.phase = 2;
    const html = sitePanel(g);
    expect(html).toContain("n'avance pas");
    expect(html).toContain('aucune production de lingot de fer depuis 2 minutes');
    expect(html).toContain('aucune production');
  });

  it('le sac et la bourse couvrent tout : on le dit', () => {
    const g = new GameState(7);
    g.project.phase = 2;
    g.inventory.items = { iron_ingot: 120, silver_ingot: 40 };
    g.money = 8000;
    const f = projectForecast(g.project, g.money, (r) => g.inventory.count(r), g.production.recent());
    expect(f.minutes).toBe(0);
    expect(projectForecastHtml(f)).toContain('couvrent tout ce qui manque');
    expect(sitePanel(g)).toContain('couvrent tout ce qui manque');
  });

  /** Une partie qui connaît du cuivre, avec une proposition et une commande acceptée de lingots de cuivre. */
  function ordersGame() {
    const g = new GameState(7);
    g.stats.collected.copper = 3;
    g.time = 300;
    for (let t = 200; t < 300; t += 5) {
      g.time = t;
      g.production.addIngot('copper_ingot'); // 12 par minute
    }
    g.time = 300;
    const base = { client: 0, reward: 480, premium: 0.4, hot: false, limit: 600 };
    const offer: Contract = { id: 901, lines: [{ res: 'copper_ingot', qty: 24, done: 0 }], until: 600, accepted: false, ...base };
    const active: Contract = { id: 902, lines: [{ res: 'copper_ingot', qty: 30, done: 0 }], until: 300 + 900, accepted: true, ...base };
    g.contracts.list.push(offer, active);
    return { g, offer, active };
  }

  it('une proposition dit si vos machines suffiraient', () => {
    const { g } = ordersGame();
    const html = ordersTab(g);
    expect(html).toContain('Réalisable ?');
    expect(html).toMatch(/Réalisable \?<\/span><b class="good">oui, ~2 min/);
  });

  it('une proposition trop grosse pour le rythme est annoncée comme telle', () => {
    const { g, offer } = ordersGame();
    offer.lines[0].qty = 400; // ~33 min pour 10 de délai
    const html = ordersTab(g);
    expect(html).toMatch(/Réalisable \?<\/span><b class="bad">non : ~\d+ min \(délai 10 min\)/);
  });

  it('une commande acceptée dit si elle tient avant l’échéance', () => {
    const { g, active } = ordersGame();
    const html = ordersTab(g);
    expect(html).toContain('À votre rythme');
    expect(html).toMatch(/À votre rythme<\/span><b class="good">~3 min · dans les temps/);
    // Plus que quelques secondes : elle ne tiendra pas.
    active.until = g.time + 40;
    expect(ordersTab(g)).toMatch(/À votre rythme<\/span><b class="bad">~3 min · trop long/);
  });

  it('sans production de ce qu’elle demande, la commande ne peut pas avancer', () => {
    const { g, active } = ordersGame();
    active.lines = [{ res: 'gold_ingot', qty: 10, done: 0 }];
    expect(ordersTab(g)).toMatch(/À votre rythme<\/span><b class="bad">rien n'avance : lingot d&#39;or/);
  });

  it('ce que le sac contient déjà couvre la commande', () => {
    const { g, active } = ordersGame();
    g.inventory.items = { copper_ingot: 100 };
    expect(active.accepted).toBe(true);
    expect(ordersTab(g)).toContain('tout est dans votre sac');
  });
});
