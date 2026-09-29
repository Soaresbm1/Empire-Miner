import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { getMachine } from '../src/data/machines';
import { resourceIndex } from '../src/data/resources';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { Drill, reachTiles } from '../src/sim/structures/Drill';
import type { Storage } from '../src/sim/structures/Storage';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
// Salle du fond de la mine de départ : x de 46 à 53, y de S+13 à S+15.
const X = 50;
const Y = S + 14;
const LEVELS = getMachine('drill').levels!;

function put(g: GameState, id: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(id, 1);
  teleport(g, 47, S + 13);
  const s = g.place(id, x, y, dir);
  if (!s) throw new Error(`${id} @${x},${y} : ${g.canPlace(id, x, y).reason}`);
  return s;
}

const reserveAt = (g: GameState, x: number, y: number) => g.world.reserve[g.world.idx(x, y)];

/**
 * Foreuse en (X, Y), flèche vers l'est, coffre devant. Gisements de cuivre sous
 * elle et sur les quatre cases voisines (nord = gauche, sud = droite, ouest = derrière).
 */
function setup(g: GameState, reserve = 1000) {
  for (const [x, y] of [[X, Y], [X, Y - 1], [X, Y + 1], [X - 1, Y]]) g.world.setDeposit(x, y, resourceIndex('copper'), reserve);
  const d = put(g, 'drill', X, Y, 0) as Drill;
  const out = put(g, 'storage', X + 1, Y) as Storage;
  d.addFuel(10);
  return { d, out };
}

/** Améliore directement une foreuse jusqu'au niveau voulu (argent et pioche fournis). */
function upgradeTo(g: GameState, d: Drill, level: number) {
  g.pickaxeLevel = 2; // pioche en fer : débloque le niveau 3
  while (d.level < level) {
    g.money += d.nextLevel()!.price;
    expect(g.upgradeMachine(d)).toBe(true);
  }
}

describe('cases couvertes par niveau', () => {
  it('niveau 1 : la case sous la foreuse ; 2 : + gauche et droite ; 3 : + derrière', () => {
    const at = (dir: Dir, level: number) => reachTiles(10, 10, dir, LEVELS[level - 1].reach!).map((t) => `${t.side}:${t.x},${t.y}`);
    expect(at(0, 1)).toEqual(['under:10,10']);
    // Flèche vers l'est : la gauche est au nord, la droite au sud, l'arrière à l'ouest.
    expect(at(0, 2)).toEqual(['under:10,10', 'left:10,9', 'right:10,11']);
    expect(at(0, 3)).toEqual(['under:10,10', 'left:10,9', 'right:10,11', 'back:9,10']);
    // Flèche vers le nord : la gauche est à l'ouest, la droite à l'est, l'arrière au sud.
    expect(at(3, 3)).toEqual(['under:10,10', 'left:9,10', 'right:11,10', 'back:10,11']);
    // La case de sortie (devant) n'est jamais forée.
    for (const dir of [0, 1, 2, 3] as Dir[]) expect(at(dir, 3).length).toBe(4);
  });

  it('les cases suivent la foreuse quand on la tourne', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 3);
    g.rotateAt(X, Y); // flèche vers le sud
    expect(d.reach().map((t) => [t.x, t.y])).toEqual([[X, Y], [X + 1, Y], [X - 1, Y], [X, Y - 1]]);
  });
});

describe('extraction', () => {
  it('au niveau 1, seule la case sous la foreuse est forée', () => {
    const g = new GameState(4);
    const { d, out } = setup(g);
    run(g, 20);
    expect(d.extracted).toBeGreaterThanOrEqual(7);
    expect(d.extracted).toBeLessThanOrEqual(9);
    expect(reserveAt(g, X, Y)).toBe(1000 - d.extracted);
    expect(reserveAt(g, X, Y - 1)).toBe(1000);
    expect(reserveAt(g, X, Y + 1)).toBe(1000);
    expect(out.items.copper).toBe(d.extracted);
  });

  it('au niveau 2, elle fore aussi à gauche et à droite : trois fois plus de minerai', () => {
    const g = new GameState(4);
    const { d, out } = setup(g);
    upgradeTo(g, d, 2);
    run(g, 40);
    const base = getMachine('drill').stats.speed * 40;
    expect(d.heads).toBe(3);
    expect(d.extracted).toBeGreaterThanOrEqual(3 * base - 2);
    expect(d.extracted).toBeLessThanOrEqual(3 * base + 1);
    expect(out.items.copper).toBe(d.extracted);
    // Les trois têtes se partagent le travail à parts égales ; l'arrière n'est pas touché.
    const taken = [[X, Y], [X, Y - 1], [X, Y + 1]].map(([x, y]) => 1000 - reserveAt(g, x, y));
    expect(Math.max(...taken) - Math.min(...taken)).toBeLessThanOrEqual(1);
    expect(reserveAt(g, X - 1, Y)).toBe(1000);
  });

  it('au niveau 3, elle fore aussi derrière elle', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 3);
    run(g, 30);
    expect(d.heads).toBe(4);
    expect(d.extracted).toBeGreaterThanOrEqual(4 * 0.4 * 30 - 2);
    expect(1000 - reserveAt(g, X - 1, Y)).toBeGreaterThan(8);
  });

  it('seules les cases qui ont un gisement comptent', () => {
    const g = new GameState(4);
    g.world.setDeposit(X, Y, resourceIndex('copper'), 1000);
    g.world.setDeposit(X, Y + 1, resourceIndex('iron'), 1000); // à droite seulement
    const d = put(g, 'drill', X, Y, 0) as Drill;
    const out = put(g, 'storage', X + 1, Y) as Storage;
    d.addFuel(10);
    upgradeTo(g, d, 3);
    run(g, 20);
    expect(d.heads).toBe(2);
    expect(out.items.copper).toBeGreaterThan(5);
    expect(out.items.iron).toBeGreaterThan(5);
  });

  it('continue sur les cases voisines quand le gisement sous elle est épuisé', () => {
    const g = new GameState(4);
    const { d } = setup(g, 3);
    g.world.setDeposit(X, Y - 1, resourceIndex('copper'), 1000);
    upgradeTo(g, d, 2);
    run(g, 40);
    expect(g.world.depositAt(X, Y)).toBe(null);
    expect(d.status).toBe('ok');
    expect(d.extracted).toBeGreaterThan(20);
  });

  it("s'arrête (épuisée) seulement quand toutes ses cases sont vides", () => {
    const g = new GameState(4);
    const { d } = setup(g, 2);
    upgradeTo(g, d, 2);
    run(g, 20);
    expect(d.extracted).toBe(6);
    expect(d.status).toBe('depleted');
  });

  it("ne fore pas sous une autre foreuse, qui garde sa case", () => {
    const g = new GameState(4);
    const { d } = setup(g);
    const other = put(g, 'drill', X, Y - 1, 3) as Drill; // posée sur la case de gauche
    upgradeTo(g, d, 2);
    expect(d.sources(g).map((t) => t.side)).toEqual(['under', 'right']);
    run(g, 10);
    expect(other.extracted).toBe(0); // sans charbon
    expect(reserveAt(g, X, Y - 1)).toBe(1000);
  });

  it('consomme autant de charbon quel que soit son niveau', () => {
    const burnt = (level: number) => {
      const g = new GameState(4);
      const { d } = setup(g);
      if (level > 1) upgradeTo(g, d, level);
      run(g, 30); // assez court pour que le coffre de sortie ne sature pas
      expect(d.status).toBe('ok');
      return d.fuelSeconds();
    };
    expect(burnt(3)).toBeCloseTo(burnt(1), 3);
  });
});

describe('achat des améliorations', () => {
  it("se paie sur la foreuse, niveau par niveau, et le niveau 3 exige la pioche en fer", () => {
    const g = new GameState(4);
    const { d } = setup(g);
    g.money = 0;
    expect(g.upgradeBlocker(d)).toBe("Pas assez d'argent");
    expect(g.upgradeMachine(d)).toBe(false);
    expect(d.level).toBe(1);

    g.money = 1000;
    expect(g.upgradeMachine(d)).toBe(true);
    expect(d.level).toBe(2);
    expect(g.money).toBe(1000 - LEVELS[1].price);

    // Pioche de départ : le niveau 3 est verrouillé, même avec l'argent.
    expect(g.upgradeBlocker(d)).toBe('Nécessite la Pioche en fer');
    expect(g.upgradeMachine(d)).toBe(false);
    g.pickaxeLevel = 2;
    expect(g.upgradeMachine(d)).toBe(true);
    expect(d.level).toBe(3);
    expect(g.money).toBe(1000 - LEVELS[1].price - LEVELS[2].price);

    expect(d.nextLevel()).toBe(null);
    expect(g.upgradeBlocker(d)).toBe('Niveau maximal atteint');
    expect(g.upgradeMachine(d)).toBe(false);
  });

  it('démontée puis reposée, une foreuse améliorée garde son niveau', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 3);
    const before = g.money;
    teleport(g, 47, S + 13);
    expect(g.removeAt(X, Y)).toBe(true);
    // Pas de remboursement : l'amélioration reste dans le kit.
    expect(g.money).toBe(before);
    expect(g.inventory.kitCount('drill')).toBe(0);
    expect(g.inventory.kitCount('drill@3')).toBe(1);
    expect(g.inventory.kitTotal('drill')).toBe(1);
    // Reposée ailleurs, dans une autre direction : toujours niveau 3.
    g.world.setDeposit(X + 2, Y, resourceIndex('copper'), 1000);
    teleport(g, 47, S + 13);
    const again = g.place('drill@3', X + 2, Y, 3) as Drill;
    expect(again).toBeInstanceOf(Drill);
    expect(again.level).toBe(3);
    expect(again.reach().length).toBe(4);
    expect(g.inventory.kitTotal('drill')).toBe(0);
  });

  it('les kits de base et améliorés restent séparés', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 2);
    teleport(g, 47, S + 13);
    g.removeAt(X, Y);
    const base = put(g, 'drill', X, Y, 0) as Drill; // une foreuse neuve achetée à l'atelier
    expect(base.level).toBe(1);
    expect(g.inventory.kitCount('drill@2')).toBe(1);
    // Un kit qu'on n'a pas ne se pose pas.
    expect(g.canPlace('drill@3', X, Y + 1).ok).toBe(false);
  });

  it('les kits améliorés sont sauvegardés', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 3);
    teleport(g, 47, S + 13);
    g.removeAt(X, Y);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.inventory.kitCount('drill@3')).toBe(1);
    teleport(h, 47, S + 13);
    expect((h.place('drill@3', X, Y, 0) as Drill).level).toBe(3);
  });

  it('le niveau est sauvegardé', () => {
    const g = new GameState(4);
    const { d } = setup(g);
    upgradeTo(g, d, 3);
    run(g, 5);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const hd = h.structures.at(X, Y) as Drill;
    expect(hd).toBeInstanceOf(Drill);
    expect(hd.level).toBe(3);
    expect(hd.sources(h).length).toBe(4);
  });
});
