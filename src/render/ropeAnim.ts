/**
 * Animation de la corde de rappel : où est le mineur, et jusqu'où va la corde, selon le temps écoulé de la
 * manœuvre. Rien ici ne touche à la simulation (le mineur ne bouge pas vraiment avant l'arrivée) : c'est
 * seulement ce que le rendu dessine. Fonctions pures, donc testables sans canvas.
 */

/** Temps (s) que met la corde à se dérouler jusqu'en haut de l'écran. */
export const ROPE_UNROLL = 0.4;
/** Temps (s) avant que le mineur quitte le sol : la corde se tend, puis la montée accélère. */
export const ROPE_HOIST = 0.45;
/** Hauteur (px) à laquelle la corde tendue soulève déjà le mineur. */
export const ROPE_HANG = 3;
/** Profondeur (px) dont le mineur s'enfonce dans le trou en redescendant : plus que sa hauteur, il disparaît. */
export const ROPE_SINK = 24;
/** Arrivée : durée (s) et hauteur (px) de la petite chute qui le repose au sol. */
export const ROPE_LAND_TIME = 0.3;
export const ROPE_LAND_HEIGHT = 10;

export interface RopeFrame {
  /** Hauteur du mineur au-dessus du sol, en pixels du monde (négatif : il s'enfonce dans le trou). */
  lift: number;
  /** Part déroulée de la corde, de 0 à 1. */
  unroll: number;
  /** Ouverture du trou sous ses pieds, de 0 à 1 (seulement à la descente). */
  hole: number;
  /** Opacité de l'ombre qu'il laisse au sol : elle s'efface quand il s'éloigne. */
  shadow: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

/**
 * Image de la manœuvre après `elapsed` secondes sur `total`. À la montée, le mineur reste accroché à la
 * corde et monte de plus en plus vite jusqu'à sortir de l'écran par le haut (`reach` : la hauteur qu'il lui
 * faut pour en sortir) ; à la descente, il s'enfonce dans un trou ouvert à ses pieds.
 */
export function ropeFrame(dir: 'up' | 'down', elapsed: number, total: number, reach: number): RopeFrame {
  const t = Math.max(0, Math.min(total, elapsed));
  const unroll = easeOut(clamp01(t / ROPE_UNROLL));
  if (dir === 'up') {
    const taut = easeOut(clamp01(t / 0.25));
    const v = clamp01((t - ROPE_HOIST) / Math.max(0.001, total - ROPE_HOIST));
    const lift = ROPE_HANG * taut + Math.max(0, reach) * v * v;
    return { lift, unroll, hole: 0, shadow: clamp01(1 - lift / 40) };
  }
  const v = clamp01((t - ROPE_HOIST / 2) / Math.max(0.001, total - ROPE_HOIST / 2));
  return { lift: -ROPE_SINK * v * v, unroll, hole: easeOut(clamp01(t / 0.35)), shadow: clamp01(1 - v) };
}

/** Petite chute d'arrivée : de `ROPE_LAND_HEIGHT` px à 0, en `ROPE_LAND_TIME` s (`left` : temps restant). */
export function landLift(left: number): number {
  const k = clamp01(left / ROPE_LAND_TIME);
  return ROPE_LAND_HEIGHT * k * k;
}
