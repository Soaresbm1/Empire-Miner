/**
 * Les quatre profils de joueur du banc. Un profil ne décide que de ses **achats** à l'Atelier (et de quand remonter les faire) :
 * le reste (où piocher, quand vendre, quand ravitailler) est commun, pour que les écarts viennent des choix d'investissement.
 *
 * - prudent : garde une réserve, améliore son équipement avant de s'automatiser, peu de lignes à la fois ;
 * - agressif : dépense tout dès que possible, vise la pioche et les premières lignes sans réserve ;
 * - automatisation : pioche améliorée puis uniquement des lignes (avec four dès que possible), équipement en dernier ;
 * - équilibré : alterne équipement et lignes.
 */
import type { Macro, Profile } from './player';

/** Réserve laissée en poche (le prudent). */
const RESERVE = 150;

const afford = (m: Macro, price: number, reserve = 0): boolean => m.g.money >= price + reserve;

/** Ligne affordable maintenant ? (prix de l'Atelier pour la prochaine ligne, avec ou sans four) */
const lineOk = (m: Macro, smelt: boolean, reserve = 0): boolean => {
  const q = m.lineQuote(smelt);
  return q !== null && afford(m, q, reserve);
};

/** Pose une ligne (avec four si on peut et si le profil le veut) ; vrai si posée. */
function line(m: Macro, smelt: boolean, reserve = 0): boolean {
  if (smelt && lineOk(m, true, reserve) && m.buildLine(true)) return true;
  return lineOk(m, false, reserve) && m.buildLine(false);
}

type Step = (m: Macro) => { ready: boolean; run(): boolean };

/** Fabrique un profil à partir d'une liste d'étapes essayées dans l'ordre : la première non faite et possible est jouée. */
function profile(id: string, label: string, steps: Step[]): Profile {
  const current = (m: Macro) => steps.map((s) => s(m)).find((s) => s.ready) ?? null;
  return {
    id,
    label,
    wantsShop: (m) => current(m) !== null,
    shop(m) {
      let did = false;
      for (let guard = 0; guard < 12; guard++) {
        const s = current(m);
        if (!s || !s.run()) break;
        did = true;
      }
      return did;
    },
  };
}

const pick = (level: number, reserve = 0): Step => (m) => ({
  ready: m.g.pickaxeLevel < level && afford(m, m.nextPickaxePrice(), reserve),
  run: () => m.buyPickaxe(),
});
const bag = (level: number, reserve = 0): Step => (m) => ({
  ready: m.g.bagLevel < level && afford(m, m.nextBagPrice(), reserve),
  run: () => m.buyBag(),
});
/** Des lignes jusqu'à en avoir `count` (au moins la pioche améliorée pour la foreuse). */
const lines = (count: number, smelt: boolean, reserve = 0): Step => (m) => ({
  ready: m.g.pickaxeLevel >= 1 && m.lines < count && lineOk(m, smelt, reserve),
  run: () => line(m, smelt, reserve),
});

export const PROFILES: Profile[] = [
  profile('prudent', 'Prudent : équipement d’abord, réserve de 150 $, 3 lignes puis 6', [
    pick(1, RESERVE),
    bag(1, RESERVE),
    lines(1, false, RESERVE * 2),
    pick(2, RESERVE),
    bag(2, RESERVE),
    lines(3, true, RESERVE * 2),
    pick(3, RESERVE),
    lines(6, true, RESERVE * 4),
  ]),
  profile('agressif', 'Agressif : pioche puis lignes dès que possible, sans réserve', [
    pick(1),
    lines(2, false),
    pick(2),
    lines(6, true),
    pick(3),
    bag(1),
    lines(12, true),
    bag(2),
  ]),
  profile('automatisation', 'Automatisation maximale : pioche améliorée, puis des lignes avec four, équipement en dernier', [
    pick(1),
    lines(40, true),
    pick(2),
    pick(3),
    bag(1),
    bag(2),
  ]),
  profile('equilibre', 'Équilibré : alterne équipement et lignes', [
    pick(1),
    bag(1),
    lines(1, false),
    pick(2),
    lines(3, true),
    bag(2),
    lines(6, true),
    pick(3),
    lines(12, true),
  ]),
];
