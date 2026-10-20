/**
 * Dépanneurs à deux : les deux appareils calculent la même partie. On joue le même scénario sur deux copies, et sur deux copies
 * rechargées d'une même sauvegarde prise en cours de route (c'est ce que fait une resynchronisation) : machines, ouvriers et constats
 * doivent rester identiques, pas après pas.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/constants';
import { stateDigest } from '../src/net/digest';
import { deserialize, serialize } from '../src/save/save';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Trois foreuses à l'arrêt (une seule peut être rechargée : le charbon des coffres est compté), deux dépanneurs, une joueuse invitée. */
function start(): GameState {
  const g = new GameState(9);
  g.addPlayer();
  g.guestIds[1] = 'amie';
  const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
  c.put('coal', 4);
  for (const x of [56, 60, 64]) {
    g.world.setDeposit(x, 9, 0, 80);
    g.structures.add(new Drill(x, 9, 1));
  }
  g.workers.add('fixer', g);
  g.workers.add('fixer', g);
  return g;
}

const play = (g: GameState, steps: number) => {
  for (let i = 0; i < steps; i++) g.update(SIM_DT, [IDLE, IDLE]);
};

const view = (g: GameState) =>
  JSON.stringify({
    reports: g.workers.serializeReports(),
    workers: g.workers.serialize(),
    fuel: g.structures.list.filter((s): s is Drill => s instanceof Drill).map((d) => [d.x, d.status, d.fuelUnits]),
  });

describe('dépanneurs à deux', () => {
  it('le scénario fait vraiment quelque chose (sinon la comparaison ne prouve rien)', () => {
    const g = start();
    play(g, 60 * 90);
    expect(g.workers.reports.size).toBeGreaterThan(0);
    expect([...g.workers.reports.values()].some((r) => r.shown)).toBe(true);
    expect(g.structures.list.filter((s): s is Drill => s instanceof Drill).some((d) => d.fuelUnits > 0 || d.burn > 0)).toBe(true);
  });

  it('deux appareils qui jouent le même scénario restent identiques, pas après pas', () => {
    const a = start();
    const b = start();
    for (let from = 0; from < 60 * 120; from += 600) {
      play(a, 600);
      play(b, 600);
      expect(stateDigest(a)).toBe(stateDigest(b));
      expect(view(a)).toBe(view(b));
    }
  });

  it('deux copies rechargées d’une même sauvegarde en cours de route évoluent pareil, constats compris', () => {
    const host = start();
    play(host, 60 * 50);
    const text = JSON.stringify(serialize(host));
    const a = deserialize(JSON.parse(text));
    const b = deserialize(JSON.parse(text));
    b.setLocal(1);
    expect(stateDigest(a)).toBe(stateDigest(b));
    for (let from = 0; from < 60 * 120; from += 600) {
      play(a, 600);
      play(b, 600);
      expect(stateDigest(a)).toBe(stateDigest(b));
      expect(view(a)).toBe(view(b));
    }
  });

  it('un constat qui diffère d’un seul côté se voit tout de suite dans l’empreinte', () => {
    const a = start();
    const b = start();
    play(a, 60 * 60);
    play(b, 60 * 60);
    expect(stateDigest(a)).toBe(stateDigest(b));
    const key = [...b.workers.reports.keys()][0];
    expect(key).toBeDefined();
    b.workers.reports.get(key)!.shown = !b.workers.reports.get(key)!.shown;
    expect(stateDigest(a)).not.toBe(stateDigest(b));
  });
});
