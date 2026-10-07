import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { AIR } from '../src/data/blocks';
import { resourceIndex } from '../src/data/resources';
import { DRILLER } from '../src/data/workers';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { drillerFacts, workerStatus } from '../src/ui/crew';
import { run } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ : x de 46 à 53, y de S + 13 à S + 15 (sol dégagé, déjà explorée).
const SPOTS: [number, number][] = [
  [46, S + 13], [48, S + 13], [50, S + 13], [52, S + 13],
  [46, S + 15], [48, S + 15], [50, S + 15], [52, S + 15],
];

function camp(spots = 8): GameState {
  const g = new GameState(4);
  g.pickaxeLevel = 1;
  g.money = 20000;
  for (const [x, y] of SPOTS.slice(0, spots)) {
    g.world.set(x, y, AIR);
    g.world.setDeposit(x, y, resourceIndex('copper'), 60);
    g.world.explored[g.world.idx(x, y)] = 1;
  }
  return g;
}

const drills = (g: GameState) => g.structures.list.filter((s): s is Drill => s instanceof Drill);

describe('foreur : trois foreuses chacun', () => {
  it('le quota est de trois', () => {
    expect(DRILLER.maxDrills).toBe(3);
  });

  it('un foreur pose trois foreuses puis s’arrête, même s’il reste des gisements, des kits et de l’argent', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const w = g.workers.add('driller', g);
    run(g, 120);
    expect(drills(g)).toHaveLength(3);
    expect(drills(g).every((d) => d.placedBy === w.id)).toBe(true);
    expect(g.workers.drillsOf(w, g)).toBe(3);
    expect(g.inventory.kitCount('drill')).toBe(7);
    // Ce n'est pas un blocage : pas de drapeau, pas de « ! » au-dessus de sa tête.
    expect(w.task).toBeNull();
    expect(w.flag === null || w.flag === 'nocoal').toBe(true);
    run(g, 60);
    expect(drills(g)).toHaveLength(3);
  });

  it('chaque foreur a ses trois : deux foreurs en posent six', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const a = g.workers.add('driller', g);
    const b = g.workers.add('driller', g);
    run(g, 240);
    expect(drills(g)).toHaveLength(6);
    expect(g.workers.drillsOf(a, g)).toBe(3);
    expect(g.workers.drillsOf(b, g)).toBe(3);
  });

  it('retirer une de ses foreuses libère une place : il en repose une', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const w = g.workers.add('driller', g);
    run(g, 120);
    expect(drills(g)).toHaveLength(3);
    g.structures.remove(drills(g)[0]);
    expect(g.workers.drillsOf(w, g)).toBe(2);
    run(g, 120);
    expect(drills(g)).toHaveLength(3);
    expect(g.workers.drillsOf(w, g)).toBe(3);
  });

  it('les foreuses du joueur ne comptent pas dans son quota', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    g.workers.add('driller', g);
    for (const [x, y] of SPOTS.slice(0, 2)) {
      g.player.x = (x + 1.5) * 16;
      g.player.y = (y + 0.9) * 16;
      expect(g.canPlace('drill', x, y)).toEqual({ ok: true });
      expect(g.place('drill', x, y, 1)).not.toBeNull();
    }
    run(g, 240);
    expect(drills(g)).toHaveLength(2 + 3);
    expect(drills(g).filter((d) => d.placedBy === 0)).toHaveLength(2);
  });

  it('congédier un foreur laisse ses foreuses, sans propriétaire : son identifiant ne leur reste pas attaché', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const w = g.workers.add('driller', g);
    run(g, 120);
    expect(drills(g)).toHaveLength(3);
    expect(g.fireWorker(w.id)).toBe(true);
    expect(drills(g)).toHaveLength(3);
    expect(drills(g).every((d) => d.placedBy === 0)).toBe(true);
    // Un nouveau foreur reçoit un identifiant neuf et a ses trois places.
    const next = g.workers.add('driller', g);
    run(g, 120);
    expect(g.workers.drillsOf(next, g)).toBe(3);
    expect(drills(g)).toHaveLength(6);
  });

  it('sauvegarde : le propriétaire de chaque foreuse est conservé, donc le quota aussi', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const w = g.workers.add('driller', g);
    run(g, 120);
    const copy = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const loaded = copy.workers.list[0];
    expect(drills(copy).map((d) => d.placedBy)).toEqual([w.id, w.id, w.id]);
    expect(copy.workers.drillsOf(loaded, copy)).toBe(3);
    run(copy, 60);
    expect(drills(copy)).toHaveLength(3);
  });

  it('une ancienne sauvegarde (foreuses sans propriétaire) se charge ; un propriétaire absurde est ignoré', () => {
    const g = camp(3);
    g.inventory.addKit('drill', 3);
    g.workers.add('driller', g);
    run(g, 120);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    for (const s of data.structures as { type: string; by?: unknown }[]) if (s.type === 'drill') delete s.by;
    expect(drills(deserialize(data)).map((d) => d.placedBy)).toEqual([0, 0, 0]);
    for (const s of data.structures as { type: string; by?: unknown }[]) if (s.type === 'drill') s.by = -4.5;
    expect(drills(deserialize(data)).every((d) => d.placedBy === 0)).toBe(true);
  });

  it('l’interface le dit : quota atteint, pas de blocage', () => {
    const g = camp();
    g.inventory.addKit('drill', 10);
    const w = g.workers.add('driller', g);
    run(g, 120);
    // Avec du charbon dans ses foreuses, rien ne le bloque : il dit seulement que son quota est atteint.
    for (const d of drills(g)) d.fuelUnits = d.fuelMax;
    run(g, 5);
    const st = workerStatus(g, w);
    expect(st.tone).toBe('idle');
    expect(st.text).toMatch(/3 foreuses/);
    expect(drillerFacts(w.level, g.workers.drillsOf(w, g))).toMatch(/foreuses posées : 3 \/ 3/);
    expect(drillerFacts(w.level)).not.toMatch(/foreuses posées/);
  });
});
