/**
 * La Manufacture à deux : les deux appareils calculent la même partie. Même scénario (les gestes des deux joueurs aux mêmes
 * pas) sur deux copies, et sur une copie qui a reçu la partie en cours de route (une resynchronisation) : la machine, les sacs
 * et les statistiques doivent rester identiques.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT, SURFACE_ROWS } from '../src/core/constants';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { applyAction, type SimAction } from '../src/sim/actions';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import type { Crafter } from '../src/sim/structures/Crafter';
import type { Storage } from '../src/sim/structures/Storage';
import { teleport } from './helpers';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };
const Y = SURFACE_ROWS + 13; // salle du fond de la mine de départ
const AT = { x: 50, y: Y };

/** La partie de départ : deux joueurs dans la salle du fond, une Manufacture, un coffre à sa sortie ; chacun a du charbon et des lingots. */
function start(): string {
  const g = new GameState(9);
  g.addPlayer();
  g.guestIds[1] = 'amie';
  g.pickaxeLevel = 2;
  g.stats.discovered.push('iron_ingot', 'copper_ingot');
  for (const slot of [0, 1]) {
    g.withSlot(slot, () => {
      g.setBagLevel(2);
      g.inventory.items = { coal: 8, iron_ingot: 6 };
      teleport(g, 47 + slot, Y);
    });
  }
  g.inventory.addKit('crafter', 1);
  g.inventory.addKit('storage', 1);
  g.inventory.addKit('conveyor', 1);
  g.place('crafter', AT.x, AT.y, 0);
  g.place('conveyor', AT.x + 2, AT.y, 0);
  g.place('storage', AT.x + 3, AT.y, 0);
  return JSON.stringify(serialize(g));
}

type Step = [number, number, SimAction];

/** Qui fait quoi, et à quel pas (60 pas par seconde). */
const SCRIPT: Step[] = [
  [60 * 1, 0, { k: 'crafterRecipe', ...AT, recipe: 'steel' }],
  [60 * 2, 1, { k: 'crafterFuel', ...AT }],
  [60 * 3, 0, { k: 'crafterDeposit', ...AT }],
  [60 * 4, 1, { k: 'crafterDeposit', ...AT }],
  [60 * 14, 0, { k: 'crafterRecipe', ...AT, recipe: 'iron_plate' }], // les lingots en attente servent aussi aux plaques
  [60 * 20, 1, { k: 'crafterRecipe', ...AT, recipe: 'copper_plate' }], // ceux qui restent reviennent à celui qui change
  [60 * 25, 0, { k: 'crafterCollect', ...AT }],
  [60 * 30, 1, { k: 'crafterCollect', ...AT }],
];

function play(g: GameState, from: number, to: number, script: Step[] = SCRIPT): void {
  for (let tick = from; tick < to; tick++) {
    for (const [at, slot, a] of script) if (at === tick) g.withSlot(slot, () => applyAction(g, a));
    g.update(SIM_DT, [IDLE, IDLE]);
  }
}

const mine = (g: GameState) =>
  JSON.stringify({
    crafter: g.structures.at(AT.x, AT.y)!.serialize(),
    out: (g.structures.at(AT.x + 3, AT.y) as Storage).items,
    bags: g.presentSlots().map((i) => g.withSlot(i, () => g.inventory.items)),
    stats: [g.stats.crafted, g.stats.discovered.length],
    production: g.production.serialize(),
  });

describe('Manufacture à deux', () => {
  const text = start();
  const fresh = () => {
    const g = deserialize(JSON.parse(text));
    g.setLocal(0);
    return g;
  };

  it('le scénario fait vraiment quelque chose (sinon la comparaison ne prouve rien)', () => {
    const g = fresh();
    const c = g.structures.at(AT.x, AT.y) as Crafter;
    expect(c.type).toBe('crafter');
    play(g, 0, 60 * 40);
    expect(g.stats.crafted).toBeGreaterThanOrEqual(4);
    expect(g.stats.discovered).toContain('steel');
    expect(g.stats.discovered).toContain('iron_plate');
    expect(c.recipe).toBe('copper_plate'); // le dernier réglage
    const out = (g.structures.at(AT.x + 3, AT.y) as Storage).items;
    expect(out.steel ?? 0).toBeGreaterThan(0); // les produits sont partis sur le convoyeur, dans le coffre
    expect(out.iron_plate ?? 0).toBeGreaterThan(0);
    expect(g.withSlot(0, () => g.inventory.items.coal ?? 0)).toBe(8); // seul le joueur 1 a chargé son charbon
    expect(g.withSlot(1, () => g.inventory.items.coal ?? 0)).toBeLessThan(8);
    expect(g.withSlot(1, () => g.inventory.items.iron_ingot ?? 0)).toBeGreaterThan(0); // le changement de recette lui a rendu des lingots
  });

  it('deux appareils qui reçoivent les mêmes gestes restent identiques, pas après pas', () => {
    const a = fresh();
    const b = fresh();
    for (let from = 0; from < 60 * 40; from += 600) {
      play(a, from, from + 600);
      play(b, from, from + 600);
      expect(stateDigest(a)).toBe(stateDigest(b));
      expect(mine(a)).toBe(mine(b));
    }
  });

  it('une partie reçue en cours de route se poursuit à l’identique, avec la machine en plein travail', () => {
    const host = fresh();
    play(host, 0, 60 * 10);
    const crafter = host.structures.at(AT.x, AT.y) as Crafter;
    expect(crafter.recipe).toBe('steel');
    expect(crafter.fuelUnits).toBeGreaterThan(0);
    const snapshot = JSON.stringify(serialize(host));
    const guest = deserialize(JSON.parse(snapshot));
    guest.setLocal(1);
    expect(mine(guest)).toBe(mine(host));
    play(host, 60 * 10, 60 * 100);
    play(guest, 60 * 10, 60 * 100);
    expect(mine(guest)).toBe(mine(host));
    expect(stateDigest(guest)).toBe(stateDigest(host));
  });
});
