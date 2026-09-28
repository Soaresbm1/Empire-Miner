/**
 * État complet d'une partie + boucle de simulation (indépendante du rendu).
 *
 * Tout ce qui se passe « dans le monde » est ici : déplacement, minage,
 * ressources au sol, économie, construction, machines. La présentation
 * (rendu, audio, interface) lit cet état et consomme `events`.
 */
import { SURFACE_ROWS, TILE, depthAt } from '../core/constants';
import { Dir, dirFromVector } from '../core/dir';
import { Rng } from '../core/rng';
import { AIR, getBlock } from '../data/blocks';
import { zoneForDepth } from '../data/depth';
import { getMachine, MACHINES } from '../data/machines';
import { RESOURCES, getResource, hasResource, resourceIndex } from '../data/resources';
import { BAGS, PICKAXES } from '../data/tools';
import { DropSystem } from './Drops';
import type { SimEvent } from './events';
import { generateWorld, WorldLayout } from './generator';
import { Inventory } from './Inventory';
import { Player } from './Player';
import { StructureManager } from './StructureManager';
import { Building, BuildingType } from './structures/Building';
import { Conveyor } from './structures/Conveyor';
import { Rail, type RailStation, type RailSwitch, type SwitchSetting } from './structures/Rail';
import { Drill } from './structures/Drill';
import { ShippingCrate } from './structures/ShippingCrate';
import type { Sorter } from './structures/Sorter';
import { STRUCTURE_FACTORIES } from './structures/registry';
import { Storage } from './structures/Storage';
import type { Structure, StructureContext } from './structures/Structure';
import { revealAround } from './visibility';
import { Wagon, WagonSystem } from './Wagons';
import type { World } from './World';

export interface PlayerIntent {
  /** Direction de déplacement souhaitée (-1..1). */
  mx: number;
  my: number;
  /** Bouton de minage maintenu. */
  mine: boolean;
  /** Tuile visée (souris ou direction). */
  target: { tx: number; ty: number } | null;
}

export const NO_INTENT: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

export interface Stats {
  tilesMined: number;
  itemsCollected: number;
  earned: number;
  spent: number;
  maxDepth: number;
  /** Objets livrés dans un coffre par l'automatisation. */
  delivered: number;
  structuresBuilt: number;
  playTime: number;
  discovered: string[];
  /** Unités ramassées par ressource. */
  collected: Record<string, number>;
  /** Argent gagné par les caisses d'expédition. */
  autoSold: number;
}

export const PLAYER_SPEED = 72; // unités monde / s
export const BUILD_RANGE = 9; // tuiles
export const VIEW_RADIUS = 9; // tuiles
export const PICKUP_RADIUS = 34;
export const INTERACT_RANGE = 12;

export class GameState implements StructureContext {
  readonly seed: number;
  readonly world: World;
  readonly layout: WorldLayout;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly drops = new DropSystem();
  readonly structures: StructureManager;
  readonly wagons = new WagonSystem();
  /** Wagonnet dans lequel le joueur est monté, ou null. */
  riding: Wagon | null = null;
  money = 0;
  pickaxeLevel = 0;
  bagLevel = 0;
  time = 0;
  autoPickup: Record<string, boolean> = {};
  stats: Stats = {
    tilesMined: 0,
    itemsCollected: 0,
    earned: 0,
    spent: 0,
    maxDepth: 0,
    delivered: 0,
    structuresBuilt: 0,
    playTime: 0,
    discovered: [],
    collected: {},
    autoSold: 0,
  };
  events: SimEvent[] = [];
  private readonly rng: Rng;
  private lastPlayerTile = -1;
  private lastInvFull = -10;
  private lastZone = '';

  constructor(seed: number) {
    this.seed = seed;
    this.layout = generateWorld(seed);
    this.world = this.layout.world;
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.player = new Player(this.layout.spawn.x, this.layout.spawn.y);
    this.inventory = new Inventory(BAGS[0].capacity);
    this.structures = new StructureManager(this.world.w);
    for (const b of this.layout.buildings) this.structures.add(new Building(b.type, b.x, b.y));
    for (const r of RESOURCES) this.autoPickup[r.id] = true;
  }

  // ---------------------------------------------------------------- équipement

  get pickaxe() {
    return PICKAXES[this.pickaxeLevel];
  }

  get bag() {
    return BAGS[this.bagLevel];
  }

  setBagLevel(level: number): void {
    this.bagLevel = level;
    this.inventory.capacity = BAGS[level].capacity;
  }

  // ---------------------------------------------------------------- contexte des structures

  structureAt(x: number, y: number): Structure | undefined {
    return this.structures.at(x, y);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  countDelivered(n: number): void {
    this.stats.delivered += n;
  }

  autoSell(total: number, n: number, from: Structure): void {
    this.money += total;
    this.stats.earned += total;
    this.stats.autoSold += total;
    this.emit({ t: 'shipped', tx: from.x, ty: from.y, total, n });
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, intent: PlayerIntent): void {
    this.time += dt;
    this.stats.playTime += dt;
    if (!this.riding) {
      this.updateMovement(dt, intent);
      this.updateMining(dt, intent);
    }
    for (const d of this.drops.update(dt, this.world)) this.emit({ t: 'crumble', res: d.res, x: d.x, y: d.y });
    this.updatePickup(dt);
    this.structures.update(dt, this);
    this.wagons.update(dt, this);
    if (this.riding) this.followWagon(this.riding);
    this.updateExploration();
  }

  /** Profondeur actuelle du joueur (m). */
  playerDepth(): number {
    return depthAt(this.player.tileY);
  }

  // ---------------------------------------------------------------- déplacement

  private updateMovement(dt: number, intent: PlayerIntent): void {
    const p = this.player;
    let { mx, my } = intent;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    p.moving = len > 0.01;
    if (!p.moving) return;
    // Ralenti pendant un coup de pioche.
    const speed = PLAYER_SPEED * this.bag.speedMul * (p.swingT > 0 ? 0.55 : 1);
    this.moveAxis(mx * speed * dt, 0);
    this.moveAxis(0, my * speed * dt);
    p.walkTime += dt;
    if (p.swingT <= 0) p.facing = dirFromVector(mx, my);
    if (p.swingT <= 0) p.aim = Math.atan2(my, mx);
  }

  /** Vrai si la boîte [x0,x1]×[y0,y1] (unités monde) touche un obstacle. */
  isBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const tx0 = Math.floor(x0 / TILE);
    const tx1 = Math.floor(x1 / TILE);
    const ty0 = Math.floor(y0 / TILE);
    const ty1 = Math.floor(y1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.world.isSolid(tx, ty)) return true;
        const s = this.structures.at(tx, ty);
        if (s && s.solid) return true;
      }
    return false;
  }

  private moveAxis(dx: number, dy: number): void {
    const p = this.player;
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!this.isBlocked(nx - p.halfW, ny - p.halfH, nx + p.halfW - 0.001, ny + p.halfH - 0.001)) {
      p.x = nx;
      p.y = ny;
      return;
    }
    // Glissement le long des coins : petite correction perpendiculaire.
    const nudge = 4;
    for (const off of [nudge, -nudge]) {
      const ox = dy !== 0 ? off : 0;
      const oy = dx !== 0 ? off : 0;
      if (
        !this.isBlocked(nx + ox - p.halfW, ny + oy - p.halfH, nx + ox + p.halfW - 0.001, ny + oy + p.halfH - 0.001) &&
        !this.isBlocked(p.x + ox - p.halfW, p.y + oy - p.halfH, p.x + ox + p.halfW - 0.001, p.y + oy + p.halfH - 0.001)
      ) {
        const step = Math.min(Math.abs(dx) + Math.abs(dy), 1.2);
        p.x += Math.sign(ox) * step;
        p.y += Math.sign(oy) * step;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- minage

  /** Distance (en tuiles) entre le joueur et le centre d'une tuile. */
  distanceToTile(tx: number, ty: number): number {
    const p = this.player;
    return Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - (p.y - 3)) / TILE;
  }

  /** Une tuile peut-elle être frappée ? (portée et présence de roche) */
  canReach(tx: number, ty: number): boolean {
    return this.world.isSolid(tx, ty) && this.distanceToTile(tx, ty) <= this.pickaxe.reach;
  }

  private updateMining(dt: number, intent: PlayerIntent): void {
    const p = this.player;
    const pick = this.pickaxe;
    if (p.swingT > 0) {
      p.swingT -= dt;
      const elapsed = p.swingDuration - p.swingT;
      if (p.swingHitPending && elapsed >= p.swingDuration * 0.45) {
        p.swingHitPending = false;
        if (p.swingTarget) this.strike(p.swingTarget.tx, p.swingTarget.ty);
      }
      if (p.swingT <= 0) p.swingT = 0;
    }
    if (intent.mine && intent.target && p.swingT <= 0 && this.canReach(intent.target.tx, intent.target.ty)) {
      const { tx, ty } = intent.target;
      p.swingDuration = pick.swingTime;
      p.swingT = pick.swingTime;
      p.swingHitPending = true;
      p.swingTarget = { tx, ty };
      const ax = (tx + 0.5) * TILE - p.x;
      const ay = (ty + 0.5) * TILE - (p.y - 3);
      p.aim = Math.atan2(ay, ax);
      p.facing = dirFromVector(ax, ay);
      this.emit({ t: 'swing', x: p.x, y: p.y });
    }
  }

  /** Un coup de pioche sur la tuile (tx, ty). */
  strike(tx: number, ty: number): void {
    const id = this.world.get(tx, ty);
    const block = getBlock(id);
    if (!block.solid) return;
    if (!block.breakable || this.pickaxe.tier < block.tier) {
      this.emit({ t: 'denied', tx, ty, block: id, need: block.breakable ? block.tier : 99 });
      return;
    }
    const i = this.world.idx(tx, ty);
    const dmg = (this.world.damage.get(i) ?? 0) + this.pickaxe.damage;
    if (dmg >= block.hp) {
      this.breakTile(tx, ty);
    } else {
      this.world.damage.set(i, dmg);
      this.emit({ t: 'hit', tx, ty, block: id, ratio: dmg / block.hp });
    }
  }

  /** Détruit une tuile : elle devient praticable et lâche ses ressources. */
  breakTile(tx: number, ty: number): void {
    const id = this.world.get(tx, ty);
    const block = getBlock(id);
    this.world.set(tx, ty, AIR);
    if (block.ore) {
      const res = getResource(block.ore);
      if (res.deposit) this.world.setDeposit(tx, ty, resourceIndex(res.id), this.rng.range(res.deposit[0], res.deposit[1]));
    }
    if (block.drop && this.rng.chance(block.drop.chance)) {
      const n = this.rng.int(block.drop.min, block.drop.max);
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      // Les morceaux jaillissent plutôt du côté du mineur.
      const toward = Math.atan2(this.player.y - 3 - cy, this.player.x - cx);
      for (let k = 0; k < n; k++) {
        const d = this.drops.spawn(block.drop.res, 1, cx, cy);
        const a = toward + (this.rng.float() - 0.5) * 1.6;
        const sp = 30 + this.rng.float() * 30;
        d.vx = Math.cos(a) * sp;
        d.vy = Math.sin(a) * sp;
      }
    }
    this.stats.tilesMined++;
    this.emit({ t: 'break', tx, ty, block: id });
    this.lastPlayerTile = -1; // force une mise à jour de la visibilité
  }

  // ---------------------------------------------------------------- ramassage

  private updatePickup(dt: number): void {
    const p = this.player;
    const px = p.x;
    const py = p.y - 3;
    for (const d of [...this.drops.list]) {
      const dist = Math.hypot(d.x - px, d.y - py);
      if (d.locked) {
        // Objet jeté volontairement : ignoré tant que le joueur n'est pas reparti.
        if (dist > 30) d.locked = false;
        continue;
      }
      if (d.age < 0.35 || !this.autoPickup[d.res]) {
        d.magnet = false;
        continue;
      }
      const room = this.inventory.room(d.res);
      if (!d.magnet) {
        if (dist < PICKUP_RADIUS) {
          if (room >= 1) d.magnet = true;
          else if (this.time - this.lastInvFull > 3) {
            this.lastInvFull = this.time;
            this.emit({ t: 'invFull' });
          }
        }
        continue;
      }
      if (room < 1 || dist > PICKUP_RADIUS * 2) {
        d.magnet = false;
        continue;
      }
      if (dist < 5) {
        const n = this.inventory.add(d.res, d.count);
        d.count -= n;
        this.stats.itemsCollected += n;
        this.stats.collected[d.res] = (this.stats.collected[d.res] ?? 0) + n;
        if (n > 0) this.emit({ t: 'pickup', res: d.res, n, x: d.x, y: d.y });
        if (d.count <= 0) this.drops.remove(d);
        else d.magnet = false;
        continue;
      }
      const speed = 90 + 160 * Math.min(1, d.age);
      d.x += ((px - d.x) / dist) * speed * dt;
      d.y += ((py - d.y) / dist) * speed * dt;
      d.z = Math.max(d.z, 3);
    }
  }

  /** Jette des ressources du sac au sol (elles restent physiquement dans le monde). */
  dropFromInventory(res: string, n: number): number {
    const k = this.inventory.remove(res, n);
    if (k > 0) {
      const d = this.drops.spawn(res, k, this.player.x, this.player.y + 2);
      d.locked = true;
    }
    return k;
  }

  // ---------------------------------------------------------------- exploration

  private updateExploration(): void {
    const p = this.player;
    const ti = this.world.idx(p.tileX, p.tileY);
    if (ti === this.lastPlayerTile) return;
    this.lastPlayerTile = ti;
    const revealed = revealAround(this.world, p.tileX, p.tileY, VIEW_RADIUS);
    for (const i of revealed) {
      const block = getBlock(this.world.tiles[i]);
      const ore = block.ore ?? (this.world.deposit[i] ? RESOURCES[this.world.deposit[i] - 1].id : null);
      if (ore && !this.stats.discovered.includes(ore)) {
        this.stats.discovered.push(ore);
        const r = getResource(ore);
        this.emit({ t: 'discover', text: `Découverte : ${r.name} (${r.rarity})` });
      }
    }
    const depth = this.playerDepth();
    if (depth > this.stats.maxDepth) this.stats.maxDepth = depth;
    if (p.tileY >= SURFACE_ROWS) {
      const zone = zoneForDepth(depth).name;
      if (zone !== this.lastZone) {
        if (this.lastZone) this.emit({ t: 'discover', text: `${zone} — ${Math.floor(depth)} m` });
        this.lastZone = zone;
      }
    }
  }

  // ---------------------------------------------------------------- interaction

  /** Structure interactive la plus proche du joueur (bâtiment, coffre, foreuse). */
  nearestInteractable(): Structure | null {
    const p = this.player;
    let best: Structure | null = null;
    let bestD = INTERACT_RANGE;
    // Recherche locale (indépendante du nombre total de structures).
    const seen = new Set<Structure>();
    for (let ty = p.tileY - 3; ty <= p.tileY + 3; ty++)
      for (let tx = p.tileX - 3; tx <= p.tileX + 3; tx++) {
        const s = this.structures.at(tx, ty);
        if (s) seen.add(s);
      }
    for (const s of seen) {
      if ((s.isBelt && !s.configurable) || s.inert) continue;
      const x0 = s.x * TILE;
      const y0 = s.y * TILE;
      const x1 = (s.x + s.w) * TILE;
      const y1 = (s.y + s.h) * TILE;
      const dx = Math.max(x0 - (p.x + p.halfW), 0, p.x - p.halfW - x1);
      const dy = Math.max(y0 - (p.y + p.halfH), 0, p.y - p.halfH - y1);
      const d = Math.hypot(dx, dy);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  isNear(type: BuildingType | string): boolean {
    return this.nearestInteractable()?.type === type;
  }

  // ---------------------------------------------------------------- économie

  sell(res: string, n: number): number {
    if (!this.isNear('counter')) return 0;
    const k = this.inventory.remove(res, n);
    if (k <= 0) return 0;
    const total = k * getResource(res).value;
    this.money += total;
    this.stats.earned += total;
    this.emit({ t: 'sold', total, n: k });
    return total;
  }

  sellAll(): number {
    if (!this.isNear('counter')) return 0;
    let total = 0;
    let n = 0;
    for (const [res, count] of Object.entries(this.inventory.items)) {
      this.inventory.remove(res, count);
      total += count * getResource(res).value;
      n += count;
    }
    if (n > 0) {
      this.money += total;
      this.stats.earned += total;
      this.emit({ t: 'sold', total, n });
    }
    return total;
  }

  private pay(price: number): boolean {
    if (this.money < price) return false;
    this.money -= price;
    this.stats.spent += price;
    return true;
  }

  buyNextPickaxe(): boolean {
    const next = PICKAXES[this.pickaxeLevel + 1];
    if (!next || !this.isNear('workshop') || !this.pay(next.price)) return false;
    this.pickaxeLevel++;
    this.emit({ t: 'bought', name: next.name });
    return true;
  }

  buyNextBag(): boolean {
    const next = BAGS[this.bagLevel + 1];
    if (!next || !this.isNear('workshop') || !this.pay(next.price)) return false;
    this.setBagLevel(this.bagLevel + 1);
    this.emit({ t: 'bought', name: next.name });
    return true;
  }

  isUnlocked(machineId: string): boolean {
    const def = getMachine(machineId);
    return !def.unlock || this.pickaxe.tier >= def.unlock.pickaxeTier;
  }

  buyKit(machineId: string, qty: number): boolean {
    const def = getMachine(machineId);
    if (!this.isNear('workshop') || !this.isUnlocked(machineId) || !this.pay(def.price * qty)) return false;
    this.inventory.addKit(machineId, qty);
    this.emit({ t: 'bought', name: qty > 1 ? `${def.name} ×${qty}` : def.name });
    return true;
  }

  // ---------------------------------------------------------------- construction

  canPlace(machineId: string, tx: number, ty: number): { ok: boolean; reason?: string } {
    const def = getMachine(machineId);
    if (this.inventory.kitCount(machineId) <= 0) return { ok: false, reason: `Aucun ${def.name.toLowerCase()} en stock` };
    if (this.distanceToTile(tx, ty) > BUILD_RANGE) return { ok: false, reason: 'Trop loin' };
    if (def.onTrack) {
      if (!this.structures.at(tx, ty)?.isTrack) return { ok: false, reason: 'Se pose sur des rails' };
      if (this.wagons.at(tx, ty)) return { ok: false, reason: 'Il y a déjà un wagonnet ici' };
      return { ok: true };
    }
    if (this.beltToReplace(machineId, tx, ty) || this.railToReplace(machineId, tx, ty)) return { ok: true };
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        if (!this.world.isOpen(x, y)) return { ok: false, reason: 'Il faut un sol dégagé' };
        if (this.structures.at(x, y)) return { ok: false, reason: 'Emplacement occupé' };
      }
    if (def.needsDeposit && !this.world.depositAt(tx, ty)) return { ok: false, reason: 'Doit être posée sur un gisement exposé' };
    if (def.surfaceOnly && ty + def.h > SURFACE_ROWS) return { ok: false, reason: 'À poser en surface, au camp' };
    if (def.solid) {
      const p = this.player;
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const overlap = p.x + p.halfW > x0 && p.x - p.halfW < x0 + def.w * TILE && p.y + p.halfH > y0 && p.y - p.halfH < y0 + def.h * TILE;
      if (overlap) return { ok: false, reason: 'Vous êtes dans le passage' };
    }
    return { ok: true };
  }

  /** Rail simple qu'un aiguillage posé en (tx, ty) remplacerait, sinon null. */
  railToReplace(machineId: string, tx: number, ty: number): Rail | null {
    const existing = this.structures.at(tx, ty);
    return getMachine(machineId).railSwitch && existing instanceof Rail ? existing : null;
  }

  /** Convoyeur d'un autre niveau que `machineId` pourrait remplacer en (tx, ty), sinon null. */
  beltToReplace(machineId: string, tx: number, ty: number): Conveyor | null {
    const existing = this.structures.at(tx, ty);
    return getMachine(machineId).conveyor && existing instanceof Conveyor && existing.type !== machineId ? existing : null;
  }

  /**
   * Pose une machine. Un convoyeur posé sur un convoyeur d'un autre niveau le remplace :
   * les objets transportés sont conservés et l'ancien convoyeur revient dans le stock.
   */
  place(machineId: string, tx: number, ty: number, dir: Dir): Structure | Wagon | null {
    if (!this.canPlace(machineId, tx, ty).ok) return null;
    const def = getMachine(machineId);
    if (def.onTrack) {
      this.inventory.removeKit(machineId);
      const w = this.wagons.add(new Wagon(tx, ty, dir));
      this.stats.structuresBuilt++;
      this.emit({ t: 'placed', type: machineId, tx, ty });
      return w;
    }
    const factory = STRUCTURE_FACTORIES[machineId];
    if (!factory) return null;
    const replaced = this.beltToReplace(machineId, tx, ty);
    if (replaced) {
      this.structures.remove(replaced);
      this.inventory.addKit(replaced.type);
    }
    const replacedRail = this.railToReplace(machineId, tx, ty);
    if (replacedRail) {
      this.structures.remove(replacedRail);
      this.inventory.addKit('rail');
    }
    this.inventory.removeKit(machineId);
    const s = this.structures.add(factory.create(tx, ty, def.rotatable ? dir : 1));
    if (replaced && s instanceof Conveyor) {
      s.items = replaced.items.slice(0, s.capacity);
      for (const extra of replaced.items.slice(s.capacity)) this.drops.spawn(extra.res, 1, (tx + 0.5) * TILE, (ty + 0.5) * TILE);
    }
    this.stats.structuresBuilt++;
    if (def.solid) {
      // Les objets au sol sous une machine pleine sont repoussés vers le joueur.
      for (const d of this.drops.list)
        if (Math.floor(d.x / TILE) === tx && Math.floor(d.y / TILE) === ty) {
          d.x = this.player.x;
          d.y = this.player.y;
        }
    }
    this.emit({ t: 'placed', type: machineId, tx, ty });
    return s;
  }

  /** Démonte le wagonnet ou la structure en (tx, ty). Son contenu tombe au sol. */
  removeAt(tx: number, ty: number): boolean {
    const w = this.wagons.at(tx, ty);
    if (w && this.distanceToTile(tx, ty) <= BUILD_RANGE) {
      if (w === this.riding) this.leaveWagon();
      this.wagons.remove(w);
      this.inventory.addKit('wagon');
      for (const [res, n] of Object.entries(w.cargo)) this.drops.spawn(res, n, w.px(), w.py());
      this.emit({ t: 'removed', type: 'wagon', tx, ty });
      return true;
    }
    const s = this.structures.at(tx, ty);
    if (!s || !s.removable) return false;
    if (this.distanceToTile(tx, ty) > BUILD_RANGE) return false;
    this.structures.remove(s);
    this.inventory.addKit(s.type);
    for (const [res, n] of Object.entries(s.contents())) this.drops.spawn(res, n, (s.x + 0.5) * TILE, (s.y + 0.5) * TILE);
    // Le kit rendu est une foreuse de base : les améliorations sont remboursées.
    const refund = s instanceof Drill ? s.upgradeValue() : 0;
    if (refund > 0) {
      this.money += refund;
      this.stats.spent -= refund;
      this.emit({ t: 'message', text: `Améliorations de la foreuse remboursées : +${refund} $`, kind: 'good' });
    }
    this.emit({ t: 'removed', type: s.type, tx, ty });
    return true;
  }

  rotateAt(tx: number, ty: number): boolean {
    const s = this.structures.at(tx, ty);
    if (!s || !s.removable || !getMachine(s.type).rotatable) return false;
    s.dir = ((s.dir + 1) % 4) as Dir;
    this.structures.invalidate();
    return true;
  }

  // ---------------------------------------------------------------- wagonnets

  /** Wagonnet assez proche du joueur pour y monter. */
  nearestWagon(): Wagon | null {
    let best: Wagon | null = null;
    let bestD = TILE * 1.6;
    for (const w of this.wagons.list) {
      const d = Math.hypot(w.px() - this.player.x, w.py() - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  rideWagon(w: Wagon): void {
    if (this.riding) this.leaveWagon();
    this.riding = w;
    w.rider = true;
    w.hold = false;
    w.boardWait = 0;
    this.player.swingT = 0;
    this.followWagon(w);
  }

  /** Descend du wagonnet sur une case libre à côté de lui. */
  leaveWagon(): void {
    const w = this.riding;
    if (!w) return;
    w.rider = false;
    w.hold = false;
    this.riding = null;
    const cx = w.tileX();
    const cy = w.tileY();
    const p = this.player;
    const spots: [number, number][] = [
      [cx, cy + 1],
      [cx, cy - 1],
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy],
    ];
    for (const [x, y] of spots) {
      const px = (x + 0.5) * TILE;
      const py = (y + 0.5) * TILE;
      if (!this.isBlocked(px - p.halfW, py - p.halfH, px + p.halfW - 0.001, py + p.halfH - 0.001)) {
        p.x = px;
        p.y = py;
        return;
      }
    }
  }

  private followWagon(w: Wagon): void {
    this.player.x = w.px();
    this.player.y = w.py() + 1;
    this.player.moving = false;
  }

  // ---------------------------------------------------------------- aiguillages

  /** Règle la branche prise par les wagonnets venant de la pointe. */
  setSwitch(sw: RailSwitch, setting: SwitchSetting): boolean {
    if (!['straight', 'left', 'right', 'alt'].includes(setting)) return false;
    sw.setting = setting;
    return true;
  }

  // ---------------------------------------------------------------- quais

  /** Vide le sac dans un quai (de chargement). */
  stationDepositAll(st: RailStation): number {
    let n = 0;
    for (const [res, count] of Object.entries(this.inventory.items)) {
      const k = st.put(res, count);
      this.inventory.remove(res, k);
      n += k;
    }
    return n;
  }

  /** Prend le contenu d'un quai (les minerais les plus précieux d'abord). */
  stationTakeAll(st: RailStation): number {
    let n = 0;
    const order = Object.keys(st.items).sort((a, b) => getResource(b).value - getResource(a).value);
    for (const res of order) {
      const k = st.take(res, Math.min(st.items[res] ?? 0, this.inventory.room(res)));
      this.inventory.add(res, k);
      n += k;
    }
    if (Object.keys(st.items).length) this.emit({ t: 'invFull' });
    return n;
  }

  // ---------------------------------------------------------------- machines

  /** Choisit le minerai qu'un trieur envoie tout droit (null = tout va tout droit). */
  setSorterFilter(s: Sorter, res: string | null): boolean {
    if (res !== null && !hasResource(res)) return false;
    s.filter = res;
    return true;
  }

  /** Charge le charbon du sac dans une foreuse. */
  fuelDrill(d: Drill): number {
    const fuel = d.def.fuel;
    if (!fuel) return 0;
    const k = d.addFuel(this.inventory.count(fuel.res));
    this.inventory.remove(fuel.res, k);
    return k;
  }

  /** Pourquoi l'amélioration suivante d'une foreuse est impossible, ou null si elle l'est. */
  drillUpgradeBlocker(d: Drill): string | null {
    const next = d.nextLevel();
    if (!next) return 'Niveau maximal atteint';
    if (next.unlock && this.pickaxe.tier < next.unlock.pickaxeTier) return next.unlock.text;
    if (this.money < next.price) return 'Pas assez d\'argent';
    return null;
  }

  /** Améliore une foreuse posée : elle couvre plus de cases. */
  upgradeDrill(d: Drill): boolean {
    const next = d.nextLevel();
    if (!next || this.drillUpgradeBlocker(d) || !this.pay(next.price)) return false;
    d.level = next.level;
    this.emit({ t: 'bought', name: `${d.def.name} niveau ${next.level}` });
    return true;
  }

  /** Récupère la production en attente dans une foreuse. */
  collectDrill(d: Drill): number {
    let n = 0;
    while (d.buffer.length && this.inventory.room(d.buffer[0]) >= 1) {
      this.inventory.add(d.buffer.shift()!, 1);
      n++;
    }
    if (d.buffer.length) this.emit({ t: 'invFull' });
    return n;
  }

  storageTake(s: Storage, res: string, n: number): number {
    const k = s.take(res, Math.min(n, this.inventory.room(res)));
    this.inventory.add(res, k);
    return k;
  }

  storageTakeAll(s: Storage): number {
    let n = 0;
    // Les minerais les plus précieux d'abord.
    const order = Object.keys(s.items).sort((a, b) => getResource(b).value - getResource(a).value);
    for (const res of order) n += this.storageTake(s, res, s.items[res] ?? 0);
    if (Object.keys(s.items).length) this.emit({ t: 'invFull' });
    return n;
  }

  /** Vide le sac dans une caisse d'expédition (vendu au prochain passage). */
  shipDepositAll(c: ShippingCrate): number {
    let n = 0;
    for (const [res, count] of Object.entries(this.inventory.items)) {
      const k = c.put(res, count);
      this.inventory.remove(res, k);
      n += k;
    }
    return n;
  }

  storageDepositAll(s: Storage): number {
    let n = 0;
    for (const [res, count] of Object.entries(this.inventory.items)) {
      const k = s.put(res, count);
      this.inventory.remove(res, k);
      n += k;
    }
    return n;
  }

  /** Liste des machines achetables (pour l'interface). */
  static get machineCatalog() {
    return MACHINES;
  }
}
