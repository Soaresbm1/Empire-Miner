/**
 * Blocs (contenu solide d'une tuile). Une tuile vaut 0 (AIR) si elle est ouverte.
 *
 * Les roches hôtes changent avec la profondeur et deviennent plus dures.
 * Un bloc de filon est généré automatiquement pour chaque ressource ayant un `vein`.
 */
import { RESOURCES } from './resources';

export type BlockKind = 'air' | 'bedrock' | 'deco' | 'rock' | 'ore';

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  kind: BlockKind;
  solid: boolean;
  breakable: boolean;
  /** Résistance (points de dégâts). */
  hp: number;
  /** Niveau de pioche minimum. */
  tier: number;
  /** Ressource lâchée à la destruction. */
  drop?: { res: string; min: number; max: number; chance: number };
  /** Pour les filons : ressource laissée en gisement au sol. */
  ore?: string;
  /** Couleurs du dessus et de la face avant (roches, décor). */
  top: string;
  side: string;
}

export interface HostRockSpec {
  key: string;
  name: string;
  minDepth: number;
  hp: number;
  tier: number;
  top: string;
  side: string;
}

/** Roches hôtes par profondeur (m). */
export const HOST_ROCKS: HostRockSpec[] = [
  { key: 'rock', name: 'Roche', minDepth: 0, hp: 3, tier: 1, top: '#6e5f53', side: '#463b33' },
  { key: 'hardrock', name: 'Roche dure', minDepth: 100, hp: 7, tier: 2, top: '#5b616b', side: '#393d45' },
  { key: 'basalt', name: 'Basalte', minDepth: 300, hp: 13, tier: 3, top: '#4d3d47', side: '#2e242b' },
];

export const BLOCKS: BlockDef[] = [];

function add(def: Omit<BlockDef, 'id'>): number {
  const id = BLOCKS.length;
  BLOCKS.push({ ...def, id });
  return id;
}

export const AIR = add({ key: 'air', name: 'Vide', kind: 'air', solid: false, breakable: false, hp: 0, tier: 0, top: '#000', side: '#000' });
export const BEDROCK = add({ key: 'bedrock', name: 'Socle rocheux', kind: 'bedrock', solid: true, breakable: false, hp: 0, tier: 99, top: '#221e24', side: '#141115' });
export const CLIFF = add({ key: 'cliff', name: 'Falaise', kind: 'bedrock', solid: true, breakable: false, hp: 0, tier: 99, top: '#7d7468', side: '#524a40' });
export const TREE = add({ key: 'tree', name: 'Arbre', kind: 'deco', solid: true, breakable: false, hp: 0, tier: 99, top: '#3f7a35', side: '#2b5424' });

/** id de bloc pour chaque roche hôte, dans l'ordre de HOST_ROCKS. */
export const HOST_ROCK_IDS: number[] = HOST_ROCKS.map((r) =>
  add({
    key: r.key,
    name: r.name,
    kind: 'rock',
    solid: true,
    breakable: true,
    hp: r.hp,
    tier: r.tier,
    drop: { res: 'stone', min: 1, max: 1, chance: 0.5 },
    top: r.top,
    side: r.side,
  }),
);

/** id du bloc de filon pour chaque ressource. */
export const ORE_BLOCK: Record<string, number> = {};
for (const r of RESOURCES) {
  if (!r.vein) continue;
  ORE_BLOCK[r.id] = add({
    key: `ore_${r.id}`,
    name: r.veinName,
    kind: 'ore',
    solid: true,
    breakable: true,
    hp: r.resistance,
    tier: r.tier,
    drop: { res: r.id, min: r.drops[0], max: r.drops[1], chance: 1 },
    ore: r.id,
    top: r.color,
    side: r.dark,
  });
}

export function getBlock(id: number): BlockDef {
  return BLOCKS[id];
}

/** Roche hôte (index dans HOST_ROCKS) pour une profondeur donnée. */
export function hostRockIndexForDepth(depth: number): number {
  let idx = 0;
  for (let i = 0; i < HOST_ROCKS.length; i++) if (depth >= HOST_ROCKS[i].minDepth) idx = i;
  return idx;
}
