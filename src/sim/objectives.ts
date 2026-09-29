/**
 * Objectifs guidant les premières minutes. Ils sont calculés à partir de
 * l'état réel de la partie (aucun compteur fictif).
 */
import type { GameState } from './GameState';
import { Drill } from './structures/Drill';

export interface Objective {
  id: string;
  text: string;
  done(g: GameState): boolean;
}

const hasStructure = (g: GameState, type: string) => g.structures.list.some((s) => s.type === type);
const owns = (g: GameState, type: string) => hasStructure(g, type) || g.inventory.kitTotal(type) > 0;

export const OBJECTIVES: Objective[] = [
  { id: 'enter', text: 'Entrez dans la mine : le puits au centre du camp', done: (g) => g.stats.maxDepth > 0 },
  { id: 'mine', text: 'Minez une paroi : maintenez le clic gauche sur la roche', done: (g) => g.stats.tilesMined >= 1 },
  { id: 'collect', text: 'Ramassez des minerais (passez dessus)', done: (g) => g.stats.itemsCollected >= 1 },
  { id: 'sell', text: 'Remontez vendre au Comptoir, en surface', done: (g) => g.stats.earned > 0 },
  { id: 'pick', text: "Achetez la Pioche améliorée à l'Atelier", done: (g) => g.pickaxeLevel >= 1 },
  { id: 'iron', text: 'Extrayez du fer (salle du fond de la mine)', done: (g) => (g.stats.collected.iron ?? 0) > 0 },
  {
    id: 'kits',
    text: "Achetez une foreuse, des convoyeurs et un coffre à l'Atelier",
    done: (g) => owns(g, 'drill') && (owns(g, 'conveyor') || owns(g, 'conveyor_fast') || owns(g, 'conveyor_express')) && owns(g, 'storage'),
  },
  { id: 'drill', text: "Posez la foreuse [B] sur un gisement (le sol d'un filon miné)", done: (g) => hasStructure(g, 'drill') },
  {
    id: 'fuel',
    text: 'Chargez la foreuse en charbon [E]',
    done: (g) => g.structures.list.some((s) => s instanceof Drill && (s.fuelUnits > 0 || s.burn > 0 || s.extracted > 0)),
  },
  { id: 'chain', text: 'Reliez la foreuse à un coffre avec des convoyeurs', done: (g) => g.stats.delivered >= 1 },
  { id: 'deep', text: 'Descendez sous les 100 m', done: (g) => g.stats.maxDepth >= 100 },
  {
    id: 'ship',
    text: "Vente automatique : amenez vos minerais par convoyeur jusqu'à une caisse d'expédition en surface",
    done: (g) => g.stats.autoSold > 0,
  },
  {
    id: 'smelt',
    text: "Fondez 10 lingots dans un four (Atelier) : minerai + charbon, lingots vendus 2,5 fois plus cher",
    done: (g) => g.stats.smelted >= 10,
  },
  { id: 'furnace', text: 'Descendez dans la Fournaise, sous 450 m : roche volcanique et beaucoup d’or', done: (g) => g.stats.maxDepth >= 450 },
  {
    id: 'diamond',
    text: 'Trouvez un diamant, sous 500 m (Pioche pro en acier)',
    done: (g) => (g.stats.collected.diamond ?? 0) > 0,
  },
];

export function currentObjective(g: GameState): { objective: Objective | null; index: number } {
  for (let i = 0; i < OBJECTIVES.length; i++) if (!OBJECTIVES[i].done(g)) return { objective: OBJECTIVES[i], index: i };
  return { objective: null, index: OBJECTIVES.length };
}
