/**
 * De quoi comparer deux sauvegardes et les montrer au joueur sans charger la partie : la graine du monde (une partie = une
 * graine), le temps de jeu (qui ne fait qu'avancer), l'argent, la profondeur atteinte, et la date.
 */
import type { SaveData } from '../save/save';

export interface Brief {
  seed: number;
  /** Temps de jeu (secondes de simulation) : d'une même partie, la plus avancée est celle qui en a le plus. */
  time: number;
  money: number;
  depth: number;
  /** Date de la sauvegarde (ISO, heure de l'appareil qui l'a faite). */
  savedAt: string;
}

/** Le résumé d'une sauvegarde au format du jeu (texte JSON) ; null si ce n'en est pas une. */
export function briefOf(raw: string): Brief | null {
  try {
    const d = JSON.parse(raw) as Partial<SaveData> | null;
    if (!d || d.game !== 'empire-miner' || typeof d.seed !== 'number' || typeof d.time !== 'number') return null;
    return {
      seed: d.seed,
      time: d.time,
      money: Number(d.money) || 0,
      depth: Number(d.stats?.maxDepth) || 0,
      savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    };
  } catch {
    return null;
  }
}

/** Même partie au même instant. */
export function sameBrief(a: Brief, b: Brief): boolean {
  return a.seed === b.seed && a.time === b.time;
}

/** « 3 h 20 », « 45 min », « moins d'une minute » : le temps de jeu, pour que le joueur reconnaisse sa partie. */
export function playTime(seconds: number): string {
  const min = Math.floor(Math.max(0, seconds) / 60);
  if (min < 1) return 'moins d’une minute';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}
