/**
 * Couche d'interface HTML au-dessus du canvas : HUD, messages, panneaux, menus.
 * Les actions des boutons sont relayées à l'hôte (Game) via `onAction`.
 */
import { METERS_PER_TILE, TILE, depthAt } from '../core/constants';
import { zoneForDepth } from '../data/depth';
import { getMachine } from '../data/machines';
import type { GameState } from '../sim/GameState';
import { OBJECTIVES, currentObjective } from '../sim/objectives';
import type { TunnelBorer } from '../sim/structures/Borer';
import type { Smelter } from '../sim/structures/Smelter';
import { GEAR, HAZARD_LABEL } from '../data/gear';
import { GAS, HEALTH, WATER } from '../data/hazards';
import { MARKER_KINDS } from '../sim/Markers';
import { Drill } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import type { Sorter } from '../sim/structures/Sorter';
import type { RailStation, RailSwitch } from '../sim/structures/Rail';
import { Storage } from '../sim/structures/Storage';
import type { Structure } from '../sim/structures/Structure';
import { esc, kg, money, resIcon } from './format';
import { icon } from './theme';
import { MenuFx } from './menuFx';
import { MAP_COLORS } from '../render/MineMap';
import { QUALITY_LABEL, type Quality } from '../render/quality';
import { WORKSHOP_TABS, isWorkshopTab } from './workshop';
import { hudMarket, BOARD_TABS, isBoardTab } from './market';
import { boardPanel, borerPanel, counterPanel, smelterPanel, drillPanel, helpPanel, inventoryPanel, mapPanel, shippingPanel, sorterPanel, stationPanel, storagePanel, switchPanel, workshopPanel } from './panels';

/** Flèches dans les 8 directions, dans l'ordre des angles (est, sud-est, sud…). */
const ARROWS8 = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

export type PanelKind = 'counter' | 'workshop' | 'board' | 'inventory' | 'storage' | 'drill' | 'borer' | 'furnace' | 'shipping' | 'sorter' | 'station' | 'switch' | 'map' | 'help';

export interface UIHost {
  onAction(action: string, arg: string): void;
  keyLabel(code: string): string;
  moveKeys(): string;
  /** Image d'une machine (data URL) pour le magasin. */
  machineIcon(id: string): string;
  /** Commandes tactiles actives (l'aide parle alors des boutons à l'écran). */
  touch?(): boolean;
}

/** Ce que le menu pause sait d'une partie à deux en cours. */
export interface NetMenu {
  role: 'host' | 'guest';
  code: string;
  peer: string;
  playing: boolean;
}

/** Faux dans les hébergements qui bloquent les téléchargements (build « artifact »). */
const CAN_DOWNLOAD = import.meta.env.MODE !== 'artifact';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class UI {
  panel: { kind: PanelKind; target: Structure | null; tab: string } | null = null;
  /** Dernier onglet de l'Atelier : on y revient à la prochaine visite. */
  workshopTab = 'tools';
  /** Dernier onglet du Tableau d'affichage (Marché ou Production). */
  boardTab = 'market';
  /** Réglages de l'onglet Machines (catégorie, « achetables seulement », détails dépliés). */
  readonly shopView: { cat: string; only: boolean; open: Set<string>; fire: number | null } = { cat: 'all', only: false, open: new Set<string>(), fire: null };
  /** Au prochain dessin du panneau, on remonte en haut de la liste. */
  private scrollTop = false;
  menu: 'main' | 'pause' | null = null;
  private readonly hud = $('#hud');
  private readonly panelRoot = $('#panel-root');
  private readonly menuRoot = $('#menu-root');
  private readonly menuFx = new MenuFx($('#menu-fx') as HTMLCanvasElement);
  /** Nombre de grains du décor animé des menus (réglage Qualité). */
  private menuMotes = 0;
  private readonly toasts = $('#toasts');
  private readonly tooltip = $('#tooltip');
  private readonly cache = new Map<string, string>();
  private panelSig = '';
  /** Le prochain rendu du panneau est une ouverture (animation). */
  private popNext = false;
  private refreshTimer = 0;

  constructor(private readonly host: UIHost) {
    const onPointer = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el || (el as HTMLButtonElement).disabled || e.button !== 0) return;
      e.preventDefault();
      // Un canvas cliquable (carte) reçoit la position du clic, en pixels du canvas.
      if (el instanceof HTMLCanvasElement) {
        const r = el.getBoundingClientRect();
        const px = ((e.clientX - r.left) * el.width) / Math.max(1, r.width);
        const py = ((e.clientY - r.top) * el.height) / Math.max(1, r.height);
        this.host.onAction(el.dataset.action!, `${Math.round(px)},${Math.round(py)}`);
        return;
      }
      this.host.onAction(el.dataset.action!, el.dataset.arg ?? '');
    };
    for (const root of [this.panelRoot, this.menuRoot, this.hud]) root.addEventListener('pointerdown', onPointer);
    this.listenMap();
    // Entrée dans le champ du code : on rejoint.
    this.menuRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'join-code') {
        e.preventDefault();
        this.host.onAction('join', '');
      }
    });
  }

  /**
   * Carte complète : un clic sans bouger pose un repère, un glissé déplace la carte, la molette zoome autour du curseur.
   * Les positions sont envoyées en pixels du canvas (pas en pixels de l'écran).
   */
  private listenMap(): void {
    const onMap = (e: Event): HTMLCanvasElement | null => {
      const t = e.target;
      return t instanceof HTMLCanvasElement && t.id === 'map-canvas' ? t : null;
    };
    const toCanvas = (el: HTMLCanvasElement, cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: ((cx - r.left) * el.width) / Math.max(1, r.width), y: ((cy - r.top) * el.height) / Math.max(1, r.height) };
    };
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    this.panelRoot.addEventListener('pointerdown', (e) => {
      const el = onMap(e);
      if (!el || e.button !== 0) return;
      e.preventDefault();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture?.(e.pointerId);
    });
    this.panelRoot.addEventListener('pointermove', (e) => {
      const el = onMap(e);
      if (!drag || !el || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true;
      const a = toCanvas(el, drag.x, drag.y);
      const b = toCanvas(el, e.clientX, e.clientY);
      this.host.onAction('mapDrag', `${Math.round(b.x - a.x)},${Math.round(b.y - a.y)}`);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      const el = onMap(e);
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      drag = null;
      if (!el || e.type === 'pointercancel' || d.moved) return;
      const p = toCanvas(el, e.clientX, e.clientY);
      this.host.onAction('mapClick', `${Math.round(p.x)},${Math.round(p.y)}`);
    };
    this.panelRoot.addEventListener('pointerup', end);
    this.panelRoot.addEventListener('pointercancel', end);
    this.panelRoot.addEventListener(
      'wheel',
      (e) => {
        const el = onMap(e);
        if (!el) return;
        e.preventDefault();
        const p = toCanvas(el, e.clientX, e.clientY);
        this.host.onAction('mapWheel', `${Math.round(p.x)},${Math.round(p.y)},${Math.sign(e.deltaY)}`);
      },
      { passive: false },
    );
  }

  /** La souris est-elle au-dessus d'un élément d'interface ? */
  isOverUI(x: number, y: number): boolean {
    const el = document.elementFromPoint(x, y);
    return !!el && el.id !== 'game' && !!el.closest('.panel, .menu, .hud-box, .buildbar');
  }

  get blocking(): boolean {
    return !!this.panel || !!this.menu;
  }

  // ------------------------------------------------------------------ HUD

  /** Hauteur de la barre de construction (px CSS, 0 hors construction). */
  buildBarHeight = 0;

  /** Remplace le contenu d'un élément s'il a changé (vrai dans ce cas). */
  private set(id: string, html: string): boolean {
    if (this.cache.get(id) === html) return false;
    this.cache.set(id, html);
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return true;
  }

  showHud(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  updateHud(g: GameState, extra: { prompt: string; build: string; hints: string; income: string; speed: string }): void {
    const depth = depthAt(g.player.tileY);
    const surface = g.player.tileY < 12;
    this.set('hud-money', `<span class="coin"></span>${money(g.money)}`);
    this.set('hud-income', extra.income);
    this.set('hud-speed', extra.speed);
    this.set('hud-market', hudMarket(g));
    // Fournaise : température, qui ralentit les machines et épuise le mineur (sauf près d'un ventilateur).
    const temp = surface ? null : g.hazards.temperature(g.player.tileY);
    const cooled = temp !== null && g.hazards.cooled(g.player.tileX, g.player.tileY);
    const suit = g.hasGear('suit');
    this.set(
      'hud-depth',
      surface
        ? `<span class="zone">Surface · Camp</span>`
        : `▼ <b>${Math.floor(depth)} m</b> <span class="zone" style="color:${zoneForDepth(depth).color}">${zoneForDepth(depth).name}</span>${
            temp !== null
              ? `<div class="heat">Chaleur ${temp} °C : machines ralenties${cooled ? ' · au frais près du ventilateur' : suit ? ' · combinaison en service' : ''}</div>`
              : ''
          }`,
    );
    const inv = g.inventory;
    const w = inv.weight();
    const ratio = w / inv.capacity;
    const items = Object.entries(inv.items)
      .map(([res, n]) => `<span class="chip">${resIcon(res)}${n}</span>`)
      .join('');
    // Santé et dangers là où se trouve le joueur.
    const p = g.player;
    const gas = g.hazards.gasAt(p.tileX, p.tileY);
    const water = g.hazards.waterAt(p.tileX, p.tileY);
    const quake = g.hazards.pendingNear(p.tileX, p.tileY, 4);
    const alerts: string[] = [];
    if (quake) alerts.push(`Le plafond craque : étai ou fuite ! (${Math.ceil(quake.t)} s)`);
    const boots = g.hasGear('boots');
    if (gas >= GAS.harmful) alerts.push(g.hasGear('mask') ? 'Grisou : le masque vous protège, sortez du nuage' : 'Grisou : sortez du nuage !');
    else if (gas > 0) alerts.push('Traces de grisou');
    if (water >= WATER.deep) alerts.push(boots ? 'Eau profonde : les cuissardes limitent la fatigue' : 'Eau profonde : vous vous épuisez');
    else if (water > 0 && !boots) alerts.push("Dans l'eau : vous êtes ralenti");
    if (temp !== null && !cooled && !suit) alerts.push('Chaleur : la santé baisse (ventilateur ou combinaison)');
    // Pièces d'équipement : allumées si portées, sinon grisées avec le rappel de leur prix (dès qu'on descend).
    const gearLine =
      g.gear.size > 0 || g.stats.maxDepth >= 55
        ? `<div class="gear-line">${GEAR.map((def) => {
            const on = g.hasGear(def.id);
            const src = icon(`gear:${def.id}`);
            const tip = on
              ? `${def.name} : ${HAZARD_LABEL[def.hazard].toLowerCase()}, −${Math.round(def.absorb * 100)} % de dégâts`
              : `${def.name} : à l'atelier, ${money(def.price)}`;
            return src ? `<img class="gear-ico ${on ? 'on' : 'off'}" src="${src}" alt="" title="${esc(tip)}">` : '';
          }).join('')}</div>`
        : '';
    const hp = g.hp / HEALTH.max;
    const health = `<div class="bar health ${hp < 0.35 ? 'full' : hp < 0.7 ? 'warn' : ''}"><div style="width:${Math.max(0, hp * 100)}%"></div><span>Santé ${Math.ceil(g.hp)} / ${HEALTH.max}</span></div>${
      alerts.length ? `<div class="danger-line">⚠ ${alerts.join(' · ')}</div>` : ''
    }`;
    this.set(
      'hud-equip',
      `<div class="equip">${g.tool === 'pickaxe' && icon(`pick${g.pickaxeLevel}`) ? `<img class="tool-ico" src="${icon(`pick${g.pickaxeLevel}`)}" alt="">` : ''}<span class="tier">N${g.activeTool.tier}</span> ${g.activeTool.name}${
        g.hasJackhammer
          ? `<div class="fuel-line"><kbd>${this.host.keyLabel('KeyT')}</kbd> ${g.tool === 'jackhammer' ? 'passer à la pioche' : 'passer au marteau-piqueur'}${
              g.tool === 'jackhammer' ? ` · charbon dans le sac : ${g.inventory.count('coal')}` : ''
            }</div>`
          : ''
      }${g.scootering ? '<div class="fuel-line">Trottinette en marche · minage impossible</div>' : ''}${
        g.ropeT > 0 ? `<div class="fuel-line rope-line">${g.ropeDir === 'down' ? 'Descente' : 'Remontée'} : ne bougez plus… ${Math.ceil(g.ropeT)} s</div>` : ''
      }</div>
       <div class="bar bag ${ratio >= 0.999 ? 'full' : ratio > 0.8 ? 'warn' : ''}"><div style="width:${Math.min(100, ratio * 100)}%"></div><span>${g.bag.name} ${kg(w)} / ${kg(inv.capacity)}</span></div>
       <div class="chips">${items || '<span class="muted">Sac vide</span>'}</div>
       ${health}${gearLine}`,
    );
    const { objective, index } = currentObjective(g);
    this.set(
      'hud-objective',
      objective
        ? `<div class="obj-title">Objectif ${index + 1}/${OBJECTIVES.length}</div><div>${esc(objective.text)}</div>`
        : `<div class="obj-title">Objectif libre</div><div>Agrandissez votre exploitation et descendez toujours plus bas.</div>`,
    );
    // Repère suivi : nom, distance et direction.
    const t = g.markers.trackedMarker;
    let track = '';
    if (t) {
      const dx = t.x + 0.5 - p.x / TILE;
      const dy = t.y + 0.5 - p.y / TILE;
      const d = Math.hypot(dx, dy) * METERS_PER_TILE;
      const arrow = d < 2 ? '●' : ARROWS8[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
      const k = MARKER_KINDS[t.kind];
      track = `<span style="color:${k.color}">${k.symbol}</span> ${esc(t.label)} <b>${arrow} ${Math.round(d)} m</b>`;
    }
    this.set('hud-track', track);
    this.set('hud-prompt', extra.prompt);
    if (this.set('hud-build', extra.build)) {
      // Hauteur de la barre de construction : sur un écran étroit, l'équipement passe au-dessus.
      this.hud.classList.toggle('building', !!extra.build);
      const h = document.getElementById('hud-build')?.offsetHeight ?? 0;
      this.buildBarHeight = h;
      if (h) this.hud.style.setProperty('--build-h', `${h}px`);
    }
    this.set('hud-hints', extra.hints);
  }

  // ------------------------------------------------------------------ messages

  toast(text: string, kind: 'info' | 'warn' | 'good' | 'bad' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  /** Fait briller le compteur d'argent (revenu automatique). */
  pulseMoney(): void {
    const el = document.getElementById('hud-money');
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  /** Indicateur discret de sauvegarde automatique. */
  flashSaved(): void {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  setTooltip(html: string | null, x = 0, y = 0): void {
    if (!html) {
      this.tooltip.style.display = 'none';
      return;
    }
    if (this.cache.get('tooltip') !== html) {
      this.cache.set('tooltip', html);
      this.tooltip.innerHTML = html;
    }
    this.tooltip.style.display = 'block';
    const w = this.tooltip.offsetWidth;
    const left = x + 18 + w > window.innerWidth ? x - w - 12 : x + 18;
    this.tooltip.style.transform = `translate(${left}px, ${y + 14}px)`;
  }

  // ------------------------------------------------------------------ panneaux

  openPanel(kind: PanelKind, target: Structure | null = null, tab = kind === 'workshop' ? this.workshopTab : kind === 'board' ? this.boardTab : 'tools'): void {
    this.panel = { kind, target, tab };
    this.shopView.fire = null;
    this.scrollTop = true;
    this.panelSig = '';
    this.popNext = true;
    this.syncOverlay();
  }

  closePanel(): void {
    this.panel = null;
    this.panelRoot.innerHTML = '';
    this.panelSig = '';
    this.syncOverlay();
  }

  /** Quand un panneau ou un menu est ouvert, les messages passent en bas pour ne pas le masquer. */
  private syncOverlay(): void {
    document.getElementById('ui')?.classList.toggle('overlay-open', !!this.panel || !!this.menu);
  }

  setTab(tab: string): void {
    if (!this.panel) return;
    if (this.panel.kind === 'workshop') {
      if (!isWorkshopTab(tab)) return;
      this.workshopTab = tab;
    } else if (this.panel.kind === 'board') {
      if (!isBoardTab(tab)) return;
      this.boardTab = tab;
    }
    this.panel.tab = tab;
    this.shopView.fire = null;
    this.scrollTop = true;
    this.panelSig = '';
  }

  /** Onglet suivant (1) ou précédent (-1) de l'Atelier ou du Tableau d'affichage, en bouclant. */
  cycleTab(dir: 1 | -1): void {
    const kind = this.panel?.kind;
    if (kind !== 'workshop' && kind !== 'board') return;
    const tabs = kind === 'workshop' ? WORKSHOP_TABS : BOARD_TABS;
    const i = tabs.findIndex(([id]) => id === this.panel!.tab);
    this.setTab(tabs[(i + dir + tabs.length) % tabs.length][0]);
  }

  /** Magasin de machines : catégorie affichée (« all » : toutes). */
  setShopCat(cat: string): void {
    this.shopView.cat = cat;
    this.scrollTop = true;
  }

  toggleShopOnly(): void {
    this.shopView.only = !this.shopView.only;
  }

  /** Congédier un ouvrier : le premier appui demande confirmation (vrai au second appui, sur le même ouvrier). */
  confirmFire(id: number): boolean {
    if (this.shopView.fire === id) {
      this.shopView.fire = null;
      return true;
    }
    this.shopView.fire = id;
    return false;
  }

  /** Déplie ou replie le détail d'une machine. */
  toggleShopDetail(id: string): void {
    if (!this.shopView.open.delete(id)) this.shopView.open.add(id);
  }

  /** Redessine le panneau ouvert si son contenu a changé. */
  renderPanel(g: GameState, dt: number, force = false): void {
    if (!this.panel) return;
    this.refreshTimer -= dt;
    if (!force && this.refreshTimer > 0 && this.panelSig) return;
    this.refreshTimer = 0.2;
    const { kind, target, tab } = this.panel;
    let title = '';
    let body = '';
    switch (kind) {
      case 'counter':
        title = 'Comptoir de vente';
        body = counterPanel(g);
        break;
      case 'board':
        title = "Tableau d'affichage";
        body = boardPanel(g, tab);
        break;
      case 'workshop':
        title = 'Atelier';
        body = workshopPanel(g, tab, (id) => this.host.machineIcon(id), this.shopView);
        break;
      case 'inventory':
        title = 'Sac et carnet';
        body = inventoryPanel(g);
        break;
      case 'storage':
        title = getMachine('storage').name;
        body = storagePanel(g, target as Storage);
        break;
      case 'drill':
        title = getMachine('drill').name;
        body = drillPanel(g, target as Drill);
        break;
      case 'borer':
        title = getMachine('borer').name;
        body = borerPanel(g, target as TunnelBorer);
        break;
      case 'furnace':
        title = (target as Smelter).def.name;
        body = smelterPanel(g, target as Smelter);
        break;
      case 'shipping':
        title = getMachine('shipping').name;
        body = shippingPanel(g, target as ShippingCrate);
        break;
      case 'sorter':
        title = getMachine('sorter').name;
        body = sorterPanel(g, target as Sorter);
        break;
      case 'station':
        title = (target as RailStation).def.name;
        body = stationPanel(g, target as RailStation);
        break;
      case 'switch':
        title = getMachine('rail_switch').name;
        body = switchPanel(g, target as RailSwitch);
        break;
      case 'map':
        title = 'Carte de la mine';
        body = mapPanel(g, MAP_COLORS);
        break;
      case 'help':
        title = 'Commandes';
        body = helpPanel({ move: this.host.moveKeys(), label: (c) => this.host.keyLabel(c), touch: this.host.touch?.() });
        break;
    }
    const money$ = kind === 'counter' || kind === 'workshop' ? `<span class="panel-money"><span class="coin"></span>${money(g.money)}</span>` : '';
    const inner = `<header><h2>${title}</h2>${money$}<button class="close" data-action="close" title="Fermer">✕</button></header><div class="panel-body">${body}</div>`;
    const sig = `${kind}|${inner}`;
    if (sig === this.panelSig) return;
    this.panelSig = sig;
    const scroll = this.panelRoot.querySelector('.panel-body')?.scrollTop ?? 0;
    // L'animation d'ouverture ne joue qu'à l'ouverture, pas à chaque rafraîchissement du contenu.
    this.panelRoot.innerHTML = `<div class="panel panel-${kind}${this.popNext ? ' pop' : ''}">${inner}</div>`;
    this.popNext = false;
    const pb = this.panelRoot.querySelector('.panel-body');
    if (pb) pb.scrollTop = this.scrollTop ? 0 : scroll;
    this.scrollTop = false;
  }

  // ------------------------------------------------------------------ menus

  /** Règle le décor animé des menus (0 : aucun) ; s'applique tout de suite si un menu est ouvert. */
  setMenuMotes(n: number): void {
    this.menuMotes = n;
    if (this.menu) this.menuFx.start(n);
  }

  showMainMenu(save: { savedAt: string; money: number; depth: number } | null, confirmNew = false): void {
    this.menu = 'main';
    this.syncOverlay();
    this.menuFx.start(this.menuMotes);
    const saveInfo = save
      ? `<small>${new Date(save.savedAt).toLocaleString('fr-FR')} · ${money(save.money)} · ${Math.floor(save.depth)} m</small>`
      : '';
    this.menuRoot.innerHTML = `<div class="menu main-menu">
      ${
        icon('logo')
          ? `<img class="logo" src="${icon('logo')}" alt="Empire Miner">`
          : '<h1><span>EMPIRE</span><span>MINER</span></h1>'
      }
      <p class="tagline">Une vieille pioche. Une petite mine. Un futur empire industriel.</p>
      <div class="menu-buttons">
        ${save ? `<button class="btn primary big" data-action="continue">Continuer${saveInfo}</button>` : ''}
        <button class="btn big ${save ? (confirmNew ? 'danger' : '') : 'primary'}" data-action="new">${confirmNew ? 'Confirmer : écraser la sauvegarde' : 'Nouvelle partie'}</button>
        <button class="btn big" data-action="play2" title="Une mine, deux mineurs : sur deux téléphones ou deux ordinateurs">Jouer à deux<small>avec un ami, sur son propre appareil</small></button>
        <button class="btn" data-action="import">Importer une sauvegarde…</button>
        <button class="btn" data-action="help">Commandes</button>
        <button class="btn" data-action="touch" title="Stick et boutons à l'écran, pour jouer au doigt">Commandes tactiles : ${this.host.touch?.() ? 'oui' : 'non'}</button>
      </div>
      <p class="credits">Clavier et souris, ou au doigt sur téléphone · prototype v0.1</p>
    </div>`;
  }

  showPauseMenu(muted: boolean, quality: Quality = 'high', net: NetMenu | null = null): void {
    this.menu = 'pause';
    this.syncOverlay();
    this.menuFx.stop();
    const guest = net?.role === 'guest';
    const twoPlayer = net
      ? `<p class="net-note">${
          net.role === 'host'
            ? net.playing
              ? `À deux avec <b>${esc(net.peer || 'votre ami')}</b> · code <b class="code">${esc(net.code)}</b>`
              : `Partie ouverte · code <b class="code">${esc(net.code)}</b> · personne n'est encore arrivé`
            : `Chez <b>${esc(net.peer || "l'hôte")}</b> · code <b class="code">${esc(net.code)}</b>`
        }<br><span class="muted">Le jeu continue pendant ce menu.</span></p>
      ${net.role === 'host' ? '<button class="btn" data-action="invite">Inviter : envoyer le lien</button>' : ''}
      <button class="btn danger" data-action="netLeave">${guest ? 'Quitter la partie à deux' : 'Arrêter la partie à deux'}</button>`
      : '<button class="btn" data-action="host2" title="Un ami rejoint votre mine avec un code">Inviter un ami (jouer à deux)</button>';
    this.menuRoot.innerHTML = `<div class="menu pause-menu"><h2>Pause</h2><div class="menu-buttons">
      <button class="btn primary big" data-action="resume">Reprendre</button>
      ${guest ? '' : '<button class="btn" data-action="save">Sauvegarder</button>'}
      ${net ? '' : '<button class="btn" data-action="load">Charger la dernière sauvegarde</button>'}
      ${CAN_DOWNLOAD && !guest ? '<button class="btn" data-action="export">Exporter la sauvegarde (fichier)</button>' : ''}
      ${net ? '' : '<button class="btn" data-action="import">Importer une sauvegarde…</button>'}
      <button class="btn" data-action="mute">Son : ${muted ? 'coupé' : 'activé'}</button>
      <button class="btn" data-action="quality" title="Élevée : tous les effets. Basse : pour les petits appareils.">Graphismes : ${QUALITY_LABEL[quality]}</button>
      <button class="btn" data-action="help">Commandes</button>
      <button class="btn" data-action="touch" title="Stick et boutons à l'écran, pour jouer au doigt">Commandes tactiles : ${this.host.touch?.() ? 'oui' : 'non'}</button>
      ${twoPlayer}
      <button class="btn" data-action="quit">Quitter vers le menu</button>
    </div></div>`;
  }

  // ------------------------------------------------------------------ jouer à deux

  /** Menu « Jouer à deux » : créer une partie (nouvelle ou sauvegardée) ou en rejoindre une avec son code. */
  showPlayMenu(opts: { hasSave: boolean; code?: string; error?: string; confirmNew?: boolean }): void {
    this.menu = 'main';
    this.syncOverlay();
    this.menuFx.start(this.menuMotes);
    this.menuRoot.innerHTML = `<div class="menu main-menu play-menu">
      <h2 class="play-title">Jouer à deux</h2>
      <p class="tagline">Une seule mine, deux mineurs. L'argent et les machines sont communs ; le sac et la pioche sont à chacun.</p>
      <div class="menu-buttons">
        <div class="play-box">
          <h3>Inviter un ami</h3>
          <p class="muted">Vous créez la partie et envoyez le lien (ou le code à 5 lettres) à votre ami. Elle est sauvegardée chez vous.</p>
          ${opts.hasSave ? '<button class="btn primary big" data-action="hostSave">Reprendre ma partie à deux</button>' : ''}
          <button class="btn ${opts.confirmNew ? 'danger' : opts.hasSave ? '' : 'primary big'}" data-action="hostNew">${opts.confirmNew ? 'Confirmer : écraser la sauvegarde' : 'Nouvelle partie à deux'}</button>
        </div>
        <div class="play-box">
          <h3>Rejoindre un ami</h3>
          <p class="muted">Tapez le code reçu, ou ouvrez directement le lien de votre ami.</p>
          <div class="join-row">
            <input id="join-code" class="join-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="8" placeholder="CODE" value="${esc(opts.code ?? '')}" aria-label="Code de la partie">
            <button class="btn primary" data-action="join">Rejoindre</button>
          </div>
          ${opts.error ? `<p class="join-error">${esc(opts.error)}</p>` : ''}
        </div>
        <button class="btn" data-action="close">Retour</button>
      </div>
    </div>`;
  }

  /** Invitation reçue par lien : un seul gros bouton pour rejoindre. */
  showInvitation(code: string): void {
    this.menu = 'main';
    this.syncOverlay();
    this.menuFx.start(this.menuMotes);
    this.menuRoot.innerHTML = `<div class="menu main-menu play-menu">
      <h2 class="play-title">Un ami vous invite</h2>
      <p class="tagline">Rejoignez sa mine : vous jouez ensemble, chacun sur son appareil.<br>Code de la partie : <b class="code">${esc(code)}</b></p>
      <div class="menu-buttons">
        <button class="btn primary big" data-action="join" data-arg="${esc(code)}">Rejoindre la partie</button>
        <button class="btn" data-action="close">Menu principal</button>
      </div>
    </div>`;
  }

  /** Écran d'attente du joueur qui rejoint : connexion, réception de la partie, ou échec avec de quoi réessayer. */
  showJoining(code: string, text: string, failed: boolean): void {
    this.menu = 'main';
    this.syncOverlay();
    this.menuFx.start(this.menuMotes);
    this.menuRoot.innerHTML = `<div class="menu main-menu play-menu">
      <h2 class="play-title">Partie de ${esc(code)}</h2>
      <p class="tagline join-text ${failed ? 'failed' : ''}">${esc(text)}</p>
      ${failed ? '' : '<div class="net-spinner" aria-hidden="true"></div>'}
      <div class="menu-buttons">
        ${failed ? '<button class="btn primary big" data-action="netRetry">Réessayer</button>' : ''}
        <button class="btn" data-action="netCancel">${failed ? 'Retour au menu' : 'Annuler'}</button>
      </div>
    </div>`;
  }

  /** Le texte de l'écran d'attente change sans refaire tout l'écran (le focus et l'animation restent). */
  setJoiningText(text: string): void {
    const el = this.menuRoot.querySelector('.join-text');
    if (el) el.textContent = text;
  }

  /** Pastille de connexion du HUD et bandeau « En attente de l'autre joueur ». */
  setNet(chip: string, banner: string): void {
    this.set('hud-net', chip);
    const el = document.getElementById('net-stall');
    if (el) {
      if (this.cache.get('net-stall') !== banner) {
        this.cache.set('net-stall', banner);
        el.innerHTML = banner;
        el.classList.toggle('hidden', !banner);
      }
    }
  }

  hideMenu(): void {
    this.menu = null;
    this.menuFx.stop();
    this.menuRoot.innerHTML = '';
    this.syncOverlay();
  }
}
