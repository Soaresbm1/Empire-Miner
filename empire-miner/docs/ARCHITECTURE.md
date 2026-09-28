# Architecture

```
src/
  core/        constantes, aléatoire déterministe, directions, entrées clavier/souris
  data/        données pures : ressources, blocs, outils, machines, zones de profondeur
  sim/         simulation (aucune dépendance au DOM) — testable en Node
    World.ts             grille de tuiles persistante (blocs, gisements, réserves, dégâts, exploration)
    generator.ts         génération déterministe de la mine depuis une graine
    GameState.ts         état complet + boucle update(dt, intention du joueur)
    Drops.ts             minerais physiques au sol
    Inventory.ts         sac limité en poids + kits de construction
    StructureManager.ts  index spatial des structures et ordre de mise à jour
    structures/          Conveyor, Drill, Storage, ShippingCrate, Building (+ registre de fabrication)
    Wagons.ts            wagonnets (véhicules qui roulent sur la voie : rails et quais)
    visibility.ts        exploration (révélation des galeries)
    objectives.ts        objectifs calculés depuis l'état réel
    events.ts            événements émis vers la présentation
  save/        sérialisation versionnée (RLE + base64 pour les grilles)
  render/      rendu Canvas 2D : peintre de tuiles, cache par blocs, sprites, effets, éclairage
  audio/       effets sonores synthétisés (Web Audio)
  ui/          HUD et panneaux HTML au-dessus du canvas
  game/        Game : boucle à pas fixe, entrées → intentions, construction, menus, sauvegardes
```

## Principes

1. **La simulation ne connaît pas la présentation.** `GameState.update(dt, intent)` fait avancer le monde ;
   elle publie des `SimEvent` (coup, bloc détruit, vente…) que `Game` transforme en sons, particules et messages.
2. **Pas fixe (1/60 s).** Le rendu interpole la caméra mais la logique reste déterministe à pas constant.
3. **Données d'abord.** Les ressources, blocs, outils et machines sont des tables ; le code les lit.
4. **Un seul monde persistant.** La mine du début n'est jamais remplacée : chaque tuile minée, chaque gisement
   exploité et chaque machine posée sont sauvegardés.
5. **Tout le monde simulé en permanence.** Les machines tournent même hors de l'écran.

## Échanges de minerais

Toutes les structures parlent la même interface :

```ts
canAccept(res, travelDir): boolean
accept(res, travelDir, ctx): boolean
```

Un convoyeur pousse l'objet de tête vers la structure devant lui ; une foreuse pousse sa production
de la même façon (devant sa flèche, sinon un convoyeur collé) ; un coffre accepte tout ce qui rentre dans sa
capacité et se vide dans les convoyeurs collés ; une caisse d'expédition accepte aussi, puis crédite l'argent
via `StructureContext.autoSell` à chaque passage du transporteur.

La sortie vers les convoyeurs collés (`Structure.pushToAdjacentConveyor`) essaie les côtés à tour de rôle.
Un convoyeur qui pointe vers la structure refuse l'objet (arrivée de face) : c'est une entrée, rien ne repart
en arrière. Les coffres ne se vident que dans des convoyeurs, jamais directement dans un autre coffre, ce qui
évite les allers-retours entre deux coffres voisins.

Combustible : une structure qui brûle quelque chose expose `fuelWanted()` (la ressource voulue tant que son
réservoir n'est pas plein). Un coffre remplit d'abord le réservoir de ses voisins, puis se vide dans les
convoyeurs. Un futur générateur ou four n'aura qu'à implémenter `fuelWanted()` pour être rechargé de la même façon. Un futur trieur, concasseur ou four
n'a qu'à implémenter ces deux méthodes pour s'insérer dans les chaînes existantes.

Tous les niveaux de convoyeur partagent la classe `Conveyor`, paramétrée par l'identifiant de machine
(`conveyor`, `conveyor_fast`, `conveyor_express`) : ajouter un niveau revient à ajouter une entrée
`conveyor: true` dans `data/machines.ts` et une ligne dans le registre. `GameState.place` remplace un convoyeur
d'un autre niveau en conservant sa direction et ses objets.

Séparateurs (`Splitter`), trieurs (`Sorter`, un séparateur dont `allowed()` restreint les sorties selon le
minerai) et ponts (`Bridge`) sont aussi des structures de transport (`isBelt`). Une structure de transport
réglable (`configurable`, ex. le trieur) reste accessible avec `E`. Chacune
indique vers où elle envoie ses objets (`downstream`), ce qui sert à ordonner la mise à jour de l'aval vers
l'amont. Les ponts sont reliés par `StructureManager` à chaque modification du réseau : chaque pont cherche
devant lui, sans traverser la roche, le premier pont de même direction ; s'il est libre il devient sa sortie.

Chaque tuile de convoyeur a une capacité (objets) et un espacement minimal : si la sortie n'absorbe pas assez
vite, les objets s'accumulent et le convoyeur sature. Les convoyeurs sont mis à jour de l'aval vers l'amont
(ordre recalculé quand le réseau change) pour un débit régulier.

## Wagonnets

Les rails et les quais sont des structures fixes (`isTrack`). Les wagonnets, eux, se déplacent : ils vivent dans
`WagonSystem` (comme les minerais au sol) et sont sauvegardés à part. À chaque case, un wagonnet continue tout
droit si la voie le permet, sinon prend le virage ; au bout de la ligne il fait demi-tour. Sur un quai il
s'arrête et transfère (chargement ou déchargement) à cadence fixe. Un quai de chargement est `feedable` : les
coffres et foreuses collés l'alimentent comme un convoyeur. Sur un aiguillage (`RailSwitch`), la direction de
sortie vient de `route()` : branche choisie pour un wagonnet venu de la pointe, pointe pour un wagonnet venu
d'une branche.

## Étendre le jeu

- **Nouveau minerai** : ajouter une entrée dans `src/data/resources.ts` (valeur, poids, rareté, résistance,
  niveau, profondeurs, filons, réserves, couleurs). Le bloc de filon, la génération, l'économie, l'inventaire,
  les foreuses et le rendu le prennent en compte automatiquement.
- **Nouvelle roche hôte** : `HOST_ROCKS` dans `src/data/blocks.ts`.
- **Nouvelle machine** : définition dans `src/data/machines.ts`, classe dans `src/sim/structures/`,
  enregistrement dans `structures/registry.ts`, rendu dans `Renderer.drawStructure`, panneau éventuel dans `ui/panels.ts`.
- **Contraintes de profondeur** (ventilation, eau, chaleur, stabilité, électricité) : ajouter des champs par
  tuile dans `World` (comme `reserve`), un système appelé depuis `GameState.update`, et ses données dans
  `data/depth.ts`. Le format de sauvegarde est versionné (`SAVE_VERSION`) pour migrer les anciennes parties.
- **Plusieurs niveaux de mine** : `World` est une grille autonome ; un futur `GameState` pourra en posséder
  plusieurs, reliés par des ascenseurs (structures qui transfèrent des objets d'une grille à l'autre).

## Sauvegarde

`save/save.ts` régénère le monde depuis la graine puis réapplique : blocs, gisements, réserves, dégâts partiels,
exploration, objets au sol, structures (avec leur contenu : objets sur convoyeurs, charbon, tampons, coffres),
joueur, argent, inventaire, kits, améliorations et statistiques. Stockage : `localStorage` (+ copie de secours)
et export/import de fichier JSON.
