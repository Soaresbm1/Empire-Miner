/**
 * Débits à l'écran : l'infobulle d'une machine ou d'un convoyeur, les lignes « Débit réel » des panneaux, la légende de la vue
 * « goulots » et l'aide du jeu.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import type { Dir } from '../src/core/dir';
import { resourceIndex } from '../src/data/resources';
import { GameState } from '../src/sim/GameState';
import type { Conveyor } from '../src/sim/structures/Conveyor';
import type { Crafter } from '../src/sim/structures/Crafter';
import type { Drill } from '../src/sim/structures/Drill';
import type { ShippingCrate } from '../src/sim/structures/ShippingCrate';
import type { Smelter } from '../src/sim/structures/Smelter';
import type { Storage } from '../src/sim/structures/Storage';
import { flowKind, flowLegend, flowRows, flowTip, limiting } from '../src/ui/flow';
import { crafterPanel, drillPanel, helpPanel, shippingPanel, smelterPanel, storagePanel } from '../src/ui/panels';
import { run, teleport } from './helpers';

const S = SURFACE_ROWS;
const Y = S + 14;

function put(g: GameState, kit: string, x: number, y: number, dir: Dir = 0) {
  g.inventory.addKit(kit, 1);
  teleport(g, 47, S + 13);
  const s = g.place(kit, x, y, dir);
  if (!s) throw new Error(`${kit} @${x},${y} : ${g.canPlace(kit, x, y).reason}`);
  return s;
}

/** Chaîne saturée : coffre → convoyeur → four (20 lingots par minute) → coffre. */
function furnaceLine() {
  const g = new GameState(4);
  const src = put(g, 'storage', 48, Y) as Storage;
  const belt = put(g, 'conveyor', 49, Y, 0) as Conveyor;
  const furnace = put(g, 'furnace', 50, Y, 0) as Smelter;
  const out = put(g, 'storage', 51, Y) as Storage;
  src.put('coal', 6);
  src.put('copper', 50);
  teleport(g, 45, S + 15);
  return { g, src, belt, furnace, out };
}

/** Le texte d'un morceau de HTML : les sauts de ligne deviennent « | », les espaces insécables des espaces. */
const plain = (html: string) => html.replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ');

describe('infobulles de débit', () => {
  it('une structure qu’on ne mesure pas n’ajoute rien', () => {
    const g = new GameState(4);
    for (const s of g.structures.list) {
      expect(flowKind(s)).toBeNull();
      expect(flowTip(s)).toBe('');
      expect(flowRows(s)).toBe('');
    }
  });

  it('avant d’avoir du recul, on dit que la mesure est en cours', () => {
    const { g, furnace } = furnaceLine();
    run(g, 3);
    expect(flowTip(furnace)).toContain('mesure en cours');
    expect(flowRows(furnace)).toContain('mesure en cours');
  });

  it('un four saturé : son débit réel sur son maximum, son temps passé, et la mention de goulot', () => {
    const { g, furnace } = furnaceLine();
    run(g, 100);
    expect(flowKind(furnace)).toBe('producer');
    expect(limiting(furnace)).toBe(true);
    const tip = plain(flowTip(furnace));
    expect(tip).toMatch(/Débit : (1[89]|2[0-2]) \/min sur 20 possibles/);
    expect(tip).toMatch(/en marche (9\d|100) %/);
    expect(tip).toContain('Goulot : sa file');
    const rows = plain(flowRows(furnace));
    expect(rows).toMatch(/Débit réel\s*2\d \/min sur 20/);
    expect(rows).toContain('Temps passé');
    expect(rows).toContain('Goulot');
  });

  it('un convoyeur bloqué dit ce qui passe et combien de temps il attend', () => {
    const { g, belt } = furnaceLine();
    run(g, 100);
    expect(flowKind(belt)).toBe('belt');
    const tip = plain(flowTip(belt));
    expect(tip).toMatch(/Passent : (1[89]|2[0-2]) \/min \(135 au plus\)/);
    expect(tip).toMatch(/bloqué \d+ %/);
    expect(flowTip(belt)).toContain('class="bad"');
  });

  it('un coffre dit ce qui entre et ce qui sort', () => {
    const { g, src, out } = furnaceLine();
    run(g, 100);
    expect(flowKind(src)).toBe('chest');
    expect(plain(flowTip(out))).toMatch(/Entre : (1[89]|2[0-2]) \/min · sort : 0 \/min/);
    expect(plain(flowRows(out))).toMatch(/entre (1[89]|2[0-2]) \/min · sort 0 \/min/);
    expect(plain(flowTip(src))).toMatch(/sort : (1[89]|2[0-2]) \/min/);
  });

  it('une foreuse à pleine cadence', () => {
    const g = new GameState(9);
    g.world.setDeposit(47, Y, resourceIndex('copper'), 5000);
    g.world.set(47, Y, 0);
    const drill = put(g, 'drill', 47, Y, 0) as Drill;
    put(g, 'conveyor', 48, Y, 0);
    put(g, 'storage', 49, Y);
    g.inventory.add('coal', 12);
    g.fuelDrill(drill);
    run(g, 90);
    expect(plain(flowTip(drill))).toMatch(/Débit : 2\d \/min sur 24 possibles/);
    expect(limiting(drill)).toBe(false);
    expect(flowTip(drill)).not.toContain('Goulot');
  });

  it('une caisse d’expédition dit ce qu’elle reçoit', () => {
    const g = new GameState(9);
    teleport(g, 50, 8);
    g.inventory.addKit('conveyor', 1);
    g.inventory.addKit('shipping', 1);
    const belt = g.place('conveyor', 51, 9, 0) as Conveyor;
    const crate = g.place('shipping', 52, 9, 0) as ShippingCrate;
    teleport(g, 50, S + 10);
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 120 === 0) belt.accept('copper', 0);
      g.update(1 / 60, { mx: 0, my: 0, mine: false, target: null });
    }
    expect(flowKind(crate)).toBe('crate');
    expect(plain(flowTip(crate))).toMatch(/Reçoit : [\d,]+ \/min/);
  });
});

describe('panneaux des machines', () => {
  it('chaque panneau de machine montre le débit réel', () => {
    const { g, furnace, out } = furnaceLine();
    run(g, 100);
    expect(plain(smelterPanel(g, furnace))).toMatch(/Débit réel\s*2\d \/min sur 20/);
    expect(plain(storagePanel(g, out))).toContain('Débit réel');
    const crate = (() => {
      const h = new GameState(9);
      teleport(h, 50, 8);
      h.inventory.addKit('shipping', 1);
      return { h, c: h.place('shipping', 52, 9, 0) as ShippingCrate };
    })();
    run(crate.h, 30);
    expect(plain(shippingPanel(crate.h, crate.c))).toContain('Débit réel');
  });

  it('le panneau d’une foreuse et celui de la Manufacture aussi', () => {
    const g = new GameState(9);
    g.world.setDeposit(47, Y, resourceIndex('copper'), 5000);
    g.world.set(47, Y, 0);
    const drill = put(g, 'drill', 47, Y, 0) as Drill;
    g.inventory.add('coal', 12);
    g.fuelDrill(drill);
    const crafter = put(g, 'crafter', 50, Y, 0) as Crafter;
    run(g, 40);
    expect(plain(drillPanel(g, drill))).toContain('Débit réel');
    expect(plain(crafterPanel(g, crafter))).toContain('Débit réel');
  });
});

describe('légende et aide', () => {
  it('la légende nomme les trois couleurs', () => {
    const html = flowLegend();
    expect(html).toContain('fl-dot bad');
    expect(html).toContain('fl-dot warn');
    expect(html).toContain('fl-dot good');
    expect(plain(html)).toBe('BloquéÀ sec / saturéÇa tourne');
  });

  it('l’aide explique la vue goulots, la touche G et les prévisions', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => (c === 'KeyG' ? 'G' : c) });
    expect(html).toContain('Rendement des lignes');
    expect(html).toContain('<kbd>G</kbd>');
    expect(html).toContain('goulots');
    expect(html).toContain('prévision');
  });
});
