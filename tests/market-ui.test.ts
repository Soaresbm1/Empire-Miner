import { describe, expect, it } from 'vitest';
import { MARKET } from '../src/data/market';
import { GameState } from '../src/sim/GameState';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { money, price } from '../src/ui/format';
import { BOARD_TABS, counterBanner, eventTitle, hudMarket, isBoardTab, marketNews, marketTab, pct, priceCell, sparkline, trendTag } from '../src/ui/market';
import { boardPanel, counterPanel, helpPanel, inventoryPanel, shippingPanel } from '../src/ui/panels';

/** Partie en cours depuis 28 minutes : cuivre, charbon et or connus, une forte demande de cuivre au palier. */
function lively(): GameState {
  const g = new GameState(4);
  g.stats.discovered = ['coal', 'copper', 'gold', 'copper_ingot'];
  g.time = 1700;
  g.market.update(1700);
  const now = g.market.step;
  g.market.load({ ...g.market.serialize(), e: [{ n: 0, res: 'copper', start: now - 4, rise: 2, hold: 8, fall: 4, amp: 0.4 }] }, 1700);
  return g;
}

const NBSP = ' ';

describe('cours du marché : textes', () => {
  it('l’écart au prix de base s’écrit avec un vrai signe moins', () => {
    expect(pct(1.12)).toBe(`+12${NBSP}%`);
    expect(pct(0.92)).toBe(`−8${NBSP}%`);
    expect(pct(1)).toBe(`0${NBSP}%`);
    expect(pct(1.004)).toBe(`0${NBSP}%`);
  });

  it('un prix a une décimale au besoin, et pas de virgule inutile', () => {
    expect(price(7)).toBe(`7${NBSP}$`);
    expect(price(7.84)).toBe(`7,8${NBSP}$`);
    expect(price(104.4)).toBe(`104${NBSP}$`);
  });

  it('les événements ont un titre et une annonce', () => {
    expect(eventTitle({ res: 'copper', up: true })).toBe('Forte demande de cuivre');
    expect(eventTitle({ res: 'coal', up: false })).toBe('Surproduction de charbon');
    expect(eventTitle({ res: 'gold', up: false })).toBe("Surproduction d'or");
    expect(eventTitle({ res: 'silver', up: true })).toBe("Forte demande d'argent");
    expect(marketNews({ res: 'copper', up: true, pct: 45 })).toBe('Marché : forte demande de cuivre, les prix montent (+45 %).');
    expect(marketNews({ res: 'gold', up: false, pct: -31 })).toBe("Marché : surproduction d'or, les prix chutent (−31 %).");
  });

  it('les onglets du Tableau d’affichage', () => {
    expect(BOARD_TABS.map(([id]) => id)).toEqual(['market', 'production']);
    expect(isBoardTab('market')).toBe(true);
    expect(isBoardTab('tools')).toBe(false);
  });
});

describe('cours du marché : courbe', () => {
  it('dessine la courbe, la ligne de base et le point du moment', () => {
    const svg = sparkline([1, 1.1, 1.2, 1.15], 'cuivre');
    expect(svg).toContain('<svg class="spark up"');
    expect(svg).toContain('class="base"');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<circle');
    expect(svg).toContain('aria-label="cuivre"');
    expect((svg.match(/(\d+\.\d),(\d+\.\d)/g) ?? []).length).toBe(4);
  });

  it('les points restent dans le cadre, la courbe jeune est collée à droite', () => {
    const w = 168;
    const svg = sparkline([0.5, 2, 0.5, 2, 1], 'extrêmes', w, 38);
    for (const m of svg.matchAll(/(\d+\.\d),(\d+\.\d)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThanOrEqual(w);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeLessThanOrEqual(38);
    }
    const first = /points="(\d+\.\d)/.exec(sparkline([1, 1], 'jeune'));
    expect(Number(first![1])).toBeGreaterThan(w * 0.9);
  });

  it('sans historique, une ligne de base seulement ; couleur selon le cours', () => {
    expect(sparkline([], 'vide')).not.toContain('<polyline');
    expect(sparkline([1], 'un point')).not.toContain('<polyline');
    expect(sparkline([1, 1], 'plat')).toContain('spark flat');
    expect(sparkline([1, 0.7], 'bas')).toContain('spark down');
  });
});

describe('cours du marché : Comptoir, sac, caisse', () => {
  it('le Comptoir affiche le prix du jour, sa tendance et le total au cours du moment', () => {
    const g = lively();
    g.inventory.add('copper', 4);
    g.inventory.add('stone', 2);
    const html = counterPanel(g);
    expect(html).toContain('Prix du jour');
    expect(html).toContain(price(g.market.price('copper')));
    expect(html).toContain('class="mk up small"');
    expect(html).toContain(money(g.quote('copper', 4)));
    expect(html).toContain(`Tout vendre (${money(g.quote('copper', 4) + g.quote('stone', 2))})`);
    // Rappel de l'événement en cours, au moment de vendre.
    expect(html).toContain('Forte demande de cuivre');
    expect(counterBanner(g)).toContain('mk-events slim');
  });

  it('sac vide : le message habituel, sans tableau', () => {
    const html = counterPanel(lively());
    expect(html).toContain('Votre sac est vide');
    expect(html).not.toContain('<table');
  });

  it('la pierre garde un prix fixe, sans étiquette de cours', () => {
    const g = lively();
    expect(priceCell(g, 'stone')).toBe(price(1));
    expect(priceCell(g, 'copper')).toContain('mk');
  });

  it('la flèche de tendance correspond à la tendance du marché', () => {
    const g = lively();
    for (const res of ['coal', 'copper', 'gold']) {
      const arrow = ['▼', '▬', '▲'][g.market.trend(res) + 1];
      expect(trendTag(g, res)).toContain(arrow);
      expect(trendTag(g, res)).toContain(pct(g.market.mult(res)));
    }
  });

  it('le sac montre les prix du moment', () => {
    const g = lively();
    g.inventory.add('copper', 1);
    expect(inventoryPanel(g)).toContain(price(g.market.price('copper')));
  });

  it('la caisse d’expédition annonce ce que rapportera le prochain passage, au cours du moment', () => {
    const g = lively();
    const crate = new ShippingCrate(5, 5, 0);
    crate.put('copper', 3);
    const html = shippingPanel(g, crate);
    expect(html).toContain(money(g.quote('copper', 3)));
    expect(html).toContain('au cours du moment');
  });
});

describe('cours du marché : Tableau d’affichage', () => {
  it('l’onglet Marché est ouvert d’abord, avec les deux onglets', () => {
    const html = boardPanel(lively());
    expect(html).toContain('data-action="tab" data-arg="market"');
    expect(html).toContain('data-action="tab" data-arg="production"');
    expect(html).toMatch(/class="tab active" data-action="tab" data-arg="market"/);
    expect(html).toContain('Prix du moment');
  });

  it('les courbes des minerais connus seulement, avec prix de base et lingot', () => {
    const g = lively();
    const html = marketTab(g);
    expect((html.match(/<svg class="spark/g) ?? []).length).toBe(3); // charbon, cuivre, or
    expect(html).toContain('Cuivre');
    expect(html).not.toContain('Fer<');
    expect(html).toContain(`Prix de base : 7${NBSP}$`);
    expect(html).toContain('Lingot : ');
    expect(html).toContain('D\'autres minerais apparaîtront');
  });

  it('les événements en cours, avec le temps qui reste', () => {
    const html = marketTab(lively());
    expect(html).toContain('Forte demande de cuivre');
    expect(html).toContain('class="mk up">+49');
    expect(html).toMatch(/encore \d min|bientôt terminé/);
  });

  it('sans événement : un marché calme', () => {
    const g = new GameState(4);
    g.stats.discovered = ['coal'];
    expect(marketTab(g)).toContain('Marché calme');
  });

  it('conseils : le bon moment pour vendre, et ce qu’il vaut mieux garder', () => {
    const g = lively();
    // Le cuivre est au palier d'une forte demande : c'est le bon moment.
    expect(marketTab(g)).toContain('Bon moment pour vendre');
    g.inventory.add('copper', 3);
    expect(marketTab(g)).toContain('vous en avez 3 dans le sac');
    // L'or est bradé seulement s'il est vraiment bas (la dérive n'est pas toujours basse).
    const low = g.market.mult('gold') <= 1 - MARKET.good || g.market.mult('coal') <= 1 - MARKET.good;
    expect(marketTab(g).includes('bradé')).toBe(low);
  });

  it('aucun minerai connu : une invitation à miner', () => {
    const g = new GameState(4);
    expect(marketTab(g)).toContain('Aucun minerai connu');
    expect(marketTab(g)).not.toContain('<table');
  });

  it('un onglet inconnu retombe sur le Marché ; l’onglet Production a ses statistiques', () => {
    const g = lively();
    expect(boardPanel(g, 'nimporte quoi')).toContain('Prix du moment');
    const prod = boardPanel(g, 'production');
    expect(prod).toContain('Gains des 10 dernières minutes');
    expect(prod).not.toContain('<svg class="spark');
    expect(prod).toMatch(/class="tab active" data-action="tab" data-arg="production"/);
  });
});

describe('cours du marché : HUD et aide', () => {
  it('la ligne du HUD est vide sans événement, et courte avec', () => {
    const calm = new GameState(4);
    expect(hudMarket(calm)).toBe('');
    const g = lively();
    const line = hudMarket(g);
    expect(line).toContain('▲ Cuivre +49');
    expect(line).toContain('mk up');
    expect((line.match(/<div/g) ?? []).length).toBe(1);
  });

  it('au plus deux lignes, même avec plus d’événements', () => {
    const g = lively();
    const now = g.market.step;
    const ev = (n: number, res: string, amp: number) => ({ n, res, start: now - 4, rise: 2, hold: 8, fall: 4, amp });
    g.market.load({ ...g.market.serialize(), e: [ev(0, 'copper', 0.4), ev(1, 'gold', -0.3), ev(2, 'coal', 0.3)] }, 1700);
    expect(g.market.active().length).toBe(MARKET.events.maxActive);
    expect((hudMarket(g).match(/<div/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('l’aide explique le marché', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => c });
    expect(html).toContain('Cours du marché');
    expect(html).toContain('Tableau d\'affichage');
  });
});
