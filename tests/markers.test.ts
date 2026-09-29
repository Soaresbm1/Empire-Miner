import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS } from '../src/core/constants';
import { ORE_BLOCK } from '../src/data/blocks';
import { resourceIndex } from '../src/data/resources';
import { viewTileAt } from '../src/render/MineMap';
import { deserialize, serialize } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { MAX_MARKERS } from '../src/sim/Markers';
import { teleport } from './helpers';

const S = SURFACE_ROWS;

describe('repères sur la carte', () => {
  it('un repère prend le nom de ce qui se trouve à cet endroit', () => {
    const g = new GameState(4);
    // Filon d'or vu, à une case du repère.
    g.world.set(21, S + 30, ORE_BLOCK.gold);
    g.world.setExplored(21, S + 30);
    expect(g.addMarker('ore', 20, S + 30)?.label).toBe("Filon d'or");
    // Gisement au sol.
    g.world.setDeposit(30, S + 20, resourceIndex('iron'), 100);
    g.world.setExplored(30, S + 20);
    expect(g.addMarker('ore', 30, S + 20)?.label).toBe('Gisement de fer');
    // Une machine (base de foreuse de percement) pour un repère « base ».
    g.inventory.addKit('borer', 1);
    teleport(g, 47, S + 13);
    expect(g.place('borer', 53, S + 14, 0)).toBeTruthy();
    expect(g.addMarker('base', 53, S + 14)?.label).toBe('Foreuse de percement');
    // Rien de particulier : nom numéroté par type.
    expect(g.addMarker('point', 5, S + 60)?.label).toBe('Repère 1');
    expect(g.addMarker('point', 6, S + 61)?.label).toBe('Repère 2');
    expect(g.addMarker('danger', 7, S + 62)?.label).toBe('Danger 1');
    // Les bâtiments du camp.
    expect(g.addMarker('base', 41, 7)?.label).toBe('Comptoir');
  });

  it('un seul repère par case, et une limite au nombre de repères', () => {
    const g = new GameState(4);
    const a = g.addMarker('point', 10, 40)!;
    const b = g.addMarker('danger', 10, 40)!;
    expect(b.id).toBe(a.id);
    expect(b.kind).toBe('danger');
    expect(g.markers.list.length).toBe(1);
    for (let i = 1; i < MAX_MARKERS; i++) expect(g.addMarker('point', 10 + i, 50)).toBeTruthy();
    expect(g.markers.full).toBe(true);
    expect(g.addMarker('point', 5, 80)).toBe(null);
    expect(g.addMarker('point', 500, 80)).toBe(null); // hors de la carte
  });

  it('suivre, ne plus suivre, supprimer', () => {
    const g = new GameState(4);
    const a = g.addMarker('ore', 10, 40)!;
    const b = g.addMarker('base', 20, 40)!;
    g.markers.toggleTrack(a.id);
    expect(g.markers.trackedMarker).toBe(a);
    g.markers.toggleTrack(b.id);
    expect(g.markers.trackedMarker).toBe(b);
    g.markers.toggleTrack(b.id);
    expect(g.markers.tracked).toBe(null);
    g.markers.toggleTrack(a.id);
    expect(g.markers.remove(a.id)).toBe(true);
    expect(g.markers.tracked).toBe(null); // le repère suivi a disparu
    expect(g.markers.list).toEqual([b]);
  });

  it('les repères et le repère suivi sont sauvegardés ; une ancienne sauvegarde n’en a pas', () => {
    const g = new GameState(4);
    g.addMarker('ore', 10, 40);
    const b = g.addMarker('danger', 20, 60)!;
    g.markers.toggleTrack(b.id);
    const h = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    expect(h.markers.list.map((m) => [m.kind, m.x, m.y, m.label])).toEqual(g.markers.list.map((m) => [m.kind, m.x, m.y, m.label]));
    expect(h.markers.trackedMarker?.label).toBe(b.label);
    const old = JSON.parse(JSON.stringify(serialize(new GameState(4))));
    delete old.markers;
    expect(deserialize(old).markers.list).toEqual([]);
  });

  it('un clic sur la carte complète vise la bonne case', () => {
    const v = { x0: 10, y0: 0, cell: 8, ox: 0, oy: 0 };
    expect(viewTileAt(v, 0, 0)).toEqual({ x: 10, y: 0 });
    expect(viewTileAt(v, 8 * 5 + 3, 8 * 20 + 7)).toEqual({ x: 15, y: 20 });
    expect(viewTileAt({ ...v, x0: 9.5 }, 3, 3)).toEqual({ x: 9, y: 0 });
  });
});
