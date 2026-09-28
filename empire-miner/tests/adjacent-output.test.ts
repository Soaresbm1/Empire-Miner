import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { conveyorThroughput, getMachine } from '../src/data/machines';
import { resourceIndex } from '../src/data/resources';
import { GameState } from '../src/sim/GameState';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import type { Drill } from '../src/sim/structures/Drill';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 10; // galerie est de la mine de départ (y = S+10 et S+11 ouverts, x de 51 à 58)

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 50, S + 8); // dans le puits, à portée de toute la galerie
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

const beltItems = (g: GameState, x: number, y: number) => (g.structures.at(x, y) as Conveyor).items.map((i) => i.res);

describe('coffre relié à un convoyeur', () => {
  it('ce que le joueur dépose dans le coffre part sur le convoyeur collé', () => {
    const g = new GameState(4);
    const chest = put(g, 'storage', 52, Y) as Storage;
    put(g, 'conveyor', 53, Y, 0);
    put(g, 'conveyor', 54, Y, 0);
    const end = put(g, 'storage', 55, Y) as Storage;
    g.inventory.add('copper', 4);
    g.inventory.add('coal', 3);
    teleport(g, 52, Y + 1);
    expect(g.storageDepositAll(chest)).toBe(7);
    run(g, 1);
    expect(beltItems(g, 53, Y).length + beltItems(g, 54, Y).length).toBeGreaterThan(0);
    run(g, 15);
    expect(chest.items).toEqual({});
    expect(end.items).toEqual({ copper: 4, coal: 3 });
  });

  it('sert de tampon au milieu d’une chaîne (convoyeur → coffre → convoyeur)', () => {
    const g = new GameState(4);
    const input = put(g, 'conveyor', 51, Y, 0) as Conveyor; // pointe vers le coffre : entrée
    const chest = put(g, 'storage', 52, Y) as Storage;
    put(g, 'conveyor', 53, Y, 0);
    const end = put(g, 'storage', 54, Y) as Storage;
    const dt = 1 / 60;
    let fed = 0;
    for (let t = 0; t < 20; t += dt) {
      if (t < 8 && input.accept('iron', 0)) fed++;
      g.update(dt, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(end.items.iron).toBe(fed);
    expect(chest.items).toEqual({});
  });

  it('ne renvoie rien sur le convoyeur qui l’alimente', () => {
    const g = new GameState(4);
    const input = put(g, 'conveyor', 51, Y, 0) as Conveyor;
    const chest = put(g, 'storage', 52, Y) as Storage;
    chest.put('gold', 5);
    run(g, 5);
    expect(input.items.length).toBe(0);
    expect(chest.items.gold).toBe(5);
  });

  it('se vide aussi sur un convoyeur qui passe sur le côté', () => {
    const g = new GameState(4);
    const chest = put(g, 'storage', 52, Y) as Storage;
    put(g, 'conveyor', 52, Y + 1, 0); // sous le coffre, file vers l'est
    put(g, 'conveyor', 53, Y + 1, 0);
    const end = put(g, 'storage', 54, Y + 1) as Storage;
    chest.put('silver', 3);
    run(g, 12);
    expect(end.items.silver).toBe(3);
  });

  it('le débit de sortie reste limité par le convoyeur', () => {
    const g = new GameState(4);
    const chest = put(g, 'storage', 52, Y) as Storage;
    for (let x = 53; x <= 56; x++) put(g, 'conveyor', x, Y, 0);
    const end = put(g, 'storage', 57, Y) as Storage;
    chest.put('coal', 90);
    const T = 20;
    run(g, T);
    const max = conveyorThroughput(getMachine('conveyor'));
    expect(end.items.coal ?? 0).toBeGreaterThan(0);
    expect(end.items.coal ?? 0).toBeLessThanOrEqual(Math.ceil(max * T));
    expect(chest.items.coal).toBeGreaterThan(0); // tout n'est pas sorti d'un coup
  });
});

describe('foreuse reliée à un convoyeur', () => {
  function drillOn(g: GameState, x: number, dir: Dir) {
    g.world.setDeposit(x, Y, resourceIndex('copper'), 1000);
    const d = put(g, 'drill', x, Y, dir) as Drill;
    d.addFuel(10);
    return d;
  }

  it('sans rien devant sa flèche, elle pousse dans un convoyeur collé sur le côté', () => {
    const g = new GameState(4);
    const d = drillOn(g, 55, 3); // flèche vers le nord : la roche
    put(g, 'conveyor', 56, Y, 0);
    const end = put(g, 'storage', 57, Y) as Storage;
    run(g, 20);
    expect(d.status).not.toBe('full');
    expect(end.items.copper ?? 0).toBeGreaterThan(3);
  });

  it('la sortie devant la flèche reste prioritaire', () => {
    const g = new GameState(4);
    drillOn(g, 55, 0);
    const front = put(g, 'storage', 56, Y) as Storage;
    put(g, 'conveyor', 55, Y + 1, 0); // collé en dessous
    const side = put(g, 'storage', 56, Y + 1) as Storage;
    run(g, 20);
    expect(front.items.copper ?? 0).toBeGreaterThan(3);
    expect(side.items.copper ?? 0).toBe(0);
  });

  it('le convoyeur qui lui apporte du charbon reste une entrée', () => {
    const g = new GameState(4);
    const d = drillOn(g, 55, 3);
    d.fuelUnits = 0;
    const feed = put(g, 'conveyor', 54, Y, 0) as Conveyor; // pointe vers la foreuse
    put(g, 'conveyor', 56, Y, 0);
    const end = put(g, 'storage', 57, Y) as Storage;
    feed.accept('coal', 0);
    run(g, 20);
    expect(feed.items.some((i) => i.res === 'copper')).toBe(false);
    expect(d.extracted).toBeGreaterThan(0); // le charbon livré a bien été brûlé
    expect(end.items.copper ?? 0).toBeGreaterThan(0);
  });
});

describe('coffre de charbon collé à une foreuse', () => {
  function bareDrill(g: GameState, x: number, res: string, dir: Dir) {
    g.world.setDeposit(x, Y, resourceIndex(res), 1000);
    return put(g, 'drill', x, Y, dir) as Drill;
  }

  it('recharge la foreuse en continu', () => {
    const g = new GameState(4);
    const d = bareDrill(g, 55, 'copper', 0);
    const out = put(g, 'storage', 56, Y) as Storage; // sortie devant la flèche
    const coal = put(g, 'storage', 55, Y + 1) as Storage; // coffre de charbon collé dessous
    coal.put('coal', 20);
    run(g, 2);
    // Réservoir plein (10) pendant qu'une unité brûle.
    expect(d.fuelUnits).toBe(d.fuelMax);
    expect(d.burn).toBeGreaterThan(0);
    expect(coal.items.coal).toBe(20 - d.fuelMax - 1);
    run(g, 70);
    expect(d.status).toBe('ok');
    expect(d.fuelUnits).toBe(d.fuelMax); // toujours plein : le coffre compense ce qui brûle
    expect(d.extracted).toBeGreaterThan(25);
    expect(out.items.copper).toBe(d.extracted);
    expect(coal.items.coal).toBeLessThan(10);
  });

  it('une foreuse à charbon qui remplit un coffre devant elle s’alimente toute seule', () => {
    const g = new GameState(4);
    const d = bareDrill(g, 55, 'coal', 0);
    put(g, 'storage', 56, Y);
    d.addFuel(1); // 30 s d'autonomie seulement
    run(g, 200);
    expect(d.extracted).toBeGreaterThan(60); // sans recharge : ~12 unités puis arrêt
    expect(d.status).toBe('ok');
  });

  it('la foreuse est servie avant les convoyeurs qui partent du coffre', () => {
    const g = new GameState(4);
    const chest = put(g, 'storage', 52, Y) as Storage;
    const belt = put(g, 'conveyor', 51, Y, 2) as Conveyor; // part du coffre vers l'ouest
    g.world.setDeposit(53, Y, resourceIndex('copper'), 1000);
    const d = put(g, 'drill', 53, Y, 0) as Drill;
    chest.put('coal', 5);
    run(g, 0.5);
    expect(belt.items.length).toBe(0);
    expect(d.fuelUnits + (d.burn > 0 ? 1 : 0)).toBe(5);
    expect(chest.items.coal ?? 0).toBe(0);
  });

  it('un coffre sans charbon ne fait pas démarrer la foreuse', () => {
    const g = new GameState(4);
    const d = bareDrill(g, 55, 'copper', 0);
    put(g, 'storage', 56, Y);
    (put(g, 'storage', 55, Y + 1) as Storage).put('iron', 5);
    run(g, 5);
    expect(d.status).toBe('nofuel');
    expect(d.extracted).toBe(0);
  });
});
