# Architecture

```
src/
  core/        constantes, aléatoire déterministe, directions, entrées clavier/souris
  data/        données pures : ressources, blocs, outils, machines, zones de profondeur
  sim/         simulation (aucune dépendance au DOM) — testable en Node
    World.ts             grille de tuiles persistante (blocs, gisements, réserves, dégâts, exploration)
    generator.ts         génération déterministe de la mine depuis une graine
    GameState.ts         état complet + boucle update(dt, intention du joueur)
    Drops.ts             minerais physiques au sol (la pierre s'effrite après `groundLife` secondes)
    Inventory.ts         sac limité en poids + kits de construction
    StructureManager.ts  index spatial des structures et ordre de mise à jour
    structures/          Conveyor, Drill, TunnelBorer, Smelter, Storage, ShippingCrate, Building (+ registre de fabrication)
    Wagons.ts            wagonnets (véhicules qui roulent sur la voie : rails et quais)
    visibility.ts        exploration (révélation des galeries)
    objectives.ts        objectifs calculés depuis l'état réel
    events.ts            événements émis vers la présentation
  save/        sérialisation versionnée (RLE + base64 pour les grilles)
  render/      rendu Canvas 2D : peintre de tuiles, cache par blocs, sprites, effets, éclairage, carte (MineMap)
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

Outils : `GameState.activeTool` donne les caractéristiques de l'outil en main (pioche ou marteau-piqueur,
`data/tools.ts`) ; un outil large frappe la case visée et ses voisines perpendiculaires (`strikeTiles`). Le
marteau-piqueur brûle le charbon du sac à chaque coup.

Foreuse de percement (`TunnelBorer`) : la structure est la base, fixe dans l'index `StructureManager` ; la
foreuse qui en sort n'est pas une structure mais une position (`dist`, en cases depuis la base dans le sens de la
flèche, plus le trajet en cours `moveT`). `StructureManager.borers` les liste pour `GameState.borerAt` (collisions
du joueur, pose interdite, E et infobulle depuis le tunnel). Elle perce avec `digTile` (même effet qu'un bloc
miné, morceaux lâchés derrière elle), attend si `occupied` (joueur, wagonnet), révèle le tunnel avec `reveal` et
rentre à la base (`returning` : plus de charbon, benne pleine, obstacle, tunnel fini, rappel) ; rentrée faute de
charbon ou pour vider sa benne, elle refait le plein (`tank`) dans la réserve de la base (`fuelUnits`) et repart.
Ses niveaux (`MachineDef.levels[].borer`) règlent vitesse, charbon emporté, largeur du front (`faceTiles`) et benne
(`load`, vidée dans le stock de la base `store`, que la base pousse dans les structures collées). `digTile` renvoie
les morceaux lâchés pour que la benne les ramasse. Le niveau suit le kit au démontage (`borer@4`), comme la foreuse
à charbon ; `GameState.upgradeMachine` / `upgradeBlocker` servent aux deux.

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

Foreuse et niveaux : `MachineDef.levels` décrit les améliorations d'une machine posée (prix, condition,
cases couvertes). Pour la foreuse, `reach` liste les cases forées relativement à sa flèche (`under`, `left`,
`right`, `back`) ; `Drill.sources()` garde celles qui ont un gisement et ne sont pas sous une autre foreuse, et
la foreuse avance à la cadence de base multipliée par ce nombre de têtes, en forant les cases à tour de rôle.
Le niveau est sauvegardé avec la structure ; `GameState.upgradeDrill` le fait payer. Démontée, la foreuse
revient dans le stock sous un identifiant de kit qui garde son niveau (`kitId('drill', 3)` = `drill@3`, voir
`parseKit` / `kitName` dans `data/machines.ts`) : `canPlace` et `place` prennent un identifiant de kit et
reposent la machine à ce niveau. Les kits sont sauvegardés tels quels.

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

Four et fonderie (`Smelter`, une classe pour les deux, réglée par `MachineDef.smelter`) : le minerai qui a un
`smeltsTo` (`data/resources.ts`) entre dans `input` par tous les côtés sauf la sortie, devient un lingot (ressource
`ingot: true`, rangée après les minerais pour garder l'index des gisements sauvegardés) dans `output`, poussé devant
la flèche (`frontTiles` : deux cases pour la fonderie 2×2). Le premier lingot d'un métal passe par
`StructureContext.countSmelted`, qui l'ajoute au carnet et compte les lingots pour l'objectif.

Dangers (`sim/Hazards.ts`, données dans `data/hazards.ts`) : `World` porte quatre grilles de plus, `dug` (case
creusée à la main), `pocket` (poche cachée de grisou ou d'eau, placée par le générateur avec son propre tirage pour
ne pas changer le terrain), `gas` et `water` (niveaux 0 à 255). `GameState.breakTile` prévient `HazardSystem.onBroken`
(poche libérée, et case marquée creusée si ce n'est pas une machine) ; le système annonce les éboulements
(`pending`), fait retomber les niveaux et ne parcourt que les cases touchées. Ventilateur et pompe agissent par
`StructureContext.hazards`. La santé (`GameState.hp`) baisse avec `hurtPlayer`, remonte après un délai et
l'évanouissement ramène le joueur au camp. Les poches ne sont pas sauvegardées (elles se recalculent depuis la
graine) ; `dug`, le gaz, l'eau, les éboulements annoncés et la santé le sont.

## Étendre le jeu

- **Nouveau minerai** : ajouter une entrée dans `src/data/resources.ts` (valeur, poids, rareté, résistance,
  niveau, profondeurs, filons, réserves, durée de vie au sol, couleurs). Le bloc de filon, la génération, l'économie, l'inventaire,
  les foreuses et le rendu le prennent en compte automatiquement. Pour qu'il se fonde, lui donner un `smeltsTo` et
  ajouter son lingot (`ingot(...)`) en fin de liste.
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
exploration, objets au sol (avec leur âge, pour que les pierres ne repartent pas pour un délai complet),
structures (avec leur contenu : objets sur convoyeurs, charbon, tampons, coffres), joueur, argent, inventaire,
kits, améliorations et statistiques. Stockage : `localStorage` (+ copie de secours)
et export/import de fichier JSON.
