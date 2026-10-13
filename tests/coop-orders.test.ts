/**
 * Commandes et Grand Chevalement à deux : les deux appareils calculent la même partie. On joue le même scénario (les mêmes
 * gestes des deux joueurs aux mêmes pas) sur deux copies, et sur une copie qui a reçu la partie en cours de route (c'est ce
 * que fait une resynchronisation) : tout ce qui concerne les commandes et le chantier doit rester identique.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT, TILE } from '../src/core/constants';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { applyAction, type SimAction } from '../src/sim/actions';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import type { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { goTo } from './helpers';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** La partie de départ, la même pour les deux appareils : deux joueurs au camp, un sac bien rempli chacun, de l'argent. */
function start(): string {
  const g = new GameState(9);
  g.addPlayer();
  g.guestIds[1] = 'amie';
  g.money = 5000;
  g.stats.collected.coal = 9;
  g.stats.collected.copper = 9;
  g.setBagLevel(1);
  g.inventory.items = { coal: 20, copper: 20 };
  g.withSlot(1, () => {
    g.setBagLevel(1);
    g.inventory.items = { coal: 20, copper: 20 };
  });
  g.inventory.addKit('shipping', 1);
  goTo(g, 'board');
  const near = (type: string) => {
    const b = g.structures.list.find((s) => s.type === type)!;
    return { x: (b.x + b.w / 2) * TILE, y: (b.y + b.h + 0.5) * TILE };
  };
  g.withSlot(1, () => {
    const p = near('site');
    g.player.x = p.x;
    g.player.y = p.y;
  });
  return JSON.stringify(serialize(g));
}

type Step = [number, number, SimAction];

/**
 * Qui fait quoi, et à quel pas (60 pas par seconde). Le joueur 1 est au chantier, le joueur 0 au Tableau d'affichage.
 * Les propositions arrivent vers 22 s, 73 s, 162 s (graine 9) : les numéros 1, 2 et 3.
 */
const SCRIPT: Step[] = [
  [60 * 40, 0, { k: 'contractAccept', id: 1 }],
  [60 * 90, 0, { k: 'contractAccept', id: 2 }],
  [60 * 95, 0, { k: 'contractDeliver' }],
  [60 * 100, 1, { k: 'siteDeliver' }],
  [60 * 105, 1, { k: 'siteFund' }],
  [60 * 110, 0, { k: 'contractDeliver', id: 2 }],
  [60 * 175, 0, { k: 'contractDecline', id: 3 }],
  [60 * 200, 0, { k: 'contractAbandon', id: 1 }],
  [60 * 210, 1, { k: 'siteFund' }],
];

/** Fait jouer `g` jusqu'au pas `to` (depuis le pas `from`), avec les gestes du scénario. */
function play(g: GameState, from: number, to: number, script: Step[] = SCRIPT): void {
  for (let tick = from; tick < to; tick++) {
    for (const [at, slot, a] of script) if (at === tick) g.withSlot(slot, () => applyAction(g, a));
    g.update(SIM_DT, [IDLE, IDLE]);
  }
}

const mine = (g: GameState) =>
  JSON.stringify({
    contracts: g.contracts.serialize(),
    project: g.project.serialize(),
    money: g.money,
    stats: [g.stats.contracts, g.stats.contractMoney, g.stats.earned, g.stats.spent],
    bags: g.presentSlots().map((i) => g.withSlot(i, () => g.inventory.items)),
  });

describe('commandes et chantier à deux', () => {
  const text = start();
  const fresh = () => {
    const g = deserialize(JSON.parse(text));
    g.setLocal(0);
    return g;
  };

  it('le scénario fait vraiment quelque chose (sinon la comparaison ne prouve rien)', () => {
    const g = fresh();
    play(g, 0, 60 * 220);
    expect(g.contracts.active().length).toBeGreaterThan(0); // la commande 2 est toujours en cours
    expect(g.contracts.get(1)).toBeUndefined(); // la 1 a été abandonnée
    expect(g.contracts.get(3)).toBeUndefined(); // la 3 a été refusée
    expect(g.stats.contractMoney).toBeGreaterThan(0); // l'abandon a payé la part livrée
    expect(g.project.funded).toBeGreaterThan(0);
    expect(g.project.delivered.coal).toBe(20);
    expect(g.money).not.toBe(5000);
    expect(g.withSlot(0, () => g.inventory.items)).toEqual({});
  });

  it('deux appareils qui reçoivent les mêmes gestes restent identiques, pas après pas', () => {
    const a = fresh();
    const b = fresh();
    for (let from = 0; from < 60 * 220; from += 600) {
      play(a, from, from + 600);
      play(b, from, from + 600);
      expect(stateDigest(a)).toBe(stateDigest(b));
      expect(mine(a)).toBe(mine(b));
    }
  });

  it('l’autre joueur voit ce que fait le premier : mêmes commandes, même chantier, même argent', () => {
    const a = fresh();
    const b = fresh();
    b.setLocal(1); // l'écran de l'invité suit l'emplacement 1
    play(a, 0, 60 * 220);
    play(b, 0, 60 * 220);
    expect(mine(a)).toBe(mine(b));
    expect(a.contracts.serialize()).toEqual(b.contracts.serialize());
    expect(stateDigest(a)).toBe(stateDigest(b));
  });

  it('une partie reçue en cours de route (resynchronisation) se poursuit à l’identique', () => {
    const host = fresh();
    play(host, 0, 60 * 107); // des commandes acceptées et en cours, un chantier commencé
    expect(host.contracts.active().length).toBeGreaterThan(0);
    expect(host.project.funded).toBeGreaterThan(0);
    const snapshot = JSON.stringify(serialize(host));
    const guest = deserialize(JSON.parse(snapshot));
    guest.setLocal(1);
    // Ce que l'invité reçoit contient tout : commandes, chantier, argent, sacs.
    expect(mine(guest)).toBe(mine(host));
    play(host, 60 * 107, 60 * 400);
    play(guest, 60 * 107, 60 * 400);
    expect(mine(guest)).toBe(mine(host));
    expect(host.contracts.offers().length + host.stats.contractMoney).toBeGreaterThan(0);
  });

  it('même chose avec une caisse d’expédition réglée sur « Commandes » ou « Chantier » (réglage et contenu sauvegardés)', () => {
    const host = fresh();
    play(host, 0, 60 * 92); // la commande 2 (60 charbons) est acceptée
    host.inventory.addKit('shipping', 1);
    const crate = host.place('shipping', 52, 9, 0) as ShippingCrate | null;
    // La pose demande d'être à portée : on la fait depuis le Tableau d'affichage (le joueur 0 y est).
    expect(crate).not.toBeNull();
    applyAction(host, { k: 'shipMode', x: 52, y: 9, mode: 'orders' });
    crate!.put('coal', 30);
    crate!.timer = 12; // un nombre rond de pas : l'arrondi de la sauvegarde ne décale pas le passage
    const guest = deserialize(JSON.parse(JSON.stringify(serialize(host))));
    guest.setLocal(1);
    const hc = host.structures.at(52, 9) as ShippingCrate;
    const gc = guest.structures.at(52, 9) as ShippingCrate;
    expect(gc.mode).toBe('orders');
    expect(gc.items).toEqual(hc.items);
    play(host, 60 * 92, 60 * 200);
    play(guest, 60 * 92, 60 * 200);
    expect(mine(guest)).toBe(mine(host));
    expect(host.contracts.get(2)!.lines[0].done).toBeGreaterThanOrEqual(50); // 20 du sac, 30 de la caisse
    expect(gc.items).toEqual(hc.items);
    expect(gc.soldTotal).toBe(hc.soldTotal);
    expect(stateDigest(guest)).toBe(stateDigest(host));
  });
});
