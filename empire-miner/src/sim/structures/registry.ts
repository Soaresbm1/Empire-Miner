/** Fabrique de structures (création depuis l'id de machine ou une sauvegarde). */
import type { Dir } from '../../core/dir';
import { Conveyor } from './Conveyor';
import { Drill } from './Drill';
import { ShippingCrate } from './ShippingCrate';
import { Storage } from './Storage';
import type { Structure, StructureSave } from './Structure';

type Factory = { create(x: number, y: number, dir: Dir): Structure; load(s: StructureSave): Structure };

export const STRUCTURE_FACTORIES: Record<string, Factory> = {
  conveyor: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor'), load: (s) => Conveyor.load(s) },
  conveyor_fast: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor_fast'), load: (s) => Conveyor.load(s) },
  conveyor_express: { create: (x, y, d) => new Conveyor(x, y, d, 'conveyor_express'), load: (s) => Conveyor.load(s) },
  drill: { create: (x, y, d) => new Drill(x, y, d), load: (s) => Drill.load(s) },
  storage: { create: (x, y, d) => new Storage(x, y, d), load: (s) => Storage.load(s) },
  shipping: { create: (x, y, d) => new ShippingCrate(x, y, d), load: (s) => ShippingCrate.load(s) },
};
