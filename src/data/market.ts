/**
 * Réglages du marché (données pures). Le cours d'un minerai est un multiplicateur de son prix de base :
 * 1 = le prix de la fiche, 1,5 = vendu 50 % plus cher, 0,7 = 30 % moins cher.
 */
export const MARKET = {
  /** Secondes de jeu entre deux cours. */
  step: 10,
  /** Cours gardés pour la courbe : 60 pas, soit 10 minutes. */
  history: 60,
  /** Calme du début de partie (s) : tous les cours restent à 100 % et aucun événement n'a lieu. */
  quiet: 90,
  /** Dérive : rappel vers la moyenne et agitation à chaque pas (en logarithme du cours). Écart habituel : environ ±14 %. */
  pull: 0.05,
  noise: 0.045,
  /** Bornes du cours. */
  min: 0.5,
  max: 2,
  /** Variation écartée de 1 pour qu'un cours « moyen » vaille 100 % en moyenne (les cours suivent une loi log-normale). */
  drift: -0.01,
  /** Écart au prix de base à partir duquel le Tableau d'affichage parle d'un bon ou d'un mauvais moment pour vendre. */
  good: 0.12,
  /** Écart sur 30 s au-delà duquel la flèche de tendance s'allume. */
  trendStep: 0.02,
  events: {
    /** Délai avant le premier événement, puis entre deux événements (s de jeu, bornes). */
    first: [150, 240],
    gap: [150, 300],
    /** Événements en même temps, au plus. */
    maxActive: 2,
    /** Durée de la montée, du palier et de la descente (s). */
    rise: 20,
    hold: [60, 110],
    fall: 40,
    /** Chance que ce soit une forte demande (sinon : surproduction). Hausses et baisses se compensent : en moyenne, le cours vaut 100 %. */
    demandChance: 0.5,
    /** Variation au palier, en logarithme du cours : +0,25 à +0,50 (× 1,28 à × 1,65), −0,42 à −0,22 (× 0,66 à × 0,80). */
    demand: [0.25, 0.5],
    glut: [-0.42, -0.22],
  },
} as const;
