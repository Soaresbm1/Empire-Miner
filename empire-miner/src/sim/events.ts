/**
 * Événements émis par la simulation et consommés par la présentation
 * (sons, particules, messages). La simulation ne connaît ni le rendu ni l'audio.
 */
export type SimEvent =
  | { t: 'swing'; x: number; y: number }
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
  | { t: 'discover'; text: string }
  | { t: 'message'; text: string; kind: 'info' | 'warn' | 'good' };
