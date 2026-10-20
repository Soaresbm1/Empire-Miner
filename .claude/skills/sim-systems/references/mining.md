# Minage, gisements, dangers

## Monde
- `src/sim/World.ts` : grilles par case (`tiles` = identifiant de bloc, `deposit` = index de ressource + 1 (0 : aucun),
  `reserve` (Uint16, finie), `damage`, `explored`, et pour les dangers `dug`, `pocket`, `gas`, `water`). `setDeposit` pose un
  gisement ; `takeFromDeposit` retire une unité de réserve et renvoie `null` quand il est épuisé. Carte : `WORLD_W` × `WORLD_H` (`core/constants.ts`), `depthAt(tileY)`.
- `src/sim/generator.ts` : génération déterministe depuis la graine (roches hôtes, filons, poches avec leur propre tirage pour ne
  pas changer le terrain).
- `src/sim/visibility.ts` : exploration.

## Données
- `src/data/resources.ts` (`ResourceDef`) : `value` (prix au comptoir), `weight`, `rarity`, `resistance`, `tier` (pioche
  requise), `minDepth`/`maxDepth`, `drops`, `vein` (`perThousand`, `deepPerThousand`, `size`), `deposit` (réserve), `groundLife`,
  `smeltsTo`. Sept minerais : pierre, charbon, cuivre, fer, argent, or, diamant.
- `src/data/blocks.ts` : `HOST_ROCKS` et blocs de filon (identifiants par ordre d'ajout : voir le skill `save-integrity`).
- `src/data/depth.ts` : `DEPTH_ZONES` (0, 100, 300, 450 m). `src/data/tools.ts` : `PICKAXES` (`tier`, `damage`, `swingTime`,
  `reach`, `price`), `BAGS`, marteau-piqueur (front de 3 cases, brûle du charbon).

## Minage du joueur
- `GameState` : `updateMining`, `strike` / `strikeTiles` (outil large), `breakTile` (prévient `HazardSystem.onBroken`),
  `updatePickup`, sac limité en poids (`Inventory`), objets au sol (`Drops.ts`, la pierre s'effrite après `groundLife`).

## Machines d'extraction
- Foreuse à charbon (`structures/Drill.ts`) : posée sur un gisement exposé (`needsDeposit`), `MachineDef.levels[].reach` (`under`,
  `left`, `right`, `back`) ; cadence × nombre de têtes ; le niveau suit le kit au démontage (`drill@3`).
- Foreuse de percement (`structures/Borer.ts`) : base fixe, foreuse = position (`dist`, `moveT`) ; `digTile`, réservoir
  (`fuelUnits`, `tank`), benne (`load`) ; niveaux par `levels[].borer` ; niveau 5 `breakAll`.

## Dangers (`src/sim/Hazards.ts`, `src/data/hazards.ts`)
- `CAVE_IN` (plafond qui craque au-delà de `maxDug` cases creusées dans un carré 5 × 5 ; étais), `GAS` (ventilateurs), `WATER`
  (pompes), `HEAT`, `HEALTH`. Poches ouvertes d'un coup (`openPocket`) ; `rebuild` / `settlePockets` au chargement.
- Équipement de protection : `src/data/gear.ts`.
- Tests : `hazards`, `deep-zone`, `stone-crumble`, `jackhammer`, `drill-upgrade`, `borer`, `borer-upgrade`, `world`.

## Pistes notées (ROADMAP)
Éclairage posable, électricité, chaleur en profondeur, coups de grisou, détecteur de poches, ressources au-delà de 450 m.
