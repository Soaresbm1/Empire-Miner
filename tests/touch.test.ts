import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input } from '../src/core/Input';
import { helpPanel } from '../src/ui/panels';
import { PINCH_IN, STICK_DEAD, isTouchDevice, pinchStep, stickKeys } from '../src/ui/touch';

/** Un `Input` sans navigateur : les écouteurs sont ignorés, on appelle les méthodes à la main. */
function makeInput(): Input {
  const target = { addEventListener() {} } as unknown as HTMLElement;
  return new Input(target);
}

const g = globalThis as unknown as { window?: unknown; location?: unknown };
let saved: { window?: unknown; location?: unknown };

beforeEach(() => {
  saved = { window: g.window, location: g.location };
  g.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  g.location = { search: '' };
});
afterEach(() => {
  g.window = saved.window;
  g.location = saved.location;
});

describe('stick virtuel', () => {
  it('rien en dessous de la zone morte, une direction au-dessus', () => {
    expect(stickKeys(0, 0)).toEqual({ left: false, right: false, up: false, down: false });
    expect(stickKeys(STICK_DEAD - 0.05, 0)).toEqual({ left: false, right: false, up: false, down: false });
    expect(stickKeys(0.9, 0)).toEqual({ left: false, right: true, up: false, down: false });
    expect(stickKeys(-1, 0)).toEqual({ left: true, right: false, up: false, down: false });
    expect(stickKeys(0, -0.8)).toEqual({ left: false, right: false, up: true, down: false });
    expect(stickKeys(0, 0.8)).toEqual({ left: false, right: false, up: false, down: true });
  });

  it('huit directions : la diagonale demande deux axes comparables', () => {
    expect(stickKeys(0.7, -0.7)).toEqual({ left: false, right: true, up: true, down: false });
    expect(stickKeys(-0.6, 0.6)).toEqual({ left: true, right: false, up: false, down: true });
    // Un petit écart sur l'autre axe ne dévie pas la marche.
    expect(stickKeys(0.95, -0.4)).toEqual({ left: false, right: true, up: false, down: false });
    expect(stickKeys(-0.2, 0.9)).toEqual({ left: false, right: false, up: false, down: true });
  });
});

describe('pincement', () => {
  it('écarter zoome, rapprocher dézoome, un petit geste ne fait rien', () => {
    expect(pinchStep(100, 100 * PINCH_IN + 1)).toBe(1);
    expect(pinchStep(100, 70)).toBe(-1);
    expect(pinchStep(100, 110)).toBe(0);
    expect(pinchStep(100, 90)).toBe(0);
    expect(pinchStep(0, 100)).toBe(0);
  });
});

describe('Input : touches virtuelles et doigt', () => {
  it('une touche virtuelle maintenue se lit comme une touche du clavier', () => {
    const inp = makeInput();
    expect(inp.isDown('KeyD', 'ArrowRight')).toBe(false);
    inp.setVirtual('KeyD', true);
    expect(inp.isDown('KeyD', 'ArrowRight')).toBe(true);
    inp.setVirtual('KeyD', false);
    expect(inp.isDown('KeyD', 'ArrowRight')).toBe(false);
    inp.setVirtual('Space', true);
    inp.clearVirtual();
    expect(inp.isDown('Space')).toBe(false);
  });

  it('un appui bref est vu une seule image, avec son caractère tapé', () => {
    const inp = makeInput();
    inp.tap('KeyM', 'M');
    inp.tap('KeyE');
    expect(inp.wasPressed('KeyE')).toBe(true);
    expect(inp.wasPressed('KeyM')).toBe(true);
    expect(inp.wasTyped('m')).toBe(true);
    inp.endFrame();
    expect(inp.wasPressed('KeyE', 'KeyM')).toBe(false);
    expect(inp.wasTyped('m')).toBe(false);
  });

  it('un doigt posé se comporte comme la souris : clic gauche, position, puis relâché à la fin de l’image', () => {
    const inp = makeInput();
    inp.touchDown(120, 80);
    expect(inp.mouseInside).toBe(true);
    expect(inp.left).toBe(true);
    expect(inp.mouseX).toBe(120);
    expect(inp.consumeLeftPress()).toBe(true);
    expect(inp.consumeLeftPress()).toBe(false);
    expect(inp.leftPressX).toBe(120);
    inp.touchMove(150, 90);
    expect(inp.mouseX).toBe(150);
    // Le doigt se lève avant que le jeu ait lu l'image : le clic est quand même vu, puis relâché.
    inp.touchUp();
    expect(inp.left).toBe(true);
    inp.endFrame();
    expect(inp.left).toBe(false);
    expect(inp.mouseInside).toBe(false);
  });

  it('un tap très bref n’est pas perdu : appui et relâchement dans la même image', () => {
    const inp = makeInput();
    inp.touchDown(10, 10);
    inp.touchUp();
    expect(inp.left).toBe(true); // vu par la lecture de l'image
    expect(inp.consumeLeftPress()).toBe(true);
    inp.endFrame();
    expect(inp.left).toBe(false);
  });

  it('en mode « Retirer », le doigt fait un clic droit', () => {
    const inp = makeInput();
    inp.touchDown(30, 40, true);
    expect(inp.right).toBe(true);
    expect(inp.left).toBe(false);
    expect(inp.consumeRightPress()).toBe(true);
    inp.touchUp();
    inp.endFrame();
    expect(inp.right).toBe(false);
  });

  it('un nouveau doigt avant la fin de l’image annule le relâchement en attente', () => {
    const inp = makeInput();
    inp.touchDown(1, 1);
    inp.touchUp();
    inp.touchDown(5, 5);
    inp.endFrame();
    expect(inp.left).toBe(true);
    expect(inp.mouseInside).toBe(true);
  });

  it('les libellés de touches parlent des boutons à l’écran en mode tactile', () => {
    const inp = makeInput();
    expect(inp.label('KeyE')).toBe('E');
    inp.touchMode = true;
    expect(inp.label('KeyE')).toBe('Agir');
    expect(inp.label('KeyB')).toBe('Bâtir');
    expect(inp.label('KeyZ')).toBe('Z');
  });
});

describe('détection du tactile', () => {
  it('écran tactile principal, ou ?touch / ?notouch dans l’adresse', () => {
    const w = g.window as { matchMedia: () => { matches: boolean } };
    expect(isTouchDevice()).toBe(false);
    w.matchMedia = () => ({ matches: true });
    expect(isTouchDevice()).toBe(true);
    g.location = { search: '?notouch' };
    expect(isTouchDevice()).toBe(false);
    w.matchMedia = () => ({ matches: false });
    g.location = { search: '?debug&touch' };
    expect(isTouchDevice()).toBe(true);
  });
});

describe('aide', () => {
  it('explique les commandes tactiles seulement sur un écran tactile', () => {
    const keys = { move: 'WASD', label: (c: string) => c };
    expect(helpPanel(keys)).not.toContain('Au doigt');
    const touch = helpPanel({ ...keys, touch: true });
    expect(touch).toContain('Au doigt');
    expect(touch).toContain('Pincer');
    expect(touch).toContain('Retirer');
  });
});
