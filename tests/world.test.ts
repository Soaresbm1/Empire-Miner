import { describe, expect, it } from 'vitest';
import { SURFACE_ROWS, depthAt, rowForDepth } from '../src/core/constants';
import { AIR, ORE_BLOCK, getBlock } from '../src/data/blocks';
import { RESOURCES } from '../src/data/resources';
import { generateWorld } from '../src/sim/generator';

describe('génération du monde', () => {
  it('est déterministe pour une même graine', () => {
    const a = generateWorld(1234).world;
    const b = generateWorld(1234).world;
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    const c = generateWorld(999).world;
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles));
  });

  it('creuse un puits de départ depuis la surface', () => {
    const { world, entrance } = generateWorld(42);
    for (let y = SURFACE_ROWS; y < SURFACE_ROWS + 10; y++) expect(world.get(entrance.x, y)).toBe(AIR);
  });

  it('place chaque minerai uniquement dans sa tranche de profondeur', () => {
    const { world } = generateWorld(7);
    for (const r of RESOURCES) {
      if (!r.vein) continue;
      const id = ORE_BLOCK[r.id];
      let count = 0;
      for (let y = 0; y < world.h; y++)
        for (let x = 0; x < world.w; x++) {
          if (world.get(x, y) !== id) continue;
          count++;
          // Les filons de la mine de départ sont placés à la main (peu profonds).
          if (y > SURFACE_ROWS + 20) {
            expect(depthAt(y)).toBeGreaterThanOrEqual(r.minDepth - 3);
            expect(depthAt(y)).toBeLessThanOrEqual(r.maxDepth + 3);
          }
        }
      expect(count, r.id).toBeGreaterThan(0);
    }
  });

  it('durcit la roche avec la profondeur', () => {
    const { world } = generateWorld(3);
    const tierAt = (y: number) => {
      const tiers: number[] = [];
      for (let x = 1; x < world.w - 1; x++) {
        const b = getBlock(world.get(x, y));
        if (b.kind === 'rock') tiers.push(b.tier);
      }
      return tiers.reduce((a, b) => a + b, 0) / tiers.length;
    };
    expect(tierAt(rowForDepth(40))).toBeLessThan(tierAt(rowForDepth(200)));
    expect(tierAt(rowForDepth(200))).toBeLessThan(tierAt(rowForDepth(400)));
  });
});
