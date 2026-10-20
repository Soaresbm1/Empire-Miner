/**
 * Puits à deux : les deux appareils calculent la même partie. Même scénario (les gestes des deux joueurs aux mêmes pas) sur
 * deux copies, et sur une copie qui a reçu la partie en cours de route (une resynchronisation) : le puits, son cycle, son usure
 * et ce qu'il a remonté doivent rester identiques.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT, SURFACE_ROWS, TILE } from '../src/core/constants';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { applyAction, type SimAction } from '../src/sim/actions';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { dropGuest } from '../src/net/guests';
import type { Storage } from '../src/sim/structures/Storage';
import type { Well } from '../src/sim/structures/Well';
import { goTo } from './helpers';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Un puits au camp avec un coffre devant lui, le chantier à la phase 7, et un sac bien rempli pour chaque joueur. */
function start(): { text: string; x: number; y: number } {
  const g = new GameState(9);
  g.addPlayer();
  g.guestIds[1] = 'amie';
  g.project.phase = 7;
  let at: { x: number; y: number } | null = null;
  for (let y = 0; y + 3 <= SURFACE_ROWS && !at; y++)
    for (let x = 6; x < 80 && !at; x++) {
      let ok = true;
      for (let yy = y; yy < y + 3 && ok; yy++) for (let xx = x; xx < x + 5 && ok; xx++) ok = g.world.isOpen(xx, yy) && !g.structures.at(xx, yy);
      if (ok) at = { x, y };
    }
  if (!at) throw new Error('aucune place pour un puits');
  g.player.x = (at.x + 1.5) * TILE;
  g.player.y = (Math.min(SURFACE_ROWS - 1, at.y + 4) + 0.5) * TILE;
  g.inventory.addKit('well', 1);
  g.inventory.addKit('storage', 1);
  if (!g.place('well', at.x, at.y, 0)) throw new Error('pose impossible');
  if (!g.place('storage', at.x + 3, at.y + 1, 0)) throw new Error('coffre impossible');
  g.withSlot(1, () => {
    g.setBagLevel(1);
    g.inventory.items = { coal: 20, mechanism: 3 };
    g.player.x = g.structures.list.find((s) => s.type === 'well')!.x * TILE;
    g.player.y = (at!.y + 4.5) * TILE;
  });
  return { text: JSON.stringify(serialize(g)), ...at };
}

type Step = [number, number, SimAction];

const play = (g: GameState, from: number, to: number, script: Step[]): void => {
  for (let tick = from; tick < to; tick++) {
    for (const [at, slot, a] of script) if (at === tick) g.withSlot(slot, () => applyAction(g, a));
    g.update(SIM_DT, [IDLE, IDLE]);
  }
};

describe('puits à deux', () => {
  const { text, x, y } = start();
  const SCRIPT: Step[] = [
    [60 * 2, 1, { k: 'wellFuel', x, y }],
    [60 * 3, 1, { k: 'wellDeposit', x, y }],
    [60 * 30, 1, { k: 'wellCollect', x, y }],
  ];
  const fresh = () => {
    const g = deserialize(JSON.parse(text));
    g.setLocal(0);
    return g;
  };
  const well = (g: GameState) => g.structures.at(x, y) as Well;
  const chest = (g: GameState) => g.structures.at(x + 3, y + 1) as Storage;

  it('le scénario fait vraiment quelque chose (sinon la comparaison ne prouve rien)', () => {
    const g = fresh();
    play(g, 0, 60 * 60, SCRIPT);
    expect(well(g).made).toBeGreaterThan(8);
    expect(well(g).mech).toBeLessThanOrEqual(2);
    expect(Object.values(chest(g).items).reduce((n, k) => n + k, 0)).toBeGreaterThan(8);
    expect(g.withSlot(1, () => g.inventory.count('coal'))).toBe(0);
  });

  it('deux appareils qui reçoivent les mêmes gestes restent identiques, pas après pas', () => {
    const a = fresh();
    const b = fresh();
    for (let from = 0; from < 60 * 90; from += 600) {
      play(a, from, from + 600, SCRIPT);
      play(b, from, from + 600, SCRIPT);
      expect(stateDigest(a)).toBe(stateDigest(b));
    }
    expect(well(a).serialize()).toEqual(well(b).serialize());
  });

  it('un puits modifié d’un seul côté se voit dans l’empreinte', () => {
    const a = fresh();
    const b = fresh();
    play(a, 0, 60 * 20, SCRIPT);
    play(b, 0, 60 * 20, SCRIPT);
    expect(stateDigest(a)).toBe(stateDigest(b));
    well(b).life -= 1;
    expect(stateDigest(a)).not.toBe(stateDigest(b));
  });

  it('l’invité qui reçoit la partie en cours de route reprend le même cycle et la même usure', () => {
    const host = fresh();
    play(host, 0, 60 * 40, SCRIPT);
    const guest = deserialize(JSON.parse(JSON.stringify(serialize(host))));
    guest.setLocal(1);
    expect(stateDigest(guest)).toBe(stateDigest(host));
    play(host, 60 * 40, 60 * 100, SCRIPT);
    play(guest, 60 * 40, 60 * 100, SCRIPT);
    expect(stateDigest(guest)).toBe(stateDigest(host));
    expect(well(guest).serialize()).toEqual(well(host).serialize());
    expect(well(host).made).toBeGreaterThan(well(host).spec.cycle.length);
  });
});

describe('puits à deux : la limite de deux', () => {
  it('les kits forment un seul stock : ce que l’un a acheté compte pour l’autre, et rien n’est payé en trop', () => {
    const g = new GameState(9);
    g.addPlayer();
    g.project.phase = 7;
    g.money = 1_000_000;
    goTo(g, 'workshop');
    g.withSlot(1, () => goTo(g, 'workshop'));
    expect(g.buyKit('well', 2)).toBe(true);
    const after = g.money;
    // Le second joueur ne peut rien acheter de plus : le stock est commun.
    expect(g.withSlot(1, () => g.buyKit('well', 1))).toBe(false);
    expect(g.withSlot(1, () => g.ownedCount('well'))).toBe(2);
    expect(g.money).toBe(after);
    // Un invité qui part puis revient ne rouvre pas la limite.
    g.guestIds[1] = 'amie';
    dropGuest(g, 1);
    expect(g.buyKit('well', 1)).toBe(false);
    expect(g.ownedCount('well')).toBe(2);
  });
});
