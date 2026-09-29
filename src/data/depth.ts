/**
 * Zones de profondeur. Chaque zone pourra plus tard activer des contraintes
 * (éclairage, ventilation, eau, chaleur, stabilité) via des systèmes dédiés.
 */
export interface DepthZone {
  minDepth: number;
  name: string;
  color: string;
}

export const DEPTH_ZONES: DepthZone[] = [
  { minDepth: 0, name: 'Galeries supérieures', color: '#c9a27a' },
  { minDepth: 100, name: 'Galeries profondes', color: '#8fa6c7' },
  { minDepth: 300, name: 'Abîmes de basalte', color: '#c77f9a' },
];

export function zoneForDepth(depth: number): DepthZone {
  let z = DEPTH_ZONES[0];
  for (const zone of DEPTH_ZONES) if (depth >= zone.minDepth) z = zone;
  return z;
}
