/**
 * Chef d'orchestre : boucle de jeu à pas fixe, entrées → intentions du joueur,
 * mode construction, événements → sons/effets/messages, menus et sauvegardes.
 */
import { SIM_DT, SURFACE_ROWS, TILE } from '../core/constants';
import { DX, DY, Dir, opposite, rotateCW } from '../core/dir';
import { Input } from '../core/Input';
import { Sfx } from '../audio/Sfx';
import { getBlock } from '../data/blocks';
import { MACHINES, MACHINE_GROUPS, MachineDef, getMachine, kitName, parseKit } from '../data/machines';
import { getResource } from '../data/resources';
import { deserialize, serialize, saveToBrowser, loadFromBrowser, browserSaveInfo, SaveData } from '../save/save';
import { GameState, NO_INTENT, PlayerIntent } from '../sim/GameState';
import { Bridge } from '../sim/structures/Bridge';
import { Building, BUILDING_INFO } from '../sim/structures/Building';
import { Conveyor } from '../sim/structures/Conveyor';
import { TunnelBorer } from '../sim/structures/Borer';
import { Smelter } from '../sim/structures/Smelter';
import { MARKER_KINDS, MarkerKind } from '../sim/Markers';
import { Fan, Prop, Pump } from '../sim/structures/Safety';
import { CAVE_IN, GAS, HEAT, WATER } from '../data/hazards';
import { Drill, reachTiles } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import { Sorter } from '../sim/structures/Sorter';
import { WORKSHOP_TABS } from '../ui/workshop';
import { Rail, RailStation, RailSwitch, type SwitchSetting } from '../sim/structures/Rail';
import { Splitter } from '../sim/structures/Splitter';
import { Storage } from '../sim/structures/Storage';
import { MineMap } from '../render/MineMap';
import { PROFILES, Quality, loadQuality, nextQuality, saveQuality } from '../render/quality';
import { Renderer, Overlay } from '../render/Renderer';
import { UI, PanelKind } from '../ui/UI';
import { esc, kg, money, resIcon } from '../ui/format';

const AUTOSAVE_EVERY = 60;
const MENU_SEED = 20260928;

export class Game {
  readonly renderer: Renderer;
  /** Mini-carte du HUD et carte complète (touche M). */
  readonly map = new MineMap();
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly ui: UI;
  state: GameState | null = null;
  mode: 'menu' | 'playing' = 'menu';
  private menuState: GameState | null = null;
  private acc = 0;
  private last = 0;
  private buildMode = false;
  /** Kit choisi et onglet de la barre de construction. */
  private buildKit: string | null = null;
  private buildCat: string | null = null;
  private buildDir: Dir = 0;
  /** Ce que ferait un clic là où vise la souris (ligne d'état de la barre de construction). */
  private buildHover: { tone: 'ok' | 'bad' | 'remove'; text: string } | null = null;
  /** Hauteur de la barre de construction (la plus grande de la session) : la caméra remonte d'autant. */
  private buildInset = 0;
  private dragLast: { tx: number; ty: number } | null = null;
  private autosave = AUTOSAVE_EVERY;
  private confirmNew = false;
  private lastDeniedToast = -10;
  private ambientTimer = 0;
  private menuPan = 0;
  debug = false;
  private fps = 60;
  private quality: Quality = loadQuality();
  /** Ventes automatiques récentes (temps de simulation, montant) pour le revenu par minute. */
  private shipLog: { t: number; total: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(this.quality);
    this.input = new Input(canvas);
    this.ui = new UI({
      onAction: (a, arg) => this.onAction(a, arg),
      keyLabel: (c) => this.input.label(c),
      moveKeys: () => this.input.moveKeys(),
      machineIcon: (id) => this.renderer.machineIcon(id),
    });
    this.ui.setMenuMotes(PROFILES[this.quality].menuMotes);
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
        this.ui.showPauseMenu(this.sfx.muted, this.quality);
        return;
      case 'quality':
        this.quality = nextQuality(this.quality);
        saveQuality(this.quality);
        this.renderer.setQuality(this.quality);
        this.ui.setMenuMotes(PROFILES[this.quality].menuMotes);
        this.ui.showPauseMenu(this.sfx.muted, this.quality);
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
        this.buildKit = arg;
        this.buildCat = null;
        return;
      case 'buildCat':
        this.buildCat = arg;
        return;
      case 'buildRotate':
        this.buildDir = rotateCW(this.buildDir);
        return;
      case 'buildClose':
        this.setBuildMode(false);
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
      case 'buyJackhammer':
        g.buyJackhammer();
        break;
      case 'buyGear':
        g.buyGear(arg);
        break;
      case 'buyScooter':
        g.buyScooter();
        break;
      case 'buyRope':
        g.buyRope(Number(arg) || 1);
        break;
      case 'shopCat':
        this.ui.setShopCat(arg);
        break;
      case 'shopOnly':
        this.ui.toggleShopOnly();
        break;
      case 'shopMore':
        this.ui.toggleShopDetail(arg);
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
      case 'borerFuel':
        if (target instanceof TunnelBorer) {
          const n = g.fuelBorer(target);
          if (n) this.ui.toast(`${n} charbon chargé${n > 1 ? 's' : ''} dans la base de la foreuse de percement.`, 'good');
        }
        break;
      case 'borerStart':
        if (target instanceof TunnelBorer) target.start();
        break;
      case 'borerStop':
        if (target instanceof TunnelBorer) target.stop();
        break;
      case 'borerLength':
        if (target instanceof TunnelBorer) g.setBorerLength(target, Number(arg));
        break;
      case 'smelterFuel':
        if (target instanceof Smelter) {
          const n = g.fuelSmelter(target);
          if (n) this.ui.toast(`${n} charbon chargé${n > 1 ? 's' : ''} dans le ${target.def.name.toLowerCase()}.`, 'good');
        }
        break;
      case 'smelterDeposit':
        if (target instanceof Smelter) {
          const n = g.smelterDeposit(target);
          if (n) this.ui.toast(`${n} minerai${n > 1 ? 's' : ''} déposé${n > 1 ? 's' : ''} à fondre.`, 'good');
        }
        break;
      case 'smelterCollect':
        if (target instanceof Smelter) {
          const n = g.smelterCollect(target);
          if (n) this.ui.toast(`${n} lingot${n > 1 ? 's' : ''} récupéré${n > 1 ? 's' : ''}.`, 'good');
        }
        break;
      case 'smelterRotate':
        if (target) g.rotateAt(target.x, target.y);
        break;
      case 'borerUpgrade':
        if (target instanceof TunnelBorer) g.upgradeMachine(target);
        break;
      case 'borerCollect':
        if (target instanceof TunnelBorer) {
          const n = g.collectBorer(target);
          if (n) this.ui.toast(`${n} minerai${n > 1 ? 's' : ''} récupéré${n > 1 ? 's' : ''} dans la base.`, 'good');
        }
        break;
      case 'borerRotate':
        if (target) g.rotateAt(target.x, target.y);
        break;
      case 'openMap':
        this.togglePanel('map');
        break;
      case 'markerKind':
        if (arg in MARKER_KINDS) g.markerKind = arg as MarkerKind;
        break;
      case 'markHere':
        this.markHere(g);
        break;
      case 'mapClick': {
        const [px, py] = arg.split(',').map(Number);
        const t = this.map.tileAt(px, py);
        if (!t) break;
        const m = g.addMarker(g.markerKind, t.x, t.y);
        if (m) this.ui.toast(`Repère posé : ${m.label}.`, 'good');
        else this.ui.toast(g.markers.full ? 'Trop de repères : supprimez-en un dans la liste.' : 'Hors de la carte.', 'warn');
        break;
      }
      case 'markerTrack':
        g.markers.toggleTrack(Number(arg));
        break;
      case 'markerDelete':
        g.markers.remove(Number(arg));
        break;
      case 'drillUpgrade':
        if (target instanceof Drill) g.upgradeMachine(target);
        break;
      case 'stationDeposit':
        if (target instanceof RailStation) g.stationDepositAll(target);
        break;
      case 'stationTakeAll':
        if (target instanceof RailStation) g.stationTakeAll(target);
        break;
      case 'switchSet':
        if (target instanceof RailSwitch) g.setSwitch(target, arg as SwitchSetting);
        break;
      case 'switchRotate':
        if (target) g.rotateAt(target.x, target.y);
        break;
      case 'sorterFilter':
        // « Aucun » vide la liste ; un minerai s'ajoute ou se retire (on peut en choisir plusieurs).
        if (target instanceof Sorter) arg ? g.toggleSorterFilter(target, arg) : g.setSorterFilter(target, null);
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
      else this.ui.showPauseMenu(this.sfx.muted, this.quality);
    }
    // Atelier ouvert : 1 à 4 (ou les flèches) changent d'onglet.
    if (this.ui.panel?.kind === 'workshop' && !paused) {
      WORKSHOP_TABS.forEach(([id], i) => inp.wasPressed(`Digit${i + 1}`, `Numpad${i + 1}`) && this.ui.setTab(id));
      if (inp.wasPressed('ArrowRight')) this.ui.cycleTab(1);
      if (inp.wasPressed('ArrowLeft')) this.ui.cycleTab(-1);
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
      if (inp.wasPressed('KeyI')) this.togglePanel('inventory');
      // Tab : onglet suivant en construction (Maj+Tab : précédent), sinon le sac.
      if (inp.wasPressed('Tab')) {
        if (this.buildMode && !this.ui.panel) this.cycleBuildCat(g, inp.isDown('ShiftLeft', 'ShiftRight') ? -1 : 1);
        else this.togglePanel('inventory');
      }
      if (inp.wasPressed('KeyH', 'F1')) this.togglePanel('help');
      // M : la lettre M du clavier, où qu'elle soit (AZERTY, QWERTY…).
      if (inp.wasTyped('m')) this.togglePanel('map');
      if (inp.wasTyped('n') && !this.ui.panel) this.markHere(g);
      if (inp.wasPressed('KeyB') && !this.ui.panel) this.setBuildMode(!this.buildMode);
      if (inp.wasPressed('KeyT') && !this.ui.panel) g.toggleTool();
      // V : corde de rappel (remonter au camp depuis la mine, redescendre au point d'accroche depuis le camp).
      if (inp.wasPressed('KeyV') && !this.ui.panel && !this.buildMode) g.useRope();
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
      intent = { mx, my, mine, target, ride: inp.isDown('ShiftLeft', 'ShiftRight') };
      // En construction, la ligne d'état de la barre remplace l'infobulle.
      if (mouseActive && !this.buildMode) tooltip = this.describeTile(g, mtx, mty);
    }
    const near = g.nearestInteractable();
    if (!this.ui.blocking && near) overlay.interact = near;
    // Cases forées par la foreuse proche, ou par celle que vise la souris en mode construction.
    const hovered = this.buildMode && mouseActive ? g.structures.at(mtx, mty) : undefined;
    const reach = hovered instanceof Drill ? hovered : near instanceof Drill ? near : null;
    if (!this.ui.blocking && reach) overlay.reach = reach;

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

    // Cartes : mini-carte du HUD et, si elle est ouverte, carte complète.
    const now = performance.now() / 1000;
    this.map.update(g, dt);
    const mini = document.getElementById('minimap');
    if (mini instanceof HTMLCanvasElement) this.map.drawMini(mini, g, now);
    const full = this.ui.panel?.kind === 'map' ? document.getElementById('map-canvas') : null;
    if (full instanceof HTMLCanvasElement) this.map.drawFull(full, g, now);

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
    // La barre cache le bas de l'écran : on garde le joueur au centre de ce qui reste visible.
    this.buildInset = this.buildMode ? Math.max(this.buildInset, this.ui.buildBarHeight) : 0;
    this.renderer.bottomInset = this.buildInset;
    if (this.debug) this.drawDebug(g);
  }

  /** Pose un repère là où se trouve le joueur (touche N). */
  private markHere(g: GameState): void {
    const m = g.addMarker(g.markerKind, g.player.tileX, g.player.tileY);
    if (m) {
      this.sfx.place();
      this.ui.toast(`Repère posé : ${m.label} (carte : M).`, 'good');
    } else this.ui.toast('Trop de repères : supprimez-en un depuis la carte (M).', 'warn');
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
    if (s instanceof Building) this.ui.openPanel(s.type === 'counter' ? 'counter' : s.type === 'board' ? 'board' : 'workshop', s);
    else if (s instanceof Storage) this.ui.openPanel('storage', s);
    else if (s instanceof ShippingCrate) this.ui.openPanel('shipping', s);
    else if (s instanceof Drill) this.ui.openPanel('drill', s);
    else if (s instanceof TunnelBorer) this.ui.openPanel('borer', s);
    else if (s instanceof Smelter) this.ui.openPanel('furnace', s);
    else if (s instanceof Sorter) this.ui.openPanel('sorter', s);
    else if (s instanceof RailStation) this.ui.openPanel('station', s);
    else if (s instanceof RailSwitch) this.ui.openPanel('switch', s);
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
    if (near instanceof Drill) return `${e} Foreuse niv. ${near.level} — charbon, production, amélioration`;
    if (near instanceof TunnelBorer) return `${e} Foreuse de percement niv. ${near.level} — charbon, départ, améliorations`;
    if (near instanceof Smelter) return `${e} ${near.def.name} — charbon, minerai, lingots`;
    if (near instanceof Sorter) return `${e} Trieur — choisir le minerai trié`;
    if (near instanceof RailStation) return `${e} ${near.def.name}`;
    if (near instanceof RailSwitch) return `${e} Aiguillage — choisir la branche`;
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
    const g = this.state;
    const rope = g && (g.ropes > 0 || g.ropeAnchor) ? `<span${g.ropeT > 0 ? ' class="on"' : ''}><kbd>${l('KeyV')}</kbd> ${g.atCamp ? (g.ropeAnchor ? 'Redescendre' : 'Corde') : 'Remonter'}${g.ropes > 0 ? ` <b>×${g.ropes}</b>` : ''}</span>` : '';
    const scooter = this.state?.hasScooter ? `<span${this.state.scootering ? ' class="on"' : ''}><kbd>Maj</kbd> Trottinette</span>` : '';
    return `${rope}${scooter}<span><kbd>${l('KeyB')}</kbd> Construire</span><span><kbd>${l('KeyI')}</kbd> Sac</span><span><kbd>M</kbd> Carte</span><span><kbd>N</kbd> Repère</span><span><kbd>${l('KeyH')}</kbd> Aide</span><span><kbd>Échap</kbd> Menu</span>`;
  }

  // ------------------------------------------------------------------ construction

  /** Kits en stock, dans l'ordre du magasin ; une machine améliorée suit sa version de base. */
  private availableKits(g: GameState): string[] {
    const rank = (kit: string) => {
      const { machine, level } = parseKit(kit);
      return MACHINES.findIndex((m) => m.id === machine) * 10 + level;
    };
    return Object.keys(g.inventory.kits)
      .filter((kit) => g.inventory.kitCount(kit) > 0 && MACHINES.some((m) => m.id === parseKit(kit).machine))
      .sort((a, b) => rank(a) - rank(b));
  }

  /** Kits en stock rangés par onglet (ordre du magasin), sans les onglets vides. */
  private kitGroups(g: GameState): { id: string; tab: string; icon: string; kits: string[] }[] {
    const kits = this.availableKits(g);
    return MACHINE_GROUPS.map((grp) => ({
      id: grp.id,
      tab: grp.tab,
      icon: grp.icon,
      kits: kits.filter((k) => grp.categories.includes(getMachine(parseKit(k).machine).category)),
    })).filter((grp) => grp.kits.length);
  }

  /**
   * Onglet et kit choisis, toujours valides : si le kit s'épuise, on passe au même
   * modèle d'un autre niveau, sinon au premier kit de l'onglet.
   */
  private buildSelection(g: GameState): { groups: ReturnType<Game['kitGroups']>; group: ReturnType<Game['kitGroups']>[number] | null; kit: string | null } {
    const groups = this.kitGroups(g);
    const has = (grp: (typeof groups)[number]) => !!this.buildKit && grp.kits.includes(this.buildKit);
    const group = groups.find((grp) => grp.id === this.buildCat) ?? groups.find(has) ?? groups[0] ?? null;
    if (!group) return { groups, group: null, kit: null };
    const machine = this.buildKit ? parseKit(this.buildKit).machine : '';
    const kit = has(group) ? this.buildKit! : (group.kits.find((k) => parseKit(k).machine === machine) ?? group.kits[0]);
    this.buildCat = group.id;
    this.buildKit = kit;
    return { groups, group, kit };
  }

  /** Onglet et touche (1-9) d'un kit dans la barre de construction (utilisé par les tests). */
  kitSlot(g: GameState, kit: string): { cat: string; index: number } | null {
    for (const grp of this.kitGroups(g)) {
      const index = grp.kits.indexOf(kit);
      if (index >= 0) return { cat: grp.id, index };
    }
    return null;
  }

  private cycleBuildCat(g: GameState, step: number): void {
    const { groups, group } = this.buildSelection(g);
    if (!group || groups.length < 2) return;
    const i = groups.indexOf(group);
    this.buildCat = groups[(i + step + groups.length) % groups.length].id;
    this.buildSelection(g);
  }

  private setBuildMode(on: boolean): void {
    // Sans kit en stock, le mode construction sert encore à démonter (clic droit) et à tourner.
    if (on && this.state && !this.availableKits(this.state).length)
      this.ui.toast("Aucune machine en stock : clic droit pour démonter. Achetez-en à l'Atelier (surface).", 'info');
    this.buildMode = on;
    this.dragLast = null;
  }

  private updateBuild(g: GameState, mtx: number, mty: number, mouseActive: boolean, overlay: Overlay): void {
    const inp = this.input;
    const { group } = this.buildSelection(g);
    if (group) for (let i = 0; i < Math.min(9, group.kits.length); i++) if (inp.wasPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.buildKit = group.kits[i];
    const kit = group ? this.buildKit : null;
    this.buildHover = null;
    const existing = g.structures.at(mtx, mty);
    const removable = existing && existing.removable ? existing : null;
    for (let k = inp.pressCount('KeyR'); k > 0; k--) {
      if (existing && existing.removable && getMachine(existing.type).rotatable) g.rotateAt(mtx, mty);
      else this.buildDir = rotateCW(this.buildDir);
    }
    if (!mouseActive) {
      this.dragLast = null;
      return;
    }
    if (removable) this.buildHover = { tone: 'remove', text: `${this.structureName(removable.type)} ici : clic droit pour démonter (le kit revient dans le stock)` };
    if (!kit) {
      // Rien à poser : on peut seulement démonter.
      if (removable) overlay.removeHint = { tx: mtx, ty: mty };
      if ((inp.consumeRightPress() || inp.right) && removable) g.removeAt(mtx, mty);
      inp.consumeLeftPress();
      this.dragLast = null;
      return;
    }
    const { machine, level } = parseKit(kit);
    const mdef = getMachine(machine);
    // Convoyeurs et rails se tracent en glissant.
    const isBelt = !!mdef.conveyor || !!mdef.dragPlace;
    // Un convoyeur d'un autre niveau sous le curseur peut être remplacé (amélioration sur place).
    const upgrade = g.beltToReplace(machine, mtx, mty);
    // Un wagonnet se pose sur la voie ; un aiguillage peut remplacer un rail simple.
    const onRail = (!!mdef.onTrack && !!existing?.isTrack) || !!g.railToReplace(machine, mtx, mty);
    if (removable && !upgrade && !onRail) overlay.removeHint = { tx: mtx, ty: mty };
    else {
      const check = g.canPlace(kit, mtx, mty);
      overlay.ghost = { machine, tx: mtx, ty: mty, dir: upgrade ? upgrade.dir : this.buildDir, ok: check.ok };
      if (!check.ok) this.buildHover = { tone: 'bad', text: check.reason ?? 'Impossible ici' };
      else {
        const what = upgrade
          ? `remplacer ce convoyeur par un ${mdef.name.toLowerCase()}`
          : mdef.onTrack
            ? 'poser le wagonnet sur la voie'
            : g.railToReplace(machine, mtx, mty)
              ? 'remplacer ce rail par un aiguillage'
              : isBelt
                ? 'poser ici (glisser pour tracer une ligne)'
                : 'poser ici';
        this.buildHover = { tone: 'ok', text: `Clic : ${what}` };
      }
      // Foreuse améliorée : cases qu'elle forera ici, dans la direction choisie.
      const reach = level > 1 ? mdef.levels?.[level - 1]?.reach : undefined;
      if (reach) overlay.ghost.reach = reachTiles(mtx, mty, this.buildDir, reach);
      if (getMachine(machine).bridge) {
        const entry = this.bridgeEntryFor(g, mtx, mty, this.buildDir);
        if (entry) overlay.ghost.link = { tx: entry.x, ty: entry.y };
      }
    }

    // Démontage : clic droit (maintenu, ou clic très bref entre deux images).
    if ((inp.consumeRightPress() || inp.right) && removable) g.removeAt(mtx, mty);

    // Pose.
    if (inp.consumeLeftPress()) {
      // Case cliquée : si l'image a tardé, la souris a pu glisser plus loin depuis le clic (le tracé
      // reprend alors de cette case à l'image suivante, sans en sauter).
      const pw = this.renderer.screenToWorld(inp.leftPressX, inp.leftPressY);
      const ptx = Math.floor(pw.x / TILE);
      const pty = Math.floor(pw.y / TILE);
      const at = g.structures.at(ptx, pty);
      const up = g.beltToReplace(machine, ptx, pty);
      const rail = (!!mdef.onTrack && !!at?.isTrack) || !!g.railToReplace(machine, ptx, pty);
      if (!at || up || rail) this.tryPlace(g, kit, ptx, pty, up ? up.dir : this.buildDir);
      this.dragLast = isBelt ? { tx: ptx, ty: pty } : null;
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
        if ((!occupant || g.beltToReplace(machine, tx, ty)) && !this.tryPlace(g, kit, tx, ty, dir, true)) break;
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

  private tryPlace(g: GameState, kit: string, tx: number, ty: number, dir: Dir, quiet = false): boolean {
    const check = g.canPlace(kit, tx, ty);
    if (!check.ok) {
      if (!quiet) {
        this.ui.toast(check.reason ?? 'Impossible ici', 'warn');
        this.sfx.error();
      }
      return false;
    }
    g.place(kit, tx, ty, dir);
    return true;
  }

  /** Nom d'une machine posée (ligne d'état du démontage). */
  private structureName(type: string): string {
    return MACHINES.find((m) => m.id === type)?.name ?? 'Machine';
  }

  /** Règles de pose d'une machine, en quelques mots. */
  private placeTips(def: MachineDef): string[] {
    const tips: string[] = [];
    if (def.needsDeposit) tips.push('Sur un gisement');
    if (def.surfaceOnly) tips.push('En surface, au camp');
    if (def.onTrack) tips.push('Sur des rails');
    if (def.conveyor || def.dragPlace) tips.push('Glisser pour tracer une ligne');
    if (def.conveyor && def.id !== 'conveyor') tips.push('Remplace un convoyeur posé');
    if (def.bridge) tips.push(`Par paire, jusqu'à ${def.bridge.range} cases d'écart`);
    if (def.w > 1 || def.h > 1) tips.push(`${def.w}×${def.h} cases : visez le coin en haut à gauche`);
    if (!def.solid && !def.conveyor && !def.track && !def.onTrack && !def.bridge) tips.push('Ne bloque pas le passage');
    return tips;
  }

  private buildBarHtml(g: GameState): string {
    if (!this.buildMode) return '';
    const l = (c: string) => this.input.label(c);
    const icon = (machine: string, cls = '') => {
      const src = this.renderer.machineIcon(machine);
      return src ? `<img class="${cls}" src="${src}" alt="">` : '';
    };
    const { groups, group, kit } = this.buildSelection(g);
    const close = `<div class="bb-close" data-action="buildClose" title="Quitter la construction (${l('KeyB')})">✕</div>`;
    const keys = (parts: string[]) => `<div class="bb-keys">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
    if (!group || !kit) {
      const status = this.buildHover
        ? `<div class="bb-status remove">${esc(this.buildHover.text)}</div>`
        : '<div class="bb-status">Visez une machine posée et faites clic droit pour la démonter.</div>';
      return `<div class="buildbar hud-box"><div class="bb-head"><span class="bb-title">Construction</span><span class="bb-tabs"></span>${close}</div>
        <div class="bb-empty">Aucune machine en stock. Achetez-en à l'<b>Atelier</b>, au camp en surface.</div>${status}
        ${keys([`<kbd>Clic droit</kbd> démonter`, `<kbd>${l('KeyB')}</kbd> quitter`])}</div>`;
    }
    const tabs = groups
      .map(
        (grp) =>
          `<div class="bb-tab ${grp === group ? 'sel' : ''}" data-action="buildCat" data-arg="${grp.id}">${icon(grp.icon)}${grp.tab}</div>`,
      )
      .join('');
    const tiles = group.kits
      .map((id, i) => {
        const { machine, level } = parseKit(id);
        return `<div class="bb-kit ${id === kit ? 'sel' : ''}" data-action="selectKit" data-arg="${id}" title="${esc(kitName(id))}">
          ${i < 9 ? `<kbd class="n">${i + 1}</kbd>` : ''}<span class="count">×${g.inventory.kitCount(id)}</span>
          ${icon(machine)}${level > 1 ? `<span class="lvl">N${level}</span>` : ''}<b>${esc(getMachine(machine).name)}</b></div>`;
      })
      .join('');
    const { machine, level } = parseKit(kit);
    const def = getMachine(machine);
    const lvl = level > 1 ? def.levels?.[level - 1] : undefined;
    const tips = this.placeTips(def)
      .map((t) => `<span class="bb-tip">${t}</span>`)
      .join('');
    const arrows = ['→', '↓', '←', '↑'];
    const dir = def.rotatable
      ? `<div class="bb-dir" data-action="buildRotate" title="Tourner (${l('KeyR')})">Direction <big>${arrows[this.buildDir]}</big> <kbd>${l('KeyR')}</kbd></div>`
      : '';
    const hover = this.buildHover;
    const status = hover
      ? `<div class="bb-status ${hover.tone}">${hover.tone === 'ok' ? '✓' : hover.tone === 'bad' ? '✗' : '⚒'} ${esc(hover.text)}</div>`
      : '<div class="bb-status">Visez un emplacement : contour vert = pose possible, rouge = impossible.</div>';
    return `<div class="buildbar hud-box">
      <div class="bb-head"><span class="bb-title">Construction</span><div class="bb-tabs">${tabs}</div>${close}</div>
      <div class="bb-kits">${tiles}</div>
      <div class="bb-info">
        <div class="bb-name"><b>${esc(kitName(kit))}</b><span class="muted">${g.inventory.kitCount(kit)} en stock</span>${tips}${dir}</div>
        <div class="bb-desc">${esc(def.summary)}${lvl ? ` <span class="bb-level">Niveau ${level}${lvl.name ? ` (${esc(lvl.name)})` : ''} : ${esc(lvl.summary)}</span>` : ''}</div>
      </div>
      ${status}
      ${keys([
        '<kbd>Clic</kbd> poser',
        '<kbd>Clic droit</kbd> démonter',
        `<kbd>1</kbd>–<kbd>${Math.min(9, group.kits.length)}</kbd> machine`,
        ...(groups.length > 1 ? ['<kbd>Tab</kbd> catégorie'] : []),
        `<kbd>${l('KeyR')}</kbd> tourner`,
        `<kbd>${l('KeyB')}</kbd> quitter`,
      ])}
    </div>`;
  }

  // ------------------------------------------------------------------ infos

  /** Chaleur de la Fournaise sur une machine (infobulle). */
  private heatLine(g: GameState, x: number, y: number): string {
    if (g.hazards.heatAt(y) === null) return '';
    const f = g.hazards.heatFactor(x, y);
    return f < 1
      ? `<br><span class="bad">Chaleur : cadence ${Math.round(f * 100)} %</span> <span class="muted">(ventilateur à ${HEAT.fanRadius} cases)</span>`
      : '<br><span class="good">Rafraîchie par un ventilateur</span>';
  }

  private describeTile(g: GameState, tx: number, ty: number): string | null {
    const w = g.world;
    if (!w.inBounds(tx, ty) || !w.explored[w.idx(tx, ty)]) return null;
    const wagon = g.wagons.at(tx, ty);
    if (wagon)
      return `<b>Wagonnet</b> — ${wagon.stopped ? "à l'arrêt" : 'en route'}${wagon.rider ? ' · vous êtes à bord' : ''}<br>Chargement : ${kg(wagon.weight())} / ${kg(
        wagon.capacity,
      )} · ${wagon.delivered} minerai(s) livré(s)<br><span class="muted">[${this.input.label('KeyF')}] monter / descendre</span>`;
    const s = g.structures.at(tx, ty) ?? g.borerAt(tx, ty) ?? undefined;
    if (s instanceof RailStation)
      return `<b>${s.def.name}</b><br>${kg(s.weight())} / ${kg(s.capacity)} en attente<br><span class="muted">[${this.input.label('KeyE')}] ouvrir</span>`;
    if (s instanceof Rail) return `<b>Rails</b><br><span class="muted">Posez-y un wagonnet ; il fait l'aller-retour jusqu'aux bouts de la ligne.</span>`;
    if (s instanceof RailSwitch) {
      const connected = (d: Dir) => !!g.structures.at(s.x + DX[d], s.y + DY[d])?.isTrack;
      const next = s.nextBranch(connected);
      const names = { straight: 'tout droit', left: 'à gauche', right: 'à droite' };
      return `<b>Aiguillage</b> — pointe ${['→', '↓', '←', '↑'][(s.dir + 2) % 4]}<br>${
        s.setting === 'alt' ? 'En alternance · ' : ''
      }prochain wagonnet : ${next ? names[next] : '—'}<br><span class="muted">[${this.input.label('KeyE')}] régler · [${this.input.label('KeyR')}] tourner en construction</span>`;
    }
    if (s instanceof Conveyor) {
      const load = s.items.length;
      return `<b>${s.def.name}</b> ${['→', '↓', '←', '↑'][s.dir]}<br>${load}/${s.capacity} objets · ${s.speed.toLocaleString('fr-FR')} tuile/s${
        s.blocked ? ' · <span class="bad">saturé</span>' : ''
      }`;
    }
    if (s instanceof Sorter)
      return `<b>Trieur</b> ${['→', '↓', '←', '↑'][s.dir]}<br>${
        s.filters.length
          ? `${s.filters.map((r) => `${resIcon(r)} ${getResource(r).name}`).join(', ')} tout droit · le reste sur les côtés`
          : 'Aucun filtre : tout va tout droit'
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
      return `<b>Foreuse</b> niveau ${s.level} — ${st}<br>${s.sources(g).length} case(s) forée(s) · charbon : ${s.fuelUnits} · extrait : ${s.extracted}${this.heatLine(g, s.x, s.y)}`;
    }
    if (s instanceof TunnelBorer) {
      const st = {
        idle: 'rangée dans sa base',
        moving: 'sort vers le front',
        digging: 'perce la roche',
        returning: 'rentre à la base',
        waiting: `attend (${s.blockReason})`,
        nofuel: 'plus de charbon',
        full: 'base pleine de minerai',
        blocked: `rentrée (${s.blockReason})`,
        done: 'tunnel terminé',
      }[s.status];
      return `<b>Foreuse de percement</b> niv. ${s.level} ${['→', '↓', '←', '↑'][s.dir]} — ${st}<br>Base : ${s.fuelUnits} charbon${
        s.stats.hopper ? ` · ${s.storeCount()} minerai(s)` : ''
      } · tunnel : ${s.tunnel} cases${s.status === 'digging' && s.heat < 1 ? `<br><span class="bad">Chaleur : perce à ${Math.round(s.heat * 100)} %</span>` : ''}`;
    }
    if (s instanceof Prop) return `<b>Étai</b><br>Pas d'éboulement à ${CAVE_IN.propRadius} cases autour`;
    if (s instanceof Fan)
      return `<b>Ventilateur</b> — ${s.active ? 'chasse le grisou' : s.cooling ? 'rafraîchit les machines' : 'air sain'}<br>Grisou : ${GAS.fanRadius} cases${
        s.cooling ? ` · machines : ${HEAT.fanRadius} cases` : ''
      }`;
    if (s instanceof Pump) return `<b>Pompe</b> — ${s.status === 'ok' ? 'assèche la galerie' : "pas d'eau à portée"}<br>Portée : ${WATER.pumpRadius} cases · sans charbon`;
    if (s instanceof Smelter) {
      const st = { ok: 'fond le minerai', idle: 'attend du minerai', nofuel: 'sans charbon', full: 'sortie saturée' }[s.status];
      return `<b>${s.def.name}</b> ${['→', '↓', '←', '↑'][s.dir]} — ${st}<br>Minerai : ${s.input.length} · lingots prêts : ${s.output.length} · charbon : ${s.fuelUnits}${this.heatLine(g, s.x, s.y)}`;
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
    const gas = w.gas[w.idx(tx, ty)];
    const water = w.water[w.idx(tx, ty)];
    if (!b.solid && (gas > 0 || water > 0)) {
      const parts: string[] = [];
      if (gas > 0) parts.push(`<b>Grisou</b> ${Math.round((gas / 255) * 100)} %${gas >= GAS.harmful ? ' — <span class="bad">irrespirable</span>' : ''}`);
      if (water > 0) parts.push(`<b>Eau</b> ${water >= WATER.deep ? '<span class="bad">profonde</span>' : 'peu profonde'} (${Math.round((water / 255) * 100)} %)`);
      return parts.join('<br>');
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
          if (e.tool === 'jackhammer') {
            this.sfx.hammer();
            r.onHammer();
          } else this.sfx.swing();
          break;
        case 'hit':
          // Le marteau-piqueur a son propre bruit (un par coup, pas un par case).
          if (g.player.swingTool !== 'jackhammer') this.sfx.hit(getBlock(e.block).tier);
          r.onHit(e.tx, e.ty, e.block, g.player.x, g.player.y);
          break;
        case 'break':
          // Une foreuse de percement qui creuse loin du joueur ne s'entend pas.
          if (Math.hypot((e.tx + 0.5) * TILE - g.player.x, (e.ty + 0.5) * TILE - g.player.y) < 18 * TILE) this.sfx.break();
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
        case 'crumble':
          r.fx.emit('dust', e.x, e.y - 2, 'rgba(150,140,130,0.6)', 5, 16);
          r.fx.emit('chip', e.x, e.y - 3, getResource(e.res).color, 3, 22);
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
        case 'hurt':
          if (e.amount >= 10) this.sfx.hurt();
          r.onHurt(e.amount);
          break;
        case 'mount':
          this.sfx.mount(e.on);
          break;
        case 'rope':
          this.sfx.rope(e.phase);
          // L'arrivée (au camp ou dans la mine) : la caméra suit tout de suite, un nuage de poussière marque le saut.
          if (e.phase === 'up' || e.phase === 'down') {
            r.fx.emit('dust', g.player.x, g.player.y, 'rgba(150,130,110,0.7)', 10, 30);
            r.snapCamera();
          }
          break;
        case 'faint':
          this.sfx.hurt();
          r.snapCamera();
          break;
        case 'rumble':
          this.sfx.rumble();
          r.onRumble(e.tx, e.ty);
          break;
        case 'collapse':
          this.sfx.collapse();
          r.onCollapse(e.tx, e.ty);
          break;
        case 'gas':
          this.sfx.gas();
          r.onGasRelease(e.tx, e.ty);
          break;
        case 'flood':
          this.sfx.flood();
          r.onFlood(e.tx, e.ty);
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
