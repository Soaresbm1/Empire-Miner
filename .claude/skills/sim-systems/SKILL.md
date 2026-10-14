---
name: sim-systems
description: Carte des systèmes de jeu d'Empire Miner (minage et gisements, production four/Manufacture/recettes, automatisation convoyeurs/coffres/wagonnets/ouvriers, économie marché/commandes/chantier) et listes de ce qu'il faut toucher pour les étendre. À charger avant de concevoir, modifier ou équilibrer une mécanique de jeu ou d'ajouter une ressource, une machine, une recette ou une marchandise.
---

# Systèmes de jeu : où et comment étendre

La référence détaillée reste `docs/ARCHITECTURE.md` ; ce skill dit **où regarder** et **quoi ne pas oublier**. Ouvrir seulement
la fiche utile :

- `references/mining.md` : monde, gisements et réserves, roches, outils, foreuses, dangers, profondeur.
- `references/production.md` : four et fonderie, Manufacture et recettes, produits, marché, commandes, Grand Chevalement.
- `references/automation.md` : convoyeurs et transport, coffres, caisse d'expédition, wagonnets, ouvriers, débits et prévisions.

## Principes communs

- **Données d'abord** : tous les nombres réglables sont dans `src/data/*.ts`. Le code les lit ; on équilibre là, pas dans `src/sim`.
- **Une interface d'échange** pour toutes les structures : `canAccept(res, travelDir)` / `accept(res, travelDir, ctx)`, sortie par
  `pushToAdjacentConveyor`, combustible par `fuelWanted()` / `addFuel`, débit mesuré par `flowState()` / `maxPerMinute()`.
  Une nouvelle machine qui les implémente s'insère dans les chaînes, est rechargée par les ouvriers et apparaît dans la vue goulots.
- **Le contexte** `StructureContext` (`structures/Structure.ts`, branché par `GameState`) donne aux structures ce qu'elles ont
  le droit de faire : `structureAt`, `emit`, `autoSell`, `quote`, `deliver`, `countExtracted/Smelted/Crafted`, `digTile`, `reveal`.
- **Tout le monde est simulé en permanence**, hors écran compris : attention au coût par pas (60 pas par seconde, jusqu'à ×4).
  Pas d'allocation ni de parcours de toutes les structures à chaque pas si un index ou un compteur suffit.

## Ajouter une machine (liste établie sur la Manufacture, commit 153ae0f)

1. `src/data/machines.ts` : `MachineDef` (prix, taille, `solid`, `rotatable`, `stats`, `unlock`, spec propre : `fuel`, `levels`…).
2. `src/sim/structures/<Machine>.ts` : la classe (`update`, échanges, `serialize` / `static load` qui vérifie ses valeurs).
3. `src/sim/structures/registry.ts` : `create` et `load`.
4. `src/sim/GameState.ts` (méthodes du joueur sur la machine) et `src/sim/actions.ts` (une `SimAction` par geste).
5. Rendu : `src/render/Renderer.ts` (dessin), `src/render/MineMap.ts` (couleur sur la carte), `sprites.ts` si besoin.
6. Interface : `src/ui/panels.ts` (panneau), `src/ui/UI.ts` et `src/game/Game.ts` (ouverture avec E), `src/ui/flow.ts`,
   `src/ui/stats.ts`, `src/ui/workshop.ts` (magasin) si la catégorie ou l'affichage le demande.
7. Tests : `tests/<machine>.test.ts` (comportement, chaîne par convoyeurs, sauvegarde, ancienne partie), `tests/coop-<machine>.test.ts`.
8. Docs : README (contenu), ARCHITECTURE (section), ROADMAP.

## Équilibrer

- Changer un nombre de `src/data` change la **version du jeu à deux** : c'est normal.
- Avant et après : mesurer plutôt que deviner (`tests/helpers.ts` : `run(g, secondes)`, `timeToBreak`) et noter les effets
  sur la progression (prix des pioches, places d'ouvriers, rangs des commandes, phases du chantier).
- Repères existants à ne pas casser sans le vouloir : le marché vaut 100 % en moyenne (`data/market.ts`), un lingot vaut environ
  2,5 fois son minerai, une plaque 1,5 fois son lingot (textes `uses` de `data/resources.ts`).
- Pas de dépense régulière aujourd'hui (ni salaire, ni entretien) : une source de revenu sans limite n'a pas de contrepoids.
