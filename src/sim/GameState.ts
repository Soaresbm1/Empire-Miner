/**
 * État complet d'une partie + boucle de simulation (indépendante du rendu).
 *
 * Tout ce qui se passe « dans le monde » est ici : déplacement, minage,
 * ressources au sol, économie, construction, machines. La présentation
 * (rendu, audio, interface) lit cet état et consomme `events`.
 */
import { SURFACE_ROWS, TILE, depthAt } from '../core/constants';
import { DX, DY, Dir, dirFromVector, rotateCW } from '../core/dir';
import { Rng } from '../core/rng';
import { AIR, getBlock } from '../data/blocks';
import { zoneForDepth } from '../data/depth';
import { getMachine, kitId, kitName, MACHINES, parseKit } from '../data/machines';
import { CAUSE_HAZARD, GEAR, HazardKind, getGear } from '../data/gear';
import { GAS, HEALTH, HEAT, WATER } from '../data/hazards';
import { RESOURCES, getResource, hasResource, resourceIndex } from '../data/resources';
import { BAGS, JACKHAMMER, PICKAXES, ROPE, SCOOTER } from '../data/tools';
import { WORKERS, getJob, workerPrice, type WorkerJob } from '../data/workers';
import { Drop, DropSystem } from './Drops';
import { HazardSystem } from './Hazards';
import { MARKER_KINDS, Marker, MarkerBook, MarkerKind } from './Markers';
import { ProductionLog } from './Production';
import type { SimEvent, ToolKind } from './events';
import { generateWorld, WorldLayout } from './generator';
import { Inventory } from './Inventory';
import { Market } from './Market';
import { Player } from './Player';
import { StructureManager } from './StructureManager';
import { Building, BuildingType } from './structures/Building';
import { Conveyor } from './structures/Conveyor';
import { Rail, type RailStation, type RailSwitch, type SwitchSetting } from './structures/Rail';
import { TunnelBorer } from './structures/Borer';
import { Smelter } from './structures/Smelter';
import { Drill } from './structures/Drill';
import { ShippingCrate } from './structures/ShippingCrate';
import type { Sorter } from './structures/Sorter';
import { STRUCTURE_FACTORIES } from './structures/registry';
import { Storage } from './structures/Storage';
import type { Structure, StructureContext } from './structures/Structure';
import { revealAround } from './visibility';
import { Wagon, WagonSystem } from './Wagons';
import { WorkerSystem } from './Workers';
import type { World } from './World';

export interface PlayerIntent {
  /** Direction de déplacement souhaitée (-1..1). */
  mx: number;
  my: number;
  /** Bouton de minage maintenu. */
  mine: boolean;
  /** Tuile visée (souris ou direction). */
  target: { tx: number; ty: number } | null;
  /** Touche Maj maintenue : le joueur monte sur sa trottinette s'il en a une. */
  ride?: boolean;
}

export const NO_INTENT: PlayerIntent = { mx: 0, my: 0, mine: false, target: null };

/** Caractéristiques de minage de l'outil en main (pioche ou marteau-piqueur). */
export interface MiningTool {
  kind: ToolKind;
  name: string;
  tier: number;
  damage: number;
  swingTime: number;
  reach: number;
  /** Nombre de cases frappées par coup (1 pour une pioche). */
  width: number;
}

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
  /** Lingots sortis des fours et fonderies. */
  smelted: number;
  /** Évanouissements (grisou, noyade, éboulement). */
  faints: number;
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
  /** Éboulements, grisou et eau. */
  readonly hazards: HazardSystem;
  /** Repères posés sur la carte. */
  readonly markers = new MarkerBook();
  /** Extraction, fonte et ventes minute après minute (panneau Statistiques). */
  readonly production = new ProductionLog(() => this.time);
  /** Cours du marché : prix de vente variables, événements « forte demande de cuivre »… */
  readonly market: Market;
  /** Ouvriers achetés à l'Atelier : ramasseurs et ravitailleurs. */
  readonly workers = new WorkerSystem();
  /** Type de repère choisi dans le panneau de la carte (pour le prochain repère posé). */
  markerKind: MarkerKind = 'point';
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
  /** Marteau-piqueur acheté, outil en main, secondes de charbon restantes dans le marteau. */
  hasJackhammer = false;
  tool: ToolKind = 'pickaxe';
  hammerFuel = 0;
  /** Trottinette à moteur achetée à l'Atelier, et vrai tant que le joueur la chevauche (Maj maintenue). */
  hasScooter = false;
  scootering = false;
  /** Cordes de rappel en stock, case où la dernière a été accrochée (point de retour) et temps restant de la manœuvre. */
  ropes = 0;
  ropeAnchor: { tx: number; ty: number } | null = null;
  ropeT = 0;
  /** Sens de la manœuvre en cours : remonter au camp ou redescendre au point d'accroche. */
  ropeDir: 'up' | 'down' | null = null;
  /** Équipement de protection acheté à l'Atelier (identifiants de `GEAR`). */
  readonly gear = new Set<string>();
  private lastNoFuel = -99;
  private lastHeatWarn = -99;
  private lastShieldMsg = -99;
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
    smelted: 0,
    faints: 0,
  };
  /** Santé du joueur (0 à HEALTH.max) ; à 0, il s'évanouit et se réveille au camp. */
  hp = HEALTH.max;
  private lastHurt = -99;
  private lastHurtEvent = -99;
  events: SimEvent[] = [];
  private readonly rng: Rng;
  private lastPlayerTile = -1;
  private lastInvFull = -10;
  private lastZone = '';

  constructor(seed: number) {
    this.seed = seed;
    this.layout = generateWorld(seed);
    this.world = this.layout.world;
    // Les événements du marché ne concernent que des minerais que le joueur connaît déjà.
    this.market = new Market(
      seed,
      (res) => this.stats.discovered.includes(res) || (this.stats.collected[res] ?? 0) > 0,
      (e) => this.emit({ t: 'market', res: e.res, up: e.up, pct: e.pct }),
    );
    this.hazards = new HazardSystem(this);
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

  hasGear(id: string): boolean {
    return this.gear.has(id);
  }

  /** Part (0 à 1) des dégâts d'un danger absorbée par l'équipement porté. */
  absorb(hazard: HazardKind): number {
    let kept = 1;
    for (const def of GEAR) if (def.hazard === hazard && this.gear.has(def.id)) kept *= 1 - def.absorb;
    return 1 - kept;
  }

  // ---------------------------------------------------------------- contexte des structures

  structureAt(x: number, y: number): Structure | undefined {
    return this.structures.at(x, y);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  countExtracted(res: string, _from: Structure): void {
    this.production.addOre(res, 1, true);
  }

  countSmelted(res: string, from: Structure): void {
    this.stats.smelted++;
    this.production.addIngot(res);
    // Premier lingot d'un métal : il rejoint le carnet (inventaire, trieur).
    if (!this.stats.discovered.includes(res)) {
      this.stats.discovered.push(res);
      this.emit({ t: 'discover', text: `Premier ${getResource(res).name.toLowerCase()} sorti du ${from.type === 'foundry' ? 'haut fourneau' : 'four'} !` });
    }
  }

  countDelivered(n: number): void {
    this.stats.delivered += n;
  }

  autoSell(total: number, n: number, from: Structure, items: Record<string, number> = {}): void {
    this.money += total;
    this.stats.earned += total;
    this.stats.autoSold += total;
    this.production.addSale(items, total, true);
    this.emit({ t: 'shipped', tx: from.x, ty: from.y, total, n });
  }

  digTile(tx: number, ty: number, from: { x: number; y: number }): Drop[] {
    return this.breakTile(tx, ty, from);
  }

  /** Foreuse de percement dont la foreuse, sortie de sa base, occupe la case. */
  borerAt(x: number, y: number): TunnelBorer | null {
    for (const b of this.structures.borers) if (b.occupies(x, y)) return b;
    return null;
  }

  occupied(x: number, y: number): boolean {
    const p = this.player;
    const x0 = x * TILE;
    const y0 = y * TILE;
    const onPlayer = p.x + p.halfW > x0 && p.x - p.halfW < x0 + TILE && p.y + p.halfH > y0 && p.y - p.halfH < y0 + TILE;
    return onPlayer || !!this.wagons.at(x, y);
  }

  reveal(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.world.setExplored(x + dx, y + dy);
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, intent: PlayerIntent): void {
    this.time += dt;
    this.stats.playTime += dt;
    this.market.update(this.time);
    this.workers.update(dt, this);
    if (!this.riding) {
      // Maj maintenue : on monte sur la trottinette (relâchée : on en descend). Les mains sont au
      // guidon, donc plus de minage, et un coup de pioche en cours est interrompu.
      const ride = this.hasScooter && !!intent.ride;
      if (ride && !this.scootering) this.cancelSwing();
      if (ride !== this.scootering) this.emit({ t: 'mount', on: ride });
      this.scootering = ride;
      this.updateMovement(dt, intent);
      if (!this.scootering) this.updateMining(dt, intent);
      this.updateRope(dt, intent);
    } else {
      // Monté dans un wagonnet : la trottinette et la corde sont rangées.
      if (this.scootering) {
        this.scootering = false;
        this.emit({ t: 'mount', on: false });
      }
      if (this.ropeT > 0) this.cancelRope('Dans un wagonnet : la corde est rangée.');
    }
    for (const d of this.drops.update(dt, this.world)) this.emit({ t: 'crumble', res: d.res, x: d.x, y: d.y });
    this.updatePickup(dt);
    this.structures.update(dt, this);
    this.wagons.update(dt, this);
    if (this.riding) this.followWagon(this.riding);
    this.hazards.update(dt);
    this.updateHealth(dt);
    this.updateExploration();
  }

  // ---------------------------------------------------------------- repères

  /**
   * Pose un repère en (x, y), nommé d'après ce qui s'y trouve. Renvoie null hors de la carte
   * ou si la liste est pleine ; sur une case déjà marquée, le repère est mis à jour.
   */
  addMarker(kind: MarkerKind, x: number, y: number): Marker | null {
    if (!this.world.inBounds(x, y)) return null;
    return this.markers.add(kind, x, y, this.markerLabel(kind, x, y));
  }

  /** Nom d'un repère : filon, gisement, machine ou danger à cet endroit, sinon « Repère 3 ». */
  markerLabel(kind: MarkerKind, x: number, y: number): string {
    const w = this.world;
    const ore = (): string | null => {
      // Filon dans la paroi ou gisement au sol, parmi les cases vues à 2 cases au plus.
      let best: string | null = null;
      let bestD = 99;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!w.inBounds(nx, ny) || !w.explored[w.idx(nx, ny)]) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d >= bestD) continue;
          const b = getBlock(w.get(nx, ny));
          const dep = w.depositAt(nx, ny);
          if (b.ore) best = b.name;
          else if (dep) best = `Gisement de ${getResource(dep).name.toLowerCase()}`;
          else continue;
          bestD = d;
        }
      return best;
    };
    const machine = (): string | null => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const s = this.structures.at(x + dx, y + dy);
          if (!s || s.isBelt || s.isTrack || s.type === 'prop') continue;
          return s instanceof Building ? s.name : getMachine(s.type).name;
        }
      return null;
    };
    const danger = (): string | null => {
      if (w.inBounds(x, y) && w.gas[w.idx(x, y)] > 0) return 'Grisou';
      if (w.inBounds(x, y) && w.water[w.idx(x, y)] > 0) return 'Galerie inondée';
      if (this.hazards.pendingNear(x, y)) return 'Plafond qui craque';
      return null;
    };
    const found = kind === 'ore' ? ore() : kind === 'base' ? machine() : kind === 'danger' ? danger() : (machine() ?? ore());
    return found ?? `${MARKER_KINDS[kind].name} ${this.markers.count(kind) + 1}`;
  }

  // ---------------------------------------------------------------- santé

  /** Blesse le joueur ; à 0 point de vie, il s'évanouit. */
  hurtPlayer(amount: number, cause: string): void {
    if (amount <= 0 || this.hp <= 0) return;
    // L'équipement absorbe une part des dégâts ; on le dit après un gros choc.
    const hazard = CAUSE_HAZARD[cause];
    const shield = hazard ? this.absorb(hazard) : 0;
    if (shield > 0) {
      if (amount >= 10 && this.time - this.lastShieldMsg >= 3) {
        this.lastShieldMsg = this.time;
        this.emit({ t: 'message', text: `Votre équipement amortit le choc : −${Math.round(shield * 100)} % de dégâts.`, kind: 'good' });
      }
      amount *= 1 - shield;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.lastHurt = this.time;
    if (this.ropeT > 0 && amount >= ROPE.interruptDamage) this.cancelRope('Le choc vous fait lâcher la corde !');
    // Dégâts continus (gaz, eau) : un événement de temps en temps suffit à l'écran et au son.
    if (amount >= 10 || this.time - this.lastHurtEvent >= 0.4) {
      this.lastHurtEvent = this.time;
      this.emit({ t: 'hurt', amount, cause });
    }
    if (this.hp <= 0) this.faint(cause);
  }

  hurtPlayerNear(x: number, y: number, radius: number, amount: number, cause: string): void {
    const p = this.player;
    if (Math.max(Math.abs(p.x / TILE - (x + 0.5)), Math.abs(p.y / TILE - (y + 0.5))) <= radius) this.hurtPlayer(amount, cause);
  }

  random(): number {
    return this.rng.float();
  }

  /** Grisou et eau profonde sous les pieds du joueur ; récupération hors de danger. */
  private updateHealth(dt: number): void {
    const p = this.player;
    if (this.hazards.gasAt(p.tileX, p.tileY) >= GAS.harmful) this.hurtPlayer(GAS.dps * dt, 'grisou');
    if (this.hazards.waterAt(p.tileX, p.tileY) >= WATER.deep) this.hurtPlayer(WATER.dps * dt, 'noyade');
    // Fournaise : la chaleur épuise, sauf près d'un ventilateur.
    const heat = this.hazards.heatAt(p.tileY);
    if (heat !== null && !this.hazards.cooled(p.tileX, p.tileY)) {
      this.hurtPlayer((HEAT.hurtTop + (HEAT.hurtBottom - HEAT.hurtTop) * heat) * dt, 'chaleur');
      if (this.time - this.lastHeatWarn >= 40) {
        this.lastHeatWarn = this.time;
        this.emit({
          t: 'message',
          text: this.gear.has('suit')
            ? 'La Fournaise brûle : la combinaison tient, mais un ventilateur vous laissera souffler.'
            : 'La chaleur vous épuise ! Une combinaison ignifugée (Atelier) ou un ventilateur tout près vous protège.',
          kind: 'warn',
        });
      }
    }
    if (this.hp < HEALTH.max && this.time - this.lastHurt >= HEALTH.regenDelay) this.hp = Math.min(HEALTH.max, this.hp + HEALTH.regen * dt);
  }

  /** Évanoui : le sac tombe sur place, le joueur se réveille au camp, en pleine forme. */
  private faint(cause: string): void {
    if (this.riding) this.leaveWagon();
    this.ropeT = 0;
    this.ropeDir = null;
    const p = this.player;
    for (const [res, n] of Object.entries(this.inventory.items)) if (n > 0) this.drops.spawn(res, n, p.x, p.y - 3);
    this.inventory.items = {};
    p.x = (this.layout.spawn.x + 0.5) * TILE;
    p.y = (this.layout.spawn.y + 0.5) * TILE;
    p.swingT = 0;
    this.hp = HEALTH.max;
    this.lastHurt = -99;
    this.stats.faints++;
    this.lastPlayerTile = -1;
    this.emit({ t: 'faint', cause });
    this.emit({ t: 'message', text: `Vous vous êtes évanoui (${cause}) ! On vous a remonté au camp ; votre sac est resté au fond.`, kind: 'bad' });
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
    const speed = PLAYER_SPEED * this.bag.speedMul * (this.scootering ? SCOOTER.speedMul : 1) * (p.swingT > 0 ? 0.55 : 1) * this.hazards.speedFactor(p.tileX, p.tileY, this.gear.has('boots'));
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
        if (this.borerAt(tx, ty)) return true;
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

  /** Caractéristiques de l'outil en main (le marteau-piqueur seulement s'il a été acheté). */
  get activeTool(): MiningTool {
    return this.toolStats(this.tool === 'jackhammer' && this.hasJackhammer ? 'jackhammer' : 'pickaxe');
  }

  toolStats(kind: ToolKind): MiningTool {
    if (kind === 'jackhammer') return { kind, name: JACKHAMMER.name, tier: JACKHAMMER.tier, damage: JACKHAMMER.damage, swingTime: JACKHAMMER.swingTime, reach: JACKHAMMER.reach, width: JACKHAMMER.width };
    const p = this.pickaxe;
    return { kind, name: p.name, tier: p.tier, damage: p.damage, swingTime: p.swingTime, reach: p.reach, width: 1 };
  }

  /** Une tuile peut-elle être frappée ? (portée et présence de roche) */
  canReach(tx: number, ty: number): boolean {
    return this.world.isSolid(tx, ty) && this.distanceToTile(tx, ty) <= this.activeTool.reach;
  }

  /** Passe de la pioche au marteau-piqueur et inversement. */
  toggleTool(): boolean {
    if (!this.hasJackhammer) {
      this.emit({ t: 'message', text: "Pas de marteau-piqueur : il s'achète à l'Atelier.", kind: 'warn' });
      return false;
    }
    this.tool = this.tool === 'jackhammer' ? 'pickaxe' : 'jackhammer';
    this.emit({ t: 'message', text: `En main : ${this.activeTool.name}`, kind: 'info' });
    return true;
  }

  /** Brûle `seconds` de charbon dans le marteau-piqueur, en rechargeant depuis le sac. Faux s'il n'y en a plus. */
  private burnHammerFuel(seconds: number): boolean {
    const fuel = JACKHAMMER.fuel;
    while (this.hammerFuel < seconds) {
      if (this.inventory.remove(fuel.res, 1) < 1) return false;
      this.hammerFuel += fuel.secondsPerUnit;
    }
    this.hammerFuel -= seconds;
    return true;
  }

  // ---------------------------------------------------------------- corde de rappel

  /** Au camp (surface) : là où l'on redescend plutôt que l'on remonte. */
  get atCamp(): boolean {
    return this.player.tileY < SURFACE_ROWS;
  }

  /**
   * Touche V : commence la manœuvre (remonter depuis la mine, redescendre depuis le camp), ou l'annule
   * si elle est en cours. Renvoie ce qui s'est passé, pour l'interface et les tests.
   */
  useRope(): 'start' | 'cancel' | 'refused' {
    if (this.ropeT > 0) {
      this.cancelRope('Vous rangez la corde.');
      return 'cancel';
    }
    const refuse = (text: string) => {
      this.emit({ t: 'message', text, kind: 'warn' });
      return 'refused' as const;
    };
    if (this.riding) return refuse('Descendez du wagonnet pour utiliser la corde.');
    if (this.hp <= 0) return 'refused';
    if (this.atCamp) {
      if (!this.ropeAnchor) return refuse(this.ropes > 0 ? 'Vous êtes déjà au camp : la corde servira pour remonter de la mine.' : 'Aucune corde accrochée dans la mine. Elles s’achètent à l’Atelier.');
      this.ropeDir = 'down';
    } else {
      if (this.ropes <= 0) return refuse('Vous n’avez pas de corde de rappel : elles s’achètent à l’Atelier.');
      this.ropeDir = 'up';
    }
    this.ropeT = ROPE.channel;
    this.cancelSwing();
    this.emit({ t: 'rope', phase: 'start' });
    this.emit({ t: 'message', text: this.ropeDir === 'up' ? `Vous vous suspendez à la corde : ne bougez plus ${ROPE.channel} s.` : `Vous vous encordez pour redescendre : ne bougez plus ${ROPE.channel} s.`, kind: 'info' });
    return 'start';
  }

  private cancelRope(text: string): void {
    this.ropeT = 0;
    this.ropeDir = null;
    this.emit({ t: 'rope', phase: 'cancel' });
    this.emit({ t: 'message', text, kind: 'warn' });
  }

  /** Fait avancer la manœuvre ; bouger, miner ou monter sur la trottinette l'annule. */
  private updateRope(dt: number, intent: PlayerIntent): void {
    if (this.ropeT <= 0) return;
    if (Math.abs(intent.mx) + Math.abs(intent.my) > 0.01 || intent.mine) return this.cancelRope('Vous avez bougé : la corde est rangée.');
    this.ropeT -= dt;
    if (this.ropeT > 0) return;
    this.ropeT = 0;
    const dir = this.ropeDir;
    this.ropeDir = null;
    if (dir === 'up') this.ropeUp();
    else if (dir === 'down') this.ropeDown();
  }

  /**
   * Remonte à la surface avec tout son sac, à la verticale de l'endroit où l'on était (et non au milieu du camp) ;
   * la corde reste accrochée là où l'on était.
   */
  private ropeUp(): void {
    const p = this.player;
    const from = { tx: p.tileX, ty: p.tileY };
    this.ropes--;
    this.ropeAnchor = from;
    // Un seul repère « Corde de rappel » : l'ancien disparaît.
    for (const m of [...this.markers.list]) if (m.label === ROPE.name) this.markers.remove(m.id);
    this.markers.add('base', from.tx, from.ty, ROPE.name);
    // Même colonne, sur la rangée du camp ; si la place est prise (arbre, falaise du bord, bâtiment), la case libre la
    // plus proche en surface ; et au point d'apparition si rien n'est libre alentour.
    const spawn = this.layout.spawn;
    const top = this.freeSpotNear(from.tx, spawn.y, 6, true) ?? { tx: spawn.x, ty: spawn.y };
    this.teleportTo(top.tx, top.ty);
    this.emit({ t: 'rope', phase: 'up' });
    this.emit({ t: 'message', text: `Vous voilà à la surface, juste au-dessus d’où vous étiez, sac intact. La corde reste accrochée à ${Math.floor(depthAt(from.ty))} m (touche V pour y redescendre).`, kind: 'good' });
  }

  /** Redescend au point d'accroche, ou à la case libre la plus proche si le passage s'est refermé. */
  private ropeDown(): void {
    const a = this.ropeAnchor;
    if (!a) return;
    const spot = this.freeSpotNear(a.tx, a.ty, 3);
    if (!spot) {
      this.emit({ t: 'rope', phase: 'cancel' });
      this.emit({ t: 'message', text: 'Le passage est bouché là-bas : la corde reste accrochée, il faudra y aller à pied.', kind: 'warn' });
      return;
    }
    this.teleportTo(spot.tx, spot.ty);
    this.ropeAnchor = null;
    for (const m of [...this.markers.list]) if (m.label === ROPE.name) this.markers.remove(m.id);
    this.emit({ t: 'rope', phase: 'down' });
    this.emit({ t: 'message', text: `Vous redescendez à ${Math.floor(depthAt(spot.ty))} m. La corde est décrochée.`, kind: 'good' });
  }

  /** Case dégagée la plus proche de (tx, ty), dans un rayon de `radius` cases (`onSurface` : jamais sous terre). */
  private freeSpotNear(tx: number, ty: number, radius: number, onSurface = false): { tx: number; ty: number } | null {
    const p = this.player;
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.world.inBounds(x, y)) continue;
        if (onSurface && y >= SURFACE_ROWS) continue;
        const cx = (x + 0.5) * TILE;
        const cy = (y + 0.5) * TILE;
        if (this.isBlocked(cx - p.halfW, cy - p.halfH, cx + p.halfW - 0.001, cy + p.halfH - 0.001)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { tx: x, ty: y };
        }
      }
    return best;
  }

  /** Place le joueur au centre d'une case (corde de rappel). */
  private teleportTo(tx: number, ty: number): void {
    const p = this.player;
    p.x = (tx + 0.5) * TILE;
    p.y = (ty + 0.5) * TILE;
    p.swingT = 0;
    p.moving = false;
    this.lastPlayerTile = -1;
  }

  /** Interrompt le coup en cours (le joueur monte sur sa trottinette). */
  private cancelSwing(): void {
    const p = this.player;
    p.swingT = 0;
    p.swingHitPending = false;
    p.swingTarget = null;
  }

  private updateMining(dt: number, intent: PlayerIntent): void {
    const p = this.player;
    if (p.swingT > 0) {
      p.swingT -= dt;
      const elapsed = p.swingDuration - p.swingT;
      if (p.swingHitPending && elapsed >= p.swingDuration * 0.45) {
        p.swingHitPending = false;
        if (p.swingTarget) this.strikeWith(this.toolStats(p.swingTool), p.swingTarget.tx, p.swingTarget.ty);
      }
      if (p.swingT <= 0) p.swingT = 0;
    }
    if (intent.mine && intent.target && p.swingT <= 0 && this.canReach(intent.target.tx, intent.target.ty)) {
      const { tx, ty } = intent.target;
      let tool = this.activeTool;
      if (tool.kind === 'jackhammer' && !this.burnHammerFuel(tool.swingTime)) {
        // Plus de charbon : on continue à la pioche plutôt que de rester les bras ballants.
        tool = this.toolStats('pickaxe');
        if (this.time - this.lastNoFuel > 4) {
          this.lastNoFuel = this.time;
          this.emit({ t: 'message', text: 'Marteau-piqueur sans charbon : vous piochez à la main.', kind: 'warn' });
        }
      }
      p.swingTool = tool.kind;
      p.swingDuration = tool.swingTime;
      p.swingT = tool.swingTime;
      p.swingHitPending = true;
      p.swingTarget = { tx, ty };
      const ax = (tx + 0.5) * TILE - p.x;
      const ay = (ty + 0.5) * TILE - (p.y - 3);
      p.aim = Math.atan2(ay, ax);
      p.facing = dirFromVector(ax, ay);
      this.emit({ t: 'swing', x: p.x, y: p.y, tool: tool.kind });
    }
  }

  /**
   * Cases frappées par un coup visant (tx, ty) : la case visée puis, pour un outil large,
   * ses voisines perpendiculairement à la direction du coup (front de 3 cases).
   */
  strikeTiles(tool: MiningTool, tx: number, ty: number): [number, number][] {
    const out: [number, number][] = [[tx, ty]];
    if (tool.width <= 1) return out;
    const p = this.player;
    const side = rotateCW(dirFromVector((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - (p.y - 3)));
    for (let k = 1; k <= (tool.width - 1) / 2; k++) out.push([tx + DX[side] * k, ty + DY[side] * k], [tx - DX[side] * k, ty - DY[side] * k]);
    return out;
  }

  private strikeWith(tool: MiningTool, tx: number, ty: number): void {
    const [first, ...sides] = this.strikeTiles(tool, tx, ty);
    this.strike(first[0], first[1], tool);
    // Les cases voisines trop dures sont ignorées sans alerte : seule la case visée compte.
    for (const [x, y] of sides) {
      const b = getBlock(this.world.get(x, y));
      if (b.solid && b.breakable && b.tier <= tool.tier) this.strike(x, y, tool);
    }
  }

  /** Un coup d'outil (la pioche par défaut) sur la tuile (tx, ty). */
  strike(tx: number, ty: number, tool: MiningTool = this.toolStats('pickaxe')): void {
    const id = this.world.get(tx, ty);
    const block = getBlock(id);
    if (!block.solid) return;
    if (!block.breakable || tool.tier < block.tier) {
      this.emit({ t: 'denied', tx, ty, block: id, need: block.breakable ? block.tier : 99 });
      return;
    }
    const i = this.world.idx(tx, ty);
    const dmg = (this.world.damage.get(i) ?? 0) + tool.damage;
    if (dmg >= block.hp) {
      this.breakTile(tx, ty);
    } else {
      this.world.damage.set(i, dmg);
      this.emit({ t: 'hit', tx, ty, block: id, ratio: dmg / block.hp });
    }
  }

  /**
   * Détruit une tuile : elle devient praticable et lâche ses ressources. Les morceaux
   * jaillissent vers le mineur, ou tombent en `from` (derrière une foreuse de percement).
   */
  breakTile(tx: number, ty: number, from?: { x: number; y: number }): Drop[] {
    const out: Drop[] = [];
    const id = this.world.get(tx, ty);
    const block = getBlock(id);
    this.world.set(tx, ty, AIR);
    if (block.ore) {
      const res = getResource(block.ore);
      if (res.deposit) this.world.setDeposit(tx, ty, resourceIndex(res.id), this.rng.range(res.deposit[0], res.deposit[1]));
    }
    if (block.drop && this.rng.chance(block.drop.chance)) {
      const n = this.rng.int(block.drop.min, block.drop.max);
      this.production.addOre(block.drop.res, n, !!from);
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      // Les morceaux jaillissent plutôt du côté du mineur (ou vers l'arrière de la machine).
      const ox = from ? from.x : cx;
      const oy = from ? from.y : cy;
      const toward = from ? Math.atan2(from.y - cy, from.x - cx) : Math.atan2(this.player.y - 3 - cy, this.player.x - cx);
      for (let k = 0; k < n; k++) {
        const d = this.drops.spawn(block.drop.res, 1, ox, oy);
        const a = toward + (this.rng.float() - 0.5) * 1.6;
        const sp = 30 + this.rng.float() * 30;
        d.vx = Math.cos(a) * sp;
        d.vy = Math.sin(a) * sp;
        out.push(d);
      }
    }
    this.stats.tilesMined++;
    this.emit({ t: 'break', tx, ty, block: id });
    this.lastPlayerTile = -1; // force une mise à jour de la visibilité
    // Poche de grisou ou d'eau libérée ; plafond fragilisé par un creusement à la main.
    this.hazards.onBroken(tx, ty, id, !from);
    return out;
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
        if (this.lastZone) {
          this.emit({ t: 'discover', text: `${zone} — ${Math.floor(depth)} m` });
          if (this.hazards.heatAt(p.tileY) !== null)
            this.emit({ t: 'message', text: 'Il fait très chaud : ici, foreuses et fours ralentissent. Un ventilateur tout proche les rafraîchit.', kind: 'warn' });
        }
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
    /** Distance entre le joueur et le rectangle de tuiles (x, y, w, h). */
    const gap = (x: number, y: number, w: number, h: number) =>
      Math.hypot(Math.max(x * TILE - (p.x + p.halfW), 0, p.x - p.halfW - (x + w) * TILE), Math.max(y * TILE - (p.y + p.halfH), 0, p.y - p.halfH - (y + h) * TILE));
    for (const s of seen) {
      if ((s.isBelt && !s.configurable) || s.inert) continue;
      const d = gap(s.x, s.y, s.w, s.h);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    // Une foreuse de percement sortie s'ouvre aussi depuis le tunnel, près de la foreuse.
    for (const b of this.structures.borers) {
      if (b.home) continue;
      const t = b.tileAt(b.dist);
      const d = gap(t.x, t.y, 1, 1);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  isNear(type: BuildingType | string): boolean {
    return this.nearestInteractable()?.type === type;
  }

  // ---------------------------------------------------------------- économie

  /** Ce que rapportent `n` unités de `res` au cours du marché du moment ($, arrondi). */
  quote(res: string, n = 1): number {
    return this.market.quote(res, n);
  }

  sell(res: string, n: number): number {
    if (!this.isNear('counter')) return 0;
    const k = this.inventory.remove(res, n);
    if (k <= 0) return 0;
    const total = this.quote(res, k);
    this.money += total;
    this.stats.earned += total;
    this.production.addSale({ [res]: k }, total, false);
    this.emit({ t: 'sold', total, n: k });
    return total;
  }

  sellAll(): number {
    if (!this.isNear('counter')) return 0;
    let total = 0;
    let n = 0;
    const sold: Record<string, number> = {};
    for (const [res, count] of Object.entries(this.inventory.items)) {
      this.inventory.remove(res, count);
      total += this.quote(res, count);
      n += count;
      sold[res] = count;
    }
    if (n > 0) {
      this.money += total;
      this.stats.earned += total;
      this.production.addSale(sold, total, false);
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

  /** Achète des cordes de rappel à l'Atelier : une seule, ou le lot de plusieurs (moins cher à l'unité). */
  buyRope(qty = 1): boolean {
    const pack = qty >= ROPE.pack.qty;
    const n = pack ? ROPE.pack.qty : 1;
    if (!this.isNear('workshop') || this.ropes + n > ROPE.maxStock) return false;
    if (!this.pay(pack ? ROPE.pack.price : ROPE.price)) return false;
    this.ropes += n;
    this.emit({ t: 'bought', name: n > 1 ? `${ROPE.name} ×${n}` : ROPE.name });
    return true;
  }

  // ---------------------------------------------------------------- ouvriers

  /** Prix du prochain ouvrier (null : l'équipe est complète). */
  get nextWorkerPrice(): number | null {
    return workerPrice(this.workers.count);
  }

  /** Les ouvriers se débloquent avec la pioche améliorée. */
  get workersUnlocked(): boolean {
    return this.pickaxe.tier >= WORKERS.unlock.pickaxeTier;
  }

  /** Embauche un ouvrier à l'Atelier (achat unique, pas de salaire). */
  hireWorker(job: WorkerJob): boolean {
    const price = this.nextWorkerPrice;
    if (price === null || !this.workersUnlocked || !this.isNear('workshop') || !this.pay(price)) return false;
    this.workers.add(job, this);
    this.emit({ t: 'bought', name: `Ouvrier : ${getJob(job).name.toLowerCase()}` });
    return true;
  }

  /** Change le métier d'un ouvrier (gratuit, de n'importe où). */
  setWorkerJob(id: number, job: WorkerJob): boolean {
    return this.workers.setJob(id, job);
  }

  /** Congédie un ouvrier, sans remboursement ; sa charge reste par terre. */
  fireWorker(id: number): boolean {
    return this.workers.remove(id, this);
  }

  /** Achète la trottinette à moteur à l'Atelier ; on la monte ensuite en maintenant Maj. */
  buyScooter(): boolean {
    if (this.hasScooter || !this.isNear('workshop') || !this.pay(SCOOTER.price)) return false;
    this.hasScooter = true;
    this.emit({ t: 'bought', name: SCOOTER.name });
    return true;
  }

  /** Achète le marteau-piqueur à l'Atelier ; il est aussitôt pris en main. */
  buyJackhammer(): boolean {
    if (this.hasJackhammer || !this.isNear('workshop') || this.pickaxe.tier < JACKHAMMER.unlock.pickaxeTier) return false;
    if (!this.pay(JACKHAMMER.price)) return false;
    this.hasJackhammer = true;
    this.tool = 'jackhammer';
    this.emit({ t: 'bought', name: JACKHAMMER.name });
    return true;
  }

  /** Achète une pièce d'équipement à l'Atelier ; elle est portée aussitôt. */
  buyGear(id: string): boolean {
    const def = getGear(id);
    if (this.gear.has(id) || !this.isNear('workshop') || !this.pay(def.price)) return false;
    this.gear.add(id);
    this.emit({ t: 'bought', name: def.name });
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

  /** `kit` : identifiant de kit (machine seule, ou machine améliorée « drill@3 »). */
  canPlace(kit: string, tx: number, ty: number): { ok: boolean; reason?: string } {
    const machineId = parseKit(kit).machine;
    const def = getMachine(machineId);
    if (this.inventory.kitCount(kit) <= 0) return { ok: false, reason: `Aucun ${kitName(kit).toLowerCase()} en stock` };
    if (this.distanceToTile(tx, ty) > BUILD_RANGE) return { ok: false, reason: `Trop loin : approchez-vous (${BUILD_RANGE} cases au plus)` };
    if (def.onTrack) {
      if (!this.structures.at(tx, ty)?.isTrack) return { ok: false, reason: 'Se pose sur des rails' };
      if (this.wagons.at(tx, ty)) return { ok: false, reason: 'Il y a déjà un wagonnet ici' };
      return { ok: true };
    }
    if (this.beltToReplace(machineId, tx, ty) || this.railToReplace(machineId, tx, ty)) return { ok: true };
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        if (!this.world.isOpen(x, y)) return { ok: false, reason: 'Il faut un sol dégagé : creusez d’abord la roche' };
        if (this.structures.at(x, y)) return { ok: false, reason: 'Emplacement occupé' };
        if (this.borerAt(x, y)) return { ok: false, reason: 'La foreuse de percement passe ici' };
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
   * Pose une machine depuis un kit. Un convoyeur posé sur un convoyeur d'un autre niveau le remplace :
   * les objets transportés sont conservés et l'ancien convoyeur revient dans le stock. Une foreuse
   * améliorée (kit « drill@3 ») est reposée à son niveau.
   */
  place(kit: string, tx: number, ty: number, dir: Dir): Structure | Wagon | null {
    if (!this.canPlace(kit, tx, ty).ok) return null;
    const { machine: machineId, level } = parseKit(kit);
    const def = getMachine(machineId);
    if (def.onTrack) {
      this.inventory.removeKit(kit);
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
    this.inventory.removeKit(kit);
    const s = this.structures.add(factory.create(tx, ty, def.rotatable ? dir : 1));
    if (s instanceof Drill || s instanceof TunnelBorer) s.level = Math.min(level, s.maxLevel);
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
    if (s instanceof TunnelBorer && !s.home) {
      this.emit({ t: 'message', text: 'La foreuse est sortie : rappelez-la à sa base avant de la démonter.', kind: 'warn' });
      return false;
    }
    this.structures.remove(s);
    // Une foreuse améliorée revient dans le stock avec son niveau (kit « drill@3 », « borer@4 »).
    this.inventory.addKit(s instanceof Drill || s instanceof TunnelBorer ? kitId(s.type, s.level) : s.type);
    for (const [res, n] of Object.entries(s.contents())) this.drops.spawn(res, n, (s.x + 0.5) * TILE, (s.y + 0.5) * TILE);
    this.emit({ t: 'removed', type: s.type, tx, ty });
    return true;
  }

  rotateAt(tx: number, ty: number): boolean {
    const s = this.structures.at(tx, ty);
    if (!s || !s.removable || !getMachine(s.type).rotatable) return false;
    // La base d'une foreuse de percement ne tourne que foreuse rangée : c'est un nouveau tunnel.
    if (s instanceof TunnelBorer) {
      if (!s.home) return false;
      s.turned();
    }
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
  /** Règle le trieur sur un seul minerai (ou aucun : tout va tout droit). */
  setSorterFilter(s: Sorter, res: string | null): boolean {
    if (res !== null && !hasResource(res)) return false;
    s.setFilters(res === null ? [] : [res]);
    return true;
  }

  /** Ajoute un minerai à ceux que le trieur envoie tout droit, ou l'en retire s'il y est déjà. */
  toggleSorterFilter(s: Sorter, res: string): boolean {
    return s.toggleFilter(res);
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
  upgradeBlocker(m: Drill | TunnelBorer): string | null {
    const next = m.nextLevel();
    if (!next) return 'Niveau maximal atteint';
    if (m instanceof TunnelBorer && !m.home) return 'Rappelez d’abord la foreuse à sa base';
    if (next.unlock && this.pickaxe.tier < next.unlock.pickaxeTier) return next.unlock.text;
    if (this.money < next.price) return 'Pas assez d\'argent';
    return null;
  }

  /**
   * Améliore une foreuse posée : la foreuse à charbon couvre plus de cases, la foreuse de
   * percement gagne son amélioration (moteur, tête large, benne).
   */
  upgradeMachine(m: Drill | TunnelBorer): boolean {
    const next = m.nextLevel();
    if (!next || this.upgradeBlocker(m) || !this.pay(next.price)) return false;
    m.level = next.level;
    this.emit({ t: 'bought', name: `${m.def.name} niveau ${next.level}${next.name ? ` (${next.name.toLowerCase()})` : ''}` });
    return true;
  }

  /** Charge le charbon du sac dans une foreuse de percement. */
  fuelBorer(b: TunnelBorer): number {
    const fuel = b.def.fuel;
    if (!fuel) return 0;
    const k = b.addFuel(this.inventory.count(fuel.res));
    this.inventory.remove(fuel.res, k);
    return k;
  }

  /** Récupère dans le sac le minerai que la foreuse de percement a ramené à sa base. */
  collectBorer(b: TunnelBorer): number {
    let n = 0;
    for (const res of Object.keys(b.store)) {
      const k = b.takeStored(res, Math.min(b.store[res], Math.floor(this.inventory.room(res))));
      if (k > 0) this.inventory.add(res, k);
      n += k;
    }
    if (b.storeCount()) this.emit({ t: 'invFull' });
    return n;
  }

  /** Charge le charbon du sac dans un four ou une fonderie. */
  fuelSmelter(s: Smelter): number {
    const fuel = s.def.fuel;
    if (!fuel) return 0;
    const k = s.addFuel(this.inventory.count(fuel.res));
    this.inventory.remove(fuel.res, k);
    return k;
  }

  /** Dépose dans un four ou une fonderie tout le minerai fusible du sac (dans la limite de sa place). */
  smelterDeposit(s: Smelter): number {
    let n = 0;
    for (const r of RESOURCES) {
      if (!r.smeltsTo) continue;
      const k = s.addOre(r.id, this.inventory.count(r.id));
      this.inventory.remove(r.id, k);
      n += k;
    }
    return n;
  }

  /** Récupère dans le sac les lingots prêts d'un four ou d'une fonderie. */
  smelterCollect(s: Smelter): number {
    const taken = s.takeOutput((res) => Math.floor(this.inventory.room(res)));
    let n = 0;
    for (const [res, k] of Object.entries(taken)) {
      this.inventory.add(res, k);
      n += k;
    }
    if (s.output.length) this.emit({ t: 'invFull' });
    return n;
  }

  /** Règle la longueur du prochain tunnel (0 = sans limite). */
  setBorerLength(b: TunnelBorer, length: number): boolean {
    if (!b.spec.lengths.includes(length)) return false;
    b.length = length;
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
