import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { getResource } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState, NO_INTENT } from '../src/sim/GameState';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const LIFE = getResource('stone').groundLife!;
// Salle du fond de la mine de départ, loin du joueur (qui reste en surface).
const X = 48.5 * TILE;
const Y = (S + 14.5) * TILE;

function setup() {
  const g = new GameState(4);
  teleport(g, 40, 8);
  return g;
}

const count = (g: GameState, res: string) => g.drops.list.filter((d) => d.res === res).reduce((n, d) => n + d.count, 0);

describe('pierres au sol', () => {
  it("seule la pierre a une durée de vie au sol", () => {
    expect(LIFE).toBeGreaterThan(0);
    for (const id of ['coal', 'copper', 'iron', 'silver', 'gold']) expect(getResource(id).groundLife).toBeUndefined();
  });

  it("un tas de pierres s'effrite au bout d'un moment, les minerais restent", () => {
    const g = setup();
    g.drops.spawn('stone', 3, X, Y, false);
    g.drops.spawn('copper', 2, X + 20, Y, false);
    g.drops.spawn('coal', 1, X - 20, Y, false);
    run(g, LIFE - 1);
    expect(count(g, 'stone')).toBe(3);
    run(g, 2);
    expect(count(g, 'stone')).toBe(0);
    run(g, LIFE * 3);
    expect(count(g, 'copper')).toBe(2);
    expect(count(g, 'coal')).toBe(1);
  });

  it("prévient la présentation (petit nuage de poussière)", () => {
    const g = setup();
    g.drops.spawn('stone', 1, X, Y, false);
    const seen: string[] = [];
    const dt = 1 / 60;
    for (let t = 0; t < LIFE + 1; t += dt) {
      g.update(dt, NO_INTENT);
      for (const e of g.events) if (e.t === 'crumble') seen.push(e.res);
      g.events.length = 0;
    }
    expect(seen).toEqual(['stone']);
  });

  it('les pierres jetées depuis le sac finissent aussi par disparaître', () => {
    const g = setup();
    g.inventory.add('stone', 4);
    expect(g.dropFromInventory('stone', 4)).toBe(4);
    run(g, 5);
    teleport(g, 60, 8); // le joueur s'éloigne : les pierres ne sont pas ramassées
    run(g, LIFE);
    expect(count(g, 'stone')).toBe(0);
    expect(g.inventory.count('stone')).toBe(0);
  });

  it('un tas qui reçoit de nouvelles pierres repart pour un délai complet', () => {
    const g = setup();
    g.drops.spawn('stone', 1, X, Y, false);
    run(g, LIFE - 10);
    g.drops.spawn('stone', 1, X + 2, Y, false);
    run(g, 15); // les deux tas ont fusionné ; le premier aurait dû s'effriter
    expect(g.drops.list.filter((d) => d.res === 'stone').length).toBe(1);
    expect(count(g, 'stone')).toBe(2);
    run(g, LIFE - 15);
    expect(count(g, 'stone')).toBe(0);
  });

  it("le joueur peut toujours ramasser les pierres avant qu'elles s'effritent", () => {
    const g = setup();
    g.drops.spawn('stone', 2, g.player.x + 40, g.player.y, false);
    run(g, LIFE - 5);
    teleport(g, 40 + 40 / TILE, 8);
    run(g, 1);
    expect(g.inventory.count('stone')).toBe(2);
    expect(count(g, 'stone')).toBe(0);
  });

  it("le temps passé au sol est sauvegardé", () => {
    const g = setup();
    g.drops.spawn('stone', 2, X, Y, false);
    g.drops.spawn('iron', 1, X + 20, Y, false);
    run(g, LIFE - 10);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(count(h, 'stone')).toBe(2);
    run(h, 11);
    expect(count(h, 'stone')).toBe(0);
    expect(count(h, 'iron')).toBe(1);
  });

  it('une ancienne sauvegarde (sans âge des tas) se charge normalement', () => {
    const g = setup();
    g.drops.spawn('stone', 1, X, Y, false);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.drops = data.drops.map((d: unknown[]) => d.slice(0, 4));
    const h = deserialize(data);
    expect(count(h, 'stone')).toBe(1);
    run(h, LIFE);
    expect(count(h, 'stone')).toBe(0);
  });
});
