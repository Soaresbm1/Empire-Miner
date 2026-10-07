import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { GameState, PICKUP_RADIUS, type PlayerIntent } from '../src/sim/GameState';

const S = SURFACE_ROWS;
const DT = 1 / 60;
const Y = S + 14;

/** Un joueur debout en (tx, Y) qui frappe la paroi en (wallX, Y). */
const miner = (wallX: number): PlayerIntent => ({ mx: 0, my: 0, mine: true, target: { tx: wallX, ty: Y } });

function place(g: GameState, slot: number, tx: number): void {
  g.withSlot(slot, () => {
    g.player.x = (tx + 0.5) * TILE;
    g.player.y = (Y + 0.5) * TILE;
  });
}

/** Position et santé d'un joueur : déterministes, donc égales à celles qu'il aurait seul. */
function body(g: GameState, slot: number) {
  return g.withSlot(slot, () => ({ x: Math.round(g.player.x * 100) / 100, y: Math.round(g.player.y * 100) / 100, hp: Math.round(g.hp * 100) / 100 }));
}

/** Nombre d'objets dans le sac d'un joueur. */
const carried = (g: GameState, slot: number) => g.withSlot(slot, () => Object.values(g.inventory.items).reduce((a, b) => a + b, 0));

/** Objets restés par terre à moins de deux rayons de ramassage de ce joueur. */
const lying = (g: GameState, slot: number) =>
  g.withSlot(slot, () => g.drops.list.filter((d) => Math.hypot(d.x - g.player.x, d.y - (g.player.y - 3)) <= PICKUP_RADIUS * 2).reduce((n, d) => n + d.count, 0));

/** Partie à deux : A (emplacement 0) au bord gauche de la salle, B (emplacement 1) au bord droit. */
function duo(configure: (g: GameState) => void = () => {}, secs = 16, intents: (t: number) => PlayerIntent[] = () => [miner(45), miner(54)]) {
  const g = new GameState(4);
  g.pickaxeLevel = 1;
  g.addPlayer();
  place(g, 0, 46);
  place(g, 1, 53);
  configure(g);
  for (let t = 0; t < secs; t += DT) g.update(DT, intents(t));
  return g;
}

const noPickup = (g: GameState) => {
  for (const k of Object.keys(g.autoPickup)) g.autoPickup[k] = false;
};

describe('jeu à deux : le ramassage, la santé et le déplacement de chacun sont à lui', () => {
  it('de base : chacun casse sa paroi et ramasse tout ce qu\'il a cassé', () => {
    const g = duo();
    expect(carried(g, 0)).toBeGreaterThan(0);
    expect(carried(g, 1)).toBeGreaterThan(0);
    expect(lying(g, 0)).toBe(0);
    expect(lying(g, 1)).toBe(0);
  });

  it('l\'hôte a coupé tout le ramassage : le sien reste par terre, celui de l\'invité est ramassé', () => {
    const g = duo(noPickup);
    expect(carried(g, 0)).toBe(0);
    expect(lying(g, 0)).toBeGreaterThan(0);
    expect(carried(g, 1)).toBeGreaterThan(0);
    expect(lying(g, 1)).toBe(0);
  });

  it('l\'invité a coupé tout le ramassage : le sien reste par terre, celui de l\'hôte est ramassé', () => {
    const g = duo((s) => s.withSlot(1, () => noPickup(s)));
    expect(carried(g, 1)).toBe(0);
    expect(lying(g, 1)).toBeGreaterThan(0);
    expect(carried(g, 0)).toBeGreaterThan(0);
    expect(lying(g, 0)).toBe(0);
  });

  it('le sac de l\'hôte est plein : celui de l\'invité se remplit quand même', () => {
    const g = duo((s) => {
      s.inventory.add('copper', s.inventory.room('copper'));
    });
    expect(carried(g, 1)).toBeGreaterThan(0);
    expect(lying(g, 1)).toBe(0);
  });

  it('le sac de l\'invité est plein : celui de l\'hôte se remplit quand même', () => {
    const g = duo((s) => s.withSlot(1, () => s.inventory.add('copper', s.inventory.room('copper'))));
    expect(carried(g, 0)).toBeGreaterThan(0);
    expect(lying(g, 0)).toBe(0);
  });

  it('l\'hôte marche pendant que l\'invité mine : chacun va où il va, l\'invité ramasse', () => {
    const solo = new GameState(4);
    solo.pickaxeLevel = 1;
    place(solo, 0, 46);
    const walk: PlayerIntent = { mx: 0, my: -1, mine: false, target: null };
    for (let t = 0; t < 16; t += DT) solo.update(DT, [walk]);
    const g = duo(undefined, 16, () => [walk, miner(54)]);
    expect(body(g, 0)).toEqual(body(solo, 0));
    expect(carried(g, 1)).toBeGreaterThan(0);
    expect(lying(g, 1)).toBe(0);
  });

  it('l\'hôte est évanoui : l\'invité garde sa santé, sa place et ce qu\'il ramasse', () => {
    const before = body(duo(undefined, 0), 1);
    const g = duo((s) => s.hurtPlayer(500, 'grisou'));
    expect(body(g, 1)).toEqual(before);
    expect(carried(g, 1)).toBeGreaterThan(0);
    expect(lying(g, 1)).toBe(0);
  });

  it('l\'invité est évanoui : l\'hôte garde sa santé, sa place et ce qu\'il ramasse', () => {
    const before = body(duo(undefined, 0), 0);
    const g = duo((s) => s.withSlot(1, () => s.hurtPlayer(500, 'grisou')));
    expect(body(g, 0)).toEqual(before);
    expect(carried(g, 0)).toBeGreaterThan(0);
    expect(lying(g, 0)).toBe(0);
  });
});
