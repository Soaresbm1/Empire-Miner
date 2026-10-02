import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, TILE } from '../src/core/constants';
import { AIR, HOST_ROCK_IDS } from '../src/data/blocks';
import { resourceIndex } from '../src/data/resources';
import { DRILLER, DRILLER_LEVELS, WORKERS, drillerLevel } from '../src/data/workers';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Drill } from '../src/sim/structures/Drill';
import { Storage } from '../src/sim/structures/Storage';
import { heldOre } from '../src/sim/Workers';
import { goTo, run } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ : x de 46 à 53, y de S + 13 à S + 15 (sol dégagé, déjà explorée).
const X = 50;
const Y = S + 14;

/** Un gisement exposé de `res` sur la case (x, y), de `amount` unités. */
function deposit(g: GameState, res: string, x = X, y = Y, amount = 60): void {
  g.world.set(x, y, AIR);
  g.world.setDeposit(x, y, resourceIndex(res), amount);
  g.world.explored[g.world.idx(x, y)] = 1;
}

function camp(): GameState {
  const g = new GameState(4);
  g.pickaxeLevel = 1;
  g.money = 5000;
  return g;
}

const drills = (g: GameState) => g.structures.list.filter((s): s is Drill => s instanceof Drill);

describe('foreur : niveaux et achat', () => {
  it('quatre niveaux : de plus en plus de minerais, plus vite, et de plus en plus cher', () => {
    expect(DRILLER_LEVELS).toHaveLength(4);
    for (let i = 1; i < DRILLER_LEVELS.length; i++) {
      expect(DRILLER_LEVELS[i].price).toBeGreaterThan(DRILLER_LEVELS[i - 1].price);
      expect(DRILLER_LEVELS[i].maxTier).toBeGreaterThan(DRILLER_LEVELS[i - 1].maxTier);
      expect(DRILLER_LEVELS[i].placeTime).toBeLessThan(DRILLER_LEVELS[i - 1].placeTime);
      expect(DRILLER_LEVELS[i].speed).toBeGreaterThan(DRILLER_LEVELS[i - 1].speed);
    }
    expect(DRILLER_LEVELS[0].price).toBe(0);
    expect(drillerLevel(0).level).toBe(1);
    expect(drillerLevel(99).level).toBe(4);
  });

  it('on l’embauche comme les autres métiers, au niveau 1', () => {
    const g = camp();
    goTo(g, 'workshop');
    expect(g.hireWorker('driller')).toBe(true);
    expect(g.workers.list[0].job).toBe('driller');
    expect(g.workers.list[0].level).toBe(1);
    expect(g.events.some((e) => e.t === 'bought' && /foreur/.test(e.name))).toBe(true);
  });

  it('amélioration à l’Atelier : prix croissants, pioche exigée aux niveaux 3 et 4, argent, maximum', () => {
    const g = camp();
    goTo(g, 'workshop');
    const w = g.workers.add('driller', g);
    g.money = 100;
    expect(g.workerUpgradeBlocker(w.id)).toBe("Pas assez d'argent");
    expect(g.upgradeWorker(w.id)).toBe(false);
    g.money = 10_000;
    g.pickaxeLevel = 1; // pioche améliorée : niveau 2 possible, pas le 3
    expect(g.upgradeWorker(w.id)).toBe(true);
    expect(w.level).toBe(2);
    expect(g.money).toBe(10_000 - DRILLER_LEVELS[1].price);
    expect(g.workerUpgradeBlocker(w.id)).toBe('Nécessite la Pioche en fer');
    g.pickaxeLevel = 2;
    expect(g.upgradeWorker(w.id)).toBe(true);
    expect(g.workerUpgradeBlocker(w.id)).toBe('Nécessite la Pioche pro en acier');
    g.pickaxeLevel = 3;
    expect(g.upgradeWorker(w.id)).toBe(true);
    expect(w.level).toBe(4);
    expect(g.workerUpgradeBlocker(w.id)).toBe('Niveau maximal atteint');
    expect(g.money).toBe(10_000 - DRILLER_LEVELS.slice(1).reduce((n, l) => n + l.price, 0));
  });

  it('seul le foreur s’améliore, et seulement à l’Atelier', () => {
    const g = camp();
    goTo(g, 'workshop');
    const p = g.workers.add('picker', g);
    const d = g.workers.add('driller', g);
    expect(g.workerUpgradeBlocker(p.id)).toBe('Seul le foreur s’améliore');
    g.player.x = 5 * TILE;
    expect(g.workerUpgradeBlocker(d.id)).toBe('Il faut être à l’Atelier');
    expect(g.upgradeWorker(d.id)).toBe(false);
    expect(g.workerUpgradeBlocker(999)).toBe('Ouvrier introuvable');
  });

  it('le foreur va plus vite à mesure qu’il monte en niveau', () => {
    const at = (level: number) => {
      const g = camp();
      const w = g.workers.add('driller', g);
      w.level = level;
      deposit(g, 'copper', 52, Y);
      g.inventory.addKit('drill', 1);
      w.x = 46.5 * TILE;
      w.y = (Y + 0.5) * TILE;
      let t = 0;
      while (drills(g).length === 0 && t < 60) {
        run(g, 0.1);
        t += 0.1;
      }
      return t;
    };
    expect(at(4)).toBeLessThan(at(1));
  });
});

describe('foreur : il pose des foreuses sur les gisements', () => {
  it('pose une foreuse du stock sur un gisement de petit minerai, et la consomme', () => {
    const g = camp();
    const w = g.workers.add('driller', g);
    deposit(g, 'copper');
    g.inventory.addKit('drill', 1);
    run(g, 30);
    expect(drills(g)).toHaveLength(1);
    expect(drills(g)[0].x).toBe(X);
    expect(drills(g)[0].y).toBe(Y);
    expect(g.inventory.kitCount('drill')).toBe(0);
    expect(g.money).toBe(5000); // un kit du stock : aucun achat
    expect(w.flag).toBeNull();
  });

  it('le niveau décide des minerais : cuivre au niveau 1, fer au 2, or au 3, diamant au 4 — jamais la pierre', () => {
    const tryLevel = (level: number, res: string) => {
      const g = camp();
      const w = g.workers.add('driller', g);
      w.level = level;
      deposit(g, res);
      g.inventory.addKit('drill', 1);
      run(g, 30);
      return drills(g).length === 1;
    };
    expect(tryLevel(1, 'copper')).toBe(true);
    expect(tryLevel(1, 'coal')).toBe(true);
    expect(tryLevel(1, 'iron')).toBe(false);
    expect(tryLevel(2, 'iron')).toBe(true);
    expect(tryLevel(2, 'gold')).toBe(false);
    expect(tryLevel(3, 'gold')).toBe(true);
    expect(tryLevel(3, 'silver')).toBe(true);
    expect(tryLevel(3, 'diamond')).toBe(false);
    expect(tryLevel(4, 'diamond')).toBe(true);
    for (const level of [1, 2, 3, 4]) expect(tryLevel(level, 'stone')).toBe(false);
  });

  it('sans kit en stock, il achète lui-même la foreuse au prix de l’Atelier', () => {
    const g = camp();
    g.workers.add('driller', g);
    deposit(g, 'copper');
    run(g, 30);
    expect(drills(g)).toHaveLength(1);
    expect(g.money).toBe(5000 - 220);
    expect(g.stats.spent).toBeGreaterThanOrEqual(220);
  });

  it('il ne vide pas votre argent : il garde une réserve, et signale qu’il lui manque une foreuse', () => {
    const g = camp();
    const w = g.workers.add('driller', g);
    deposit(g, 'copper');
    g.money = 220 + DRILLER.moneyReserve - 1;
    run(g, 30);
    expect(drills(g)).toHaveLength(0);
    expect(g.money).toBe(220 + DRILLER.moneyReserve - 1);
    expect(w.flag).toBe('nodrill');
    // De l'argent revient : il achète et pose.
    g.money = 220 + DRILLER.moneyReserve;
    run(g, 30);
    expect(drills(g)).toHaveLength(1);
    expect(g.money).toBe(DRILLER.moneyReserve);
    expect(w.flag).toBeNull();
  });

  it('un kit en stock passe avant l’achat (et un kit rendu plus tard est utilisé)', () => {
    const g = camp();
    g.workers.add('driller', g);
    deposit(g, 'copper', 48, Y);
    deposit(g, 'copper', 52, Y);
    g.inventory.addKit('drill', 1);
    run(g, 60);
    expect(drills(g)).toHaveLength(2);
    expect(g.money).toBe(5000 - 220); // un seul achat : le premier venait du stock
  });

  it('rien à équiper : pas de blocage, pas d’achat', () => {
    const g = camp();
    const w = g.workers.add('driller', g);
    run(g, 20);
    expect(drills(g)).toHaveLength(0);
    expect(w.flag).toBeNull();
    expect(g.money).toBe(5000);
  });

  it('un gisement déjà couvert par une foreuse, un gisement presque épuisé, un gisement non découvert : ignorés', () => {
    const g = camp();
    g.workers.add('driller', g);
    g.inventory.addKit('drill', 3);
    deposit(g, 'copper', 48, Y);
    const existing = g.structures.add(new Drill(48, Y, 1)) as Drill; // couvre déjà son gisement
    expect(existing).toBeTruthy();
    deposit(g, 'copper', 52, Y, DRILLER.minReserve - 1); // presque épuisé
    deposit(g, 'copper', 50, Y + 1); // pas encore découvert
    g.world.explored[g.world.idx(50, Y + 1)] = 0;
    run(g, 40);
    expect(drills(g)).toHaveLength(1);
    expect(g.inventory.kitCount('drill')).toBe(3);
  });

  it('deux foreurs ne visent pas le même gisement', () => {
    const g = camp();
    g.workers.add('driller', g);
    g.workers.add('driller', g);
    deposit(g, 'copper', 48, Y);
    deposit(g, 'copper', 52, Y);
    g.inventory.addKit('drill', 2);
    run(g, 60);
    const spots = drills(g).map((d) => `${d.x},${d.y}`).sort();
    expect(spots).toEqual([`48,${Y}`, `52,${Y}`]);
    expect(g.inventory.kitCount('drill')).toBe(0);
  });

  it('il ne bouche jamais un passage : une foreuse au milieu d’un couloir d’une case est refusée, au bout d’un cul-de-sac elle est posée', () => {
    const g = camp();
    g.workers.add('driller', g);
    g.inventory.addKit('drill', 1);
    // Un couloir d'une case de large, à l'est de la salle de départ.
    for (let x = 54; x <= 64; x++) {
      g.world.set(x, Y, AIR);
      for (const y of [Y - 1, Y + 1]) g.world.set(x, y, HOST_ROCK_IDS[0]);
    }
    for (let x = 54; x <= 64; x++) g.world.explored[g.world.idx(x, Y)] = 1;
    deposit(g, 'copper', 58, Y); // au milieu : bouche le couloir
    run(g, 40);
    expect(drills(g)).toHaveLength(0);
    // Au bout (cul-de-sac), le même gisement ne gêne personne.
    g.world.setDeposit(58, Y, 0, 0);
    deposit(g, 'copper', 64, Y);
    run(g, 40);
    expect(drills(g)).toHaveLength(1);
    expect(drills(g)[0].x).toBe(64);
  });

  it('la foreuse posée a du charbon apporté par un ravitailleur, puis son minerai est rangé par un ramasseur', () => {
    const g = camp();
    const chest = g.structures.add(new Storage(46, S + 14, 1)) as Storage;
    chest.put('coal', 20);
    g.workers.add('driller', g);
    g.workers.add('refueler', g);
    g.workers.add('picker', g);
    deposit(g, 'copper', 52, Y, 200);
    g.inventory.addKit('drill', 1);
    run(g, 240);
    const d = drills(g)[0];
    expect(d).toBeTruthy();
    expect(d.extracted).toBeGreaterThan(3);
    expect(chest.items.copper ?? 0).toBeGreaterThan(0);
  });
});

describe('ramasseur : il prend aussi le minerai gardé par les machines', () => {
  function withChest(): { g: GameState; chest: Storage } {
    const g = camp();
    const chest = g.structures.add(new Storage(46, S + 14, 1)) as Storage;
    return { g, chest };
  }

  it('vide la sortie d’une foreuse à charbon qui en garde assez, dans le coffre le plus proche', () => {
    const { g, chest } = withChest();
    const d = g.structures.add(new Drill(52, Y, 1)) as Drill;
    d.buffer = ['copper', 'copper', 'copper', 'iron'];
    g.workers.add('picker', g);
    run(g, 40);
    expect(d.buffer).toEqual([]);
    expect(chest.items.copper).toBe(3);
    expect(chest.items.iron).toBe(1);
  });

  it('laisse une foreuse qui n’en garde que peu (elle se vide seule sur son convoyeur)', () => {
    const { g, chest } = withChest();
    const d = g.structures.add(new Drill(52, Y, 1)) as Drill;
    d.buffer = ['copper', 'copper'];
    g.workers.add('picker', g);
    run(g, 40);
    expect(d.buffer).toHaveLength(WORKERS.machinePickup.drill - 1);
    expect(chest.items.copper ?? 0).toBe(0);
    expect(heldOre(d)).toEqual({});
  });

  it('vide le stock de la base d’une foreuse de percement', () => {
    const { g, chest } = withChest();
    g.inventory.addKit('borer', 1);
    goTo(g, 'workshop');
    g.player.x = 47 * TILE;
    g.player.y = (S + 13.5) * TILE;
    const b = g.place('borer', 52, Y, 0) as unknown as { store: Record<string, number>; storeCount(): number };
    expect(b).toBeTruthy();
    b.store = { gold: 10 };
    g.player.x = 47 * TILE;
    g.workers.add('picker', g);
    run(g, 90);
    // 15 kg par voyage = 4 lingots d'or (3,5 kg) ; sous le seuil (5), le reste ne vaut pas le déplacement
    expect(chest.items.gold).toBe(8);
    expect(b.storeCount()).toBe(2);
  });

  it('respecte les réglages des coffres : un minerai qu’aucun coffre n’accepte reste dans la machine, et c’est signalé', () => {
    const { g, chest } = withChest();
    chest.setAllow(['iron']);
    const d = g.structures.add(new Drill(52, Y, 1)) as Drill;
    d.buffer = ['copper', 'copper', 'copper'];
    const w = g.workers.add('picker', g);
    run(g, 30);
    expect(d.buffer).toHaveLength(3);
    expect(w.flag).toBe('nostore');
    chest.setAllow([]);
    run(g, 40);
    expect(chest.items.copper).toBe(3);
  });

  it('deux ramasseurs ne vident pas la même machine, et la pierre reste', () => {
    const { g, chest } = withChest();
    const d = g.structures.add(new Drill(52, Y, 1)) as Drill;
    d.buffer = ['stone', 'stone', 'stone', 'copper', 'copper', 'copper'];
    g.workers.add('picker', g);
    g.workers.add('picker', g);
    run(g, 40);
    expect(chest.items.copper).toBe(3);
    expect(chest.items.stone ?? 0).toBe(0);
    expect(d.buffer).toEqual(['stone', 'stone', 'stone']);
  });
});

describe('foreur : sauvegarde', () => {
  it('métier et niveau se retrouvent', () => {
    const g = camp();
    const w = g.workers.add('driller', g);
    w.level = 3;
    const again = deserialize(serialize(g)).workers.list[0];
    expect(again.job).toBe('driller');
    expect(again.level).toBe(3);
  });

  it('une ancienne sauvegarde (sans niveau) donne le niveau 1 ; un niveau absurde est borné', () => {
    const g = camp();
    g.workers.add('driller', g);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.workers[0].level;
    expect(deserialize(data).workers.list[0].level).toBe(1);
    data.workers[0].level = 99;
    expect(deserialize(data).workers.list[0].level).toBe(4);
    data.workers[0].level = -3;
    expect(deserialize(data).workers.list[0].level).toBe(1);
    data.workers[0].level = 'abc';
    expect(deserialize(data).workers.list[0].level).toBe(1);
  });
});
