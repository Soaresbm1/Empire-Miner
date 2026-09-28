/**
 * Chef d'orchestre : boucle de jeu à pas fixe, entrées → intentions du joueur,
 * mode construction, événements → sons/effets/messages, menus et sauvegardes.
 */
import { SIM_DT, SURFACE_ROWS, TILE } from '../core/constants';
import { DX, DY, Dir, opposite, rotateCW } from '../core/dir';
import { Input } from '../core/Input';
import { Sfx } from '../audio/Sfx';
import { getBlock } from '../data/blocks';
import { MACHINES, getMachine } from '../data/machines';
import { getResource } from '../data/resources';
import { deserialize, serialize, saveToBrowser, loadFromBrowser, browserSaveInfo, SaveData } from '../save/save';
import { GameState, NO_INTENT, PlayerIntent } from '../sim/GameState';
import { Bridge } from '../sim/structures/Bridge';
import { Building, BUILDING_INFO } from '../sim/structures/Building';
import { Conveyor } from '../sim/structures/Conveyor';
import { Drill } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import { Sorter } from '../sim/structures/Sorter';
import { Rail, RailStation } from '../sim/structures/Rail';
import { Splitter } from '../sim/structures/Splitter';
import { Storage } from '../sim/structures/Storage';
import { Renderer, Overlay } from '../render/Renderer';
import { UI, PanelKind } from '../ui/UI';
import { esc, kg, money, resIcon } from '../ui/format';

const AUTOSAVE_EVERY = 60;
const MENU_SEED = 20260928;

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly ui: UI;
  state: GameState | null = null;
  mode: 'menu' | 'playing' = 'menu';
  private menuState: GameState | null = null;
  private acc = 0;
  private last = 0;
  private buildMode = false;
  private buildIndex = 0;
  private buildDir: Dir = 0;
  private dragLast: { tx: number; ty: number } | null = null;
  private autosave = AUTOSAVE_EVERY;
  private confirmNew = false;
  private lastDeniedToast = -10;
  private ambientTimer = 0;
  private menuPan = 0;
  debug = false;
  private fps = 60;
  /** Ventes automatiques récentes (temps de simulation, montant) pour le revenu par minute. */
  private shipLog: { t: number; total: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.ui = new UI({
      onAction: (a, arg) => this.onAction(a, arg),
      keyLabel: (c) => this.input.label(c),
      moveKeys: () => this.input.moveKeys(),
      machineIcon: (id) => this.renderer.machineIcon(id),
    });
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('beforeunload', () => this.autoSaveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoSaveNow();
    });
    try {
      this.sfx.setMuted(localStorage.getItem('empire-miner.muted') === '1');
    } catch {
      /* stockage indisponible */
    }
  }

  start(): void {
    this.showMainMenu();
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }

  // ------------------------------------------------------------------ parties

  private showMainMenu(): void {
    this.mode = 'menu';
    this.buildMode = false;
    this.ui.closePanel();
    this.ui.showHud(false);
    if (!this.menuState) {
      this.menuState = new GameState(MENU_SEED);
      // Révèle la mine de départ pour le décor du menu.
      const w = this.menuState.world;
      for (let y = 0; y < SURFACE_ROWS + 22; y++) for (let x = 30; x < 70; x++) w.explored[w.idx(x, y)] = 1;
    }
    this.renderer.setState(this.menuState);
    this.ui.showMainMenu(browserSaveInfo(), this.confirmNew);
  }

  newGame(seed = Math.floor(Math.random() * 1e9)): void {
    this.begin(new GameState(seed));
    this.ui.toast('Bienvenue ! Descendez dans la mine par le puits au centre du camp.', 'info');
    this.autoSaveNow();
  }

  private begin(state: GameState): void {
    this.state = state;
    this.mode = 'playing';
    this.acc = 0;
    this.autosave = AUTOSAVE_EVERY;
    this.buildMode = false;
    this.confirmNew = false;
    this.shipLog = [];
    this.renderer.setState(state);
    this.ui.hideMenu();
    this.ui.closePanel();
    this.ui.showHud(true);
    // Première exploration immédiate.
    state.update(0, NO_INTENT);
    state.events.length = 0;
  }

  loadSave(data: SaveData): void {
    this.begin(deserialize(data));
    this.ui.toast('Partie chargée.', 'good');
  }

  private autoSaveNow(): void {
    if (this.mode === 'playing' && this.state) saveToBrowser(this.state);
  }

  private exportSave(): void {
    // L'hébergement « artifact » interdit les téléchargements : l'export n'y est pas proposé.
    if (import.meta.env.MODE === 'artifact' || !this.state) return;
    const blob = new Blob([JSON.stringify(serialize(this.state))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `empire-miner-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.ui.toast('Sauvegarde exportée.', 'good');
  }

  private importSave(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        this.loadSave(JSON.parse(await file.text()));
        this.autoSaveNow();
      } catch (e) {
        this.ui.toast(`Import impossible : ${(e as Error).message}`, 'bad');
      }
    };
    input.click();
  }

  // ------------------------------------------------------------------ actions d'interface

  onAction(action: string, arg: string): void {
    const g = this.state;
    this.sfx.click();
    switch (action) {
      case 'close':
        this.ui.closePanel();
        if (this.mode === 'menu') this.showMainMenu();
        return;
      case 'continue':
        try {
          const s = loadFromBrowser();
          if (s) {
            this.begin(s);
            this.ui.toast('Bon retour à la mine !', 'good');
          }
        } catch (e) {
          this.ui.toast(`Sauvegarde illisible : ${(e as Error).message}`, 'bad');
        }
        return;
      case 'new':
        if (browserSaveInfo() && !this.confirmNew) {
          this.confirmNew = true;
          this.ui.showMainMenu(browserSaveInfo(), true);
          return;
        }
        this.newGame();
        return;
      case 'import':
        this.importSave();
        return;
      case 'help':
        this.ui.openPanel('help');
        if (this.state) this.ui.renderPanel(this.state, 0, true);
        else if (this.menuState) this.ui.renderPanel(this.menuState, 0, true);
        return;
      case 'resume':
        this.ui.hideMenu();
        return;
      case 'save':
        if (g && saveToBrowser(g)) this.ui.toast('Partie sauvegardée.', 'good');
        else this.ui.toast('Impossible de sauvegarder dans ce navigateur. Utilisez l\'export.', 'bad');
        return;
      case 'load':
        try {
          const s = loadFromBrowser();
          if (s) {
            this.begin(s);
            this.ui.toast('Dernière sauvegarde chargée.', 'good');
          } else this.ui.toast('Aucune sauvegarde trouvée.', 'warn');
        } catch (e) {
          this.ui.toast(`Sauvegarde illisible : ${(e as Error).message}`, 'bad');
        }
        return;
      case 'export':
        this.exportSave();
        return;
      case 'mute':
        this.sfx.setMuted(!this.sfx.muted);
        try {
          localStorage.setItem('empire-miner.muted', this.sfx.muted ? '1' : '0');
        } catch {
          /* ignoré */
        }
        this.ui.showPauseMenu(this.sfx.muted);
        return;
      case 'quit':
        this.autoSaveNow();
        this.ui.hideMenu();
        this.showMainMenu();
        return;
      case 'tab':
        this.ui.setTab(arg);
        break;
      case 'selectKit':
        this.buildIndex = Number(arg) || 0;
        return;
    }
    if (!g) return;
    const target = this.ui.panel?.target ?? null;
    switch (action) {
      case 'sell':
        g.sell(arg, g.inventory.count(arg));
        break;
      case 'sellAll':
        g.sellAll();
        break;
      case 'buyPickaxe':
        g.buyNextPickaxe();
        break;
      case 'buyBag':
        g.buyNextBag();
        break;
      case 'buyKit': {
        const [id, q] = arg.split(':');
        g.buyKit(id, Number(q));
        break;
      }
      case 'togglePickup':
        g.autoPickup[arg] = !g.autoPickup[arg];
        break;
      case 'drop':
        g.dropFromInventory(arg, g.inventory.count(arg));
        break;
      case 'storageTake':
        if (target instanceof Storage) g.storageTake(target, arg, target.items[arg] ?? 0);
        break;
      case 'storageTakeAll':
        if (target instanceof Storage) g.storageTakeAll(target);
        break;
      case 'storageDeposit':
        if (target instanceof Storage) g.storageDepositAll(target);
        break;
      case 'shipDeposit':
        if (target instanceof ShippingCrate) {
          const n = g.shipDepositAll(target);
          if (n) this.ui.toast(`${n} minerai${n > 1 ? 's' : ''} déposé${n > 1 ? 's' : ''} : vendu${n > 1 ? 's' : ''} au prochain passage.`, 'good');
        }
        break;
      case 'drillFuel':
        if (target instanceof Drill) {
          const n = g.fuelDrill(target);
          if (n) this.ui.toast(`${n} charbon chargé${n > 1 ? 's' : ''} dans la foreuse.`, 'good');
        }
        break;
      case 'drillCollect':
        if (target instanceof Drill) g.collectDrill(target);
        break;
      case 'drillRotate':
        if (target) g.rotateAt(target.x, target.y);
        break;
      case 'stationDeposit':
        if (target instanceof RailStation) g.stationDepositAll(target);
        break;
      case 'stationTakeAll':
        if (target instanceof RailStation) g.stationTakeAll(target);
        break;
      case 'sorterFilter':
        if (target instanceof Sorter) g.setSorterFilter(target, arg || null);
        break;
    }
    this.flushEvents();
    this.ui.renderPanel(g, 0, true);
  }

  // ------------------------------------------------------------------ boucle

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    try {
      if (this.mode === 'playing' && this.state) this.tickPlaying(dt, this.state);
      else this.tickMenu(dt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private tickMenu(dt: number): void {
    this.menuPan += dt;
    const s = this.menuState;
    if (s) {
      s.update(dt, NO_INTENT);
      s.events.length = 0;
      const cx = 50 * TILE + Math.sin(this.menuPan * 0.08) * 12 * TILE;
      const cy = (SURFACE_ROWS + 4) * TILE + Math.sin(this.menuPan * 0.05) * 6 * TILE;
      this.renderer.lookAt(cx, cy);
    }
    this.renderer.update(dt, false);
    this.renderer.draw({ target: null, ghost: null, removeHint: null, interact: null }, false);
    if (this.input.wasPressed('Escape') && this.ui.panel) {
      this.ui.closePanel();
      this.showMainMenu();
    }
  }

  private tickPlaying(dt: number, g: GameState): void {
    const inp = this.input;
    const paused = this.ui.menu === 'pause';

    // --- touches globales
    if (inp.wasPressed('Escape')) {
      if (this.ui.panel) this.ui.closePanel();
      else if (paused) this.ui.hideMenu();
      else if (this.buildMode) this.setBuildMode(false);
      else this.ui.showPauseMenu(this.sfx.muted);
    }
    if (inp.wasPressed('F3')) this.debug = !this.debug;
    if (!paused) {
      if (inp.wasPressed('KeyE')) {
        if (this.ui.panel) this.ui.closePanel();
        else if (g.riding) g.leaveWagon();
        else this.interact(g);
      }
      if (inp.wasPressed('KeyF') && !this.ui.panel) {
        if (g.riding) g.leaveWagon();
        else {
          const w = g.nearestWagon();
          if (w) {
            this.setBuildMode(false);
            g.rideWagon(w);
          }
        }
      }
      if (inp.wasPressed('KeyI', 'Tab')) this.togglePanel('inventory');
      if (inp.wasPressed('KeyH', 'F1')) this.togglePanel('help');
      if (inp.wasPressed('KeyB') && !this.ui.panel) this.setBuildMode(!this.buildMode);
    }
    if (inp.wheel && !this.ui.blocking) this.renderer.adjustZoom(-inp.wheel);

    // --- intention du joueur
    const overUI = this.ui.isOverUI(inp.mouseX, inp.mouseY);
    const mouseActive = inp.mouseInside && !overUI && !this.ui.blocking;
    const wpos = this.renderer.screenToWorld(inp.mouseX, inp.mouseY);
    const mtx = Math.floor(wpos.x / TILE);
    const mty = Math.floor(wpos.y / TILE);
    let intent: PlayerIntent = NO_INTENT;
    const overlay: Overlay = { target: null, ghost: null, removeHint: null, interact: null };
    let tooltip: string | null = null;

    if (!this.ui.blocking) {
      const mx = (inp.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
      const my = (inp.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (inp.isDown('KeyW', 'ArrowUp') ? 1 : 0);
      let target: { tx: number; ty: number } | null = null;
      let mine = false;
      if (this.buildMode) {
        this.updateBuild(g, mtx, mty, mouseActive, overlay);
      } else {
        if (mouseActive && g.world.isSolid(mtx, mty) && g.distanceToTile(mtx, mty) <= g.pickaxe.reach + 2.5) {
          const b = getBlock(g.world.get(mtx, mty));
          const inReach = g.canReach(mtx, mty);
          overlay.target = { tx: mtx, ty: mty, ok: inReach && b.breakable && b.tier <= g.pickaxe.tier };
          if (inReach) target = { tx: mtx, ty: mty };
          mine = inp.left && inReach;
        }
        if (inp.isDown('Space')) {
          const p = g.player;
          const ftx = Math.floor((p.x + DX[p.facing] * 11) / TILE);
          const fty = Math.floor((p.y - 3 + DY[p.facing] * 11) / TILE);
          if (g.canReach(ftx, fty)) {
            target = { tx: ftx, ty: fty };
            mine = true;
            const b = getBlock(g.world.get(ftx, fty));
            overlay.target = { tx: ftx, ty: fty, ok: b.breakable && b.tier <= g.pickaxe.tier };
          }
        }
      }
      intent = { mx, my, mine, target };
      if (mouseActive) tooltip = this.describeTile(g, mtx, mty);
    }
    const near = g.nearestInteractable();
    if (!this.ui.blocking && near) overlay.interact = near;

    // --- simulation (pas fixe)
    if (!paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 8) {
        g.update(SIM_DT, intent);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      this.flushEvents();
      this.autosave -= dt;
      if (this.autosave <= 0) {
        this.autosave = AUTOSAVE_EVERY;
        if (saveToBrowser(g)) this.ui.flashSaved();
      }
    }

    // Ferme le panneau si le joueur s'est éloigné de la structure.
    const panel = this.ui.panel;
    if (panel?.target && (g.nearestInteractable() !== panel.target || !g.structures.list.includes(panel.target))) this.ui.closePanel();
    this.ui.renderPanel(g, dt);

    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 0.25;
      this.sfx.setDepth(g.playerDepth());
    }

    // --- rendu
    this.renderer.update(dt, true);
    this.renderer.draw(overlay);
    this.ui.setTooltip(tooltip, inp.mouseX, inp.mouseY);
    this.ui.updateHud(g, {
      prompt: this.promptText(g, near),
      build: this.buildBarHtml(g),
      hints: this.hintsHtml(),
      income: this.incomeHtml(g),
    });
    if (this.debug) this.drawDebug(g);
  }

  private togglePanel(kind: PanelKind): void {
    if (this.ui.panel?.kind === kind) this.ui.closePanel();
    else {
      this.setBuildMode(false);
      this.ui.openPanel(kind);
    }
  }

  private interact(g: GameState): void {
    const s = g.nearestInteractable();
    if (!s) return;
    this.setBuildMode(false);
    if (s instanceof Building) this.ui.openPanel(s.type === 'counter' ? 'counter' : 'workshop', s, 'tools');
    else if (s instanceof Storage) this.ui.openPanel('storage', s);
    else if (s instanceof ShippingCrate) this.ui.openPanel('shipping', s);
    else if (s instanceof Drill) this.ui.openPanel('drill', s);
    else if (s instanceof Sorter) this.ui.openPanel('sorter', s);
    else if (s instanceof RailStation) this.ui.openPanel('station', s);
  }

  /** Invite d'action : structure proche (E) et wagonnet (F). */
  private promptText(g: GameState, near: ReturnType<GameState['nearestInteractable']>): string {
    if (this.ui.blocking) return '';
    const f = `<kbd>${this.input.label('KeyF')}</kbd>`;
    if (g.riding) return `${f} Descendre du wagonnet`;
    const main = this.structurePrompt(near);
    const wagon = g.nearestWagon() ? `${f} Monter dans le wagonnet` : '';
    return [main, wagon].filter(Boolean).join(' &nbsp;·&nbsp; ');
  }

  private structurePrompt(near: ReturnType<GameState['nearestInteractable']>): string {
    if (!near) return '';
    const e = `<kbd>${this.input.label('KeyE')}</kbd>`;
    if (near instanceof Building) return `${e} ${BUILDING_INFO[near.type].name} — ${BUILDING_INFO[near.type].prompt}`;
    if (near instanceof Storage) return `${e} Ouvrir le coffre`;
    if (near instanceof ShippingCrate) return `${e} Caisse d'expédition — vente automatique`;
    if (near instanceof Drill) return `${e} Foreuse — charbon et production`;
    if (near instanceof Sorter) return `${e} Trieur — choisir le minerai trié`;
    if (near instanceof RailStation) return `${e} ${near.def.name}`;
    return '';
  }

  /** Revenu des ventes automatiques sur la dernière minute. */
  private incomeHtml(g: GameState): string {
    if (g.stats.autoSold <= 0) return '';
    this.shipLog = this.shipLog.filter((s) => s.t > g.time - 60);
    const perMin = this.shipLog.reduce((sum, s) => sum + s.total, 0);
    return `Vente auto : +${money(perMin)} / min`;
  }

  private hintsHtml(): string {
    const l = (c: string) => this.input.label(c);
    return `<span><kbd>${l('KeyB')}</kbd> Construire</span><span><kbd>${l('KeyI')}</kbd> Sac</span><span><kbd>${l('KeyH')}</kbd> Aide</span><span><kbd>Échap</kbd> Menu</span>`;
  }

  // ------------------------------------------------------------------ construction

  private availableKits(g: GameState): string[] {
    return MACHINES.map((m) => m.id).filter((id) => g.inventory.kitCount(id) > 0);
  }

  private setBuildMode(on: boolean): void {
    if (on && this.state && !this.availableKits(this.state).length) {
      this.ui.toast("Vous n'avez aucune machine. Achetez-en à l'Atelier (surface).", 'warn');
      this.sfx.error();
      return;
    }
    this.buildMode = on;
    this.dragLast = null;
  }

  private updateBuild(g: GameState, mtx: number, mty: number, mouseActive: boolean, overlay: Overlay): void {
    const inp = this.input;
    const kits = this.availableKits(g);
    if (!kits.length) {
      this.setBuildMode(false);
      return;
    }
    for (let i = 0; i < Math.min(9, kits.length); i++) if (inp.wasPressed(`Digit${i + 1}`)) this.buildIndex = i;
    this.buildIndex = Math.min(this.buildIndex, kits.length - 1);
    const machine = kits[this.buildIndex];
    const existing = g.structures.at(mtx, mty);
    for (let k = inp.pressCount('KeyR'); k > 0; k--) {
      if (existing && existing.removable && getMachine(existing.type).rotatable) g.rotateAt(mtx, mty);
      else this.buildDir = rotateCW(this.buildDir);
    }
    if (!mouseActive) {
      this.dragLast = null;
      return;
    }
    const mdef = getMachine(machine);
    // Convoyeurs et rails se tracent en glissant.
    const isBelt = !!mdef.conveyor || !!mdef.dragPlace;
    // Un convoyeur d'un autre niveau sous le curseur peut être remplacé (amélioration sur place).
    const upgrade = g.beltToReplace(machine, mtx, mty);
    // Un wagonnet se pose sur la voie.
    const onRail = !!mdef.onTrack && !!existing?.isTrack;
    if (existing && existing.removable && !upgrade && !onRail) overlay.removeHint = { tx: mtx, ty: mty };
    else {
      overlay.ghost = { machine, tx: mtx, ty: mty, dir: upgrade ? upgrade.dir : this.buildDir, ok: g.canPlace(machine, mtx, mty).ok };
      if (getMachine(machine).bridge) {
        const entry = this.bridgeEntryFor(g, mtx, mty, this.buildDir);
        if (entry) overlay.ghost.link = { tx: entry.x, ty: entry.y };
      }
    }

    // Démontage : clic droit (maintenu, ou clic très bref entre deux images).
    if ((inp.consumeRightPress() || inp.right) && existing && existing.removable) g.removeAt(mtx, mty);

    // Pose.
    if (inp.consumeLeftPress()) {
      if (!existing || upgrade || onRail) this.tryPlace(g, machine, mtx, mty, upgrade ? upgrade.dir : this.buildDir);
      this.dragLast = isBelt ? { tx: mtx, ty: mty } : null;
    } else if (inp.left && this.dragLast && isBelt && (mtx !== this.dragLast.tx || mty !== this.dragLast.ty)) {
      // Tracé de convoyeurs en glissant : chaque tuile pointe vers la suivante.
      let { tx, ty } = this.dragLast;
      let guard = 0;
      while ((tx !== mtx || ty !== mty) && guard++ < 40) {
        const dx = mtx - tx;
        const dy = mty - ty;
        const dir: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        const prev = g.structures.at(tx, ty);
        if (prev instanceof Conveyor) {
          prev.dir = dir;
          g.structures.invalidate();
        }
        tx += DX[dir];
        ty += DY[dir];
        this.buildDir = dir;
        const occupant = g.structures.at(tx, ty);
        if ((!occupant || g.beltToReplace(machine, tx, ty)) && !this.tryPlace(g, machine, tx, ty, dir, true)) break;
      }
      this.dragLast = { tx, ty };
    } else if (!inp.left) this.dragLast = null;
  }

  /** Pont d'entrée libre (derrière, même direction, à portée, sans roche) auquel un pont posé ici se relierait. */
  private bridgeEntryFor(g: GameState, tx: number, ty: number, dir: Dir): Bridge | null {
    const back = opposite(dir);
    const range = getMachine('bridge').bridge?.range ?? 5;
    for (let k = 1; k <= range; k++) {
      const x = tx + DX[back] * k;
      const y = ty + DY[back] * k;
      if (!g.world.inBounds(x, y) || g.world.isSolid(x, y)) return null;
      const s = g.structures.at(x, y);
      if (s instanceof Bridge && s.dir === dir) return !s.target && !s.source ? s : null;
    }
    return null;
  }

  private tryPlace(g: GameState, machine: string, tx: number, ty: number, dir: Dir, quiet = false): boolean {
    const check = g.canPlace(machine, tx, ty);
    if (!check.ok) {
      if (!quiet) {
        this.ui.toast(check.reason ?? 'Impossible ici', 'warn');
        this.sfx.error();
      }
      return false;
    }
    g.place(machine, tx, ty, dir);
    if (!this.availableKits(g).includes(machine)) this.buildIndex = 0;
    return true;
  }

  private buildBarHtml(g: GameState): string {
    if (!this.buildMode) return '';
    const kits = this.availableKits(g);
    const arrows = ['→', '↓', '←', '↑'];
    const items = kits
      .map((id, i) => {
        const m = getMachine(id);
        return `<div class="kit ${i === this.buildIndex ? 'sel' : ''}" data-action="selectKit" data-arg="${i}"><kbd>${i + 1}</kbd><b>${m.name}</b><span>×${g.inventory.kitCount(id)}</span></div>`;
      })
      .join('');
    const l = (c: string) => this.input.label(c);
    return `<div class="buildbar hud-box"><div class="build-title">Construction · direction ${arrows[this.buildDir]}</div><div class="kits-row">${items}</div>
      <div class="build-help"><kbd>Clic</kbd> poser (glisser = ligne) · <kbd>Clic droit</kbd> démonter · <kbd>${l('KeyR')}</kbd> tourner · <kbd>${l('KeyB')}</kbd>/<kbd>Échap</kbd> quitter</div></div>`;
  }

  // ------------------------------------------------------------------ infos

  private describeTile(g: GameState, tx: number, ty: number): string | null {
    const w = g.world;
    if (!w.inBounds(tx, ty) || !w.explored[w.idx(tx, ty)]) return null;
    const wagon = g.wagons.at(tx, ty);
    if (wagon)
      return `<b>Wagonnet</b> — ${wagon.stopped ? "à l'arrêt" : 'en route'}${wagon.rider ? ' · vous êtes à bord' : ''}<br>Chargement : ${kg(wagon.weight())} / ${kg(
        wagon.capacity,
      )} · ${wagon.delivered} minerai(s) livré(s)<br><span class="muted">[${this.input.label('KeyF')}] monter / descendre</span>`;
    const s = g.structures.at(tx, ty);
    if (s instanceof RailStation)
      return `<b>${s.def.name}</b><br>${kg(s.weight())} / ${kg(s.capacity)} en attente<br><span class="muted">[${this.input.label('KeyE')}] ouvrir</span>`;
    if (s instanceof Rail) return `<b>Rails</b><br><span class="muted">Posez-y un wagonnet ; il fait l'aller-retour jusqu'aux bouts de la ligne.</span>`;
    if (s instanceof Conveyor) {
      const load = s.items.length;
      return `<b>${s.def.name}</b> ${['→', '↓', '←', '↑'][s.dir]}<br>${load}/${s.capacity} objets · ${s.speed.toLocaleString('fr-FR')} tuile/s${
        s.blocked ? ' · <span class="bad">saturé</span>' : ''
      }`;
    }
    if (s instanceof Sorter)
      return `<b>Trieur</b> ${['→', '↓', '←', '↑'][s.dir]}<br>${
        s.filter ? `${resIcon(s.filter)} ${getResource(s.filter).name} tout droit · le reste sur les côtés` : 'Aucun filtre : tout va tout droit'
      }<br><span class="muted">[E] pour régler</span>`;
    if (s instanceof Splitter)
      return `<b>Séparateur</b> ${['→', '↓', '←', '↑'][s.dir]}<br>Entrée par l'arrière · sorties : devant, gauche, droite (à tour de rôle)${
        s.blocked ? '<br><span class="bad">toutes les sorties sont bloquées</span>' : ''
      }`;
    if (s instanceof Bridge) {
      const arrow = ['→', '↓', '←', '↑'][s.dir];
      if (s.target) return `<b>Pont de convoyeur</b> ${arrow} — entrée<br>Relié à la sortie ${s.span()} cases plus loin · ${s.transit.length} objet(s) en l'air`;
      if (s.source) return `<b>Pont de convoyeur</b> ${arrow} — sortie<br>Pose le minerai devant lui`;
      return `<b>Pont de convoyeur</b> ${arrow} — non relié<br><span class="muted">Posez un second pont dans la même direction, jusqu'à ${s.range} cases devant</span>`;
    }
    if (s instanceof Drill) {
      const st = { ok: 'en marche', nofuel: 'sans charbon', full: 'sortie bloquée', depleted: 'gisement épuisé' }[s.status];
      return `<b>Foreuse</b> — ${st}<br>Charbon : ${s.fuelUnits} · extrait : ${s.extracted}`;
    }
    if (s instanceof Storage) return `<b>Coffre</b><br>${kg(s.weight())} / ${kg(s.capacity)}`;
    if (s instanceof ShippingCrate)
      return `<b>Caisse d'expédition</b><br>${kg(s.weight())} / ${kg(s.capacity)} · ${money(s.pendingValue())} en attente<br>Passage dans ${Math.ceil(s.timer)} s`;
    if (s instanceof Building) return `<b>${s.name}</b>`;
    const id = w.get(tx, ty);
    const b = getBlock(id);
    if (b.solid) {
      if (!b.breakable) return `<b>${b.name}</b><br><span class="muted">Indestructible</span>`;
      const dmg = w.damage.get(w.idx(tx, ty)) ?? 0;
      const tooHard = b.tier > g.pickaxe.tier;
      const drop = b.drop ? `${resIcon(b.drop.res)} ${getResource(b.drop.res).name}${b.drop.chance < 1 ? ' (parfois)' : ''}` : '';
      return `<b>${esc(b.name)}</b> ${drop}<br>Résistance ${Math.max(0, b.hp - dmg)}/${b.hp} · niveau ${b.tier}${
        tooHard ? `<br><span class="bad">Pioche trop faible (niveau ${b.tier} requis)</span>` : ''
      }`;
    }
    const dep = w.depositAt(tx, ty);
    if (dep) return `<b>Gisement de ${getResource(dep).name.toLowerCase()}</b><br>Réserve : ${w.reserve[w.idx(tx, ty)]} unités<br><span class="muted">Posez une foreuse dessus</span>`;
    return null;
  }

  // ------------------------------------------------------------------ événements

  private flushEvents(): void {
    const g = this.state;
    if (!g) return;
    const r = this.renderer;
    for (const e of g.events) {
      switch (e.t) {
        case 'swing':
          this.sfx.swing();
          break;
        case 'hit':
          this.sfx.hit(getBlock(e.block).tier);
          r.onHit(e.tx, e.ty, e.block, g.player.x, g.player.y);
          break;
        case 'break':
          this.sfx.break();
          r.onBreak(e.tx, e.ty, e.block);
          break;
        case 'denied':
          this.sfx.denied();
          r.onDenied(e.tx, e.ty, g.player.x, g.player.y);
          if (g.time - this.lastDeniedToast > 2.5) {
            this.lastDeniedToast = g.time;
            this.ui.toast(e.need >= 99 ? 'Cette roche est indestructible.' : `Trop dur ! Il faut une pioche de niveau ${e.need}.`, 'warn');
          }
          break;
        case 'pickup':
          this.sfx.pickup();
          r.onPickup(e.res, e.n, e.x, e.y);
          break;
        case 'invFull':
          this.sfx.error();
          this.ui.toast('Sac plein ! Vendez au comptoir ou videz-le dans un coffre.', 'warn');
          break;
        case 'sold':
          this.sfx.sell();
          r.fx.text(`+${money(e.total)}`, g.player.x, g.player.y - 20, '#f2c230');
          r.fx.emit('spark', g.player.x, g.player.y - 12, '#f2c230', 12, 50);
          this.ui.toast(`Vendu ${e.n} minerai${e.n > 1 ? 's' : ''} pour ${money(e.total)}.`, 'good');
          break;
        case 'shipped': {
          this.shipLog.push({ t: g.time, total: e.total });
          r.onShipped(e.tx, e.ty, `+${money(e.total)}`);
          this.ui.pulseMoney();
          if (g.distanceToTile(e.tx, e.ty) < 16) this.sfx.coins();
          break;
        }
        case 'bought':
          this.sfx.buy();
          this.ui.toast(`Acheté : ${e.name}`, 'good');
          this.autoSaveNow();
          break;
        case 'placed':
          this.sfx.place();
          r.fx.emit('dust', (e.tx + 0.5) * TILE, (e.ty + 0.8) * TILE, 'rgba(160,150,130,0.5)', 5, 20);
          break;
        case 'removed':
          this.sfx.remove();
          break;
        case 'extract':
          r.fx.emit('chip', (e.tx + 0.5) * TILE, (e.ty + 0.5) * TILE, getResource(e.res).color, 2, 25);
          break;
        case 'discover':
          this.sfx.discover();
          this.ui.toast(e.text, 'good');
          break;
        case 'message':
          this.ui.toast(e.text, e.kind);
          break;
      }
    }
    g.events.length = 0;
  }

  private drawDebug(g: GameState): void {
    const ctx = this.renderer.canvas.getContext('2d')!;
    const H = 170;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, H - 60, 420, 50);
    ctx.fillStyle = '#9f9';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    const belts = g.structures.list.filter((s) => s instanceof Conveyor) as Conveyor[];
    const items = belts.reduce((s, b) => s + b.items.length, 0);
    ctx.fillText(`FPS ${this.fps.toFixed(0)} · tuile ${g.player.tileX},${g.player.tileY} · drops ${g.drops.list.length}`, 16, H - 40);
    ctx.fillText(`structures ${g.structures.list.length} · objets sur convoyeurs ${items} · zoom ${this.renderer.zoom}`, 16, H - 22);
  }
}
