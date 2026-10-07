import { describe, expect, it } from 'vitest';
import { GameState, NO_INTENT } from '../src/sim/GameState';

const DT = 1 / 60;
const tick = (g: GameState, n: number) => {
  for (let i = 0; i < n; i++) g.update(DT, [NO_INTENT, NO_INTENT]);
};

/**
 * Deux joueurs au camp ; un tas de `res` tombe aux pieds du joueur 1 (l'invité). L'hôte est à côté (`near`) ou à l'autre
 * bout du camp : deux situations qui défaisaient chacune le ramassage de l'invité.
 */
function setup(res = 'stone', near = false) {
  const g = new GameState(4);
  g.addPlayer();
  const guest = g.withSlot(1, () => ({ x: g.player.x, y: g.player.y }));
  if (!near) g.player.x += 300;
  g.drops.spawn(res, 1, guest.x, guest.y - 3);
  return { g, guest };
}

describe('jeu à deux : le ramassage de chacun est à lui', () => {
  it('l\'invité ramasse ce qui tombe à ses pieds', () => {
    const { g } = setup();
    tick(g, 120);
    expect(g.withSlot(1, () => g.inventory.items.stone ?? 0)).toBe(1);
    expect(g.drops.list.length).toBe(0);
  });

  it('même si l\'hôte a coupé le ramassage de ce minerai (à côté ou loin)', () => {
    for (const near of [true, false]) {
      const { g } = setup('stone', near);
      g.autoPickup.stone = false; // réglage de l'hôte (joueur 0)
      tick(g, 120);
      expect(g.withSlot(1, () => g.inventory.items.stone ?? 0)).toBe(1);
      expect(g.inventory.items.stone ?? 0).toBe(0);
    }
  });

  it('quand les deux sont là, le premier arrivé le prend, une seule fois', () => {
    const { g } = setup('stone', true);
    tick(g, 120);
    const total = (g.inventory.items.stone ?? 0) + g.withSlot(1, () => g.inventory.items.stone ?? 0);
    expect(total).toBe(1);
    expect(g.drops.list.length).toBe(0);
  });

  it('même si le sac de l\'hôte est plein', () => {
    const { g } = setup('copper');
    const free = g.inventory.room('copper');
    g.inventory.add('copper', free);
    tick(g, 120);
    expect(g.withSlot(1, () => g.inventory.items.copper ?? 0)).toBe(1);
  });

  it('l\'hôte ramasse aussi quand c\'est l\'invité qui a coupé le ramassage', () => {
    const g = new GameState(4);
    g.addPlayer();
    g.withSlot(1, () => (g.autoPickup.stone = false));
    g.drops.spawn('stone', 1, g.player.x, g.player.y - 3);
    tick(g, 120);
    expect(g.inventory.items.stone ?? 0).toBe(1);
    expect(g.withSlot(1, () => g.inventory.items.stone ?? 0)).toBe(0);
  });

  it('un objet jeté par l\'invité n\'est pas rendu à l\'invité parce que l\'hôte est loin', () => {
    const g = new GameState(4);
    g.addPlayer();
    g.withSlot(1, () => {
      g.inventory.add('coal', 2);
      g.dropFromInventory('coal', 2);
    });
    // L'hôte (joueur 0) est au camp ; on l'éloigne de plus de 30 px, l'invité reste sur son tas.
    g.player.x += 400;
    tick(g, 120);
    expect(g.withSlot(1, () => g.inventory.items.coal ?? 0)).toBe(0);
    expect(g.drops.list.length).toBe(1);
  });
});
