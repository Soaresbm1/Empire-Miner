import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { AIR, HOST_ROCK_IDS } from '../src/data/blocks';
import { HEALTH } from '../src/data/hazards';
import { ROPE } from '../src/data/tools';
import { deserialize, serialize } from '../src/save/save';
import { GameState, NO_INTENT, PlayerIntent } from '../src/sim/GameState';
import { goTo, run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 20; // environ 52 m de profondeur
const MOVE: PlayerIntent = { mx: 1, my: 0, mine: false, target: null };

/** Galerie dégagée où le joueur se tient, loin du camp. */
function gallery(g: GameState, x0 = 20, x1 = 40): void {
  for (let x = x0; x <= x1; x++) {
    g.world.set(x, Y, AIR);
    g.world.setExplored(x, Y);
  }
  teleport(g, x0 + 3, Y);
}

/** Partie dans la galerie, avec `ropes` cordes. */
function inMine(ropes = 2): GameState {
  const g = new GameState(4);
  g.ropes = ropes;
  gallery(g);
  g.events = [];
  return g;
}

const messages = (g: GameState) => g.events.filter((e) => e.t === 'message').map((e) => (e as { text: string }).text);
const phases = (g: GameState) => g.events.filter((e) => e.t === 'rope').map((e) => (e as { phase: string }).phase);

describe('corde de rappel : achat à l’Atelier', () => {
  it('une corde, ou le lot de cinq moins cher à l’unité', () => {
    const g = new GameState(4);
    g.money = 1000;
    goTo(g, 'workshop');
    expect(g.buyRope(1)).toBe(true);
    expect(g.ropes).toBe(1);
    expect(g.money).toBe(1000 - ROPE.price);
    expect(g.buyRope(ROPE.pack.qty)).toBe(true);
    expect(g.ropes).toBe(1 + ROPE.pack.qty);
    expect(g.money).toBe(1000 - ROPE.price - ROPE.pack.price);
    expect(ROPE.pack.price).toBeLessThan(ROPE.price * ROPE.pack.qty);
    expect(g.events.some((e) => e.t === 'bought' && e.name === `${ROPE.name} ×${ROPE.pack.qty}`)).toBe(true);
  });

  it('refuse loin de l’Atelier, sans argent, ou au-delà du stock maximal', () => {
    const g = new GameState(4);
    g.money = 5000;
    teleport(g, 5, S - 6);
    expect(g.buyRope()).toBe(false);
    goTo(g, 'workshop');
    g.money = ROPE.price - 1;
    expect(g.buyRope()).toBe(false);
    expect(g.money).toBe(ROPE.price - 1);
    g.money = 5000;
    g.ropes = ROPE.maxStock - 2;
    expect(g.buyRope(ROPE.pack.qty)).toBe(false); // le lot dépasserait le maximum
    expect(g.buyRope(1)).toBe(true);
    g.ropes = ROPE.maxStock;
    expect(g.buyRope(1)).toBe(false);
    expect(g.ropes).toBe(ROPE.maxStock);
  });
});

describe('corde de rappel : remonter au camp', () => {
  it('on reste suspendu quelques secondes, puis on est au camp avec tout son sac', () => {
    const g = inMine();
    g.inventory.add('copper', 3);
    g.inventory.addKit('conveyor', 4);
    const from = { tx: g.player.tileX, ty: g.player.tileY };
    expect(g.useRope()).toBe('start');
    expect(g.ropeT).toBeCloseTo(ROPE.channel, 5);
    run(g, ROPE.channel - 0.5, NO_INTENT);
    expect(g.player.tileY).toBe(from.ty); // toujours dans la mine
    expect(g.ropeT).toBeGreaterThan(0);
    run(g, 0.6, NO_INTENT);
    expect(g.ropeT).toBe(0);
    expect(g.player.tileY).toBeLessThan(S); // au camp
    expect(g.atCamp).toBe(true);
    expect(g.inventory.count('copper')).toBe(3); // contrairement à un évanouissement, le sac suit
    expect(g.inventory.kitCount('conveyor')).toBe(4);
    expect(g.ropes).toBe(1);
    expect(g.ropeAnchor).toEqual(from);
    expect(phases(g)).toEqual(['start', 'up']);
  });

  it('un repère « Corde de rappel » marque l’endroit, et il n’y en a qu’un', () => {
    const g = inMine(3);
    const x0 = g.player.tileX;
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    const m1 = g.markers.list.filter((m) => m.label === ROPE.name);
    expect(m1).toHaveLength(1);
    expect(m1[0]).toMatchObject({ x: x0, y: Y, kind: 'base' });
    // Une deuxième remontée, ailleurs : l'ancien repère disparaît.
    teleport(g, x0 + 5, Y);
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    const m2 = g.markers.list.filter((m) => m.label === ROPE.name);
    expect(m2).toHaveLength(1);
    expect(m2[0].x).toBe(x0 + 5);
    expect(g.ropes).toBe(1);
  });

  it('bouger annule la manœuvre sans consommer la corde', () => {
    const g = inMine();
    const x0 = g.player.x;
    g.useRope();
    run(g, 1, NO_INTENT);
    run(g, 0.2, MOVE);
    expect(g.ropeT).toBe(0);
    expect(g.ropes).toBe(2);
    expect(g.ropeAnchor).toBe(null);
    expect(g.player.x).toBeGreaterThan(x0);
    expect(g.player.tileY).toBe(Y);
    expect(phases(g)).toEqual(['start', 'cancel']);
    expect(messages(g).some((t) => /bougé/.test(t))).toBe(true);
  });

  it('appuyer de nouveau sur V range la corde', () => {
    const g = inMine();
    g.useRope();
    run(g, 1, NO_INTENT);
    expect(g.useRope()).toBe('cancel');
    expect(g.ropeT).toBe(0);
    expect(g.ropes).toBe(2);
  });

  it('un gros choc (éboulement) interrompt la manœuvre, pas le gaz ni la chaleur qui font mal en continu', () => {
    const g = inMine();
    g.useRope();
    g.hurtPlayer(ROPE.interruptDamage - 0.5, 'grisou'); // dégâts continus : on tient bon
    expect(g.ropeT).toBeGreaterThan(0);
    g.hurtPlayer(ROPE.interruptDamage, 'éboulement');
    expect(g.ropeT).toBe(0);
    expect(g.ropes).toBe(2);
    expect(messages(g).some((t) => /lâcher/.test(t))).toBe(true);
  });

  it('s’évanouir pendant la manœuvre l’annule : on est ramené au camp, le sac reste au fond', () => {
    const g = inMine();
    g.inventory.add('gold', 2);
    g.useRope();
    g.hurtPlayer(HEALTH.max * 10, 'noyade');
    expect(g.ropeT).toBe(0);
    expect(g.ropeDir).toBe(null);
    expect(g.stats.faints).toBe(1);
    expect(g.inventory.count('gold')).toBe(0);
    expect(g.ropes).toBe(2);
    expect(g.ropeAnchor).toBe(null);
  });

  it('sans corde, ou depuis un wagonnet, la manœuvre est refusée avec un message', () => {
    const g = inMine(0);
    expect(g.useRope()).toBe('refused');
    expect(messages(g).some((t) => /pas de corde/.test(t))).toBe(true);
    expect(g.ropeT).toBe(0);
    const h = inMine();
    h.riding = {} as never;
    expect(h.useRope()).toBe('refused');
    expect(messages(h).some((t) => /wagonnet/.test(t))).toBe(true);
  });

  it('miner pendant la manœuvre l’annule', () => {
    const g = inMine();
    g.world.set(g.player.tileX + 1, Y, HOST_ROCK_IDS[0]);
    g.useRope();
    run(g, 0.5, { mx: 0, my: 0, mine: true, target: { tx: g.player.tileX + 1, ty: Y } });
    expect(g.ropeT).toBe(0);
    expect(g.ropes).toBe(2);
  });
});

describe('corde de rappel : où l’on ressort', () => {
  /** Partie avec une galerie sous la colonne `x` (profondeur Y), le joueur dedans, et une surface dégagée au-dessus. */
  function below(x: number): GameState {
    const g = new GameState(4);
    g.ropes = 2;
    for (let dx = -2; dx <= 2; dx++) {
      g.world.set(x + dx, Y, AIR);
      g.world.setExplored(x + dx, Y);
      // Surface dégagée alentour : le test ne dépend pas des arbres tirés au hasard.
      for (let y = 3; y < S; y++) g.world.set(x + dx, y, AIR);
    }
    teleport(g, x, Y);
    g.events = [];
    return g;
  }
  const rise = (g: GameState) => {
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
  };

  it('on ressort à la verticale de l’endroit où l’on était, et non au milieu du camp', () => {
    for (const x of [8, 20, 36, 45, 62, 80, 91]) {
      const g = below(x);
      rise(g);
      expect(g.atCamp, `colonne ${x}`).toBe(true);
      expect(g.player.tileX, `colonne ${x}`).toBe(x);
      expect(g.player.tileY, `colonne ${x}`).toBe(g.layout.spawn.y);
    }
  });

  it('le sac et le point d’accroche sont les mêmes qu’avant', () => {
    const g = below(20);
    g.inventory.add('copper', 5);
    rise(g);
    expect(g.inventory.count('copper')).toBe(5);
    expect(g.ropeAnchor).toEqual({ tx: 20, ty: Y });
    expect(messages(g).some((t) => /juste au-dessus/.test(t))).toBe(true);
  });

  it('si la place est prise (arbre, rocher), c’est la case libre la plus proche, toujours en surface', () => {
    const g = below(20);
    g.world.set(20, g.layout.spawn.y, HOST_ROCK_IDS[0]);
    rise(g);
    expect(g.atCamp).toBe(true);
    expect(Math.abs(g.player.tileX - 20) + Math.abs(g.player.tileY - g.layout.spawn.y)).toBe(1);
  });

  it('sous la falaise du bord de la carte : la première case libre en surface', () => {
    const g = new GameState(4);
    g.ropes = 1;
    g.world.set(1, Y, AIR);
    g.world.setExplored(1, Y);
    for (let x = 2; x <= 4; x++) for (let y = 3; y < S; y++) g.world.set(x, y, AIR);
    teleport(g, 1, Y);
    rise(g);
    expect(g.atCamp).toBe(true);
    expect(g.player.tileX).toBeGreaterThanOrEqual(2);
    expect(g.player.tileX).toBeLessThanOrEqual(4);
  });

  it('rien de libre alentour : on revient au point d’apparition du camp', () => {
    const g = below(20);
    for (let x = 14; x <= 26; x++) for (let y = 2; y < S; y++) g.world.set(x, y, HOST_ROCK_IDS[0]);
    rise(g);
    expect(g.atCamp).toBe(true);
    expect(g.player.tileX).toBe(g.layout.spawn.x);
    expect(g.player.tileY).toBe(g.layout.spawn.y);
  });

  it('on ne ressort jamais sous terre, même s’il y a une caverne libre sous la rangée du camp', () => {
    const g = below(20);
    // Surface bouchée sur tout le rayon de recherche ; une poche d'air juste sous le sol.
    for (let x = 14; x <= 26; x++) for (let y = 2; y < S; y++) g.world.set(x, y, HOST_ROCK_IDS[0]);
    g.world.set(20, S, AIR);
    g.world.set(20, S + 1, AIR);
    rise(g);
    expect(g.player.tileY).toBeLessThan(S);
  });

  it('puis V ramène au même endroit de la mine', () => {
    const g = below(45);
    rise(g);
    g.events = [];
    expect(g.useRope()).toBe('start');
    run(g, ROPE.channel + 0.1, NO_INTENT);
    expect(g.player.tileX).toBe(45);
    expect(g.player.tileY).toBe(Y);
    expect(g.ropes).toBe(1);
  });
});

describe('corde de rappel : redescendre depuis le camp', () => {
  /** Remonte avec la corde, puis laisse le joueur au camp. */
  function ascended(): { g: GameState; from: { tx: number; ty: number } } {
    const g = inMine();
    const from = { tx: g.player.tileX, ty: g.player.tileY };
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    g.events = [];
    return { g, from };
  }

  it('au camp, V ramène au point d’accroche sans consommer de corde', () => {
    const { g, from } = ascended();
    expect(g.atCamp).toBe(true);
    expect(g.useRope()).toBe('start');
    expect(g.ropeDir).toBe('down');
    run(g, ROPE.channel + 0.1, NO_INTENT);
    expect(g.player.tileX).toBe(from.tx);
    expect(g.player.tileY).toBe(from.ty);
    expect(g.ropes).toBe(1); // inchangé
    expect(g.ropeAnchor).toBe(null);
    expect(g.markers.list.some((m) => m.label === ROPE.name)).toBe(false);
    expect(phases(g)).toEqual(['start', 'down']);
  });

  it('sans corde accrochée, depuis le camp, rien ne se passe (message adapté au stock)', () => {
    const g = new GameState(4);
    g.ropes = 2;
    expect(g.atCamp).toBe(true);
    expect(g.useRope()).toBe('refused');
    expect(messages(g).some((t) => /déjà au camp/.test(t))).toBe(true);
    const h = new GameState(4);
    expect(h.useRope()).toBe('refused');
    expect(messages(h).some((t) => /Aucune corde accrochée/.test(t))).toBe(true);
  });

  it('bouger annule aussi la descente, et la corde reste accrochée', () => {
    const { g } = ascended();
    g.useRope();
    run(g, 0.5, MOVE);
    expect(g.ropeT).toBe(0);
    expect(g.ropeAnchor).not.toBe(null);
    expect(g.atCamp).toBe(true);
  });

  it('si le point d’accroche s’est refermé, on arrive à la case libre la plus proche', () => {
    const { g, from } = ascended();
    g.world.set(from.tx, from.ty, HOST_ROCK_IDS[0]); // éboulement : la case est bouchée
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    expect(g.atCamp).toBe(false);
    expect(g.player.tileY).toBe(Y);
    expect(Math.abs(g.player.tileX - from.tx)).toBeLessThanOrEqual(3);
    expect(g.player.tileX).not.toBe(from.tx);
    expect(g.ropeAnchor).toBe(null);
  });

  it('si tout est bouché autour, on reste au camp et la corde reste accrochée', () => {
    const { g, from } = ascended();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) g.world.set(from.tx + dx, from.ty + dy, HOST_ROCK_IDS[0]);
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    expect(g.atCamp).toBe(true);
    expect(g.ropeAnchor).toEqual(from);
    expect(messages(g).some((t) => /bouché/.test(t))).toBe(true);
  });
});

describe('corde de rappel : sauvegarde', () => {
  it('les cordes et le point d’accroche se retrouvent ; la manœuvre en cours, non', () => {
    const g = inMine(3);
    g.useRope();
    run(g, ROPE.channel + 0.1, NO_INTENT);
    g.useRope(); // redescente commencée
    expect(g.ropeT).toBeGreaterThan(0);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(back.ropes).toBe(2);
    expect(back.ropeAnchor).toEqual(g.ropeAnchor);
    expect(back.ropeT).toBe(0);
    expect(back.ropeDir).toBe(null);
  });

  it('une ancienne sauvegarde se charge sans corde', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete data.rope;
    const g = deserialize(data);
    expect(g.ropes).toBe(0);
    expect(g.ropeAnchor).toBe(null);
  });

  it('ignore un stock ou un point d’accroche absurdes', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    data.rope = { count: 999, anchor: [1e9, 'x'] };
    const g = deserialize(data);
    expect(g.ropes).toBe(ROPE.maxStock);
    expect(g.ropeAnchor).toBe(null);
    data.rope = { count: -4, anchor: [30, Y] };
    const h = deserialize(data);
    expect(h.ropes).toBe(0);
    expect(h.ropeAnchor).toEqual({ tx: 30, ty: Y });
  });
});
