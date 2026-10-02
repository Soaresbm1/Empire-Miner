/**
 * Événements émis par la simulation et consommés par la présentation
 * (sons, particules, messages). La simulation ne connaît ni le rendu ni l'audio.
 */
/** Outil tenu par le joueur. */
export type ToolKind = 'pickaxe' | 'jackhammer';

export type SimEvent =
  | { t: 'swing'; x: number; y: number; tool: ToolKind }
  | { t: 'hit'; tx: number; ty: number; block: number; ratio: number }
  | { t: 'break'; tx: number; ty: number; block: number }
  | { t: 'denied'; tx: number; ty: number; block: number; need: number }
  | { t: 'pickup'; res: string; n: number; x: number; y: number }
  | { t: 'invFull' }
  | { t: 'sold'; total: number; n: number }
  | { t: 'shipped'; tx: number; ty: number; total: number; n: number }
  | { t: 'bought'; name: string }
  | { t: 'placed'; type: string; tx: number; ty: number }
  | { t: 'removed'; type: string; tx: number; ty: number }
  | { t: 'extract'; tx: number; ty: number; res: string }
  | { t: 'crumble'; res: string; x: number; y: number }
  | { t: 'discover'; text: string }
  | { t: 'message'; text: string; kind: 'info' | 'warn' | 'good' | 'bad' }
  /** Le joueur est blessé (au plus un événement toutes les 0,4 s pour les dégâts continus). */
  | { t: 'hurt'; amount: number; cause: string }
  | { t: 'faint'; cause: string }
  /** Le plafond craque (éboulement annoncé) ou s'effondre. */
  | { t: 'rumble'; tx: number; ty: number }
  | { t: 'collapse'; tx: number; ty: number }
  /** Une poche de grisou ou d'eau vient d'être percée. */
  | { t: 'gas'; tx: number; ty: number }
  | { t: 'flood'; tx: number; ty: number }
  /** Le joueur monte sur sa trottinette (Maj enfoncée) ou en descend (Maj relâchée). */
  | { t: 'mount'; on: boolean }
  /** Corde de rappel : début de la manœuvre, annulation, arrivée au camp (« up ») ou retour au point d'accroche (« down »). */
  | { t: 'rope'; phase: 'start' | 'cancel' | 'up' | 'down' };
