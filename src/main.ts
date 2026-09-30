/**
 * Point d'entrée d'Empire Miner.
 */
import './ui/ui.css';
import { Game } from './game/Game';
import { installTheme } from './ui/theme';

installTheme();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Accès de débogage / tests automatisés : ?debug dans l'URL.
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __EM: Game }).__EM = game;
  game.debug = true;
}
