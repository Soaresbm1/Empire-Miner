# Production, économie, buts

## Transformation
- Four et fonderie (`structures/Smelter.ts`, `MachineDef.smelter`) : minerai avec `smeltsTo` → lingot (`ingot: true`), au charbon ;
  entrée par tous les côtés sauf la sortie, sortie devant la flèche (`frontTilesOf`). `countSmelted` compte et fait découvrir.
- Manufacture (`structures/Crafter.ts`, `MachineDef.crafter`) : recette **choisie** (`setRecipe`, `GameState.setCrafterRecipe`
  rend ce qui ne sert plus) ; `canAccept` ne laisse entrer que les matières de la recette ; charbon brûlé pendant le travail.
- Recettes : `src/data/recipes.ts` (`id` = produit, `inputs`, `yield`, `time`). Produits : `product(...)` dans `data/resources.ts`
  (`follows` : cours suivi, `shape` : dessin `plate` / `bar` / `gem`).
- **Ajouter un produit** : ressource `product(...)` en fin de liste, recette, et ligne `GOODS` si les clients doivent le demander.

## Marché (`src/sim/Market.ts`, `src/data/market.ts`)
- Cours = multiplicateur du prix de base par minerai, pas de 10 s, marche aléatoire qui revient vers la moyenne + événements
  (forte demande, surproduction), bornes 0,5 à 2. Tirages par **hachage** (graine, pas, minerai) : rien d'aléatoire à sauvegarder.
- Lingots et produits suivent le cours de leur minerai (`FOLLOWS`). La pierre ne s'échange pas.
- Toute vente passe par `GameState.quote(res, n)` ou `StructureContext.quote` : prix d'un lot arrondi une seule fois.

## Commandes des clients (`src/sim/Contracts.ts`, `src/data/contracts.ts`)
- `GOODS` (marchandises demandables), `CONTRACTS` (quantités, primes, délais), `CLIENTS`, `rankOf` (rangs), `REPUTATION` et
  `trustOf` (confiance par client, exclusives). Tirages `hash2(numéro, indice, graine)`.
- Hôte `ContractsHost` : `known`, `perks`, `completed`, `settle`, `offered` ; livraison à la main ou par caisse réglée sur `orders`.

## Grand Chevalement (`src/sim/Project.ts`, `src/data/project.ts`)
- `PHASES` : matériaux, argent, commandes honorées, avantage (`PhasePerk`). Changer le nombre de phases demande un état de plus
  dans `buildSiteSprites`.

## Mesures disponibles
- `Stats` (`GameState.ts`) : `earned`, `spent`, `autoSold`, `smelted`, `crafted`, `contracts`, `contractMoney`, `collected`…
- `ProductionLog` (`Production.ts`) : production des 10 dernières minutes ; `Forecast.ts` : « au rythme actuel ».
- Tests : `smelter`, `crafter`, `products`, `market`, `market-ui`, `contracts`, `contracts-reputation`, `project`, `forecast`,
  `production`, `coop-orders`, `coop-crafter`.

## Pistes notées (ROADMAP)
Concasseur, alliages, composants, recettes à plusieurs étages ; second chantier ; clients aux goûts propres.
