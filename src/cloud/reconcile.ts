/**
 * Que faire de la partie de cet appareil et de celle du compte ? Une décision pure, sans réseau ni stockage, pour qu'on
 * puisse l'éprouver cas par cas : c'est ici que se joue « ne jamais écraser une partie sans le savoir ».
 *
 * Cet appareil se souvient de son dernier échange réussi avec le compte (`SyncLink`) : la révision du compte à ce moment-là, et
 * la partie (graine, temps de jeu) qu'ils avaient en commun. De là :
 *  - le compte n'a pas changé depuis → seul cet appareil a pu avancer : on envoie ;
 *  - le compte a changé et cet appareil n'a pas bougé → on prend celle du compte (rien n'est perdu : elle prolonge la nôtre) ;
 *  - le compte a changé pour une AUTRE partie (nouvelle partie ou import sur un autre appareil) : elle ne prolonge pas la nôtre,
 *    la prendre en silence ferait disparaître celle-ci → on demande ;
 *  - les deux ont avancé de leur côté, ou cet appareil n'a jamais parlé à ce compte et a déjà une partie différente → on demande.
 */
import { sameBrief, type Brief } from './brief';

/** Le dernier échange réussi de cet appareil avec le compte. */
export interface SyncLink {
  /** Révision du compte à ce moment-là. */
  rev: string;
  /** La partie échangée : sa graine et son temps de jeu. */
  seed: number;
  time: number;
  /** L'heure de cet appareil (ms) au moment de l'échange. */
  at: number;
}

/**
 * Jusqu'où une sauvegarde de l'appareil, faite après son dernier échange avec le compte, ne compte pas comme un vrai travail à
 * part : en fermant la page (ou en la mettant en arrière-plan), le jeu se sauvegarde une dernière fois, quelques secondes de
 * jeu après le dernier envoi. Sans cette marge, changer d'appareil poserait la question « quelle partie garder ? » à chaque fois.
 * Les deux heures comparées sont celles du même appareil.
 */
export const DRIFT_MS = 90000;

/** Une partie, désignée par sa graine et son temps de jeu. */
export interface Mark {
  seed: number;
  time: number;
}

export type Plan =
  | { do: 'nothing' }
  /** Les deux ont déjà la même partie : on retient la révision du compte, sans rien transférer. */
  | { do: 'adopt' }
  | { do: 'push' }
  | { do: 'pull' }
  | { do: 'ask'; why: 'first' | 'diverged' | 'replaced' };

/** La partie de l'appareil n'a avancé que de quelques secondes de jeu depuis le dernier échange (même partie, moins de `drift` ms). */
export function lightly(local: Brief, link: SyncLink, drift: number): boolean {
  if (local.seed !== link.seed || local.time < link.time) return false;
  const since = Date.parse(local.savedAt) - link.at;
  return since >= 0 && since <= drift;
}

export function reconcile(local: Brief | null, cloud: (Brief & { rev: string }) | null, link: SyncLink | null, drift = DRIFT_MS): Plan {
  if (!local && !cloud) return { do: 'nothing' };
  if (!cloud) return { do: 'push' };
  if (!local) return { do: 'pull' };

  if (sameBrief(local, cloud)) return link?.rev === cloud.rev ? { do: 'nothing' } : { do: 'adopt' };

  const moved = !link || local.seed !== link.seed || local.time !== link.time;
  if (link && link.rev === cloud.rev) return moved ? { do: 'push' } : { do: 'nothing' };
  if (link && (!moved || lightly(local, link, drift))) {
    // Le compte prolonge-t-il la partie qu'on lui connaissait (même graine) ? Sinon une autre partie a pris sa place ailleurs.
    return local.seed === cloud.seed ? { do: 'pull' } : { do: 'ask', why: 'replaced' };
  }
  return { do: 'ask', why: link ? 'diverged' : 'first' };
}

/**
 * Le compte contient-il notre propre dernier envoi, dont on n'a pas vu la réponse (page fermée en route, réseau coupé juste
 * après l'écriture) ? Alors ce n'est pas un autre appareil qui l'a modifié : sa révision est le nouveau point commun.
 */
export function recognizeOwn(link: SyncLink | null, sent: Mark | null, cloud: (Brief & { rev: string }) | null, now: number): SyncLink | null {
  if (!sent || !cloud || link?.rev === cloud.rev) return link;
  if (cloud.seed !== sent.seed || cloud.time !== sent.time) return link;
  return { rev: cloud.rev, seed: cloud.seed, time: cloud.time, at: now };
}
