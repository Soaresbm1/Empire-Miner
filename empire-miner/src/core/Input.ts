/**
 * Clavier et souris. Les touches sont identifiées par leur position physique
 * (`KeyboardEvent.code`) : ZQSD sur AZERTY et WASD sur QWERTY fonctionnent pareil.
 */
export class Input {
  readonly down = new Set<string>();
  /** Nombre d'appuis depuis la dernière image (plusieurs appuis rapides ne sont pas perdus). */
  private readonly pressed = new Map<string, number>();
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  left = false;
  right = false;
  private leftPressed = false;
  private rightPressed = false;
  wheel = 0;
  /** Libellés de touches selon la disposition du clavier (si le navigateur le permet). */
  private layout: Map<string, string> | null = null;
  /** Vrai quand un panneau d'interface capture la souris. */
  uiHover = false;

  constructor(target: HTMLElement) {
    const prevent = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (prevent.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.set(e.code, (this.pressed.get(e.code) ?? 0) + 1);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
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
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
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
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
  }

  /** Libellé d'une touche physique pour l'affichage (ex. KeyW → « Z » sur AZERTY). */
  label(code: string): string {
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
