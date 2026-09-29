/** Fabrique de structures (création depuis l'id de machine ou une sauvegarde). */
import type { Dir } from '../../core/dir';
import { TunnelBorer } from './Borer';
import { Conveyor } from './Conveyor';
import { Bridge } from './Bridge';
import { Drill } from './Drill';
import { Rail, RailStation, RailSwitch } from './Rail';
import { ShippingCrate } from './ShippingCrate';
import { Smelter } from './Smelter';
import { Sorter } from './Sorter';
import { Splitter } from './Splitter';
import { Storage } from './Storage';
import type { Structure, StructureSave } from './Structure';

type Factory = { create(x: number, y: number, dir: Dir): Structure; load(s: StructureSave): Structure };

export const STRUCTURE_FACTORIES: Record<string, Factory> = {
  conveyor: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor'), load: (s) => Conveyor.load(s) },
  conveyor_fast: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor_fast'), load: (s) => Conveyor.load(s) },
  conveyor_express: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor_express'), load: (s) => Conveyor.load(s) },
  drill: { create: (x, y, d) => new Drill(x, y, d), load: (s) => Drill.load(s) },
  borer: { create: (x, y, d) => new TunnelBorer(x, y, d), load: (s) => TunnelBorer.load(s) },
  storage: { create: (x, y, d) => new Storage(x, y, d), load: (s) => Storage.load(s) },
  splitter: { create: (x, y, d) => new Splitter(x, y, d), load: (s) => Splitter.load(s) },
  sorter: { create: (x, y, d) => new Sorter(x, y, d), load: (s) => Sorter.load(s) },
  bridge: { create: (x, y, d) => new Bridge(x, y, d), load: (s) => Bridge.load(s) },
  rail: { create: (x, y) => new Rail(x, y), load: (s) => new Rail(s.x, s.y) },
  rail_switch: { create: (x, y, d) => new RailSwitch(x, y, d), load: (s) => RailSwitch.load(s) },
  rail_load: { create: (x, y) => new RailStation(x, y, 'rail_load'), load: (s) => RailStation.load(s) },
  rail_unload: { create: (x, y) => new RailStation(x, y, 'rail_unload'), load: (s) => RailStation.load(s) },
  shipping: { create: (x, y, d) => new ShippingCrate(x, y, d), load: (s) => ShippingCrate.load(s) },
  furnace: { create: (x, y, d) => new Smelter('furnace', x, y, d), load: (s) => Smelter.load('furnace', s) },
  foundry: { create: (x, y, d) => new Smelter('foundry', x, y, d), load: (s) => Smelter.load('foundry', s) },
};
