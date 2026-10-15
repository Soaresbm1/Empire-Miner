import { describe, expect, it } from 'vitest';
import { SIM_DT, TILE } from '../src/core/constants';
import { REPAIR, REPAIR_CAUSES, REPAIR_TEXT, WORKER_JOBS } from '../src/data/workers';
import { deserialize, serialize } from '../src/save/save';
import { GameState, type PlayerIntent } from '../src/sim/GameState';
import { diagnose } from '../src/sim/Repair';
import { Conveyor } from '../src/sim/structures/Conveyor';
import { Drill } from '../src/sim/structures/Drill';
import { Smelter } from '../src/sim/structures/Smelter';
import { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import { Storage } from '../src/sim/structures/Storage';
import { repairNotes } from '../src/ui/crew';
import { run } from './helpers';

const IDLE: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Un coffre au camp et une foreuse à charbon sur un gisement (surface), sans charbon ni sortie : elle est à l'arrêt. */
function setup(coal = 0) {
  const g = new GameState(4);
  const c = g.structures.add(new Storage(46, 10, 1)) as Storage;
  g.world.setDeposit(56, 9, 1, 60);
  const d = g.structures.add(new Drill(56, 9, 1)) as Drill;
  if (coal) c.put('coal', coal);
  g.update(SIM_DT, [IDLE]);
  return { g, c, d };
}

const tile = (w: { x: number; y: number }) => ({ x: Math.floor(w.x / TILE), y: Math.floor((w.y - 1) / TILE) });

describe('dépanneur : diagnostic', () => {
  it('plus de charbon : réparable s’il y en a en coffre, sinon signalé', () => {
    const { g, d } = setup();
    expect(d.status).toBe('nofuel');
    expect(diagnose(g, d)).toEqual({ cause: 'nocoal', fixable: false });
    (g.structures.at(46, 10) as Storage).put('coal', 3);
    expect(diagnose(g, d)).toEqual({ cause: 'nofuel', fixable: true });
  });

  it('sortie pleine : réparable si un coffre accepte le produit ; sinon la cause dit pourquoi rien ne sort', () => {
    const { g, c, d } = setup();
    d.status = 'full';
    d.buffer = ['copper', 'copper', 'copper'];
    // Un coffre accepte : le dépanneur peut vider.
    expect(diagnose(g, d)).toEqual({ cause: 'outfull', fixable: true });
    // Il a déjà essayé plusieurs fois : la cause devient celle de la sortie (ici : rien n'est relié).
    expect(diagnose(g, d, true)).toEqual({ cause: 'noexit', fixable: false });
    c.allow = ['gold']; // plus aucun coffre ne veut du cuivre
    expect(diagnose(g, d)).toEqual({ cause: 'noexit', fixable: false });
    // Un convoyeur en sortie : la ligne est pleine plus loin.
    g.structures.add(new Conveyor(57, 9, 0));
    expect(diagnose(g, d)).toEqual({ cause: 'beltfull', fixable: false });
  });

  it('caisse d’expédition pleine, et coffre voisin qui ne veut pas du produit', () => {
    const { g, d } = setup();
    d.status = 'full';
    d.buffer = ['copper', 'copper', 'copper'];
    (g.structures.at(46, 10) as Storage).allow = ['gold']; // aucun coffre ne veut du cuivre
    const crate = g.structures.add(new ShippingCrate(57, 9, 0)) as ShippingCrate;
    expect(diagnose(g, d)).toEqual({ cause: 'cratefull', fixable: false });
    g.structures.remove(crate);
    const side = g.structures.add(new Storage(55, 9, 1)) as Storage;
    side.allow = ['gold'];
    expect(diagnose(g, d)).toEqual({ cause: 'nochest', fixable: false });
  });

  it('une machine qui tourne, ou à sec (gisement épuisé), n’est pas « bloquée »', () => {
    const { g, d } = setup(5);
    d.addFuel(3);
    g.update(SIM_DT, [IDLE]);
    expect(d.status).toBe('ok');
    expect(diagnose(g, d)).toBeNull();
    g.world.deposit[56 + 9 * g.world.w] = 0; // gisement épuisé
    g.update(SIM_DT, [IDLE]);
    expect(d.status).toBe('depleted');
    expect(diagnose(g, d)).toBeNull();
  });

  it('chaque cause a son texte et son conseil, en français', () => {
    for (const c of REPAIR_CAUSES) {
      expect(REPAIR_TEXT[c].label.length).toBeGreaterThan(3);
      expect(REPAIR_TEXT[c].advice.length).toBeGreaterThan(10);
    }
  });
});

describe('dépanneur : au travail', () => {
  it('le métier existe, le foreur n’existe plus', () => {
    expect(WORKER_JOBS.map((j) => j.id)).toEqual(['picker', 'fixer', 'refueler']);
    expect(WORKER_JOBS.find((j) => j.id === 'fixer')?.name).toBe('Dépanneur');
  });

  it('machine sans charbon : il prend du charbon dans un coffre et la recharge', () => {
    const { g, c, d } = setup(10);
    expect(d.flowState()).toBe('stuck');
    g.workers.add('fixer', g);
    run(g, 40);
    expect(c.items.coal ?? 0).toBeLessThan(10);
    expect(d.fuelUnits + d.burn).toBeGreaterThan(0);
    expect(g.workers.reports.size).toBe(0);
  });

  it('sortie pleine : il la vide dans le coffre', () => {
    const { g, c, d } = setup(0);
    d.fuelUnits = 5; // elle a du charbon, mais sa sortie est pleine et rien n'en part
    d.buffer = Array(d.def.stats.capacity).fill('copper');
    g.update(SIM_DT, [IDLE]);
    expect(d.status).toBe('full');
    g.workers.add('fixer', g);
    run(g, 30);
    expect(c.items.copper).toBeGreaterThanOrEqual(d.def.stats.capacity);
  });

  it('ce qu’il ne peut pas régler : il rentre au camp, le constat ne s’affiche qu’à l’arrivée, puis il repart ailleurs', () => {
    const { g, d } = setup(0);
    const w = g.workers.add('fixer', g);
    const home = g.workers.homeTile(g, 0);
    let inspected = false;
    let returningUnseen = false;
    for (let i = 0; i < 60 * 40; i++) {
      g.update(SIM_DT, [IDLE]);
      if (w.task?.kind === 'inspect') inspected = true;
      const r = g.workers.reports.get('56,9');
      if (w.note && w.task?.kind === 'home' && r) returningUnseen ||= !r.shown;
    }
    expect(inspected).toBe(true);
    expect(returningUnseen).toBe(true); // en chemin, rien n'est encore affiché
    const r = g.workers.reports.get(`${d.x},${d.y}`)!;
    expect(r.cause).toBe('nocoal');
    expect(r.shown).toBe(true);
    expect(w.note).toBeNull();
    expect(tile(w).x + tile(w).y * g.world.w).toBe(home);
  });

  it('une machine signalée n’est pas revisitée avant le délai, puis elle l’est', () => {
    const { g, d } = setup(0);
    const w = g.workers.add('fixer', g);
    run(g, 40);
    const first = g.workers.reports.get('56,9')!;
    expect(first.shown).toBe(true);
    let early = 0;
    let late = false;
    while (g.time < first.t + REPAIR.cooldown + 40) {
      g.update(SIM_DT, [IDLE]);
      const visiting = w.task?.kind === 'inspect' || w.focus !== null;
      if (visiting && g.time < first.t + REPAIR.cooldown - 1) early++;
      if (visiting && g.time > first.t + REPAIR.cooldown) late = true;
    }
    expect(early).toBe(0);
    expect(late).toBe(true);
    expect(g.workers.reports.get('56,9')!.t).toBeGreaterThan(first.t);
    expect(d.status).toBe('nofuel');
  });

  it('deux dépanneurs ne visent pas la même machine', () => {
    const { g } = setup(0);
    g.world.setDeposit(60, 9, 1, 60);
    g.structures.add(new Drill(60, 9, 1));
    g.update(SIM_DT, [IDLE]);
    const [a, b] = [g.workers.add('fixer', g), g.workers.add('fixer', g)];
    const key = (t: unknown) => (t as { x: number; y: number }).x + ',' + (t as { x: number; y: number }).y;
    let both = false;
    for (let i = 0; i < 60 * 12; i++) {
      g.update(SIM_DT, [IDLE]);
      const ta = a.task?.kind === 'inspect' ? key(a.task) : a.focus ? key(a.focus) : null;
      const tb = b.task?.kind === 'inspect' ? key(b.task) : b.focus ? key(b.focus) : null;
      if (ta && tb) {
        both = true;
        expect(ta).not.toBe(tb);
      }
    }
    expect(both).toBe(true);
  });

  it('rien à l’arrêt : il reste à son poste, sans bouger ni rien signaler', () => {
    const g = new GameState(4);
    const w = g.workers.add('fixer', g);
    const [x, y] = [w.x, w.y];
    run(g, 20);
    expect([w.x, w.y]).toEqual([x, y]);
    expect(w.task).toBeNull();
    expect(g.workers.reports.size).toBe(0);
  });
});

describe('dépanneur : constats, délai et rechargement', () => {
  it('une machine bloquée par intermittence ne fait pas oublier le délai ; le constat n’est affiché que si elle est à l’arrêt', () => {
    const { g, d } = setup(0);
    g.workers.reports.set('56,9', { x: 56, y: 9, cause: 'beltfull', t: g.time, shown: true });
    expect(repairNotes(g)).toHaveLength(1);
    g.world.deposit[56 + 9 * g.world.w] = 0; // elle n'est plus bloquée (gisement épuisé : à sec)
    d.addFuel(3);
    g.update(SIM_DT, [IDLE]);
    expect(d.flowState()).not.toBe('stuck');
    expect(g.workers.reports.size).toBe(1); // gardé : son délai court encore, pour qu'on ne la revisite pas
    expect(repairNotes(g)).toHaveLength(0); // mais rien d'affiché : elle ne bloque plus
    run(g, REPAIR.cooldown + 1);
    expect(g.workers.reports.size).toBe(0); // délai écoulé et machine libre : oublié
  });

  it('après un chargement, le constat d’un four sans charbon reste (son état n’est pas sauvegardé, il se recalcule)', () => {
    const g = new GameState(4);
    const f = g.structures.add(new Smelter('furnace', 60, 9, 1)) as Smelter;
    f.input = ['copper', 'copper'];
    g.update(SIM_DT, [IDLE]);
    expect(f.flowState()).toBe('stuck');
    g.workers.reports.set('60,9', { x: 60, y: 9, cause: 'nocoal', t: g.time, shown: true });
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    loaded.update(SIM_DT, [IDLE]);
    expect(loaded.workers.reports.size).toBe(1);
    expect(repairNotes(loaded)).toHaveLength(1);
  });

  it('après un chargement, le dépanneur ne se précipite pas sur des foreuses qui tournent', () => {
    const { g, d } = setup(5);
    d.addFuel(5);
    g.update(SIM_DT, [IDLE]);
    expect(d.status).toBe('ok');
    g.workers.add('fixer', g);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    const w = loaded.workers.list[0];
    for (let i = 0; i < 20; i++) {
      loaded.update(SIM_DT, [IDLE]);
      expect(w.task).toBeNull(); // le statut par défaut d'une foreuse rechargée (« sans charbon ») n'est qu'un état provisoire
    }
  });

  it('du charbon en coffre mais aucun chemin pour l’atteindre : « inaccessible », pas « plus de charbon »', () => {
    const { g, c } = setup(10);
    for (const [x, y] of [[45, 10], [47, 10], [46, 9], [46, 11]]) {
      const wall = g.structures.add(new Storage(x, y, 1)) as Storage;
      wall.allow = ['gold'];
    }
    expect(c.items.coal).toBe(10);
    g.workers.add('fixer', g);
    run(g, 40);
    expect(g.workers.reports.get('56,9')?.cause).toBe('unreachable');
    expect(REPAIR_TEXT.unreachable.label).toContain('inaccessible');
  });

  it('un constat renouvelé redevient le plus récent : quand la liste est pleine, c’est le plus ancien qui part', () => {
    const { g, d } = setup(0);
    const w = g.workers.add('fixer', g);
    const ws = g.workers as unknown as { report(w: unknown, g: GameState, m: Drill, cause: string): void };
    for (let i = 0; i < REPAIR.maxReports; i++) g.workers.reports.set(i + ',0', { x: i, y: 0, cause: 'noexit', t: i, shown: true });
    ws.report(w, g, d, 'beltfull');
    expect([...g.workers.reports.keys()].at(-1)).toBe('56,9');
    expect(g.workers.reports.size).toBe(REPAIR.maxReports);
    expect(g.workers.reports.has('0,0')).toBe(false); // le plus ancien est parti
  });
});

describe('dépanneur : sauvegarde', () => {
  it('les constats font l’aller-retour et restent identiques', () => {
    const { g } = setup(0);
    g.workers.add('fixer', g);
    run(g, 40);
    expect(g.workers.reports.size).toBe(1);
    const again = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(again.workers.serializeReports()).toEqual(g.workers.serializeReports());
    expect(again.workers.list.map((w) => w.job)).toEqual(['fixer']);
  });

  it('une partie sans constats n’écrit pas le champ ; une ancienne sauvegarde sans lui se charge', () => {
    const g = new GameState(4);
    expect(serialize(g).repairs).toBeUndefined();
    const data = JSON.parse(JSON.stringify(serialize(g)));
    delete data.repairs;
    expect(deserialize(data).workers.reports.size).toBe(0);
  });

  it('un ancien foreur devient dépanneur (il a été acheté : on ne le perd pas), sans son niveau', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.workers = [
      { id: 1, job: 'driller', level: 3, x: 800, y: 160, cargo: {} },
      { id: 2, job: 'picker', x: 800, y: 160, cargo: {} },
    ];
    const loaded = deserialize(data);
    expect(loaded.workers.list.map((w) => [w.id, w.job])).toEqual([[1, 'fixer'], [2, 'picker']]);
    expect('level' in loaded.workers.list[0]).toBe(false);
  });

  it('une foreuse sauvegardée avec l’ancien champ « by » se charge normalement', () => {
    const { g } = setup(0);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    const s = data.structures.find((x: { type: string }) => x.type === 'drill');
    s.by = 2;
    const loaded = deserialize(data);
    expect(loaded.structures.at(56, 9)).toBeInstanceOf(Drill);
    expect('placedBy' in (loaded.structures.at(56, 9) as object)).toBe(false);
  });

  it('constats abîmés (cause inconnue, hors carte, texte à la place d’un nombre) : ignorés, sans exception', () => {
    const g = new GameState(4);
    const data = JSON.parse(JSON.stringify(serialize(g)));
    data.repairs = [
      { x: 56, y: 9, cause: 'nocoal', t: 12, shown: true },
      { x: 56, y: 9, cause: 'inconnue', t: 1, shown: true },
      { x: -5, y: 9, cause: 'nocoal', t: 1, shown: false },
      { x: 'a', y: 9, cause: 'nocoal', t: 1, shown: false },
      null,
      { x: 57, y: 9, cause: 'beltfull', t: 'hier', shown: false },
    ];
    const loaded = deserialize(data);
    expect(loaded.workers.serializeReports()).toEqual([{ x: 56, y: 9, cause: 'nocoal', t: 12, shown: true }]);
    data.repairs = 'abîmé';
    expect(deserialize(data).workers.reports.size).toBe(0);
  });
});
