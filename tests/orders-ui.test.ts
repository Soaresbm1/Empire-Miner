import { describe, expect, it } from 'vitest';
import { CLIENTS } from '../src/data/contracts';
import { PHASES, PHASES_II } from '../src/data/project';
import type { Contract } from '../src/sim/Contracts';
import { GameState } from '../src/sim/GameState';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { money } from '../src/ui/format';
import { clientName, clock, contractNews, hudOrders, lineText, linesText, ordersTab } from '../src/ui/orders';
import { boardPanel, shipDelivery, shippingPanel } from '../src/ui/panels';
import { duration, siteNews, sitePanel } from '../src/ui/site';
import { teleport } from './helpers';

/** Partie dont le joueur connaît du charbon et du cuivre. */
function game(): GameState {
  const g = new GameState(7);
  g.stats.collected.coal = 3;
  g.stats.collected.copper = 3;
  return g;
}

let next = 900;
function give(g: GameState, lines: [string, number][], over: Partial<Contract> = {}): Contract {
  const c: Contract = {
    id: next++,
    client: 0,
    lines: lines.map(([res, qty]) => ({ res, qty, done: 0 })),
    reward: 480,
    premium: 0.4,
    hot: false,
    limit: 600,
    until: Math.ceil(g.time) + 600,
    accepted: false,
    ...over,
  };
  g.contracts.list.push(c);
  return c;
}

const NBSP = ' ';

describe('commandes : textes', () => {
  it('un décompte s’écrit en minutes et secondes', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(65.2)).toBe('1:06');
    expect(clock(600)).toBe('10:00');
    expect(clock(-3)).toBe('0:00');
  });

  it('une durée de jeu s’écrit en heures et minutes', () => {
    expect(duration(0)).toBe('0 min');
    expect(duration(47 * 60 + 20)).toBe('47 min');
    expect(duration(3600)).toBe('1 h 00 min');
    expect(duration(2 * 3600 + 5 * 60)).toBe('2 h 05 min');
  });

  it('ce que demande une commande, en lettres', () => {
    expect(lineText('copper', 40)).toBe('40 cuivre');
    expect(lineText('iron_ingot', 12)).toBe('12 lingot de fer');
    expect(linesText([['coal', 30], ['gold', 5]])).toBe('30 charbon et 5 or');
  });

  it('chaque client a un nom, même pour un numéro hors liste', () => {
    expect(clientName(0)).toBe(CLIENTS[0]);
    expect(clientName(99)).toBe(CLIENTS[0]);
  });

  it('les annonces disent qui, quoi et combien', () => {
    const base = { client: 0, paid: 480, lines: [['copper', 40]] as [string, number][] };
    expect(contractNews({ ...base, kind: 'offer' })).toBe(`Nouvelle commande : ${CLIENTS[0]} veut 40 cuivre, pour 480${NBSP}$ (Tableau d'affichage).`);
    expect(contractNews({ ...base, kind: 'done' })).toBe(`Commande honorée : ${CLIENTS[0]} vous verse 480${NBSP}$ !`);
    expect(contractNews({ ...base, kind: 'late', paid: 56 })).toContain('ne paie que ce qui est livré (56');
    expect(contractNews({ ...base, kind: 'late', paid: 0 })).toContain('un autre fournisseur');
    expect(contractNews({ ...base, kind: 'abandoned', paid: 56 })).toContain('paie ce qui est livré');
    expect(contractNews({ ...base, kind: 'abandoned', paid: 0 })).toContain('ne doit rien');
  });

  it('les annonces du chantier', () => {
    expect(siteNews(0, false)).toBe(`Grand Chevalement : « Fondations » est terminée ! ${PHASES[0].perk.text}.`);
    expect(siteNews(4, true)).toContain('achevé');
    expect(siteNews(4, true)).toContain('Empereur de la mine');
    expect(siteNews(99, false)).toContain('phase terminée');
  });
});

describe('onglet Commandes', () => {
  it('sans rien de connu, il explique comment attirer des clients', () => {
    const g = new GameState(7);
    const html = ordersTab(g);
    expect(html).toContain('Aucun client pour l');
    expect(html).toContain('minez du charbon');
    expect(html).toContain('Aucune commande en cours');
  });

  it('avec des marchandises connues mais pas encore de proposition, les clients arrivent', () => {
    const html = ordersTab(game());
    expect(html).toContain('Les clients arrivent');
    expect(html).not.toContain('Aucun client pour l');
  });

  it('une proposition montre qui, quoi, combien, et la comparaison au marché', () => {
    const g = game();
    const c = give(g, [['copper', 40]], { client: 3, reward: 450, premium: 0.5, limit: 720 });
    const html = ordersTab(g);
    expect(html).toContain('Maison Bertrand &amp; Fils'); // le nom du client est échappé
    expect(html).not.toContain('Maison Bertrand & Fils');
    expect(html).toContain('<b>40</b> Cuivre');
    expect(html).toContain(money(450));
    expect(html).toContain(`Au marché, ce serait</span><b>${money(g.quote('copper', 40))}</b>`);
    expect(html).toContain('12 min'); // délai une fois acceptée
    expect(html).toContain(`data-action="contractAccept" data-arg="${c.id}"`);
    expect(html).toContain(`data-action="contractDecline" data-arg="${c.id}"`);
    expect(html).toMatch(/\+\d+ %/);
  });

  it('une forte demande est signalée', () => {
    const g = game();
    give(g, [['copper', 10]], { hot: true });
    expect(ordersTab(g)).toContain('Forte demande');
    expect(ordersTab(game())).not.toContain('Forte demande');
  });

  it('on ne peut accepter qu’autant de commandes que de places', () => {
    const g = game();
    give(g, [['coal', 30]], { accepted: true });
    const ok = ordersTab(g);
    expect(ok).toContain('1 / 2');
    give(g, [['coal', 30]], { accepted: true });
    give(g, [['copper', 20]]);
    const html = ordersTab(g);
    expect(html).toMatch(/data-action="contractAccept"[^>]* disabled/);
    expect(html).toContain('terminez-en une, ou abandonnez-en une');
  });

  it('une commande en cours montre l’avancement, le temps, et le bouton de livraison selon le sac', () => {
    const g = game();
    g.time = 100;
    const c = give(g, [['coal', 40]], { accepted: true, until: 700, client: 1 });
    c.lines[0].done = 10;
    let html = ordersTab(g);
    expect(html).toContain('10 / 40');
    expect(html).toContain('10:00'); // 600 s
    expect(html).toContain(CLIENTS[1]);
    expect(html).toMatch(new RegExp(`data-action="contractDeliver" data-arg="${c.id}"[^>]* disabled`)); // rien dans le sac
    g.inventory.items.coal = 7;
    html = ordersTab(g);
    expect(html).not.toMatch(new RegExp(`data-action="contractDeliver" data-arg="${c.id}"[^>]* disabled`));
    expect(html).toContain('dans le sac : 7');
    expect(html).toContain('data-action="contractDeliver" data-arg=""'); // « Tout livrer »
  });

  it('abandonner demande confirmation', () => {
    const g = game();
    const c = give(g, [['coal', 40]], { accepted: true });
    expect(ordersTab(g)).toContain('>Abandonner<');
    const html = ordersTab(g, c.id);
    expect(html).toContain('Sûr ? Appuyez encore');
    expect(ordersTab(g, 12345)).toContain('>Abandonner<'); // une autre commande attend la confirmation
  });

  it('une commande presque en retard le dit', () => {
    const g = game();
    g.time = 0;
    give(g, [['coal', 40]], { accepted: true, until: 30 });
    expect(ordersTab(g)).toContain('ord-time late');
    const h = game();
    give(h, [['coal', 40]], { accepted: true, until: 100 });
    expect(ordersTab(h)).toContain('ord-time soon');
  });

  it('le rang et ses effets', () => {
    const g = game();
    expect(ordersTab(g)).toContain('<b>Livreur</b>');
    g.stats.contracts = 9;
    const html = ordersTab(g);
    expect(html).toContain('<b>Négociant</b>');
    expect(html).toContain('9 / 16 commandes honorées');
    expect(html).toContain('50 % plus grosses');
    g.stats.contracts = 40;
    expect(ordersTab(g)).toContain('rang maximal');
  });
});

describe('commandes : réputation des clients', () => {
  it('un client qu’on ne connaît pas n’a pas d’étiquette, et la liste « Vos clients » est absente', () => {
    const g = game();
    give(g, [['coal', 30]], { client: 2 });
    const html = ordersTab(g);
    expect(html).not.toContain('class="tag trust');
    expect(html).not.toContain('Vos clients');
    expect(html).not.toContain('Exclusive');
  });

  it('un client de confiance porte son niveau, avec dans l’infobulle ce que ça rapporte', () => {
    const g = game();
    g.contracts.reputation[2] = 4;
    give(g, [['coal', 30]], { client: 2 });
    const html = ordersTab(g);
    expect(html).toContain('class="tag trust t2"');
    expect(html).toContain('>Habitué</span>');
    expect(html).toContain('4 points de confiance');
    expect(html).toContain('encore 2 points avant le niveau suivant');
    expect(html).toContain('4 points de prime de plus');
    expect(html).toContain('10 % de temps en plus');
  });

  it('au niveau maximal, l’infobulle le dit', () => {
    const g = game();
    g.contracts.reputation[2] = 12;
    give(g, [['coal', 30]], { client: 2 });
    expect(ordersTab(g)).toContain('niveau maximal');
  });

  it('une commande exclusive est marquée sur la proposition et sur la commande en cours', () => {
    const g = game();
    give(g, [['coal', 30]], { exclusive: true });
    give(g, [['copper', 20]], { exclusive: true, accepted: true });
    const html = ordersTab(g);
    expect(html.match(/class="tag excl"/g)).toHaveLength(2);
    expect(html).toContain('★ Exclusive');
  });

  it('« Vos clients » liste les habitués, du plus fidèle au moins fidèle, et condense au-delà de six', () => {
    const g = game();
    g.contracts.reputation[3] = 2;
    g.contracts.reputation[5] = 7;
    const html = ordersTab(g);
    expect(html).toContain('Vos clients <small class="ord-count">2</small>');
    expect(html.indexOf(CLIENTS[5].replace('&', '&amp;'))).toBeLessThan(html.indexOf(CLIENTS[3].replace('&', '&amp;')));
    expect(html).toContain('>Fidèle</span>');
    expect(html).toContain('3 points avant le suivant');
    expect(html).not.toContain('autre');
    for (let i = 0; i < 9; i++) g.contracts.reputation[i] = 1 + i;
    const many = ordersTab(g);
    expect(many).toContain('… et 3 autres');
    expect(many.match(/<li><span class="ord-what">/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it('le nom d’un client est échappé dans la liste', () => {
    const g = game();
    g.contracts.reputation[3] = 1; // Maison Bertrand & Fils
    const html = ordersTab(g);
    expect(html).toContain('Maison Bertrand &amp; Fils');
    expect(html).not.toContain('Maison Bertrand & Fils');
  });

  it('les annonces disent ce que le client retient', () => {
    const base = { client: 0, paid: 480, lines: [['copper', 40]] as [string, number][] };
    expect(contractNews({ ...base, kind: 'done', trust: { level: 2, up: true } })).toContain(`${CLIENTS[0]} vous fait désormais confiance : Habitué.`);
    expect(contractNews({ ...base, kind: 'late', paid: 0, trust: { level: 1, up: false } })).toContain('est moins sûr de vous : Connaissance.');
    expect(contractNews({ ...base, kind: 'abandoned', paid: 0, trust: { level: 0, up: false } })).toContain('ne vous fait plus confiance.');
    expect(contractNews({ ...base, kind: 'done' })).not.toContain('confiance');
    const ex = contractNews({ ...base, kind: 'offer', exclusive: true });
    expect(ex).toContain('Commande exclusive');
    expect(ex).toContain('compte sur vous');
  });

  it('abandonner prévient qu’un point de confiance est en jeu', () => {
    const g = game();
    const c = give(g, [['coal', 30]], { accepted: true, client: 2 });
    expect(ordersTab(g, c.id)).not.toContain('perd 1 point de confiance');
    g.contracts.reputation[2] = 2;
    expect(ordersTab(g, c.id)).toContain('perd 1 point de confiance');
  });
});

describe('Tableau d’affichage : onglets', () => {
  it('une pastille sur « Commandes » quand des propositions attendent et qu’il y a de la place', () => {
    const g = game();
    expect(boardPanel(g, 'market')).not.toContain('class="badge"');
    give(g, [['coal', 30]]);
    give(g, [['copper', 30]]);
    expect(boardPanel(g, 'market')).toMatch(/Commandes<span class="badge" title="2 propositions à regarder">2<\/span>/);
    // Sur l'onglet lui-même, la pastille n'a plus de raison d'être ; sans place libre non plus.
    expect(boardPanel(g, 'orders')).not.toContain('class="badge"');
    give(g, [['coal', 30]], { accepted: true });
    give(g, [['coal', 30]], { accepted: true });
    expect(boardPanel(g, 'market')).not.toContain('class="badge"');
  });

  it('l’onglet Commandes est celui qu’on choisit', () => {
    const g = game();
    give(g, [['coal', 30]]);
    const html = boardPanel(g, 'orders');
    expect(html).toContain('Propositions');
    expect(html).toContain('class="tab active" data-action="tab" data-arg="orders"');
  });
});

describe('ligne du HUD', () => {
  it('rien sans commande acceptée', () => {
    const g = game();
    give(g, [['coal', 30]]);
    expect(hudOrders(g)).toBe('');
  });

  it('la commande la plus pressée, et combien d’autres attendent', () => {
    const g = game();
    g.time = 100;
    const a = give(g, [['coal', 30]], { accepted: true, until: 900 });
    give(g, [['copper', 20]], { accepted: true, until: 500 });
    a.lines[0].done = 5;
    const html = hudOrders(g);
    expect(html).toContain('0/20 Cuivre'); // celle qui finit le plus tôt
    expect(html).toContain('+1');
    expect(html).toContain('6:40');
    expect(html).not.toContain('late');
    g.time = 460;
    expect(hudOrders(g)).toContain('class="ord-hud late"');
  });
});

describe('caisse d’expédition : destination', () => {
  function crate(g: GameState): ShippingCrate {
    g.inventory.addKit('shipping', 1);
    teleport(g, 50, 8);
    return g.place('shipping', 52, 9, 0) as ShippingCrate;
  }

  it('trois boutons, celui du mode choisi est allumé', () => {
    const g = game();
    const c = crate(g);
    const html = shippingPanel(g, c);
    expect(html).toMatch(/btn small on" data-action="shipMode" data-arg="market"/);
    expect(html).toMatch(/btn small off" data-action="shipMode" data-arg="orders"/);
    expect(html).toMatch(/btn small off" data-action="shipMode" data-arg="site"/);
    c.mode = 'site';
    const site = shippingPanel(g, c);
    expect(site).toMatch(/btn small on" data-action="shipMode" data-arg="site"/);
    expect(site).toContain('Grand Chevalement');
    c.mode = 'orders';
    expect(shippingPanel(g, c)).toContain("Tableau d'affichage");
  });

  it('ce que le prochain passage livrera, et ce qu’il vendra', () => {
    const g = game();
    const c = crate(g);
    give(g, [['coal', 30]], { accepted: true });
    c.mode = 'orders';
    c.put('coal', 40);
    c.put('copper', 5);
    expect(shipDelivery(g, 'orders', 'coal', 40)).toBe(30);
    expect(shipDelivery(g, 'orders', 'copper', 5)).toBe(0);
    expect(shipDelivery(g, 'market', 'coal', 40)).toBe(0);
    expect(shipDelivery(g, 'site', 'coal', 40)).toBe(Math.min(40, g.project.need('coal')));
    const html = shippingPanel(g, c);
    expect(html).toContain('30 livrés');
    expect(html).toContain('30 à livrer');
    expect(html).toContain(money(g.quote('coal', 10) + g.quote('copper', 5)));
  });

  it('en mode marché, rien n’est livré', () => {
    const g = game();
    const c = crate(g);
    give(g, [['coal', 30]], { accepted: true });
    c.put('coal', 10);
    expect(shippingPanel(g, c)).not.toContain('à livrer');
  });
});

describe('panneau du chantier', () => {
  it('la phase en cours, la frise et les matériaux manquants', () => {
    const g = game();
    const html = sitePanel(g);
    expect(html).toContain(`Phase 1 sur ${PHASES.length}`);
    expect(html).toContain('Fondations');
    expect(html).toContain('0 %');
    expect((html.match(/<li class="(done|now|next)"/g) ?? []).length).toBe(PHASES.length);
    expect(html).toContain('<li class="now"');
    for (const n of PHASES[0].needs) expect(html).toContain(`0 / ${n.qty}`);
    expect(html).toContain(`0${NBSP}$ / ${money(PHASES[0].money)}`);
    expect(html).toContain(PHASES[0].perk.text);
  });

  it('les boutons dépendent du sac et de l’argent', () => {
    const g = game();
    let html = sitePanel(g);
    expect(html).toMatch(/data-action="siteDeliver"[^>]* disabled/);
    expect(html).toMatch(/data-action="siteFund"[^>]* disabled/);
    g.inventory.items.coal = 12;
    g.money = 200;
    html = sitePanel(g);
    expect(html).not.toMatch(/data-action="siteDeliver"[^>]* disabled/);
    expect(html).not.toMatch(/data-action="siteFund"[^>]* disabled/);
    expect(html).toContain(`Verser ${money(200)}`);
    expect(html).toContain('dans le sac : 12');
  });

  it('une fois tout livré et payé, il ne manque plus que les commandes honorées', () => {
    const g = game();
    g.project.advance(0);
    for (const n of g.project.missing()) g.project.deliver(n.res, n.qty);
    g.project.fund(g.project.moneyLeft());
    g.stats.contracts = 1;
    const html = sitePanel(g);
    expect(html).toContain('Tout est livré et payé');
    expect(html).toContain(`honoré ${PHASES[1].contracts} commandes (1 pour l`);
    expect(html).toContain(`1 / ${PHASES[1].contracts}`);
    expect(html).toContain('Acquis');
    expect(html).toContain(PHASES[0].perk.text);
  });

  it('le monument achevé : écran de fin avec les chiffres de la partie', () => {
    const g = game();
    g.stats.contracts = 99;
    g.stats.playTime = 3 * 3600 + 25 * 60;
    g.stats.earned = 123456;
    for (let i = 0; i < PHASES.length; i++) {
      for (const n of g.project.missing()) g.project.deliver(n.res, n.qty);
      g.project.fund(g.project.moneyLeft());
      g.update(0.1, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(g.project.done).toBe(true);
    // L'acte I achevé : l'écran de fin de l'acte (onglet « victory »), puis le chantier se poursuit avec le Grand Ascenseur.
    const html = sitePanel(g, 'victory');
    expect(html).toContain('Empereur de la mine');
    expect(html).toContain('Ouvrir le Grand Ascenseur');
    expect(html).toContain('3 h 25 min');
    expect(html).toContain(money(g.stats.earned));
    expect(html).toContain('Commandes honorées');
    expect(html).toContain('>99<');
    for (const ph of PHASES) expect(html).toContain(ph.name);
    expect(html).not.toContain('data-action="siteDeliver"');
    // Tout achevé (acte II compris) : l'écran de fin du Grand Ascenseur.
    g.project2.phase = PHASES_II.length;
    const end = sitePanel(g);
    expect(end).toContain('Roi des profondeurs');
    expect(end).toContain('data-action="close"');
    expect(end).toContain('Continuer à jouer');
    for (const ph of PHASES_II) expect(end).toContain(ph.name);
  });
});
