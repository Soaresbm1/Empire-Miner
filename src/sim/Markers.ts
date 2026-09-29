/**
 * Repères posés par le joueur sur la carte (ou là où il se trouve, touche N) : un filon à
 * exploiter plus tard, une base de foreuse, un danger à éviter… Chaque repère a un type
 * (couleur et symbole) et un nom donné automatiquement d'après ce qui se trouve à cet endroit.
 * Un repère peut être « suivi » : une flèche au bord de l'écran indique sa direction.
 */
export type MarkerKind = 'point' | 'ore' | 'base' | 'danger';

export const MARKER_KINDS: Record<MarkerKind, { name: string; color: string; symbol: string }> = {
  point: { name: 'Repère', color: '#f2c230', symbol: '★' },
  ore: { name: 'Filon', color: '#4fd1c5', symbol: '◆' },
  base: { name: 'Base', color: '#7fd07a', symbol: '■' },
  danger: { name: 'Danger', color: '#ff6b5b', symbol: '▲' },
};

export const MARKER_ORDER: MarkerKind[] = ['point', 'ore', 'base', 'danger'];

/** Nombre maximal de repères. */
export const MAX_MARKERS = 24;

export interface Marker {
  id: number;
  kind: MarkerKind;
  x: number;
  y: number;
  label: string;
}

/** Sauvegarde : [type, x, y, nom] et l'indice du repère suivi. */
export interface MarkerSave {
  list: [MarkerKind, number, number, string][];
  tracked: number | null;
}

export class MarkerBook {
  list: Marker[] = [];
  /** Repère suivi (flèche à l'écran), ou null. */
  tracked: number | null = null;
  private nextId = 1;

  get full(): boolean {
    return this.list.length >= MAX_MARKERS;
  }

  at(x: number, y: number): Marker | null {
    return this.list.find((m) => m.x === x && m.y === y) ?? null;
  }

  get(id: number): Marker | null {
    return this.list.find((m) => m.id === id) ?? null;
  }

  get trackedMarker(): Marker | null {
    return this.tracked === null ? null : this.get(this.tracked);
  }

  /** Ajoute un repère (un seul par case). Renvoie null si la liste est pleine. */
  add(kind: MarkerKind, x: number, y: number, label: string): Marker | null {
    const same = this.at(x, y);
    if (same) {
      same.kind = kind;
      same.label = label;
      return same;
    }
    if (this.full) return null;
    const m: Marker = { id: this.nextId++, kind, x, y, label };
    this.list.push(m);
    return m;
  }

  remove(id: number): boolean {
    const i = this.list.findIndex((m) => m.id === id);
    if (i < 0) return false;
    this.list.splice(i, 1);
    if (this.tracked === id) this.tracked = null;
    return true;
  }

  /** Suit un repère (ou arrête de le suivre s'il l'était déjà). */
  toggleTrack(id: number): void {
    this.tracked = this.tracked === id || !this.get(id) ? null : id;
  }

  /** Nombre de repères de ce type (pour numéroter les noms par défaut). */
  count(kind: MarkerKind): number {
    return this.list.filter((m) => m.kind === kind).length;
  }

  serialize(): MarkerSave {
    const tracked = this.list.findIndex((m) => m.id === this.tracked);
    return { list: this.list.map((m) => [m.kind, m.x, m.y, m.label]), tracked: tracked >= 0 ? tracked : null };
  }

  load(s: MarkerSave | undefined): void {
    this.list = [];
    this.tracked = null;
    this.nextId = 1;
    if (!s || !Array.isArray(s.list)) return;
    for (const [kind, x, y, label] of s.list.slice(0, MAX_MARKERS)) {
      if (!(kind in MARKER_KINDS) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      this.list.push({ id: this.nextId++, kind, x: Math.floor(x), y: Math.floor(y), label: String(label ?? MARKER_KINDS[kind].name).slice(0, 40) });
    }
    if (s.tracked !== null && s.tracked !== undefined && this.list[s.tracked]) this.tracked = this.list[s.tracked].id;
  }
}
