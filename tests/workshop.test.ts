import { describe, expect, it } from 'vitest';
import { GEAR } from '../src/data/gear';
import { MACHINES } from '../src/data/machines';
import { BAGS, JACKHAMMER, PICKAXES, SCOOTER } from '../src/data/tools';
import { GameState } from '../src/sim/GameState';
import { DEFAULT_VIEW, ShopView, WORKSHOP_TABS, offers, tabBadges, workshopAdvice, workshopPanel } from '../src/ui/workshop';

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const view = (v: Partial<ShopView>): ShopView => ({ ...DEFAULT_VIEW, ...v });

/** Partie dont tout l'Atelier (hors machines) est acheté. */
function complete(): GameState {
  const g = new GameState(4);
  g.pickaxeLevel = PICKAXES.length - 1;
  g.setBagLevel(BAGS.length - 1);
  g.hasJackhammer = true;
  g.hasScooter = true;
  for (const d of GEAR) g.gear.add(d.id);
  return g;
}

describe('atelier : conseil d’achat', () => {
  it('propose d’abord la pioche suivante, avec ce qu’il manque pour l’acheter', () => {
    const g = new GameState(4);
    g.money = 10;
    const a = workshopAdvice(g)!;
    expect(a.name).toBe(PICKAXES[1].name);
    expect(a.price).toBe(PICKAXES[1].price);
    expect(a.action).toBe('buyPickaxe');
    expect(a.tab).toBe('tools');
    expect(a.can).toBe(false);
    expect(a.missing).toBe(PICKAXES[1].price - 10);
    g.money = 1000;
    expect(workshopAdvice(g)).toMatchObject({ can: true, missing: 0 });
  });

  it('une fois la meilleure pioche acquise, il conseille l’équipement du danger qu’on approche', () => {
    const g = new GameState(4);
    g.pickaxeLevel = PICKAXES.length - 1;
    g.stats.maxDepth = 10; // loin de tout danger (le casque se discute dès 20 m) : le sac passe avant
    expect(workshopAdvice(g)!.action).toBe('buyBag');
    g.stats.maxDepth = 70; // le casque (60 m) et les cuissardes (70 m) deviennent utiles
    expect(workshopAdvice(g)).toMatchObject({ action: 'buyGear', arg: 'helmet', tab: 'gear' });
    g.gear.add('helmet');
    expect(workshopAdvice(g)).toMatchObject({ action: 'buyGear', arg: 'boots' });
    g.stats.maxDepth = 430; // la Fournaise approche : la combinaison (450 m)
    g.gear.add('boots');
    g.gear.add('mask');
    expect(workshopAdvice(g)).toMatchObject({ action: 'buyGear', arg: 'suit' });
  });

  it('suit l’ordre sac, marteau-piqueur, trottinette, puis plus rien', () => {
    const g = new GameState(4);
    g.pickaxeLevel = PICKAXES.length - 1;
    expect(workshopAdvice(g)!.action).toBe('buyBag');
    g.setBagLevel(1);
    expect(workshopAdvice(g)!.action).toBe('buyBag'); // la brouette
    g.setBagLevel(BAGS.length - 1);
    expect(workshopAdvice(g)!.action).toBe('buyJackhammer');
    g.hasJackhammer = true;
    expect(workshopAdvice(g)!.action).toBe('buyScooter');
    g.hasScooter = true;
    expect(workshopAdvice(g)).toBeNull();
  });

  it('ne propose jamais le marteau-piqueur tant que la pioche ne suffit pas', () => {
    const g = new GameState(4);
    g.pickaxeLevel = JACKHAMMER.unlock.pickaxeTier - 2;
    expect(offers(g).some((o) => o.action === 'buyJackhammer')).toBe(false);
    g.pickaxeLevel = JACKHAMMER.unlock.pickaxeTier - 1;
    expect(offers(g).some((o) => o.action === 'buyJackhammer')).toBe(true);
  });

  it('la bande de conseil s’affiche avec le bouton d’achat, ou la barre quand l’argent manque', () => {
    const g = new GameState(4);
    g.money = 0;
    let html = workshopPanel(g, 'tools');
    expect(html).toContain(`Conseil : ${PICKAXES[1].name}`);
    expect(html).toContain('class="meter"');
    expect(html).toContain('data-action="tab" data-arg="tools"'); // « Voir »
    g.money = PICKAXES[1].price;
    html = workshopPanel(g, 'tools');
    expect(html).toContain('advice ok');
    expect(html).toMatch(/class="btn primary small" data-action="buyPickaxe"/);
  });

  it('une partie complète n’a plus de conseil à donner', () => {
    expect(workshopPanel(complete(), 'tools')).toContain('Atelier au complet');
  });
});

describe('atelier : pastilles des onglets', () => {
  it('sans argent, aucune pastille', () => {
    const g = new GameState(4);
    g.money = 0;
    expect(tabBadges(g)).toEqual({ tools: 0, transport: 0, gear: 0, machines: 0 });
    expect(workshopPanel(g, 'tools')).not.toContain('class="badge"');
  });

  it('chaque onglet compte ce qu’on peut acheter tout de suite', () => {
    const g = new GameState(4);
    g.money = 1000;
    const b = tabBadges(g);
    expect(b.tools).toBe(1); // la pioche (le marteau-piqueur est verrouillé)
    expect(b.transport).toBe(2); // le grand sac et la trottinette
    expect(b.gear).toBe(GEAR.length); // tout l'équipement coûte moins de 1 000 $
    expect(b.machines).toBeGreaterThan(0);
    g.hasScooter = true;
    g.money = 100;
    expect(tabBadges(g).transport).toBe(1); // seul le grand sac (90 $)
  });

  it('les quatre onglets sont là, numérotés de 1 à 4', () => {
    const html = workshopPanel(new GameState(4), 'tools');
    expect(WORKSHOP_TABS.map(([id]) => id)).toEqual(['tools', 'transport', 'gear', 'machines']);
    expect(count(html, /<button class="tab[ "]/g)).toBe(4);
    expect(count(html, /class="tab-key">[1-4]</g)).toBe(4);
    expect(html).toContain('tab active" data-action="tab" data-arg="tools"');
  });

  it('un onglet inconnu retombe sur Outils', () => {
    expect(workshopPanel(new GameState(4), 'nimporte')).toContain('tab active" data-action="tab" data-arg="tools"');
  });
});

describe('atelier : onglets Outils, Transport et Équipement', () => {
  it('Outils montre les paliers de pioche et le marteau-piqueur sans le cacher', () => {
    const g = new GameState(4);
    const html = workshopPanel(g, 'tools');
    expect(count(html, /class="step[ "]/g)).toBe(PICKAXES.length);
    expect(html).toContain('step current');
    expect(html).toContain('step next');
    expect(html).toContain(JACKHAMMER.name);
    expect(html).toContain('🔒 ' + JACKHAMMER.unlock.text);
  });

  it('Transport montre les sacs et la trottinette', () => {
    const g = new GameState(4);
    const html = workshopPanel(g, 'transport');
    expect(count(html, /class="step[ "]/g)).toBe(BAGS.length);
    expect(html).toContain(SCOOTER.name);
    expect(html).toContain('data-action="buyScooter"');
  });

  it('l’argent qui manque se voit : bouton grisé, barre et montant', () => {
    const g = new GameState(4);
    g.money = 40;
    const html = workshopPanel(g, 'tools');
    expect(html).toMatch(/data-action="buyPickaxe" disabled/);
    expect(html).toContain(`Il vous manque ${(PICKAXES[1].price - 40).toLocaleString('fr-FR')} $`);
    expect(html).toContain(`style="width:${Math.round((40 / PICKAXES[1].price) * 100)}%"`);
  });

  it('Équipement passe en tête les pièces dont le danger approche, et marque les portées', () => {
    const g = new GameState(4);
    g.stats.maxDepth = 440; // la Fournaise (450 m) est proche : la combinaison compte
    for (const id of ['helmet', 'mask', 'boots']) g.gear.add(id); // les autres sont déjà portées
    const html = workshopPanel(g, 'gear');
    expect(html.indexOf('Combinaison')).toBeLessThan(html.indexOf('Casque'));
    expect(html).toContain('3 sur 4 portées');
    expect(count(html, /data-action="buyGear"/g)).toBe(1);
    // Au début de la partie, aucun danger n'approche : rien n'est « conseillé ».
    expect(workshopPanel(new GameState(4), 'gear')).not.toContain('conseillé');
    // Le casque (60 m) est conseillé dès 20 m de profondeur.
    const early = new GameState(4);
    early.stats.maxDepth = 25;
    expect(workshopPanel(early, 'gear')).toContain('conseillé');
  });
});

describe('atelier : onglet Machines', () => {
  const rows = (html: string) => count(html, /class="shop-row/g);
  const buys = (html: string) => count(html, /data-action="buyKit"/g);

  it('liste toutes les machines, les verrouillées sur une seule ligne et sans bouton d’achat', () => {
    const g = new GameState(4);
    g.money = 100000;
    const html = workshopPanel(g, 'machines');
    expect(rows(html)).toBe(MACHINES.length);
    const locked = html.split('<div class="shop-row locked"').slice(1);
    expect(locked.length).toBeGreaterThan(0);
    for (const l of locked) expect(l.split('<div class="shop-row')[0]).not.toContain('buyKit');
    expect(html).toContain('🔒 Nécessite la Pioche');
  });

  it('une catégorie ne montre que ses machines', () => {
    const g = new GameState(4);
    const all = rows(workshopPanel(g, 'machines'));
    const sec = workshopPanel(g, 'machines', undefined, view({ cat: 'securite' }));
    expect(rows(sec)).toBeGreaterThan(0);
    expect(rows(sec)).toBeLessThan(all);
    expect(sec).toContain('<h4>Sécurité</h4>');
    expect(sec).not.toContain('<h4>Extraction</h4>');
    // Le filtre actif est marqué.
    expect(sec).toMatch(/btn small chip on" data-action="shopCat" data-arg="securite"/);
  });

  it('« achetables » cache ce qu’on ne peut pas payer ou pas encore débloquer', () => {
    const g = new GameState(4);
    g.money = 0;
    const none = workshopPanel(g, 'machines', undefined, view({ only: true }));
    expect(rows(none)).toBe(0);
    expect(none).toContain('Rien à acheter pour le moment');
    g.money = 300;
    const some = workshopPanel(g, 'machines', undefined, view({ only: true }));
    expect(rows(some)).toBeGreaterThan(0);
    expect(rows(some)).toBeLessThan(MACHINES.length);
    expect(some).not.toContain('shop-row locked');
    expect(some).toMatch(/btn small on" data-action="shopOnly"/);
  });

  it('chaque ligne montre trois caractéristiques au plus, et le détail se déplie', () => {
    const g = new GameState(4);
    g.money = 100000;
    g.pickaxeLevel = PICKAXES.length - 1; // le four est verrouillé avec la vieille pioche
    const fold = workshopPanel(g, 'machines', undefined, view({ cat: 'traitement' }));
    const open = workshopPanel(g, 'machines', undefined, view({ cat: 'traitement', open: new Set(['foundry']) }));
    expect(count(open, /class="spec"/g)).toBeGreaterThan(count(fold, /class="spec"/g));
    expect(fold).toContain('Détails ▾');
    expect(open).toContain('Moins ▴');
    expect(open).toContain('shop-row open');
    const foundry = MACHINES.find((m) => m.id === 'foundry')!;
    expect(open).toContain(foundry.description);
    expect(fold).not.toContain(foundry.description);
    expect(fold).toMatch(/data-action="shopMore" data-arg="foundry"/);
  });

  it('les filtres sont dans la barre collée sous les onglets, et seulement sur cet onglet', () => {
    const g = new GameState(4);
    const machines = workshopPanel(g, 'machines');
    expect(machines.indexOf('shop-filters')).toBeGreaterThan(machines.indexOf('class="shop-nav"'));
    expect(machines.indexOf('shop-filters')).toBeLessThan(machines.indexOf('class="shop-group"'));
    expect(workshopPanel(g, 'tools')).not.toContain('shop-filters');
  });

  it('les achats restent possibles : quantités, stock et machines déjà posées', () => {
    const g = new GameState(4);
    g.money = 5000;
    g.inventory.addKit('conveyor', 3);
    const html = workshopPanel(g, 'machines');
    expect(html).toContain('<b>3</b> en stock');
    expect(html).toContain('data-arg="conveyor:10"');
    expect(buys(html)).toBeGreaterThan(MACHINES.length / 2);
  });
});
