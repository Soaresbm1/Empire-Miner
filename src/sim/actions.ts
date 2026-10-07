/**
 * Actions du joueur sur la partie : tout ce que l'interface peut changer (achats, ventes, pose et démontage de
 * machines, réglages des coffres, repères…), décrit par des données simples.
 *
 * Jouer seul : l'action s'applique tout de suite. Jouer à deux : elle est envoyée à l'autre téléphone et appliquée par
 * les deux au même pas de simulation, pour le joueur qui l'a demandée (voir `net/lockstep`). Les messages à l'écran
 * (« 3 charbons chargés »…) sont donc émis ici, comme événements, et non plus par l'interface.
 */
import type { Dir } from '../core/dir';
import { getResource, hasResource } from '../data/resources';
import { MARKER_KINDS, type MarkerKind } from './Markers';
import type { GameState } from './GameState';
import { isJob, type WorkerJob } from '../data/workers';
import { Conveyor } from './structures/Conveyor';
import { Drill } from './structures/Drill';
import { TunnelBorer } from './structures/Borer';
import { Smelter } from './structures/Smelter';
import { Sorter } from './structures/Sorter';
import { RailStation, RailSwitch, type SwitchSetting } from './structures/Rail';
import { ShippingCrate } from './structures/ShippingCrate';
import { Storage } from './structures/Storage';

type At = { x: number; y: number };

export type SimAction =
  // économie
  | { k: 'sell'; res: string }
  | { k: 'sellAll' }
  | { k: 'buyPickaxe' }
  | { k: 'buyBag' }
  | { k: 'buyJackhammer' }
  | { k: 'buyGear'; id: string }
  | { k: 'buyScooter' }
  | { k: 'buyRope'; qty: number }
  | { k: 'buyKit'; id: string; qty: number }
  // ouvriers
  | { k: 'hire'; job: string }
  | { k: 'workerJob'; id: number; job: string }
  | { k: 'workerUpgrade'; id: number }
  | { k: 'fire'; id: number }
  // sac et outils
  | { k: 'togglePickup'; res: string }
  | { k: 'drop'; res: string }
  | { k: 'toggleTool' }
  | { k: 'rope' }
  | { k: 'wagon' }
  | { k: 'leaveWagon' }
  // construction
  | { k: 'place'; kit: string; x: number; y: number; dir: Dir; quiet?: boolean }
  | { k: 'remove'; x: number; y: number }
  | { k: 'rotate'; x: number; y: number }
  | { k: 'beltDir'; x: number; y: number; dir: Dir }
  // machines et coffres (désignés par leur case)
  | ({ k: 'storageTake'; res: string } & At)
  | ({ k: 'storageTakeAll' } & At)
  | ({ k: 'storageDeposit' } & At)
  | ({ k: 'storageAllow'; res: string } & At)
  | { k: 'chestsAllow'; at: [number, number][]; allow: string[] }
  | ({ k: 'shipDeposit' } & At)
  | ({ k: 'drillFuel' } & At)
  | ({ k: 'drillCollect' } & At)
  | ({ k: 'machineUpgrade' } & At)
  | ({ k: 'borerFuel' } & At)
  | ({ k: 'borerStart' } & At)
  | ({ k: 'borerStop' } & At)
  | ({ k: 'borerLength'; length: number } & At)
  | ({ k: 'borerCollect' } & At)
  | ({ k: 'smelterFuel' } & At)
  | ({ k: 'smelterDeposit' } & At)
  | ({ k: 'smelterCollect' } & At)
  | ({ k: 'stationDeposit' } & At)
  | ({ k: 'stationTakeAll' } & At)
  | ({ k: 'switchSet'; setting: string } & At)
  | ({ k: 'sorterFilter'; res: string } & At)
  // repères
  | { k: 'mark'; kind: string; x: number; y: number; here?: boolean }
  | { k: 'markerTrack'; id: number }
  | { k: 'markerDelete'; id: number };

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

/**
 * Applique une action pour le joueur actif de `g` (l'appelant l'a choisi avec `g.withSlot`). Ne lance jamais d'exception :
 * une action refusée (pas assez d'argent, machine disparue…) ne change rien.
 */
export function applyAction(g: GameState, a: SimAction): void {
  const msg = (text: string, kind: 'info' | 'warn' | 'good' | 'bad' = 'good') => g.emit({ t: 'message', text, kind });
  const at = (p: At) => g.structures.at(p.x, p.y);
  switch (a.k) {
    case 'sell':
      if (hasResource(a.res)) g.sell(a.res, g.inventory.count(a.res));
      return;
    case 'sellAll':
      g.sellAll();
      return;
    case 'buyPickaxe':
      g.buyNextPickaxe();
      return;
    case 'buyBag':
      g.buyNextBag();
      return;
    case 'buyJackhammer':
      g.buyJackhammer();
      return;
    case 'buyGear':
      g.buyGear(String(a.id));
      return;
    case 'buyScooter':
      g.buyScooter();
      return;
    case 'buyRope':
      g.buyRope(Number(a.qty) || 1);
      return;
    case 'buyKit':
      g.buyKit(String(a.id), Number(a.qty));
      return;
    case 'hire':
      if (isJob(a.job)) g.hireWorker(a.job as WorkerJob);
      return;
    case 'workerJob':
      if (isJob(a.job)) g.setWorkerJob(Number(a.id), a.job as WorkerJob);
      return;
    case 'workerUpgrade':
      g.upgradeWorker(Number(a.id));
      return;
    case 'fire':
      g.fireWorker(Number(a.id));
      return;
    case 'togglePickup':
      if (hasResource(a.res)) g.autoPickup[a.res] = !g.autoPickup[a.res];
      return;
    case 'drop':
      if (hasResource(a.res)) g.dropFromInventory(a.res, g.inventory.count(a.res));
      return;
    case 'toggleTool':
      g.toggleTool();
      return;
    case 'rope':
      g.useRope();
      return;
    case 'wagon': {
      // F : descendre du wagonnet, sinon monter dans celui qui est à portée.
      if (g.riding) g.leaveWagon();
      else {
        const w = g.nearestWagon();
        if (w) g.rideWagon(w);
      }
      return;
    }
    case 'leaveWagon':
      if (g.riding) g.leaveWagon();
      return;
    case 'place': {
      const check = g.canPlace(a.kit, a.x, a.y);
      if (!check.ok) {
        if (!a.quiet) msg(check.reason ?? 'Impossible ici', 'warn');
        return;
      }
      g.place(a.kit, a.x, a.y, a.dir);
      return;
    }
    case 'remove':
      g.removeAt(a.x, a.y);
      return;
    case 'rotate':
      g.rotateAt(a.x, a.y);
      return;
    case 'beltDir': {
      // Tracé d'un convoyeur en glissant : chaque tuile pointe vers la suivante.
      const c = g.structures.at(a.x, a.y);
      if (c instanceof Conveyor && (a.dir === 0 || a.dir === 1 || a.dir === 2 || a.dir === 3)) {
        c.dir = a.dir;
        g.structures.invalidate();
      }
      return;
    }
    case 'storageTake': {
      const s = at(a);
      if (s instanceof Storage) g.storageTake(s, a.res, s.items[a.res] ?? 0);
      return;
    }
    case 'storageTakeAll': {
      const s = at(a);
      if (s instanceof Storage) g.storageTakeAll(s);
      return;
    }
    case 'storageDeposit': {
      const s = at(a);
      if (!(s instanceof Storage)) return;
      g.storageDepositAll(s);
      // Ce que le coffre refuse reste dans le sac : on dit pourquoi.
      if (s.allow.length && Object.keys(g.inventory.items).some((res) => !s.accepts(res)))
        msg(`Ce coffre n'accepte que : ${s.allow.map((r) => getResource(r).name.toLowerCase()).join(', ')}.`, 'warn');
      return;
    }
    case 'storageAllow': {
      const s = at(a);
      // « Tout » vide la liste ; un minerai s'ajoute ou se retire (on peut en choisir plusieurs).
      if (s instanceof Storage) a.res ? g.toggleStorageAllow(s, a.res) : g.clearStorageAllow(s);
      return;
    }
    case 'chestsAllow': {
      const list = a.at.map(([x, y]) => g.structures.at(x, y)).filter((s): s is Storage => s instanceof Storage);
      if (!list.length) {
        msg("Choisissez d'abord des coffres : clic sur un coffre, ou glissez un rectangle.", 'warn');
        return;
      }
      const allow = a.allow.filter((r) => hasResource(r));
      const changed = g.setStoragesAllow(list, allow);
      if (!changed) {
        msg(`${list.length > 1 ? `Ces ${list.length} coffres étaient déjà réglés` : 'Ce coffre était déjà réglé'} ainsi.`, 'info');
        return;
      }
      const many = changed > 1;
      const verb = many ? 'acceptent' : 'accepte';
      const names = allow.map((r) => getResource(r).name.toLowerCase());
      const what = allow.length ? `${verb} seulement ${names.join(', ')}` : `${verb} tout`;
      const already = list.length - changed;
      msg(`${changed} coffre${many ? 's' : ''} réglé${many ? 's' : ''} : ${many ? 'ils' : 'il'} ${what}.${already ? ` (${already} déjà réglé${already > 1 ? 's' : ''} ainsi)` : ''}`);
      return;
    }
    case 'shipDeposit': {
      const s = at(a);
      if (!(s instanceof ShippingCrate)) return;
      const n = g.shipDepositAll(s);
      if (n) msg(`${n} ${plural(n, 'minerai')} ${plural(n, 'déposé')} : ${plural(n, 'vendu')} au prochain passage.`);
      return;
    }
    case 'drillFuel': {
      const s = at(a);
      if (!(s instanceof Drill)) return;
      const n = g.fuelDrill(s);
      if (n) msg(`${n} charbon${n > 1 ? 's' : ''} chargé${n > 1 ? 's' : ''} dans la foreuse.`);
      return;
    }
    case 'drillCollect': {
      const s = at(a);
      if (s instanceof Drill) g.collectDrill(s);
      return;
    }
    case 'machineUpgrade': {
      const s = at(a);
      if (s instanceof Drill || s instanceof TunnelBorer) g.upgradeMachine(s);
      return;
    }
    case 'borerFuel': {
      const s = at(a);
      if (!(s instanceof TunnelBorer)) return;
      const n = g.fuelBorer(s);
      if (n) msg(`${n} charbon${n > 1 ? 's' : ''} chargé${n > 1 ? 's' : ''} dans la base de la foreuse de percement.`);
      return;
    }
    case 'borerStart': {
      const s = at(a);
      if (s instanceof TunnelBorer) s.start();
      return;
    }
    case 'borerStop': {
      const s = at(a);
      if (s instanceof TunnelBorer) s.stop();
      return;
    }
    case 'borerLength': {
      const s = at(a);
      if (s instanceof TunnelBorer) g.setBorerLength(s, Number(a.length));
      return;
    }
    case 'borerCollect': {
      const s = at(a);
      if (!(s instanceof TunnelBorer)) return;
      const n = g.collectBorer(s);
      if (n) msg(`${n} ${plural(n, 'minerai')} ${plural(n, 'récupéré')} dans la base.`);
      return;
    }
    case 'smelterFuel': {
      const s = at(a);
      if (!(s instanceof Smelter)) return;
      const n = g.fuelSmelter(s);
      if (n) msg(`${n} charbon${n > 1 ? 's' : ''} chargé${n > 1 ? 's' : ''} dans le ${s.def.name.toLowerCase()}.`);
      return;
    }
    case 'smelterDeposit': {
      const s = at(a);
      if (!(s instanceof Smelter)) return;
      const n = g.smelterDeposit(s);
      if (n) msg(`${n} ${plural(n, 'minerai')} ${plural(n, 'déposé')} à fondre.`);
      return;
    }
    case 'smelterCollect': {
      const s = at(a);
      if (!(s instanceof Smelter)) return;
      const n = g.smelterCollect(s);
      if (n) msg(`${n} ${plural(n, 'lingot')} ${plural(n, 'récupéré')}.`);
      return;
    }
    case 'stationDeposit': {
      const s = at(a);
      if (s instanceof RailStation) g.stationDepositAll(s);
      return;
    }
    case 'stationTakeAll': {
      const s = at(a);
      if (s instanceof RailStation) g.stationTakeAll(s);
      return;
    }
    case 'switchSet': {
      const s = at(a);
      if (s instanceof RailSwitch) g.setSwitch(s, a.setting as SwitchSetting);
      return;
    }
    case 'sorterFilter': {
      const s = at(a);
      // « Aucun » vide la liste ; un minerai s'ajoute ou se retire (on peut en choisir plusieurs).
      if (s instanceof Sorter) a.res ? g.toggleSorterFilter(s, a.res) : g.setSorterFilter(s, null);
      return;
    }
    case 'mark': {
      if (!(a.kind in MARKER_KINDS)) return;
      const kind = a.kind as MarkerKind;
      const x = a.here ? g.player.tileX : a.x;
      const y = a.here ? g.player.tileY : a.y;
      const m = g.addMarker(kind, x, y);
      if (m) msg(a.here ? `Repère posé : ${m.label} (carte : M).` : `Repère posé : ${m.label}.`);
      else if (a.here) msg('Trop de repères : supprimez-en un depuis la carte (M).', 'warn');
      else msg(g.markers.full ? 'Trop de repères : supprimez-en un dans la liste.' : 'Hors de la carte.', 'warn');
      return;
    }
    case 'markerTrack':
      g.markers.toggleTrack(Number(a.id));
      return;
    case 'markerDelete':
      g.markers.remove(Number(a.id));
      return;
  }
}

/** Une action reçue d'un autre appareil est-elle bien formée ? (les données du réseau ne sont jamais crues sur parole) */
export function isSimAction(v: unknown): v is SimAction {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { k?: unknown }).k;
  return typeof k === 'string' && k.length < 24;
}
