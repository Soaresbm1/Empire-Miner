import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { AIR, BEDROCK, HOST_ROCK_IDS } from '../src/data/blocks';
import { JACKHAMMER } from '../src/data/tools';
import { deserialize, serialize } from '../src/save/save';
import { GameState, PlayerIntent } from '../src/sim/GameState';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;
const ROCK = HOST_ROCK_IDS[0];
const HARD = HOST_ROCK_IDS[1];

/** Joueur dans le puits, face à un mur de 3 cases (x = 51, y = S+2..S+4). */
function wall(g: GameState, block = ROCK) {
  for (const y of [S + 2, S + 3, S + 4]) {
    g.world.set(51, y, block);
    g.world.setExplored(51, y);
  }
  teleport(g, 50, S + 3);
}

function owned(g: GameState, coal = 10) {
  g.hasJackhammer = true;
  g.tool = 'jackhammer';
  g.inventory.add('coal', coal);
}

/** Maintient le minage sur (51, S+3) pendant `seconds`. */
function hold(g: GameState, seconds: number) {
  run(g, seconds, { mx: 0, my: 0, mine: true, target: { tx: 51, ty: S + 3 } } as PlayerIntent);
}

describe('marteau-piqueur', () => {
  it("s'achète à l'Atelier avec la pioche en fer, puis se prend en main", () => {
    const g = new GameState(4);
    goTo(g, 'workshop');
    g.money = 5000;
    expect(g.buyJackhammer()).toBe(false); // vieille pioche
    g.pickaxeLevel = 2;
    teleport(g, 20, 8); // loin de l'atelier
    expect(g.buyJackhammer()).toBe(false);
    goTo(g, 'workshop');
    expect(g.buyJackhammer()).toBe(true);
    expect(g.money).toBe(5000 - JACKHAMMER.price);
    expect(g.tool).toBe('jackhammer');
    expect(g.activeTool.width).toBe(3);
    expect(g.buyJackhammer()).toBe(false); // déjà acheté
  });

  it('T passe de la pioche au marteau-piqueur (seulement une fois acheté)', () => {
    const g = new GameState(4);
    expect(g.toggleTool()).toBe(false);
    expect(g.activeTool.kind).toBe('pickaxe');
    owned(g);
    expect(g.toggleTool()).toBe(true);
    expect(g.activeTool.kind).toBe('pickaxe');
    expect(g.toggleTool()).toBe(true);
    expect(g.activeTool.kind).toBe('jackhammer');
  });

  it('attaque la case visée et ses deux voisines, perpendiculairement au coup', () => {
    const g = new GameState(4);
    wall(g);
    owned(g);
    hold(g, 0.5);
    for (const y of [S + 2, S + 3, S + 4]) expect(g.world.get(51, y)).toBe(AIR);
    // À la pioche, seule la case visée est touchée.
    const h = new GameState(4);
    wall(h);
    h.pickaxeLevel = 2;
    hold(h, 0.5);
    expect(h.world.get(51, S + 3)).toBe(AIR);
    expect(h.world.get(51, S + 2)).toBe(ROCK);
    expect(h.world.get(51, S + 4)).toBe(ROCK);
  });

  it('creuse bien plus vite que la pioche en fer', () => {
    const timeToOpen = (hammer: boolean) => {
      const g = new GameState(4);
      wall(g, HARD);
      g.pickaxeLevel = 2;
      if (hammer) owned(g);
      let t = 0;
      while (![S + 2, S + 3, S + 4].every((y) => g.world.get(51, y) === AIR) && t < 30) {
        const target = [S + 3, S + 2, S + 4].find((y) => g.world.get(51, y) !== AIR)!;
        run(g, 1 / 60, { mx: 0, my: 0, mine: true, target: { tx: 51, ty: target } } as PlayerIntent);
        t += 1 / 60;
      }
      return t;
    };
    const pick = timeToOpen(false);
    const hammer = timeToOpen(true);
    expect(hammer).toBeLessThan(pick / 3);
  });

  it('brûle le charbon du sac : une unité pour 12 s de travail', () => {
    const g = new GameState(4);
    wall(g, BEDROCK); // indestructible : le marteau tourne sans s'arrêter
    owned(g, 3);
    hold(g, 13);
    expect(g.inventory.count('coal')).toBe(1); // 13 s de marteau : deux unités entamées
    expect(g.hammerFuel).toBeGreaterThan(0);
    expect(g.hammerFuel).toBeLessThan(JACKHAMMER.fuel.secondsPerUnit);
  });

  it("sans charbon, on continue à la pioche (et on est prévenu)", () => {
    const g = new GameState(4);
    wall(g);
    owned(g, 0);
    g.pickaxeLevel = 2;
    run(g, 1 / 60, { mx: 0, my: 0, mine: true, target: { tx: 51, ty: S + 3 } } as PlayerIntent);
    expect(g.player.swingTool).toBe('pickaxe');
    expect(g.events.some((e) => e.t === 'message' && e.text.includes('sans charbon'))).toBe(true);
    hold(g, 1);
    expect(g.world.get(51, S + 3)).toBe(AIR);
    expect(g.world.get(51, S + 2)).toBe(ROCK); // pas de front de 3 cases à la main
  });

  it('les cases voisines indestructibles sont épargnées, sans alerte', () => {
    const g = new GameState(4);
    wall(g, BEDROCK);
    g.world.set(51, S + 3, ROCK);
    owned(g);
    g.events.length = 0;
    hold(g, 0.5);
    expect(g.world.get(51, S + 3)).toBe(AIR);
    expect(g.world.get(51, S + 2)).toBe(BEDROCK);
    expect(g.events.some((e) => e.t === 'denied')).toBe(false);
  });

  it('est sauvegardé avec le charbon qui lui reste', () => {
    const g = new GameState(4);
    wall(g);
    owned(g, 4);
    hold(g, 0.3);
    g.toggleTool();
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.hasJackhammer).toBe(true);
    expect(h.tool).toBe('pickaxe');
    expect(h.hammerFuel).toBeCloseTo(g.hammerFuel, 1);
    // Une ancienne sauvegarde n'a pas de marteau.
    const old = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete old.tools;
    expect(deserialize(old).hasJackhammer).toBe(false);
  });
});
