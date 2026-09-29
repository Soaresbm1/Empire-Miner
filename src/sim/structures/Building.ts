/**
 * Bâtiments fixes du camp de surface (comptoir de vente, atelier, tableau d'affichage).
 * Ils font partie de la carte générée et ne peuvent pas être démontés.
 */
import { Structure, StructureSave } from './Structure';

export type BuildingType = 'counter' | 'workshop' | 'board';

export const BUILDING_INFO: Record<BuildingType, { name: string; w: number; h: number; prompt: string }> = {
  counter: { name: 'Comptoir', w: 3, h: 2, prompt: 'Vendre vos minerais' },
  workshop: { name: 'Atelier', w: 3, h: 2, prompt: 'Améliorations et machines' },
  board: { name: "Tableau d'affichage", w: 2, h: 2, prompt: 'Statistiques de production' },
};

export class Building extends Structure {
  readonly type: BuildingType;

  constructor(type: BuildingType, x: number, y: number) {
    super(x, y, 1);
    this.type = type;
    this.w = BUILDING_INFO[type].w;
    this.h = BUILDING_INFO[type].h;
    this.removable = false;
  }

  get name(): string {
    return BUILDING_INFO[this.type].name;
  }

  serialize(): StructureSave {
    return super.serialize();
  }
}
