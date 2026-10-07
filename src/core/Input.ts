/**
 * Clavier, souris et doigts. Les touches sont identifiées par leur position physique
 * (`KeyboardEvent.code`) : ZQSD sur AZERTY et WASD sur QWERTY fonctionnent pareil.
 * Les raccourcis mnémoniques dont la lettre change de place selon le clavier (M
 * pour la carte) se lisent au caractère tapé (`wasTyped`).
 *
 * Sur téléphone, les boutons à l'écran appuient des touches virtuelles (`setVirtual`, `tap`) et un doigt posé sur le monde
 * se comporte comme la souris (`touchDown`, `touchMove`, `touchUp`) : le jeu ne voit pas la différence.
 */
/** Nom, sur un téléphone, du bouton qui remplace une touche. */
const TOUCH_LABELS: Record<string, string> = { KeyE: 'Agir', KeyF: 'Wagon', KeyV: 'Corde', KeyB: 'Bâtir', KeyI: 'Sac', KeyP: 'Pause', KeyX: 'Vitesse', KeyC: 'Coffres', KeyR: 'Tourner', KeyH: 'Aide' };

export class Input {
  readonly down = new Set<string>();
  /** Nombre d'appuis depuis la dernière image (plusieurs appuis rapides ne sont pas perdus). */
  private readonly pressed = new Map<string, number>();
  /** Caractères tapés depuis la dernière image (en minuscules). */
  private readonly typed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  left = false;
  right = false;
  private leftPressed = false;
  /** Position de la souris au moment du dernier clic gauche (elle a pu bouger avant l'image suivante). */
  leftPressX = 0;
  leftPressY = 0;
  private rightPressed = false;
  wheel = 0;
  /** Libellés de touches selon la disposition du clavier (si le navigateur le permet). */
  private layout: Map<string, string> | null = null;
  /** Vrai quand un panneau d'interface capture la souris. */
  uiHover = false;
  /** Commandes tactiles actives : les libellés de touches parlent des boutons à l'écran. */
  touchMode = false;
  /** Touches maintenues par des boutons à l'écran (stick, bouton « Miner »…). */
  private readonly virtual = new Set<string>();
  /** Un doigt est posé sur le monde. */
  private touching = false;
  /** Le doigt est levé : la « souris » se relâche à la fin de l'image, pour qu'un tap très bref soit vu. */
  private releasePending = false;

  constructor(target: HTMLElement) {
    const prevent = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (prevent.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.set(e.code, (this.pressed.get(e.code) ?? 0) + 1);
        if (e.key.length === 1) this.typed.add(e.key.toLowerCase());
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.virtual.clear();
      this.left = this.right = false;
    });
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseInside = true;
    });
    target.addEventListener('mouseleave', () => (this.mouseInside = false));
    target.addEventListener('mousedown', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e.button === 0) {
        this.left = true;
        this.leftPressed = true;
        this.leftPressX = e.clientX;
        this.leftPressY = e.clientY;
      } else if (e.button === 2) {
        this.right = true;
        this.rightPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.left = false;
      else if (e.button === 2) this.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    const nav = navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } };
    nav.keyboard
      ?.getLayoutMap?.()
      .then((m) => (this.layout = m))
      .catch(() => {});
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c) || this.virtual.has(c));
  }

  /** Maintient (ou relâche) une touche virtuelle, comme un bouton à l'écran qu'on garde appuyé. */
  setVirtual(code: string, on: boolean): void {
    if (on) this.virtual.add(code);
    else this.virtual.delete(code);
  }

  /** Relâche toutes les touches virtuelles (écran verrouillé, changement d'application…). */
  clearVirtual(): void {
    this.virtual.clear();
  }

  /** Un appui bref sur une touche (bouton à l'écran) ; `char` est le caractère tapé pour les raccourcis qui en dépendent (M, N, +). */
  tap(code: string, char?: string): void {
    this.pressed.set(code, (this.pressed.get(code) ?? 0) + 1);
    if (char) this.typed.add(char.toLowerCase());
  }

  /** Un doigt se pose sur le monde en (x, y) : clic gauche, ou clic droit (démonter) si `remove`. */
  touchDown(x: number, y: number, remove = false): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseInside = true;
    this.touching = true;
    this.releasePending = false;
    if (remove) {
      this.right = true;
      this.rightPressed = true;
    } else {
      this.left = true;
      this.leftPressed = true;
      this.leftPressX = x;
      this.leftPressY = y;
    }
  }

  touchMove(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }

  /** Le doigt se lève : le clic se relâche à la fin de l'image (le pointeur disparaît avec lui). */
  touchUp(): void {
    if (!this.touching) return;
    this.touching = false;
    this.releasePending = true;
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Lettre tapée, quelle que soit sa place sur le clavier (ex. « m » sur AZERTY comme sur QWERTY). */
  wasTyped(...chars: string[]): boolean {
    return chars.some((c) => this.typed.has(c));
  }

  pressCount(code: string): number {
    return this.pressed.get(code) ?? 0;
  }

  consumeLeftPress(): boolean {
    const v = this.leftPressed;
    this.leftPressed = false;
    return v;
  }

  consumeRightPress(): boolean {
    const v = this.rightPressed;
    this.rightPressed = false;
    return v;
  }

  /** Fin d'image : oublie les appuis ponctuels. */
  endFrame(): void {
    this.pressed.clear();
    this.typed.clear();
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
    if (this.releasePending && !this.touching) {
      this.releasePending = false;
      this.left = false;
      this.right = false;
      this.mouseInside = false;
    }
  }

  /** Libellé d'une touche physique pour l'affichage (ex. KeyW → « Z » sur AZERTY) ; au doigt, le nom du bouton. */
  label(code: string): string {
    if (this.touchMode && TOUCH_LABELS[code]) return TOUCH_LABELS[code];
    const l = this.layout?.get(code);
    if (l) return l.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  moveKeys(): string {
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => this.label(c)).join('');
  }
}
