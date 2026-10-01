import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { AIR, HOST_ROCK_IDS } from '../src/data/blocks';
import { BAGS, SCOOTER } from '../src/data/tools';
import { deserialize, serialize } from '../src/save/save';
import { GameState, NO_INTENT, PlayerIntent } from '../src/sim/GameState';
import { workshopPanel } from '../src/ui/panels';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 20;
const RIDE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null, ride: true };
const ROLL: PlayerIntent = { mx: 1, my: 0, mine: false, target: null, ride: true };
const WALK: PlayerIntent = { mx: 1, my: 0, mine: false, target: null };

/** Galerie horizontale dégagée, avec le joueur à son extrémité gauche. */
function gallery(g: GameState, x0 = 10, x1 = 60): void {
  for (let x = x0; x <= x1; x++) {
    g.world.set(x, Y, AIR);
    g.world.setExplored(x, Y);
  }
  teleport(g, x0 + 1, Y);
}

/** Distance parcourue (en cases) pendant `seconds` avec cette intention, depuis le début de la galerie. */
function travel(g: GameState, intent: PlayerIntent, seconds = 0.5): number {
  gallery(g);
  const x0 = g.player.x;
  run(g, seconds, intent);
  return (g.player.x - x0) / TILE;
}

describe('trottinette : achat à l’Atelier', () => {
  it('s’achète à l’Atelier, une seule fois, et coûte son prix', () => {
    const g = new GameState(4);
    g.money = 2000;
    teleport(g, 5, S - 6); // loin de l'Atelier
    expect(g.buyScooter()).toBe(false);
    expect(g.hasScooter).toBe(false);
    expect(g.money).toBe(2000);
    goTo(g, 'workshop');
    expect(g.buyScooter()).toBe(true);
    expect(g.hasScooter).toBe(true);
    expect(g.money).toBe(2000 - SCOOTER.price);
    expect(g.events.some((e) => e.t === 'bought' && e.name === SCOOTER.name)).toBe(true);
    expect(g.buyScooter()).toBe(false); // déjà achetée
    expect(g.money).toBe(2000 - SCOOTER.price);
  });

  it('refuse l’achat sans assez d’argent', () => {
    const g = new GameState(4);
    goTo(g, 'workshop');
    g.money = SCOOTER.price - 1;
    expect(g.buyScooter()).toBe(false);
    expect(g.hasScooter).toBe(false);
    expect(g.money).toBe(SCOOTER.price - 1);
  });

  it('la fiche de l’Atelier (onglet Transport) propose l’achat, puis indique qu’elle est acquise', () => {
    const g = new GameState(4);
    g.money = SCOOTER.price;
    goTo(g, 'workshop');
    let html = workshopPanel(g, 'transport');
    expect(html).toContain(SCOOTER.name);
    expect(html).toContain('data-action="buyScooter"');
    expect(html).not.toMatch(/data-action="buyScooter"[^>]*disabled/);
    g.money = 10;
    expect(workshopPanel(g, 'transport')).toMatch(/data-action="buyScooter"[^>]*disabled/);
    g.money = SCOOTER.price;
    g.buyScooter();
    html = workshopPanel(g, 'transport');
    expect(html).toContain('acquise');
    expect(html).not.toContain('data-action="buyScooter"');
  });
});

describe('trottinette : Maj enfoncée = montée, Maj relâchée = descente', () => {
  it('sans trottinette, Maj ne change rien', () => {
    const g = new GameState(4);
    gallery(g);
    run(g, 0.2, RIDE);
    expect(g.scootering).toBe(false);
    expect(travel(new GameState(4), ROLL)).toBeCloseTo(travel(new GameState(4), WALK), 5);
  });

  it('on monte quand Maj est enfoncée et on descend dès qu’elle est relâchée', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    gallery(g);
    run(g, 0.1, NO_INTENT);
    expect(g.scootering).toBe(false);
    run(g, 0.1, RIDE);
    expect(g.scootering).toBe(true);
    run(g, 0.1, NO_INTENT);
    expect(g.scootering).toBe(false);
    run(g, 0.1, RIDE);
    expect(g.scootering).toBe(true);
  });

  it('un événement signale chaque montée et chaque descente, une seule fois', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    gallery(g);
    g.events = [];
    run(g, 0.3, RIDE);
    run(g, 0.3, NO_INTENT);
    run(g, 0.3, NO_INTENT);
    const mounts = g.events.filter((e) => e.t === 'mount').map((e) => (e as { on: boolean }).on);
    expect(mounts).toEqual([true, false]);
  });

  it('en roulant, on va 1,7 fois plus vite ; en marchant, à la vitesse normale', () => {
    const walk = new GameState(4);
    const ride = new GameState(4);
    ride.hasScooter = true;
    const dWalk = travel(walk, WALK);
    const dRide = travel(ride, ROLL);
    expect(ride.scootering).toBe(true);
    expect(dRide / dWalk).toBeCloseTo(SCOOTER.speedMul, 1);
    // Sans Maj, même avec la trottinette, on marche.
    const owner = new GameState(4);
    owner.hasScooter = true;
    expect(travel(owner, WALK)).toBeCloseTo(dWalk, 5);
  });

  it('la vitesse se cumule avec celle du sac', () => {
    const plain = new GameState(4);
    plain.hasScooter = true;
    const loaded = new GameState(4);
    loaded.hasScooter = true;
    loaded.setBagLevel(BAGS.length - 1);
    expect(travel(loaded, ROLL) / travel(plain, ROLL)).toBeCloseTo(BAGS[BAGS.length - 1].speedMul, 2);
  });
});

describe('trottinette : pas de minage en roulant', () => {
  /** Roche tendre juste à droite du joueur, au bout d'une galerie. */
  function face(g: GameState) {
    gallery(g, 10, 14);
    const tx = 15;
    g.world.set(tx, Y, HOST_ROCK_IDS[0]);
    g.world.setExplored(tx, Y);
    teleport(g, 14, Y);
    return { tx, ty: Y };
  }
  const mineIntent = (t: { tx: number; ty: number }, ride: boolean): PlayerIntent => ({ mx: 0, my: 0, mine: true, target: t, ride });

  it('Maj maintenue : la pioche ne frappe pas', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    const t = face(g);
    run(g, 6, mineIntent(t, true));
    expect(g.world.isSolid(t.tx, t.ty)).toBe(true);
    expect(g.player.swingT).toBe(0);
  });

  it('Maj relâchée : on mine de nouveau', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    const t = face(g);
    run(g, 6, mineIntent(t, true));
    run(g, 6, mineIntent(t, false));
    expect(g.world.isSolid(t.tx, t.ty)).toBe(false);
  });

  it('monter interrompt le coup de pioche en cours', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    const t = face(g);
    run(g, 0.1, mineIntent(t, false));
    expect(g.player.swingT).toBeGreaterThan(0);
    run(g, 1 / 60, mineIntent(t, true));
    expect(g.scootering).toBe(true);
    expect(g.player.swingT).toBe(0);
    expect(g.player.swingTarget).toBe(null);
    expect(g.world.isSolid(t.tx, t.ty)).toBe(true);
  });
});

describe('trottinette : sauvegarde', () => {
  it('l’achat est sauvegardé, pas l’état « en train de rouler »', () => {
    const g = new GameState(4);
    g.hasScooter = true;
    gallery(g);
    run(g, 0.2, RIDE);
    expect(g.scootering).toBe(true);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(back.hasScooter).toBe(true);
    expect(back.scootering).toBe(false);
  });

  it('une ancienne sauvegarde, sans trottinette, se charge à pied', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete data.tools.scooter;
    expect(deserialize(data).hasScooter).toBe(false);
    delete data.tools;
    expect(deserialize(data).hasScooter).toBe(false);
  });
});
