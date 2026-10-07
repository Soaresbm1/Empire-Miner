/**
 * Point d'entrée d'Empire Miner.
 */
import './ui/ui.css';
import './ui/touch.css';
import { Game } from './game/Game';
import { stateDigest } from './net/digest';
import { installTheme } from './ui/theme';

installTheme();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Accès de débogage / tests automatisés : ?debug dans l'URL.
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __EM: Game; __digest: typeof stateDigest }).__EM = game;
  (window as unknown as { __digest: typeof stateDigest }).__digest = stateDigest;
  game.debug = true;
}
