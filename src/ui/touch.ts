/**
 * Commandes tactiles (téléphone, tablette) : un stick pour marcher, un bouton « Miner » qu'on garde appuyé, un bouton
 * « Agir », quelques raccourcis et un menu ☰ qui donne accès à tout le reste du clavier.
 *
 * Rien ici ne touche à la partie : les boutons appuient des touches virtuelles de `Input`, et un doigt posé sur le monde
 * se comporte comme la souris (toucher = clic, rester appuyé = miner, glisser = tracer un convoyeur, pincer = zoomer).
 */
import type { Input } from '../core/Input';

const PREF_KEY = 'empire-miner.touch';

/** Réglage du joueur : vrai (toujours), faux (jamais), null (selon l'appareil). */
export function loadTouchPref(): boolean | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function saveTouchPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* ignoré */
  }
}

/**
 * Les commandes tactiles sont-elles à afficher ? `?touch` / `?notouch` dans l'adresse d'abord, puis le réglage du menu,
 * puis l'appareil (écran tactile principal).
 */
export function isTouchDevice(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('notouch')) return false;
  if (q.has('touch')) return true;
  const pref = loadTouchPref();
  if (pref !== null) return pref;
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

export interface StickKeys {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** Part du rayon du stick en dessous de laquelle on ne bouge pas. */
export const STICK_DEAD = 0.34;

/**
 * Touches que représente le stick : `nx`, `ny` sont le décalage du doigt en parts du rayon (de −1 à 1, y vers le bas).
 * Huit directions : l'axe secondaire ne compte que s'il pèse au moins la moitié de l'axe principal.
 */
export function stickKeys(nx: number, ny: number): StickKeys {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const main = Math.max(ax, ay);
  if (main < STICK_DEAD) return { left: false, right: false, up: false, down: false };
  const on = (v: number) => Math.abs(v) >= STICK_DEAD && Math.abs(v) >= main * 0.5;
  return { left: nx < 0 && on(nx), right: nx > 0 && on(nx), up: ny < 0 && on(ny), down: ny > 0 && on(ny) };
}

/** Rapport de distance entre deux doigts à partir duquel on zoome d'un cran. */
export const PINCH_IN = 1.3;
export const PINCH_OUT = 1 / PINCH_IN;

/** Zoom d'un pincement : +1 (doigts qui s'écartent), −1 (qui se rapprochent) ou 0 tant que le geste est trop petit. */
export function pinchStep(start: number, now: number): number {
  if (start <= 0) return 0;
  const r = now / start;
  return r >= PINCH_IN ? 1 : r <= PINCH_OUT ? -1 : 0;
}

/** Ce que les boutons ont besoin de savoir de la partie (mis à jour à chaque image, le DOM ne change que si cela change). */
export interface TouchContext {
  /** Partie en cours (faux dans les menus : tout est caché). */
  playing: boolean;
  /** Un panneau ou un menu est ouvert : il a ses propres boutons. */
  blocking: boolean;
  /** Une machine, un coffre ou un bâtiment est à portée : « Agir » s'allume. */
  near: boolean;
  /** Dans un wagonnet. */
  riding: boolean;
  /** Un wagonnet est à portée. */
  wagonNear: boolean;
  hasScooter: boolean;
  buildMode: boolean;
  chestMode: boolean;
  /** Pause demandée par le joueur. */
  paused: boolean;
  /** Vitesse de jeu (1, 2 ou 4). */
  speed: number;
  /** Hauteur de la barre de construction (px), pour que les boutons restent au-dessus. */
  barHeight: number;
  /** Partie à deux : ni pause ni vitesse (l'autre joueur continue de jouer). */
  net?: boolean;
}

interface Btn {
  code: string;
  label: string;
  /** Caractère « tapé » attendu par le jeu pour ce raccourci (M, N). */
  char?: string;
  hint?: string;
}

/** Tout le clavier qu'on peut avoir besoin d'appuyer, rangé dans le menu ☰. */
const SHEET: Btn[] = [
  { code: 'KeyI', label: 'Sac', hint: 'Sac et carnet' },
  { code: 'KeyM', char: 'm', label: 'Carte', hint: 'Carte de la mine' },
  { code: 'KeyB', label: 'Bâtir', hint: 'Poser des machines' },
  { code: 'KeyC', label: 'Coffres', hint: 'Régler plusieurs coffres' },
  { code: 'KeyN', char: 'n', label: 'Repère', hint: 'Poser un repère ici' },
  { code: 'KeyT', label: 'Outil', hint: 'Pioche ou marteau-piqueur' },
  { code: 'KeyV', label: 'Corde', hint: 'Corde de rappel' },
  { code: 'KeyF', label: 'Wagon', hint: 'Monter ou descendre du wagonnet' },
  { code: 'KeyP', label: 'Pause', hint: 'Pause' },
  { code: 'KeyX', label: 'Vitesse', hint: 'Vitesse ×1, ×2, ×4' },
  { code: 'KeyH', label: 'Aide', hint: 'Commandes et conseils' },
  { code: 'Escape', label: 'Menu', hint: 'Menu du jeu' },
];

/** Ce que le titre et le ✕ de la barre de construction dépassent au-dessus de son cadre (px CSS). */
const BAR_OVERHANG = 12;

/** Les trois raccourcis les plus utiles, toujours sous le pouce. */
const QUICK: Btn[] = [SHEET[0], SHEET[1], SHEET[2]];

const html = (s: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild as HTMLElement;
};

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly act: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly build: HTMLElement;
  private readonly scooter: HTMLButtonElement;
  private readonly wagon: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  /** « Retirer » : en construction, un toucher démonte au lieu de poser. */
  private removeMode = false;
  private sheetOpen = false;
  private ctx: TouchContext | null = null;
  private sig = '';
  private stickId: number | null = null;
  private stickKeysNow: StickKeys = { left: false, right: false, up: false, down: false };
  /** Doigts posés sur le monde. */
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  /** Après un pincement, les doigts restants ne visent plus rien jusqu'à ce qu'ils soient tous levés. */
  private aimLocked = false;
  private measureT = 0;
  private alive = true;

  constructor(
    private readonly input: Input,
    private readonly canvas: HTMLCanvasElement,
    parent: HTMLElement,
  ) {
    input.touchMode = true;
    document.body.classList.add('touch');
    this.root = html(`<div id="touch" class="tc hidden">
      <div class="tc-stick" data-tc="stick"><div class="tc-base"><div class="tc-knob"></div></div></div>
      <div class="tc-right">
        <div class="tc-extra">
          <button class="tc-btn tc-small tc-scooter hidden" data-tc="scooter" title="Trottinette (garder activée pour rouler)"><b>🛴</b><span>Roule</span></button>
          <button class="tc-btn tc-small tc-wagon hidden" data-tc="wagon"><b>🚃</b><span>Wagon</span></button>
        </div>
        <div class="tc-quick">
          ${QUICK.map((b) => `<button class="tc-btn tc-small" data-code="${b.code}"${b.char ? ` data-char="${b.char}"` : ''} title="${b.hint}"><span>${b.label}</span></button>`).join('')}
          <button class="tc-btn tc-small tc-more" data-tc="more" title="Toutes les commandes"><b>☰</b></button>
        </div>
        <div class="tc-main">
          <button class="tc-btn tc-act" data-tc="act"><span>Agir</span></button>
          <button class="tc-btn tc-mine" data-tc="mine" title="Gardez appuyé pour miner devant vous"><b>⛏</b><span>Miner</span></button>
        </div>
        <div class="tc-build hidden">
          <button class="tc-btn tc-small" data-code="KeyR"><b>↻</b><span>Tourner</span></button>
          <button class="tc-btn tc-small tc-remove" data-tc="remove"><b>✕</b><span>Retirer</span></button>
        </div>
      </div>
      <div class="tc-sheet hidden">${SHEET.map((b) => `<button class="tc-btn" data-code="${b.code}"${b.char ? ` data-char="${b.char}"` : ''} title="${b.hint}"><span>${b.label}</span></button>`).join('')}</div>
    </div>`);
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.stick = q('.tc-stick');
    this.knob = q('.tc-knob');
    this.act = q('[data-tc="act"]');
    this.sheet = q('.tc-sheet');
    this.build = q('.tc-build');
    this.scooter = q('[data-tc="scooter"]');
    this.wagon = q('[data-tc="wagon"]');
    this.remove = q('[data-tc="remove"]');
    this.listenButtons();
    this.listenStick();
    this.listenWorld();
    // Le menu ☰ se pose au-dessus de la pile de boutons : il en faut la hauteur.
    const stack = q('.tc-right');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.root.style.setProperty('--tc-h', `${stack.offsetHeight}px`)).observe(stack);
    // Pas de menu contextuel, pas de zoom de la page, pas de défilement : tout le toucher est pour le jeu.
    for (const el of [this.root, this.canvas]) el.addEventListener('touchstart', (e) => this.alive && e.cancelable && e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    window.addEventListener('blur', () => this.releaseAll());
  }

  // ------------------------------------------------------------------ boutons

  private listenButtons(): void {
    const press = (el: HTMLElement, e: PointerEvent) => {
      el.classList.add('down');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture indisponible */
      }
    };
    const release = (el: HTMLElement) => el.classList.remove('down');
    for (const el of this.root.querySelectorAll<HTMLElement>('button')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        press(el, e);
        const code = el.dataset.code;
        const tc = el.dataset.tc;
        if (code) {
          this.input.tap(code, el.dataset.char);
          if (this.sheet.contains(el)) this.setSheet(false);
          return;
        }
        switch (tc) {
          case 'act':
            this.input.tap('KeyE');
            return;
          case 'wagon':
            this.input.tap('KeyF');
            return;
          case 'more':
            this.setSheet(!this.sheetOpen);
            return;
          case 'mine':
            this.input.setVirtual('Space', true);
            return;
          case 'scooter': {
            const on = !el.classList.contains('on');
            el.classList.toggle('on', on);
            this.input.setVirtual('ShiftLeft', on);
            return;
          }
          case 'remove':
            this.removeMode = !this.removeMode;
            this.remove.classList.toggle('on', this.removeMode);
            return;
        }
      });
      const up = () => {
        release(el);
        if (el.dataset.tc === 'mine') this.input.setVirtual('Space', false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  }

  private setSheet(open: boolean): void {
    this.sheetOpen = open;
    this.sheet.classList.toggle('hidden', !open);
    this.root.querySelector('.tc-more')?.classList.toggle('on', open);
  }

  // ------------------------------------------------------------------ stick

  private listenStick(): void {
    const move = (e: PointerEvent) => {
      const r = this.stick.getBoundingClientRect();
      const radius = r.width * 0.36;
      let nx = (e.clientX - (r.left + r.width / 2)) / radius;
      let ny = (e.clientY - (r.top + r.height / 2)) / radius;
      const m = Math.hypot(nx, ny);
      if (m > 1) {
        nx /= m;
        ny /= m;
      }
      this.knob.style.transform = `translate(${Math.round(nx * radius)}px, ${Math.round(ny * radius)}px)`;
      this.applyStick(stickKeys(nx, ny));
    };
    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      try {
        this.stick.setPointerCapture(e.pointerId);
      } catch {
        /* capture indisponible */
      }
      this.stick.classList.add('down');
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.classList.remove('down');
      this.knob.style.transform = '';
      this.applyStick({ left: false, right: false, up: false, down: false });
    };
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
    this.stick.addEventListener('lostpointercapture', end);
  }

  private applyStick(k: StickKeys): void {
    const pairs: [string, boolean, boolean][] = [
      ['KeyA', this.stickKeysNow.left, k.left],
      ['KeyD', this.stickKeysNow.right, k.right],
      ['KeyW', this.stickKeysNow.up, k.up],
      ['KeyS', this.stickKeysNow.down, k.down],
    ];
    for (const [code, was, now] of pairs) if (was !== now) this.input.setVirtual(code, now);
    this.stickKeysNow = k;
  }

  // ------------------------------------------------------------------ monde

  /** Doigts sur le monde : un doigt vise (comme la souris), deux doigts zooment. */
  private listenWorld(): void {
    const c = this.canvas;
    const pos = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
    const dist = () => {
      const [a, b] = [...this.fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    c.addEventListener('pointerdown', (e) => {
      if (!this.alive || e.pointerType === 'mouse') return;
      e.preventDefault();
      this.setSheet(false);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* capture indisponible */
      }
      this.fingers.set(e.pointerId, pos(e));
      if (this.fingers.size === 1 && !this.aimLocked) {
        const p = pos(e);
        this.input.touchDown(p.x, p.y, this.removeMode && !!this.ctx?.buildMode);
      } else if (this.fingers.size === 2) {
        // Un deuxième doigt : on arrête de viser, on pince.
        this.input.touchUp();
        this.aimLocked = true;
        this.pinchStart = dist();
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.alive || e.pointerType === 'mouse' || !this.fingers.has(e.pointerId)) return;
      this.fingers.set(e.pointerId, pos(e));
      if (this.fingers.size === 1 && !this.aimLocked) this.input.touchMove(e.clientX, e.clientY);
      else if (this.fingers.size === 2) {
        const step = pinchStep(this.pinchStart, dist());
        if (step !== 0) {
          // La molette de la souris : une valeur négative zoome (voir `Game`).
          this.input.wheel -= step;
          this.pinchStart = dist();
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !this.fingers.delete(e.pointerId)) return;
      if (this.fingers.size === 0) {
        this.input.touchUp();
        this.aimLocked = false;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------------ état

  /** Retire les boutons (réglage « Commandes tactiles : non ») : la souris et le clavier reprennent seuls. */
  destroy(): void {
    this.alive = false;
    this.releaseAll();
    this.input.touchMode = false;
    document.body.classList.remove('touch');
    this.root.remove();
  }

  /** Relâche tout (changement d'application, écran verrouillé) : plus de touche coincée. */
  releaseAll(): void {
    this.input.clearVirtual();
    this.input.touchUp();
    this.fingers.clear();
    this.aimLocked = false;
    this.stickId = null;
    this.stickKeysNow = { left: false, right: false, up: false, down: false };
    this.knob.style.transform = '';
    this.scooter.classList.remove('on');
    for (const el of this.root.querySelectorAll('.down')) el.classList.remove('down');
  }

  /** Met les boutons à jour selon la partie (appelé à chaque image ; le DOM ne bouge que si quelque chose a changé). */
  update(ctx: TouchContext, dt: number): void {
    this.ctx = ctx;
    const show = ctx.playing && !ctx.blocking;
    const sig = [show, ctx.near, ctx.riding, ctx.wagonNear, ctx.hasScooter, ctx.buildMode, ctx.chestMode, ctx.paused, ctx.speed, !!ctx.net, Math.round(ctx.barHeight)].join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.root.classList.toggle('hidden', !show);
      this.root.classList.toggle('building', ctx.buildMode || ctx.chestMode);
      // Le titre et le ✕ de la barre débordent de 12 px au-dessus de son cadre : les boutons montent d'autant.
      this.root.style.setProperty('--bb-h', `${ctx.barHeight > 0 ? Math.round(ctx.barHeight) + BAR_OVERHANG : 0}px`);
      this.act.classList.toggle('lit', ctx.near || ctx.riding);
      this.act.firstElementChild!.textContent = ctx.riding ? 'Descendre' : 'Agir';
      this.wagon.classList.toggle('hidden', !ctx.wagonNear || ctx.riding);
      this.scooter.classList.toggle('hidden', !ctx.hasScooter);
      if (!ctx.hasScooter) this.input.setVirtual('ShiftLeft', false);
      this.build.classList.toggle('hidden', !ctx.buildMode);
      if (!ctx.buildMode && this.removeMode) {
        this.removeMode = false;
        this.remove.classList.remove('on');
      }
      for (const b of this.root.querySelectorAll<HTMLElement>('[data-code="KeyB"]')) b.classList.toggle('on', ctx.buildMode);
      for (const b of this.root.querySelectorAll<HTMLElement>('[data-code="KeyC"]')) b.classList.toggle('on', ctx.chestMode);
      for (const b of this.root.querySelectorAll<HTMLElement>('[data-code="KeyP"]')) b.classList.toggle('on', ctx.paused);
      for (const b of this.root.querySelectorAll<HTMLElement>('[data-code="KeyX"]')) b.classList.toggle('on', ctx.speed > 1);
      for (const b of this.root.querySelectorAll<HTMLElement>('[data-code="KeyP"], [data-code="KeyX"]')) b.classList.toggle('hidden', !!ctx.net);
      if (!show) this.releaseAll();
    }
    // Le bas du cadre en haut à gauche : l'équipement se range dessous (la mise en page tactile en a besoin).
    this.measureT -= dt;
    if (this.measureT <= 0) {
      this.measureT = 0.5;
      const tl = document.querySelector('.hud-tl');
      if (tl) document.documentElement.style.setProperty('--tl-bottom', `${Math.round(tl.getBoundingClientRect().bottom)}px`);
    }
  }
}
