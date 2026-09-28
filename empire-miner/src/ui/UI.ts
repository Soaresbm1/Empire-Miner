/**
 * Couche d'interface HTML au-dessus du canvas : HUD, messages, panneaux, menus.
 * Les actions des boutons sont relayées à l'hôte (Game) via `onAction`.
 */
import { depthAt } from '../core/constants';
import { zoneForDepth } from '../data/depth';
import { getMachine } from '../data/machines';
import type { GameState } from '../sim/GameState';
import { OBJECTIVES, currentObjective } from '../sim/objectives';
import { Drill } from '../sim/structures/Drill';
import { ShippingCrate } from '../sim/structures/ShippingCrate';
import type { Sorter } from '../sim/structures/Sorter';
import { Storage } from '../sim/structures/Storage';
import type { Structure } from '../sim/structures/Structure';
import { esc, kg, money, resIcon } from './format';
import { counterPanel, drillPanel, helpPanel, inventoryPanel, shippingPanel, sorterPanel, storagePanel, workshopPanel } from './panels';

export type PanelKind = 'counter' | 'workshop' | 'inventory' | 'storage' | 'drill' | 'shipping' | 'sorter' | 'help';

export interface UIHost {
  onAction(action: string, arg: string): void;
  keyLabel(code: string): string;
  moveKeys(): string;
}

/** Faux dans les hébergements qui bloquent les téléchargements (build « artifact »). */
const CAN_DOWNLOAD = import.meta.env.MODE !== 'artifact';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class UI {
  panel: { kind: PanelKind; target: Structure | null; tab: string } | null = null;
  menu: 'main' | 'pause' | null = null;
  private readonly hud = $('#hud');
  private readonly panelRoot = $('#panel-root');
  private readonly menuRoot = $('#menu-root');
  private readonly toasts = $('#toasts');
  private readonly tooltip = $('#tooltip');
  private readonly cache = new Map<string, string>();
  private panelSig = '';
  private refreshTimer = 0;

  constructor(private readonly host: UIHost) {
    const onPointer = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el || (el as HTMLButtonElement).disabled || e.button !== 0) return;
      e.preventDefault();
      this.host.onAction(el.dataset.action!, el.dataset.arg ?? '');
    };
    for (const root of [this.panelRoot, this.menuRoot, this.hud]) root.addEventListener('pointerdown', onPointer);
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

  private set(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  showHud(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  updateHud(g: GameState, extra: { prompt: string; build: string; hints: string; income: string }): void {
    const depth = depthAt(g.player.tileY);
    const surface = g.player.tileY < 12;
    this.set('hud-money', `<span class="coin"></span>${money(g.money)}`);
    this.set('hud-income', extra.income);
    this.set('hud-depth', surface ? `<span class="zone">Surface · Camp</span>` : `▼ <b>${Math.floor(depth)} m</b> <span class="zone" style="color:${zoneForDepth(depth).color}">${zoneForDepth(depth).name}</span>`);
    const inv = g.inventory;
    const w = inv.weight();
    const ratio = w / inv.capacity;
    const items = Object.entries(inv.items)
      .map(([res, n]) => `<span class="chip">${resIcon(res)}${n}</span>`)
      .join('');
    this.set(
      'hud-equip',
      `<div class="equip"><span class="tier">N${g.pickaxe.tier}</span> ${g.pickaxe.name}</div>
       <div class="bar ${ratio >= 0.999 ? 'full' : ratio > 0.8 ? 'warn' : ''}"><div style="width:${Math.min(100, ratio * 100)}%"></div><span>${g.bag.name} ${kg(w)} / ${kg(inv.capacity)}</span></div>
       <div class="chips">${items || '<span class="muted">Sac vide</span>'}</div>`,
    );
    const { objective, index } = currentObjective(g);
    this.set(
      'hud-objective',
      objective
        ? `<div class="obj-title">Objectif ${index + 1}/${OBJECTIVES.length}</div><div>${esc(objective.text)}</div>`
        : `<div class="obj-title">Objectif libre</div><div>Agrandissez votre exploitation et descendez toujours plus bas.</div>`,
    );
    this.set('hud-prompt', extra.prompt);
    this.set('hud-build', extra.build);
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

  openPanel(kind: PanelKind, target: Structure | null = null, tab = 'tools'): void {
    this.panel = { kind, target, tab };
    this.panelSig = '';
  }

  closePanel(): void {
    this.panel = null;
    this.panelRoot.innerHTML = '';
    this.panelSig = '';
  }

  setTab(tab: string): void {
    if (this.panel) {
      this.panel.tab = tab;
      this.panelSig = '';
    }
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
      case 'workshop':
        title = 'Atelier';
        body = workshopPanel(g, tab);
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
      case 'shipping':
        title = getMachine('shipping').name;
        body = shippingPanel(g, target as ShippingCrate);
        break;
      case 'sorter':
        title = getMachine('sorter').name;
        body = sorterPanel(g, target as Sorter);
        break;
      case 'help':
        title = 'Commandes';
        body = helpPanel({ move: this.host.moveKeys(), label: (c) => this.host.keyLabel(c) });
        break;
    }
    const money$ = kind === 'counter' || kind === 'workshop' ? `<span class="panel-money"><span class="coin"></span>${money(g.money)}</span>` : '';
    const html = `<div class="panel panel-${kind}"><header><h2>${title}</h2>${money$}<button class="close" data-action="close" title="Fermer">✕</button></header><div class="panel-body">${body}</div></div>`;
    if (html === this.panelSig) return;
    this.panelSig = html;
    const scroll = this.panelRoot.querySelector('.panel-body')?.scrollTop ?? 0;
    this.panelRoot.innerHTML = html;
    const pb = this.panelRoot.querySelector('.panel-body');
    if (pb) pb.scrollTop = scroll;
  }

  // ------------------------------------------------------------------ menus

  showMainMenu(save: { savedAt: string; money: number; depth: number } | null, confirmNew = false): void {
    this.menu = 'main';
    const saveInfo = save
      ? `<small>${new Date(save.savedAt).toLocaleString('fr-FR')} · ${money(save.money)} · ${Math.floor(save.depth)} m</small>`
      : '';
    this.menuRoot.innerHTML = `<div class="menu main-menu">
      <h1><span>EMPIRE</span><span>MINER</span></h1>
      <p class="tagline">Une vieille pioche. Une petite mine. Un futur empire industriel.</p>
      <div class="menu-buttons">
        ${save ? `<button class="btn primary big" data-action="continue">Continuer${saveInfo}</button>` : ''}
        <button class="btn big ${save ? (confirmNew ? 'danger' : '') : 'primary'}" data-action="new">${confirmNew ? 'Confirmer : écraser la sauvegarde' : 'Nouvelle partie'}</button>
        <button class="btn" data-action="import">Importer une sauvegarde…</button>
        <button class="btn" data-action="help">Commandes</button>
      </div>
      <p class="credits">Se joue au clavier et à la souris · prototype v0.1</p>
    </div>`;
  }

  showPauseMenu(muted: boolean): void {
    this.menu = 'pause';
    this.menuRoot.innerHTML = `<div class="menu pause-menu"><h2>Pause</h2><div class="menu-buttons">
      <button class="btn primary big" data-action="resume">Reprendre</button>
      <button class="btn" data-action="save">Sauvegarder</button>
      <button class="btn" data-action="load">Charger la dernière sauvegarde</button>
      ${CAN_DOWNLOAD ? '<button class="btn" data-action="export">Exporter la sauvegarde (fichier)</button>' : ''}
      <button class="btn" data-action="import">Importer une sauvegarde…</button>
      <button class="btn" data-action="mute">Son : ${muted ? 'coupé' : 'activé'}</button>
      <button class="btn" data-action="help">Commandes</button>
      <button class="btn" data-action="quit">Quitter vers le menu</button>
    </div></div>`;
  }

  hideMenu(): void {
    this.menu = null;
    this.menuRoot.innerHTML = '';
  }
}
