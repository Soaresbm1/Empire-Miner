import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { AIR, HOST_ROCK_IDS } from '../src/data/blocks';
import { GAS } from '../src/data/hazards';
import { WORKERS, getJob, workerName, workerPrice } from '../src/data/workers';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { Storage } from '../src/sim/structures/Storage';
import { cargoWeight, walkable } from '../src/sim/Workers';
import { goTo, run } from './helpers';

const S = SURFACE_ROWS;
const drop = (g: GameState, res: string, n: number, tx: number, ty: number) => g.drops.spawn(res, n, (tx + 0.5) * TILE, (ty + 0.5) * TILE, false);
const chest = (g: GameState, tx = 46, ty = 10) => g.structures.add(new Storage(tx, ty, 1)) as Storage;
const tile = (w: { x: number; y: number }) => ({ x: Math.floor(w.x / TILE), y: Math.floor((w.y - 1) / TILE) });

describe('ouvriers : achat', () => {
  function atWorkshop(): GameState {
    const g = new GameState(4);
    g.money = 10000;
    g.pickaxeLevel = 1;
    goTo(g, 'workshop');
    return g;
  }

  it('les prix montent à chaque ouvrier, jusqu’à six, sans salaire', () => {
    const g = atWorkshop();
    let paid = 0;
    for (let i = 0; i < WORKERS.max; i++) {
      expect(g.nextWorkerPrice).toBe(WORKERS.prices[i]);
      const before = g.money;
      expect(g.hireWorker(i % 2 ? 'refueler' : 'picker')).toBe(true);
      paid += before - g.money;
    }
    expect(g.workers.count).toBe(WORKERS.max);
    expect(paid).toBe(WORKERS.prices.slice(0, WORKERS.max).reduce((a, b) => a + b, 0));
    expect(g.nextWorkerPrice).toBeNull();
    expect(g.hireWorker('picker')).toBe(false);
    // Achat unique : plus rien n'est débité ensuite.
    const money = g.money;
    run(g, 120);
    expect(g.money).toBe(money);
    expect(workerPrice(0)).toBe(WORKERS.prices[0]);
    expect(workerPrice(WORKERS.max)).toBeNull();
  });

  it('il faut être à l’Atelier, avoir la pioche améliorée et assez d’argent', () => {
    const g = atWorkshop();
    g.player.x = 5 * TILE;
    expect(g.hireWorker('picker')).toBe(false); // loin de l'Atelier
    goTo(g, 'workshop');
    g.pickaxeLevel = 0;
    expect(g.workersUnlocked).toBe(false);
    expect(g.hireWorker('picker')).toBe(false);
    g.pickaxeLevel = 1;
    g.money = WORKERS.prices[0] - 1;
    expect(g.hireWorker('picker')).toBe(false);
    expect(g.money).toBe(WORKERS.prices[0] - 1);
    g.money = WORKERS.prices[0];
    expect(g.hireWorker('picker')).toBe(true);
    expect(g.money).toBe(0);
    expect(g.events.some((e) => e.t === 'bought' && /ramasseur/.test(e.name))).toBe(true);
  });

  it('un ouvrier arrive au camp, sur une case libre, avec un nom', () => {
    const g = atWorkshop();
    g.hireWorker('picker');
    g.hireWorker('refueler');
    const [a, b] = g.workers.list;
    for (const w of [a, b]) {
      const t = tile(w);
      expect(walkable(g, t.x, t.y)).toBe(true);
      expect(t.y).toBeLessThan(S);
    }
    expect(tile(a)).not.toEqual(tile(b));
    expect(workerName(a.id)).not.toBe(workerName(b.id));
    expect(getJob('picker').name).toBe('Ramasseur');
  });

  it('changer de métier est gratuit ; congédier rend sa charge au sol, sans remboursement', () => {
    const g = atWorkshop();
    g.hireWorker('picker');
    const w = g.workers.list[0];
    const money = g.money;
    expect(g.setWorkerJob(w.id, 'refueler')).toBe(true);
    expect(w.job).toBe('refueler');
    expect(g.setWorkerJob(w.id, 'refueler')).toBe(false);
    expect(g.setWorkerJob(999, 'picker')).toBe(false);
    w.cargo = { copper: 2 };
    expect(g.fireWorker(w.id)).toBe(true);
    expect(g.workers.count).toBe(0);
    expect(g.money).toBe(money);
    expect(g.drops.list.some((d) => d.res === 'copper' && d.count === 2)).toBe(true);
    expect(g.fireWorker(w.id)).toBe(false);
  });
});

describe('ramasseur', () => {
  it('ramasse un tas au sol et le range dans le coffre', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 3, 56, 10);
    run(g, 20);
    expect(c.items.copper).toBe(3);
    expect(g.drops.list).toHaveLength(0);
    expect(w.cargo).toEqual({});
  });

  it('un tas à l’autre coin de la case où il se trouve est ramassé, sans réfléchir à chaque image', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    // Il se tient au coin nord-ouest de sa case, le tas est au coin sud-est : sur la même case, donc à portée.
    const t = tile(w);
    w.x = t.x * TILE + 0.5;
    w.y = t.y * TILE + 1.5;
    g.drops.spawn('copper', 1, (t.x + 1) * TILE - 0.5, (t.y + 1) * TILE - 0.5, false);
    run(g, 0.4); // laisse le tas atteindre l'âge de ramassage
    run(g, 10);
    expect(c.items.copper).toBe(1);
  });

  it('descend dans la mine par le puits pour y chercher un minerai', () => {
    const g = new GameState(4);
    const c = chest(g);
    g.workers.add('picker', g);
    drop(g, 'iron', 2, 50, S + 6); // dans le puits de la mine de départ
    run(g, 40);
    expect(c.items.iron).toBe(2);
  });

  it('porte au plus 15 kg : plusieurs voyages pour un gros tas', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    drop(g, 'iron', 10, 56, 10); // 3 kg pièce : 5 par voyage
    let maxCarried = 0;
    for (let i = 0; i < 60 * 80 && c.items.iron !== 10; i++) {
      g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
      maxCarried = Math.max(maxCarried, cargoWeight(w.cargo));
    }
    expect(c.items.iron).toBe(10);
    expect(maxCarried).toBeLessThanOrEqual(WORKERS.capacity + 1e-6);
    expect(maxCarried).toBeGreaterThanOrEqual(12);
  });

  it('laisse la pierre (elle s’effrite) et ce que le joueur a jeté', () => {
    const g = new GameState(4);
    const c = chest(g);
    g.workers.add('picker', g);
    drop(g, 'stone', 4, 56, 10);
    // Le joueur vient de jeter de l'or et reste dessus : le tas est « verrouillé » tant qu'il ne s'éloigne pas.
    const thrown = drop(g, 'gold', 1, 54, 10);
    thrown.locked = true;
    g.player.x = (54 + 0.5) * TILE;
    g.player.y = (10 + 0.5) * TILE;
    run(g, 20);
    expect(Object.keys(c.items)).toHaveLength(0);
    expect(g.drops.list.some((d) => d.res === 'gold')).toBe(true);
    // Une fois le joueur parti, le tas est à tout le monde : le ramasseur le range.
    g.player.x = (30 + 0.5) * TILE;
    run(g, 20);
    expect(c.items.gold).toBe(1);
  });

  it('deux ramasseurs ne visent pas le même tas', () => {
    const g = new GameState(4);
    const c = chest(g);
    const [a, b] = [g.workers.add('picker', g), g.workers.add('picker', g)];
    drop(g, 'copper', 1, 58, 10);
    drop(g, 'copper', 1, 40, 10);
    let both = false;
    for (let i = 0; i < 60 * 30; i++) {
      g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
      if (a.task?.kind === 'pick' && b.task?.kind === 'pick' && (a.task as { drop: number }).drop === (b.task as { drop: number }).drop) throw new Error('même tas visé');
      if (a.task?.kind === 'pick' && b.task?.kind === 'pick') both = true;
    }
    expect(both).toBe(true);
    expect(c.items.copper).toBe(2);
  });

  it('un tas trop loin à parcourir est laissé', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    // Une galerie en serpentin sous le puits : le tas, au bout, est à plus de `reach` cases à parcourir.
    const y1 = S + 25;
    const y2 = S + 27;
    for (let y = S + 12; y <= y1; y++) g.world.set(49, y, AIR);
    for (let x = 49; x <= 90; x++) g.world.set(x, y1, AIR);
    for (let y = y1; y <= y2; y++) g.world.set(90, y, AIR);
    for (let x = 10; x <= 90; x++) g.world.set(x, y2, AIR);
    drop(g, 'copper', 1, 10, y2);
    run(g, 30);
    expect(c.items.copper ?? 0).toBe(0);
    expect(w.cargo).toEqual({});
    expect(g.drops.list).toHaveLength(1);
    // Le même tas, plus près, est ramassé.
    drop(g, 'copper', 1, 70, y1);
    run(g, 60);
    expect(c.items.copper).toBe(1);
  });

  it('sans coffre qui accepte ce minerai, il le laisse au sol et le signale ; puis le ramasse quand un coffre apparaît', () => {
    const g = new GameState(4);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 2, 56, 10);
    run(g, 10);
    expect(g.drops.list).toHaveLength(1); // il ne prend rien dont il ne saurait que faire
    expect(w.cargo).toEqual({});
    expect(w.flag).toBe('nostore');
    expect(w.task).toBeNull();
    const c = chest(g);
    run(g, 15);
    expect(c.items.copper).toBe(2);
    expect(w.flag).toBeNull();
  });

  it('une charge que plus aucun coffre n’accepte est gardée, signalée, puis livrée quand un coffre l’accepte', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 2, 56, 10);
    // Le tas est ramassé, puis le joueur règle le coffre sur autre chose pendant le trajet.
    for (let i = 0; i < 60 * 8 && !w.cargo.copper; i++) g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
    expect(w.cargo.copper).toBe(2);
    c.setAllow(['iron']);
    run(g, 15);
    expect(w.cargo.copper).toBe(2);
    expect(w.flag).toBe('nostore');
    c.setAllow([]);
    run(g, 15);
    expect(c.items.copper).toBe(2);
    expect(w.cargo).toEqual({});
  });

  it('un coffre plein : il en cherche un autre ; la caisse d’expédition n’est jamais visée', () => {
    const g = new GameState(4);
    const full = chest(g, 46, 10);
    full.put('stone', 100); // plein de pierre
    expect(full.canAccept('copper')).toBe(false);
    const crate = g.structures.add(new ShippingCrate(60, 10, 1)) as ShippingCrate;
    crate.timer = 1000;
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 2, 54, 10);
    run(g, 15);
    expect(g.drops.list).toHaveLength(1); // aucun coffre n'a de place : le tas reste au sol
    expect(crate.items).toEqual({});
    expect(w.flag).toBe('nostore');
    const other = chest(g, 44, 10);
    run(g, 20);
    expect(other.items.copper).toBe(2);
    expect(crate.items).toEqual({});
  });

  it('évite le grisou : ne traverse pas un nuage, et ne va pas dans un tas qui s’y trouve', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    // Un nuage sur toute la hauteur de la surface, à gauche du camp : le coffre est de l'autre côté.
    const cloud = () => {
      for (let y = 2; y < S; y++) g.world.gas[g.world.idx(52, y)] = GAS.harmful + 100;
      g.hazards.rebuild();
    };
    drop(g, 'copper', 1, 56, 10);
    for (let i = 0; i < 15; i++) {
      cloud(); // le nuage ne se dissipe pas pendant le test
      run(g, 1);
    }
    expect(c.items.copper ?? 0).toBe(0);
    expect(g.drops.list).toHaveLength(1);
    expect(w.cargo).toEqual({});
    // Le nuage parti, le tas est ramassé.
    g.world.gas.fill(0);
    g.hazards.rebuild();
    run(g, 20);
    expect(c.items.copper).toBe(1);
  });

  it('un passage qui se ferme en route : il contourne ou reprend sa recherche', () => {
    const g = new GameState(4);
    const c = chest(g);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 1, 58, 10);
    run(g, 3);
    expect(w.task?.kind).toBe('pick');
    // Un éboulement bouche la rangée devant lui : les rangées voisines restent libres.
    const t = tile(w);
    g.world.set(t.x + 2, t.y, HOST_ROCK_IDS[0]);
    run(g, 30);
    expect(c.items.copper).toBe(1);
  });

  it('revient à son poste quand il n’y a plus rien à faire', () => {
    const g = new GameState(4);
    chest(g);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 1, 60, 10);
    run(g, 30);
    const home = g.workers.homeTile(g, 0);
    expect(tile(w)).toEqual({ x: home % g.world.w, y: Math.floor(home / g.world.w) });
    expect(w.moving).toBe(false);
  });
});

describe('filtre de coffre : ce que les ouvriers y rangent', () => {
  it('chaque minerai va dans le coffre qui l’accepte, même s’il est plus loin', () => {
    const g = new GameState(4);
    const near = chest(g, 52, 10);
    near.setAllow(['iron']);
    const far = chest(g, 40, 10);
    far.setAllow(['copper']);
    g.workers.add('picker', g);
    drop(g, 'copper', 2, 56, 10);
    drop(g, 'iron', 2, 58, 10);
    run(g, 40);
    expect(far.items).toEqual({ copper: 2 });
    expect(near.items).toEqual({ iron: 2 });
    expect(g.drops.list).toHaveLength(0);
  });

  it('un coffre réglé sur un minerai passe avant un coffre libre plus proche', () => {
    const g = new GameState(4);
    const free = chest(g, 56, 10); // juste à côté des tas, accepte tout
    const coal = chest(g, 40, 10); // loin, réglé sur le charbon
    coal.setAllow(['coal']);
    g.workers.add('picker', g);
    drop(g, 'coal', 2, 58, 10);
    drop(g, 'copper', 2, 60, 10);
    run(g, 50);
    expect(coal.items).toEqual({ coal: 2 });
    expect(free.items).toEqual({ copper: 2 }); // le cuivre, lui, n'a pas de coffre réglé : le coffre libre le prend
  });

  it('un tas qu’aucun coffre n’accepte reste au sol, les autres sont ramassés', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.setAllow(['copper']);
    const w = g.workers.add('picker', g);
    drop(g, 'copper', 1, 56, 10);
    drop(g, 'gold', 1, 58, 10);
    run(g, 30);
    expect(c.items).toEqual({ copper: 1 });
    expect(g.drops.list.map((d) => d.res)).toEqual(['gold']);
    expect(w.cargo).toEqual({});
    expect(w.flag).toBe('nostore'); // l'or traîne : on le signale
  });

  it('un coffre sans filtre prend tout ; plusieurs coffres filtrés et un coffre libre : le libre prend le reste', () => {
    const g = new GameState(4);
    const iron = chest(g, 48, 10);
    iron.setAllow(['iron']);
    const rest = chest(g, 42, 10);
    g.workers.add('picker', g);
    drop(g, 'iron', 1, 56, 10);
    drop(g, 'gold', 1, 58, 10);
    run(g, 40);
    expect(iron.items).toEqual({ iron: 1 });
    expect(rest.items).toEqual({ gold: 1 });
  });
});

describe('filtre de coffre : le coffre lui-même', () => {
  it('sans filtre il accepte tout ; avec un filtre, seulement ces minerais', () => {
    const c = new Storage(1, 1, 1);
    expect(c.allow).toEqual([]);
    expect(c.accepts('gold')).toBe(true);
    c.setAllow(['gold', 'copper', 'gold', 'inconnu']);
    expect(c.allow).toEqual(['copper', 'gold']); // sans doublon ni inconnu, dans l'ordre des ressources
    expect(c.accepts('copper')).toBe(true);
    expect(c.accepts('iron')).toBe(false);
    expect(c.room('iron')).toBe(0);
    expect(c.canAccept('iron')).toBe(false);
    expect(c.room('copper')).toBeGreaterThan(0);
  });

  it('le dépôt manuel, les convoyeurs et les ouvriers passent tous par le filtre', () => {
    const g = new GameState(4);
    const c = new Storage(1, 1, 1);
    c.setAllow(['copper']);
    expect(c.put('iron', 5)).toBe(0);
    expect(c.put('copper', 3)).toBe(3);
    expect(c.accept('iron', 0, g)).toBe(false);
    expect(c.accept('copper', 0, g)).toBe(true);
    expect(c.items).toEqual({ copper: 4 });
  });

  it('ce qui est déjà dedans y reste, et peut toujours en sortir', () => {
    const c = new Storage(1, 1, 1);
    c.put('iron', 4);
    c.setAllow(['copper']);
    expect(c.items.iron).toBe(4);
    expect(c.take('iron', 3)).toBe(3);
    expect(c.items.iron).toBe(1);
  });

  it('choisir un minerai depuis « tout » ne garde que lui ; en retirer le dernier remet « tout »', () => {
    const c = new Storage(1, 1, 1);
    expect(c.toggleAllow('copper')).toBe(true);
    expect(c.allow).toEqual(['copper']);
    c.toggleAllow('coal');
    expect(c.allow).toEqual(['coal', 'copper']);
    c.toggleAllow('coal');
    c.toggleAllow('copper');
    expect(c.allow).toEqual([]);
    expect(c.accepts('gold')).toBe(true);
    expect(c.toggleAllow('inconnu')).toBe(false);
  });

  it('le dépôt du sac : seul ce que le coffre accepte part, le reste garde sa place dans le sac', () => {
    const g = new GameState(4);
    const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
    c.setAllow(['copper']);
    g.inventory.add('copper', 2);
    g.inventory.add('coal', 2);
    g.storageDepositAll(c);
    expect(c.items).toEqual({ copper: 2 });
    expect(g.inventory.count('coal')).toBe(2);
    expect(g.inventory.count('copper')).toBe(0);
  });

  it('le réglage est sauvegardé ; une ancienne sauvegarde de coffre accepte tout ; les valeurs absurdes sont ignorées', () => {
    const g = new GameState(4);
    const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
    c.setAllow(['gold', 'iron']);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect((back.structures.at(46, 10) as Storage).allow).toEqual(['iron', 'gold']);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    const saved = data.structures.find((s: { type: string }) => s.type === 'storage');
    delete saved.allow;
    expect((deserialize(data).structures.at(46, 10) as Storage).allow).toEqual([]);
    saved.allow = [3, null, 'inconnu', 'copper', 'copper'];
    expect((deserialize(data).structures.at(46, 10) as Storage).allow).toEqual(['copper']);
    saved.allow = 'pas une liste';
    expect((deserialize(data).structures.at(46, 10) as Storage).allow).toEqual([]);
  });
});

describe('ravitailleur', () => {
  function plant(g: GameState, tx: number, fuel = 0): Drill {
    const d = g.structures.add(new Drill(tx, 9, 1)) as Drill;
    d.fuelUnits = fuel;
    return d;
  }

  it('prend du charbon dans un coffre et recharge une foreuse', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.put('coal', 20);
    const d = plant(g, 56);
    g.workers.add('refueler', g);
    run(g, 20);
    expect(d.fuelUnits).toBe(d.fuelMax);
    expect(c.items.coal ?? 0).toBe(20 - d.fuelMax);
  });

  it('ne recharge pas une machine qui a plus de la moitié de son réservoir', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.put('coal', 8);
    const d = plant(g, 56, Math.ceil(new Drill(0, 0, 1).fuelMax * 0.6));
    const before = d.fuelUnits;
    g.workers.add('refueler', g);
    run(g, 20);
    expect(d.fuelUnits).toBe(before);
    expect(c.items.coal).toBe(8);
  });

  it('deux machines, un seul coffre : elles sont toutes deux servies, sans doublon', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.put('coal', 30);
    const a = plant(g, 56);
    const b = plant(g, 60);
    g.workers.add('refueler', g);
    g.workers.add('refueler', g);
    run(g, 40);
    expect(a.fuelUnits).toBe(a.fuelMax);
    expect(b.fuelUnits).toBe(b.fuelMax);
    expect(c.items.coal).toBe(30 - a.fuelMax - b.fuelMax);
  });

  it('sans charbon dans les coffres : il le signale, puis repart dès qu’il y en a', () => {
    const g = new GameState(4);
    const c = chest(g);
    const d = plant(g, 56);
    const w = g.workers.add('refueler', g);
    run(g, 10);
    expect(w.flag).toBe('nocoal');
    expect(d.fuelUnits).toBe(0);
    c.put('coal', d.fuelMax - 1);
    run(g, 20);
    expect(d.fuelUnits).toBe(d.fuelMax - 1);
    expect(w.flag).toBeNull();
  });

  it('ne prend que ce qu’il faut : le reste du charbon reste dans le coffre', () => {
    const g = new GameState(4);
    const c = chest(g);
    c.put('coal', 100);
    const d = plant(g, 56, 0);
    const w = g.workers.add('refueler', g);
    run(g, 20);
    expect(c.items.coal).toBe(100 - d.fuelMax);
    expect(w.cargo.coal ?? 0).toBe(0);
  });

  it('au repos quand tout est plein', () => {
    const g = new GameState(4);
    const w = g.workers.add('refueler', g);
    run(g, 5);
    expect(w.task).toBeNull();
    expect(w.flag).toBeNull();
  });
});

describe('ouvriers : sauvegarde', () => {
  it('métier, position et charge se retrouvent ; la tâche se recalcule', () => {
    const g = new GameState(4);
    chest(g);
    const a = g.workers.add('picker', g);
    const b = g.workers.add('refueler', g);
    a.cargo = { copper: 3 };
    a.x += 20;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(back.workers.count).toBe(2);
    const [a2, b2] = back.workers.list;
    expect([a2.id, a2.job, a2.x, a2.y, a2.cargo]).toEqual([a.id, 'picker', a.x, a.y, { copper: 3 }]);
    expect([b2.id, b2.job]).toEqual([b.id, 'refueler']);
    expect(a2.task).toBeNull();
  });

  it('une ancienne sauvegarde se charge sans ouvrier', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete data.workers;
    expect(deserialize(data).workers.count).toBe(0);
  });

  it('ignore les valeurs absurdes et plafonne l’équipe', () => {
    const data = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    const ok = { id: 1, job: 'picker', x: 800, y: 160, cargo: { copper: 2 } };
    data.workers = [
      ok,
      { id: 1, job: 'refueler', x: 'oups', y: NaN, cargo: { inconnu: 5, coal: -3, iron: 99 } },
      { id: 'a', job: 'danseur', x: 0, y: 0, cargo: {} },
      null,
      ...Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, job: 'picker', x: 800, y: 160, cargo: {} })),
    ];
    const g = deserialize(data);
    expect(g.workers.count).toBeLessThanOrEqual(WORKERS.max);
    expect(g.workers.list.every((w) => Number.isFinite(w.x) && Number.isFinite(w.y))).toBe(true);
    expect(g.workers.list[0].cargo).toEqual({ copper: 2 });
    expect(g.workers.list[1].cargo).toEqual({}); // inconnu, négatif, trop lourd : rien
    expect(new Set(g.workers.list.map((w) => w.id)).size).toBe(g.workers.count);
    expect(() => run(g, 5)).not.toThrow();
  });
});
