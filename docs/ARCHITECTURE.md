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
    structures/          Conveyor, Drill, TunnelBorer, Smelter, Crafter, Storage, ShippingCrate, Building (+ registre de fabrication)
    Market.ts            cours du marché (prix variables, événements) ; tirages par hachage, rien d'aléatoire à sauvegarder
    Contracts.ts         commandes des clients : propositions, acceptation, livraison, échéance, rang
    Project.ts           le Grand Chevalement : cinq phases, livraisons, argent versé, avantages
    Wagons.ts            wagonnets (véhicules qui roulent sur la voie : rails et quais)
    visibility.ts        exploration (révélation des galeries)
    objectives.ts        objectifs calculés depuis l'état réel
    events.ts            événements émis vers la présentation
  save/        sérialisation versionnée (RLE + base64 pour les grilles)
  render/      rendu Canvas 2D : peintre de tuiles, cache par blocs, sprites, effets, éclairage, carte (MineMap)
  audio/       effets sonores synthétisés (Web Audio)
  ui/          HUD et panneaux HTML au-dessus du canvas
  game/        Game : boucle à pas fixe, entrées → intentions, construction, menus, sauvegardes
  net/         jeu à deux : lockstep, session, transports (MQTT, BroadcastChannel), instantané, empreintes
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
à charbon ; `GameState.upgradeMachine` / `upgradeBlocker` servent aux deux. Le niveau 5 (`breakAll`) change la règle de
`cutBlocker` : au lieu de refuser ce qui est indestructible ou au-delà du `tier` de la machine, elle ne refuse plus que
le bord du monde (`onWorldEdge`, dernière rangée de la carte) ; un bloc indestructible se perce en `spec.unbreakableHp`
points de dégâts (`cutHp`), le rendu des fissures en tient compte. Les côtés de la tête large suivent la même règle.

Combustible : une structure qui brûle quelque chose expose `fuelWanted()` (la ressource voulue tant que son
réservoir n'est pas plein). Un coffre remplit d'abord le réservoir de ses voisins, puis se vide dans les
convoyeurs. Un futur générateur ou four n'aura qu'à implémenter `fuelWanted()` pour être rechargé de la même façon. Un futur trieur, concasseur ou four
n'a qu'à implémenter ces deux méthodes pour s'insérer dans les chaînes existantes.

Tous les niveaux de convoyeur partagent la classe `Conveyor`, paramétrée par l'identifiant de machine
(`conveyor`, `conveyor_fast`, `conveyor_express`) : ajouter un niveau revient à ajouter une entrée
`conveyor: true` dans `data/machines.ts` et une ligne dans le registre. `GameState.place` remplace un convoyeur
d'un autre niveau en conservant sa direction et ses objets.

Séparateurs (`Splitter`), trieurs (`Sorter`, un séparateur dont `allowed()` restreint les sorties selon le
minerai : `filters` en liste, `sendsFront()` décide) et ponts (`Bridge`) sont aussi des structures de transport (`isBelt`). Une structure de transport
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
**Fréquence** : les dangers étaient trop nombreux (mesuré sur 8 mines : une poche de grisou ou d'eau libérée toutes les
150 à 160 cases de roche creusées, parce qu'une poche de 2 à 4 cases se libérait une fois par case ; un escalier de
marteau-piqueur ou une salle de 4 × 4 faisaient déjà craquer le plafond). Une poche (amas de cases voisines de même nature)
s'ouvre maintenant d'un coup (`openPocket` : percer l'une de ses cases les vide toutes, une seule libération), il y en a 2,4
fois moins (`perThousand` à 1), puis encore deux fois moins (`perThousand` à 0,5) — soit une libération pour environ 1 700 cases de roche
creusées — et le plafond ne craque qu'au-delà de 20 cases creusées dans le carré de 5 × 5 (`CAVE_IN.maxDug`, dès 80 m) : un tunnel de 3 cases
de large n'en compte que 9, un escalier 11, une salle de 8 × 8 creusée rangée par rangée 13, une galerie de 6 cases de large 17 ; il faut presque
remplir le carré. Les poches ont leur propre tirage : changer leur nombre ne bouge ni le minerai ni la carte. Au chargement, `rebuild` referme
(`settlePockets`) toute poche dont une case n'est plus de la roche : comme les poches se recalculent depuis la graine,
sans cela une poche déjà ouverte se serait réarmée par ses cases voisines non percées.

Marché (`sim/Market.ts`, réglages dans `data/market.ts`) : `GameState.market` garde, pour chaque minerai, un cours
(multiplicateur du prix de base) qui avance par pas de 10 s de temps de jeu (`Market.update(time)`, appelé à chaque
tick) : marche aléatoire qui revient vers la moyenne, plus des événements (hausse ou chute temporaire d'un minerai
que le joueur connaît, annoncés par `SimEvent` `market`). Les tirages viennent d'un hash (graine, pas, minerai) : pas
d'état aléatoire à sauvegarder, et avancer d'un coup ou pas à pas donne le même marché. Un lingot suit le cours de son
minerai, la pierre ne s'échange pas. Toute vente passe par `GameState.quote(res, n)` (comptoir, « tout vendre ») ou
`StructureContext.quote` (caisse d'expédition) : le prix d'un lot est arrondi une seule fois. L'interface
(`ui/market.ts`) lit le marché sans le modifier : prix et tendance (Comptoir, sac), courbes SVG et événements (onglet
Marché du Tableau d'affichage), ligne du HUD. Sauvegarde : champ facultatif `market` (cours, courbes, événements) ;
sans lui, le marché repart à 100 % au pas du temps de jeu, sans rejouer le passé.

Filtre de coffre : `Storage.allow` (minerais acceptés, vide = tout) est pris en compte par `room()`, d'où `canAccept`,
`accept` (convoyeurs), `put` (dépôt manuel, ouvriers) : tout ce qui entre passe par le filtre, ce qui est déjà dedans
reste et peut sortir. Réglé depuis le panneau du coffre (`toggleStorageAllow`), sauvegardé (champ facultatif `allow`).
Vitesse de jeu et pause (`game/speed.ts`, `ui/speedBar.ts`) : la simulation ne change pas, elle avance toujours par pas de
SIM_DT ; `advance(g, time, dt, speed, intent)` ajoute `dt × vitesse` à l'accumulateur et fait autant de pas que nécessaire
(au plus `stepCap(speed)` : 8, 16, 32). À vitesse accélérée, un budget de calcul par image (`SPEED_LIMITS.budgetMs`) coupe la
boucle si l'ordinateur ne suit pas, et le retard est oublié ; `smoothRate` mesure la vitesse réellement obtenue (le bandeau
l'affiche sous 80 % de la demande). La pause du joueur (`userPaused`, touche P) saute seulement `advance` : événements,
panneaux, construction et sauvegarde automatique (à l'horloge réelle) continuent. `speedDanger(g)` (santé basse, éboulement
annoncé, grisou, eau profonde) ramène à ×1 et refuse les vitesses rapides. Le son plafonne ses voix simultanées. Ni la vitesse
ni la pause ne sont sauvegardées.

Zoom de la carte complète (`render/MineMap.ts`) : la carte garde un `zoomCell` (taille d'une tuile en pixels du canvas,
`null` = cadrage automatique « tout voir ») et un `center` (en cases). `drawFull` calcule `fitCell` (tout voir) et `maxCell`
(`MAP_MAX_CELL` = 40 px CSS), borne le zoom, puis cadre la vue sur le centre avec `clampAxis` (ramenée dans le monde, ou
centrée s'il est plus petit que la vue). `zoomAround` (pure) garde la case sous le curseur immobile ; `zoomAt`, `zoomBy`,
`panBy`, `resetView`, `centerOnPlayer` sont les points d'entrée. Côté interface (`UI.listenMap`), le canvas n'a plus de
`data-action` : un appui sans mouvement (moins de 5 px) envoie `mapClick` au relâchement, un glissé envoie `mapDrag` (en pixels
du canvas, sans son), la molette `mapWheel`. `Game` ouvre toujours la carte sur « tout voir ».

Réglage de plusieurs coffres : mode `chestMode` de `Game` (touche C), un état d'interface qui ne touche pas la
simulation avant « Appliquer ». `chestSel` (ensemble de `Storage`) est rempli par `updateChests` : un clic bref bascule le
coffre visé, un glissé de plus de 6 pixels choisit ceux du rectangle (`chestsInRect`, `pickChests` : si tous y étaient
déjà, il les retire). `chestDraft` est le réglage à appliquer ; `GameState.setStoragesAllow(coffres, liste)` le copie sur
chacun (normalisé par `normalizeAllow`) et compte ceux qui ont changé. La barre (`ui/chestFilter.ts`, injectée dans
`#hud-build` comme celle de la construction) et les puces du panneau d'un coffre partagent `filterChips`. Le rendu reçoit
`Overlay.chests` (coffres choisis, coffre visé, rectangle en pixels du monde). Pas de portée : un coffre se règle de loin.

Ouvriers (`sim/Workers.ts`, réglages dans `data/workers.ts`) : `GameState.workers` (un `WorkerSystem`) garde les
ouvriers, mis à jour à chaque tick. Chacun a une tâche (`WorkerTask` : marcher vers un tas, un coffre, une machine…)
et un chemin de cases. La recherche de chemin (`Pather`, largeur d'abord sur la grille, tableaux réutilisés, 4
voisins) ne traverse que les cases franchissables (`walkable` : ni roche, ni structure pleine, ni foreuse en route, ni
grisou ou eau profonde) et ne s'arrête qu'à `WORKERS.reach` (2 000 cases de chemin : aucune limite de distance en
pratique) pour **chercher du travail** (tas, machine, charbon) comme pour **rentrer** (déposer la charge dans `planStore`,
livrer du charbon, retourner à la case d'attente). Avant, la limite était de 90 cases et un ramasseur qui avait suivi une
traînée de minerai trop loin des coffres restait coincé avec sa charge. Une recherche qui échoue parcourt toute la zone
accessible (quelques dizaines de milliers de cases au plus : peu coûteux) ; une recherche de coffre sans résultat n'est
refaite que toutes les 3 s (`FAR_RETRY`). Quand il ne
trouve pas de coffre, `planStore` dit pourquoi (`WorkerFlag` : `nostore` aucun coffre n'accepte, `full` ils sont pleins,
`noroute` aucun chemin) ; `ui/crew.ts` en fait les phrases, la ligne du Tableau d'affichage et l'infobulle au survol
(`workerAt`, `workerTooltip`). Le ramasseur vise le tas le plus proche non
réclamé par un autre (les tas de pierre, ceux que le joueur vient de jeter et ceux qu'aucun coffre n'accepte sont
ignorés), puis un coffre qui peut recevoir sa charge (jamais une caisse d'expédition) ; le ravitailleur repère les machines à combustible (`fuelWanted`,
`fuelUnits`, `addFuel`) à moitié vides, prend du charbon dans un coffre et les recharge. Un passage qui se ferme en
route annule la tâche et relance la réflexion ; sans rien à faire, l'ouvrier retourne à sa case d'attente près du
puits. Il émet l'événement `worker` (éclat et son). **Livreur** (`thinkCourier`, `courier` dans `data/workers.ts`, charge `capacityOf` = 30 kg
contre 15) : il livre d'abord sa charge (`deliver`) à la première destination qui l'attend (`destinations` : le bâtiment `site` tant que
`Project.need(res) > 0`, le bâtiment `board` tant que `Contracts.wanted(res) > 0`, c'est-à-dire seulement les commandes acceptées), au
plus proche ; une charge que plus personne n'attend retourne au coffre (`planStore`). À vide, `demand` liste ce qui est attendu (les
commandes dans l'ordre de leur échéance, puis les matériaux de la phase), en retirant ce que les autres livreurs portent déjà, et il va au
plus proche coffre qui en contient (`fetch`) ; `doFetch` recalcule la demande à l'arrivée et ne prend que ce qui reste attendu, dans la limite de
sa charge. `doDeliver` appelle `Project.deliver` / `Contracts.deliver` (les mêmes qu'un joueur au chantier ou au Tableau). Drapeaux : `nogoods`
(attendu mais aucun coffre n'en a) et `lost` (un coffre l'a, aucun chemin). Rien de neuf n'est sauvegardé : le métier et la charge existaient
déjà (la charge est validée contre `capacityOf(métier)`). Tests : `tests/courier.test.ts`, `e2e/courier.mjs`. **Machines qui gardent leur minerai** : `heldOre` (foreuse à charbon dont
le tampon atteint `WORKERS.machinePickup.drill`, stock de la base d'une foreuse de percement à `borerBase`) est ce qu'un
ramasseur peut y prendre ; il vise le tas ou la machine la plus proche, `takeHeld` retire le minerai (`TunnelBorer.takeStored`)
et le même `planStore` choisit le coffre (mêmes règles de filtre, mêmes causes de blocage ; ce qu'aucun coffre n'accepte reste
dans la machine). Les fours et fonderies sont exclus. **Foreur** (`thinkDriller`) : il cherche, parmi les gisements exposés
et explorés (`world.deposit`/`reserve`/`explored`), ceux dont le minerai est au plus du palier `DRILLER_LEVELS[level].maxTier`
(la pierre est exclue), qui ne sont pas dans la portée d'une foreuse existante (`Drill.reach()`), pas réclamés par un autre
foreur et où `GameState.siteProblem` autorise la pose ; `blocksPassage` écarte les cases dont l'occupation couperait un
passage (cases libres voisines qui ne se rejoignent plus dans `DRILLER.passageRadius`). Chaque foreur ne garde que
`DRILLER.maxDrills` (3) foreuses debout : `Drill.placedBy` (identifiant du foreur, 0 pour le joueur ; champ facultatif `by` de la
sauvegarde) est posé par `doPlace`, `WorkerSystem.drillsOf` les compte, `thinkPlace` s'arrête au quota sans drapeau de blocage,
et `remove` (congé) rend ses foreuses sans propriétaire pour qu'un identifiant libéré ne leur reste pas attaché. Avant de chercher un gisement
(`thinkDriller`), il fait le travail d'un ravitailleur pour les foreuses seules (`thinkFuel` partagé avec `thinkRefueler` ;
`needy` ne retient que les `Drill` pour un foreur) : coffre qui a du charbon (`take`), puis foreuse à moitié vide (`fuel`) ;
sans charbon, `nocoal` reste affiché tant qu'il n'a rien à poser. Il marche jusqu'à une case voisine
(tâche `place`) et `GameState.placeDrillFor` pose la foreuse : un kit du stock, à défaut un achat au prix de l'Atelier si
`DRILLER.moneyReserve` reste (`drillAvailable`, sinon drapeau `nodrill`). `canPlace` est découpé en `siteProblem` + `build`
pour que le joueur et les ouvriers partagent les mêmes règles. Niveaux : `Worker.level`, `GameState.upgradeWorker` /
`workerUpgradeBlocker` (prix, pioche, Atelier), qui règlent aussi la durée de pose et la vitesse de marche. Achat à l'Atelier : `GameState.hireWorker` (prix croissant,
`isNear('workshop')`), `setWorkerJob`, `fireWorker`. **Taille de l'équipe** : `WORKERS.max` (9) et `WORKERS.perJob` (3 par
métier) ; les places s'ouvrent avec la pioche (`WORKER_SLOTS` : 3, 6, 9 aux paliers 2, 3, 4 ; `workerSlots`,
`nextSlotStep`). `GameState.workerHireBlocker(métier)` donne la raison d'un refus (équipe complète, palier de pioche,
quota du métier ; l'argent et le lieu sont vérifiés à part) ; `setWorkerJob` refuse un métier déjà plein. `WorkerSystem.add`
reste sans plafond : une sauvegarde plus ancienne (plus de places ou de quota que maintenant) est chargée entière, on
ne peut juste plus y recruter. Sauvegarde : champ facultatif `workers` (métier, niveau,
position, charge ; le reste se recalcule). L'interface (`ui/crew.ts`) lit les ouvriers sans les modifier ; l'onglet est
dans `ui/workshop.ts`, le rendu dans `Renderer.drawWorker` (sprites du mineur recolorés par `PlayerGear.crew`).

Commandes tactiles (`ui/touch.ts`, `core/Input.ts`) : le jeu ne connaît ni doigts ni boutons, seulement `Input`. Les boutons à
l'écran appuient des touches virtuelles (`setVirtual` pour une touche maintenue : stick → ZQSD, ⛏ → Espace, trottinette → Maj ;
`tap` pour un appui bref : Agir → E, ☰ → I, M, B, C, N, T, V, F, P, X, H, Échap) et un doigt posé sur le canvas se comporte comme la
souris (`touchDown`, `touchMove`, `touchUp` : clic gauche, ou droit en mode « Retirer » ; le relâchement est reporté à la fin de
l'image pour qu'un tap très bref soit vu). Deux doigts sur le monde = pincement, converti en cran de molette. `TouchControls`
(créé par `Game.setTouch` si `isTouchDevice()` : `?touch`/`?notouch`, puis le réglage du menu, puis `(pointer: coarse)`) construit
son DOM dans `#ui`, ne le met à jour que si `TouchContext` change, et se cache quand un panneau ou un menu est ouvert. Le zoom de
base se règle sur le petit côté de l'écran (`Renderer.resize`). `stickKeys` et `pinchStep` sont des fonctions pures testées
(`tests/touch.test.ts`).

Mise en page tactile (`ui/touch.css`, actif avec `body.touch`) : `#ui` est un conteneur (`container: ui / size`), donc tout se règle
sur la place **visible** de la page (`cqh`/`cqw`, `@container ui (max-height: 300px)`, `(orientation: portrait)`) et non sur `vh`, qui
sur iOS est la hauteur *sans* les barres de Safari. L'unité `--u` (≈ 12 % de la hauteur, bornée à 34–60 px) donne la taille des
boutons ; `--L/--R/--T/--B` sont les marges (zones sûres `env(safe-area-inset-*)` + 6 px, au moins 24 px de chaque côté contre le
glissé « retour » du bord) ; `--ml/--mr` celles des menus, qui n'ont pas besoin de cette garde. Le HUD (`#hud`) est une grille CSS dans
la zone sûre (colonne gauche : un seul cadre `.hud-left` ; centre : l'objectif, déplacé par `UI` dans `.hud-mid` ; droite : mini-carte
et repère suivi) et `.tc` (boutons) occupe la même zone : stick en bas à gauche, pile de rangées alignée en bas à droite (extras,
raccourcis, Agir et Miner), menu ☰ posé au-dessus de la pile (`--tc-h`). Pendant la construction ou le réglage des coffres, la barre
prend le bas : les boutons montent de sa hauteur (`--bb-h`, titre et ✕ débordants compris) et le renderer décale la caméra
(`bottomInset`). Les messages se posent sous l'objectif (`--obj-bottom`) ou, debout, sous tout le haut du HUD (`--hud-bottom`),
mesurés par des `ResizeObserver`. Sur un écran très bas, le superflu disparaît (`display: none` ciblé) plutôt que de se chevaucher.

Appui sur un bouton (`UI` constructeur) : à la souris l'action part à l'appui (`pointerdown`) ; au doigt, au relâchement et seulement
si le doigt a bougé de moins de 10 px (`TAP_SLOP`) : un glissé qui défile une liste n'active donc pas le bouton sous le doigt (le
navigateur envoie `pointercancel`). `preventDefault` à l'appui évite que le navigateur rejoue un clic de souris sur le monde derrière un
panneau qu'on vient de fermer. L'action et son argument sont ceux du bouton **au moment de l'appui** (`taps`), pas au relâchement : le
panneau se met à jour pendant que le doigt est posé. La carte complète gère elle-même glissé, toucher (repère) et pincement à deux doigts.

Fenêtres fixes (`touch.css`) : l'intérieur d'une fenêtre ne bouge que de haut en bas. `.panel-body` a `overflow-x: hidden` (rien à faire
glisser de côté), `touch-action: pan-y` (un glissé en diagonale ne fait défiler que verticalement) et `overscroll-behavior: none` (`contain`
laisserait le rebond au bout de la liste ; les menus qui défilent ont aussi `overflow-x: hidden` et `pan-y`). Comme tout ce qui dépasse serait
alors coupé, **le contenu doit tenir en largeur** : une bande d'onglets qui défilait de côté (avalée par le doigt qui fait défiler la fenêtre)
passe à la ligne (`flex-wrap`, onglets plus serrés sous 480 px de large), les marges négatives de `.shop-nav` suivent le remplissage du corps
(`--pad-x`, qui valait 6 px de moins que les marges de bureau : de quoi glisser de côté), les tableaux (sac, comptoir) se resserrent sous
480 px, et les lignes du magasin ont `min-width: 0`. `e2e/phone.mjs` mesure, pour chacune des 20 fenêtres à 11 tailles, que le corps et la
bande d'onglets ne débordent pas et que rien ne sort du corps ; `e2e/panels.mjs` glisse de vrais doigts (de côté, en diagonale, sur la bande
d'onglets) sur un contenu volontairement plus large que la fenêtre.

Mise à jour du DOM (`ui/morph.ts`) : un panneau ouvert (Atelier, Tableau d'affichage…) montre des valeurs qui bougent plusieurs fois par
seconde (argent, ouvriers, cours) ; `renderPanel` le recalcule toutes les 0,2 s et, si le HTML a changé, le **corrige sur place** avec
`morph(cadre, html)` au lieu de `innerHTML = …`. Refaire tous les éléments coupe net un défilement ou un appui au doigt (le navigateur perd
l'élément que le doigt tenait) : la fenêtre paraissait figée dès que le jeu tournait, ce que seul un jeu en marche révèle. `morph` apparie
les nœuds par position (même balise, même espace de noms), corrige texte et attributs, et laisse intacts le défilement, les images, les
courbes SVG et la taille d'un canevas (qui appartient à qui le dessine : la carte). Le cadre `.panel` n'est créé qu'à l'ouverture (son
animation `pop` ne rejoue donc pas), et `scrollTop` n'est réécrit que pour remonter en haut (l'écrire arrêterait l'élan d'un défilement sur
iPhone). La barre de construction (`#hud-build`, redessinée à chaque case visée) passe aussi par `morph`. Les autres blocs du HUD, sans
bouton ni défilement, restent en `innerHTML`.

Plein écran (`ui/fullscreen.ts`) : `displayMode()` dit si le jeu est déjà une application (`navigator.standalone`,
`display-mode`), plein écran, plein écran possible par bouton (API Fullscreen, hors iPhone), ou seulement par l'écran d'accueil
(iPhone : `installPanel`). Le manifeste (`public/manifest.webmanifest`, `display: fullscreen`), les icônes (`public/*.png`, générées
par `node scripts/make-icons.mjs`) et les balises `apple-mobile-web-app-*` de `index.html` permettent « Sur l'écran d'accueil ». `Game`
garde l'écran allumé (Screen Wake Lock) et refait l'ajustement au changement d'orientation ou de `visualViewport`.

Un panneau ouvert depuis un menu (« Commandes » du menu principal ou du menu pause, « Plein écran… » sur iPhone) passe devant : le menu
s'efface (`#menu-root.behind-panel`, `visibility: hidden`, posé par `UI.syncOverlay` dès qu'un panneau et un menu sont ouverts ensemble ;
le DOM du menu, sa place et son défilement restent) et revient à la fermeture du panneau (croix, Échap). Le menu reste « ouvert » pour le jeu :
seul, `tickPlaying` garde le jeu figé tant que `ui.menu === 'pause'`, y compris pendant la lecture du panneau. (Le panneau est avant le menu
dans `index.html` : sans cette règle, il s'ouvrait derrière lui.) Les rappels du compte (`onCloudChanged`, `onCloudPulled`) ne redessinent pas
le menu par-dessus un panneau ouvert.

Tests : `e2e/phone.mjs` ouvre le jeu dans Chromium en émulation tactile à 11 tailles (dont celle d'un iPhone dans Safari avec ses
barres, 874×282, et des marges d'encoche simulées par `Emulation.setSafeAreaInsetsOverride`), mesure les rectangles de chaque cadre et
bouton (dans la zone sûre, sans recouvrement, taille de doigt, part de monde visible, menus sans défilement, panneaux de toutes sortes) et
écrit des captures dans `e2e/screenshots/phone/` ; `e2e/touch.mjs` envoie de vrais gestes (`Input.dispatchTouchEvent`) ;
`e2e/panels.mjs` fait de même sur un jeu qui tourne (argent et cours qui bougent) : défilement des fenêtres et de la bande de construction,
toucher long, bouton qui change de sens sous le doigt, contenu exact de chaque fenêtre, et `morph` contre `innerHTML` sur 1 500 paires de
contenus tirées au hasard ; `e2e/menus.mjs` (clics et touches, ce qu'un doigt toucherait) vérifie « Commandes » depuis le menu principal et le menu pause ;
`e2e/playthrough.mjs` rejoue une partie complète au clavier et à la souris.

Repères (`sim/Markers.ts`) : `GameState.markers` (un `MarkerBook`) garde la liste, le repère suivi et
les sauvegarde ; `GameState.addMarker` les nomme d'après le terrain et les machines. La carte complète
convertit un clic en case (`MineMap.tileAt`, via la dernière vue dessinée, donc aussi quand la carte est zoomée) ;
l'interface transmet la position du clic (en pixels du canvas) au relâchement, s'il n'y a pas eu de glissé.

## Commandes et Grand Chevalement

Deux systèmes de **buts**, tous deux dans la simulation (donc déterministes, sauvegardés, identiques sur les deux appareils d'une
partie à deux). Les nombres sont des données : `data/contracts.ts` (marchandises, quantités, primes, délais, rangs, clients) et
`data/project.ts` (phases : matériaux, argent, commandes honorées, avantage).

- **`sim/Contracts.ts`** suit le modèle de `Market` : un tirage par hachage `hash2(numéro de proposition, indice, graine)`, jamais
  de `Math.random`, donc aucun état aléatoire à sauvegarder. Elle ne connaît pas la partie : un **hôte** (`ContractsHost`) lui
  dit ce que le joueur connaît (`known`), ce que le chantier accorde (`perks`), combien de commandes sont honorées
  (`completed`, qui fait le rang) et reçoit les règlements (`settle`) et les nouvelles propositions (`offered`) ; `GameState`
  les branche sur l'argent, les statistiques et les `SimEvent`. `update(temps)` retire les propositions périmées, règle les
  commandes en retard (le client paie la part livrée au prix de base) et en tire une nouvelle quand c'est l'heure. Une
  proposition garde sa récompense, fixée au tirage. `deliver(res, n, seulement?)` sert d'abord la commande la plus pressée.
- **Réputation** (`Contracts.reputation`, un entier par client de `CLIENTS`, réglages dans `REPUTATION`) : `close()` ajoute un point
  (deux pour une exclusive) à une commande honorée, en retire un à un retard ou un abandon (plancher 0, plafond 12) et dit à l'hôte le
  niveau avant et après (`settle(…, {before, after})`), d'où l'annonce « fait désormais confiance ». Le niveau (`trustOf`) donne une
  prime et un délai en plus à la **proposition suivante** (une proposition tirée garde ses chiffres). Le client d'une proposition
  ordinaire est tiré parmi ceux qui n'ont rien sur le Tableau, avec un poids `1 + points` (`pickClient`) ; une partie neuve (tous à zéro) tire
  donc comme avant. **Exclusive** : si le rang (`rankOf(completed())`) dépasse `exclusiveRank` (dernier rang servi), la prochaine proposition
  est une exclusive du client le plus fidèle (au hasard par hachage parmi les ex æquo) et `exclusiveRank` avance ; elle ne revient pas si on
  la laisse passer. Sauvegarde : `rep` (absent si tous à zéro), `x` (absent à 0), `e: 1` par commande ; tout est validé au chargement, une
  ancienne sauvegarde repart à zéro. Ces champs sont dans l'empreinte de synchro (ils comptent pour la simulation).
- **`sim/Project.ts`** ne connaît que le chantier : `deliver`, `fund` (l'argent versé), `ready(commandesHonorées, clientsFidèles?)`, `advance`.
  Il prend en paramètre la liste de ses phases : `GameState.project` (acte I, `PHASES`) et `GameState.project2` (**acte II, le Grand
  Ascenseur**, `PHASES_II`) sont deux instances. `GameState.work` est le chantier **en cours** (`project`, puis `project2` une fois
  l'acte I achevé) : c'est lui que lisent les livraisons du joueur (`deliverToSite`, `fundSite`), les caisses d'expédition (`deliver`),
  les livreurs (`Workers.destinations`/`demand`), le rendu et le panneau ; `worksDone` dit que tout est achevé. Une phase peut exiger
  des clients fidèles (`PhaseSpec.faithful`, compté par `Contracts.faithfulCount()` : clients au niveau `FAITHFUL_LEVEL`) ; l'acte II
  seul en demande. `GameState.perks()` additionne les avantages des deux chantiers, dont `crew` (places d'ouvriers : `maxWorkers` =
  9 + `crew`, `workerSlots` y ajoute les pioches). L'événement `site` porte `act` (1 ou 2) ; `last` marque la fin de l'acte.
  `GameState.checkProject()` (à chaque pas) termine les phases dont tout est réuni et émet `{ t: 'site' }`.
- **Livrer** : à la main (actions `contractDeliver`, `siteDeliver`, `siteFund`, qui exigent d'être devant le Tableau ou le
  chantier, comme `sell` exige le comptoir), ou par une **caisse d'expédition** (`ShippingCrate.mode` : `market`, `orders`,
  `site`). La caisse accepte tout, comme avant (`canAccept` ne change pas : un convoyeur ne se bouche jamais pour une raison
  nouvelle) ; à chaque passage, `StructureContext.deliver(mode, objets, caisse)` donne les objets aux commandes ou au chantier et
  renvoie le reste, que la caisse **vend** au cours du moment. Le mode n'est écrit dans la sauvegarde que s'il n'est pas `market`.
- **Sauvegarde** : `contracts`, `project` et `project2` (champs facultatifs de `SaveData` ; `project2` absent = acte II à zéro, validés au chargement comme `market` : une valeur
  aberrante est ignorée, une ancienne sauvegarde repart de zéro) et deux compteurs dans `Stats` (`contracts`, `contractMoney`). La
  carte régénère le chantier avec les autres bâtiments du camp ; `deserialize` écarte (`GameState.evict`) toute machine d'une
  ancienne sauvegarde qui tomberait dessus (son kit revient au stock, son contenu tombe devant l'entrée) et remet à l'entrée de
  la mine un joueur qui s'y trouverait (`unstickPlayers`).
- **Jeu à deux** : tout passe par des `SimAction` (`contractAccept`, `contractDecline`, `contractAbandon`, `contractDeliver`,
  `siteDeliver`, `siteFund`, `shipMode`) ; les événements `contract`, `site` et `delivered` ne sont pas « personnels » : les deux
  joueurs les voient et les entendent. Le test `tests/coop-orders.test.ts` rejoue un même scénario sur deux copies, et sur une copie
  qui a reçu la partie en cours de route : commandes, chantier, argent et sacs restent identiques.
- **Interface** : `ui/orders.ts` (onglet « Commandes », ligne du HUD, annonces), `ui/site.ts` (panneau du chantier et écran de fin),
  `ui/panels.ts` (`shippingPanel` : destination du transporteur). Étiquettes de confiance et « ★ Exclusive » sur les cartes, liste « Vos clients »
  (six au plus) et annonces de niveau dans `ui/orders.ts`. Le rendu du chantier (`render/sprites.ts` : six états, `Renderer.drawSite`)
  lit `project.phase`.
- **Ajouter un produit** : une ressource `product(...)` (`data/resources.ts`), une recette (`data/recipes.ts`), et si les clients
  doivent le demander, une ligne dans `GOODS` ; rien d'autre (marché, dessin, listes et panneau s'en servent tout seuls).
- **Ajouter une marchandise demandable** : une ligne dans `GOODS` (`data/contracts.ts`). **Changer le chantier** : `PHASES`
  (`data/project.ts`) ; si le nombre de phases change, `buildSiteSprites` doit dessiner un état de plus.

## Manufacture et produits fabriqués

La Manufacture (`sim/structures/Crafter.ts`) est le second étage de la chaîne : le four fait des lingots, elle en fait des
**produits** (plaques, acier, diamant taillé). Elle est écrite sur le modèle du four (`Smelter`) : mêmes entrées par convoyeur
ou à la main, même charbon qui ne brûle que pendant le travail (donc un ravitailleur la recharge sans rien changer à
`Workers`, qui reconnaît une machine à charbon à ses membres `addFuel`, `fuelUnits`, `fuelMax`), même sortie poussée devant la
flèche (la fonction `frontTilesOf` de `Structure.ts` donne les cases de sortie des deux machines), même cadence réduite par la
chaleur. Ce qui change : une **recette choisie** par le joueur.

- **Données** : `data/resources.ts` (les produits sont des `product(...)`, rangés après les lingots pour ne pas décaler les
  index des gisements sauvegardés ; `follows` dit de quel minerai ils suivent le cours, `shape` comment les dessiner),
  `data/recipes.ts` (matières, quantité, durée), `CrafterSpec` de la machine (`data/machines.ts`).
- **Marché** : un produit n'est pas une marchandise cotée (`COMMODITIES` ne change pas, donc le marché sauvegardé non plus) ; il
  suit le cours de son minerai (`FOLLOWS`), si bien qu'un événement sur le fer touche aussi la plaque de fer et l'acier.
- **Une recette par produit** : l'identifiant de la recette est celui du produit. `Crafter.canAccept` ne laisse entrer que les
  matières de la recette (sinon le convoyeur attend) ; `Crafter.setRecipe` renvoie les matières en attente que la nouvelle
  recette n'utilise pas, et `GameState.setCrafterRecipe` les rend au joueur (sac, puis à ses pieds).
- **Statistiques** : `countCrafted` (contexte des structures) compte la fabrication, la range dans le tableau `made` du journal de
  production (clé facultative `f` de la sauvegarde) et fait entrer le produit dans le carnet (`stats.discovered`) : c'est ce
  qui le rend demandable par les clients (`GOODS` de `data/contracts.ts`) et visible dans les listes (coffres, trieur, marché).
- **Interface** : `crafterPanel` (`ui/panels.ts`) montre les recettes dont on connaît les matières ; les actions `crafterRecipe`,
  `crafterFuel`, `crafterDeposit`, `crafterCollect` passent par `SimAction` (donc par le jeu à deux). Le dessin est `drawCrafter`
  (`render/Renderer.ts`) ; les petits objets (plaque, poutre d'acier, gemme) sont dessinés par `buildNuggetSprites` selon `shape`.
- **Sauvegarde** : `Crafter.load` n'accepte que des valeurs saines (recette connue, matières de la recette, nombres bornés).
  Les deux dernières phases du chantier réclament des produits : `Project.load` rend (`GameState.giveBack`) ce qui avait été
  livré à une phase qui ne l'attend plus, pour qu'un changement de recette du chantier ne fasse rien perdre.

## Rendement des lignes : débits, goulots, prévisions

Trois outils pour juger une ligne, tous **en lecture seule** : rien ne change la partie, rien n'est sauvegardé, rien ne passe par
le réseau, et l'empreinte du jeu à deux ne les voit pas.

- **`sim/Flow.ts`** : un compteur (`Flow`) par structure mesurée, créé à la première utilisation (`Structure.flow`, donc les rails et les
  bâtiments n'en ont pas). C'est un anneau de 12 tranches de 5 s : par tranche, les objets **sortis** (`add`), les objets **entrés**
  (`addIn`, pour les coffres et les caisses) et les secondes passées **en marche, bloqué ou à sec** (`tick(dt, état)`). Le temps
  vient des pas de simulation (jamais de l'horloge de la machine) : la pause et les vitesses ×2 / ×4 comptent comme il faut.
  `StructureManager.update` relève `flowState()` de chaque structure toutes les 0,05 s (pas à chaque pas : un tiers du coût) et
  fait avancer son compteur ; les
  structures appellent `flow.add()` là où un objet passe (`Conveyor`, `Splitter`, `Bridge` : l'objet est pris par la structure
  suivante ; `Drill`, `Smelter`, `Crafter` : à l'extraction, la fonte ou la fabrication ; `Storage` : `addIn` à l'arrivée, `add`
  au départ ; `ShippingCrate` : `addIn`). Chaque classe dit aussi son **débit maximal** (`maxPerMinute()` : cadence de la machine
  avec la chaleur, vitesse × capacité pour un convoyeur) et ce qu'est pour elle « bloquée » ou « à sec » (`flowState()` :
  sortie pleine ou plus de charbon, ou rien à traiter).
- **Lecture** : `stateOf` (l'état qui a dominé la minute, celui du moment tant que la mesure a moins de 10 s), `saturated`
  (convoyeur à 85 % de sa charge) et `toneOf` (rouge / ambre / vert / rien) servent la vue goulots du rendu
  (`Renderer.drawFlowView`, `drawFlowLabels`, activée par `Overlay.flow` et la touche `G`) ; `ui/flow.ts` écrit les infobulles
  (`flowTip`, appelée par `Game.describeTile`) et les lignes des panneaux (`flowRows`). `Smelter.backedUp()` et
  `Crafter.backedUp()` disent que la file d'attente est pleine (à une fabrication près) : avec une machine qui travaille en
  continu, c'est le goulot (`limiting`).
- **`sim/Forecast.ts`** : « au rythme actuel, dans combien de temps ? ». `ProductionLog.recent()` donne les débits des 2 dernières
  minutes, chaque ressource ramenée au temps écoulé depuis son premier relevé dans la fenêtre (30 s au moins) : une ligne qu'on
  vient de bâtir se lit juste tout de suite, une ligne arrêtée s'éteint à mesure que ses relevés sortent. `supply` en retire ce que
  consomment les fours (un lingot fondu a coûté un minerai) et les recettes de la Manufacture ; `materialNeed` et `moneyNeed`
  déduisent le sac et la bourse ; `combine` retient le besoin le plus long (un besoin qui n'avance pas passe avant) ;
  `projectForecast` et `orderForecast` appliquent cela à la phase du chantier et à une commande, `fitIn` la compare au temps dont
  on dispose. `ui/forecast.ts` écrit le bloc du chantier, l'étiquette de chaque besoin et les lignes « À votre rythme » (commande
  acceptée) et « Réalisable ? » (proposition).
- **Limites assumées** : une prévision suppose que toute la production arrive à destination et que deux besoins sur la même
  ressource ne se la partagent pas (la phrase le dit en infobulle) ; le charbon brûlé par les machines n'est pas déduit. Un
  chargement ou une resynchronisation remet les compteurs de débit à zéro (ils se remplissent en 10 s) ; les compteurs
  `outCursor`, `frontCursor` et `resCursor` des structures, eux, ne sont pas sauvegardés non plus (c'est le cas depuis toujours).
- **Tests** : `tests/flow.test.ts` (compteur, chaînes réelles : four saturé, foreuse, Manufacture, séparateur et pont, caisse
  pleine ; rechargement et déterminisme des mesures), `tests/flow-ui.test.ts` (infobulles, panneaux, légende, aide),
  `tests/forecast.test.ts` (production récente, calcul, textes du chantier et des commandes), `e2e/flow.mjs` (navigateur réel :
  pixels de la vue goulots lus sur le canvas).

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
kits, améliorations, statistiques, commandes et chantier. Stockage : `localStorage` (+ copie de secours), export/import de fichier JSON, et,
si le joueur a un compte, une copie en ligne (voir « Compte » plus bas).

**Bilan de session** (`sim/Recap.ts`, `ui/recap.ts`) : `GameState.sessionBase` (compteurs pris par `Game.begin` à l'ouverture) et
`GameState.lastSession` (lue dans la sauvegarde) sont **hors simulation**. Le bilan d'une session est la différence des compteurs de
`Stats` depuis `sessionBase` (`recapSince`), dont quatre compteurs d'ouvriers (`crewStored`, `crewFueled`, `crewPlaced`,
`crewDelivered`, incrémentés par `Workers`, donc déterministes). `serialize` écrit le champ facultatif `recap` (`recapToSave`) : la session
en cours si elle a duré `RECAP_MIN_SECONDS` (2 min), sinon la précédente, pour qu'une ouverture de dix secondes n'efface pas le bilan
d'une longue partie ; **jamais** quand `world: false` (l'empreinte de synchronisation et la resynchronisation à deux ne le voient pas :
chaque appareil a sa session). `deserialize` le lit (`parseRecap` écarte les valeurs absurdes). À la reprise (`continueGame`,
`loadSave`), le jeu ouvre le panneau « Bilan » (`recap`, onglet `resume`) s'il y a quelque chose à dire ; le menu pause a un bouton « Bilan ».

## Équilibrage

`sim/Balance.ts` (outils, aucune règle du jeu ne les lit) : `rawNeeds` ramène les phases des chantiers à des minerais (lingots un pour
un, recettes), `worldSupply` compte ce qu'une mine contient (filons + réserves des gisements), `ordersTimeline` mesure sur le vrai
`Contracts` le temps minimal que les commandes et les clients fidèles imposent (un joueur qui prend d'abord les clients de confiance et
livre après un délai donné). `tests/balance.test.ts` en tire des garde-fous : **la mine la plus pauvre de 60 doit contenir au moins 1,25 fois
ce que les deux actes demandent** (le diamant est le point sensible : certaines mines n'en cachent que 14 à 26 unités ; c'est pourquoi
l'acte II en demande peu), l'acte II dure plus d'une heure même sans attente de production et quelques heures à dix minutes par commande,
et les clients fidèles ne retardent pas plus d'une heure un joueur qui choisit ses clients. `npm run balance` réécrit `docs/BALANCE.md`
(coût de chaque phase, minerais, rythme des commandes, temps pour payer).

## Jeu à deux (lockstep)

**Principe.** Les deux appareils partent du même état (la sauvegarde de l'hôte, rechargée des deux côtés) et font tourner la
même simulation à pas fixe ; seules les **entrées** circulent : l'intention de chaque joueur à chaque pas et ses
`SimAction` (acheter, poser, régler…). Aucun état de jeu n'est envoyé en cours de partie.

- **Déterminisme** (`core/dmath.ts`, test d'analyse statique) : pas de `Math.random`, `hypot`, `exp`, `log`, `sin`, `cos`,
  `pow` dans `src/sim` ; les fonctions voisines sont remplacées par des versions n'utilisant que + − × ÷ √, identiques sur
  tous les moteurs JavaScript (iPhone ↔ ordinateur). Les tirages passent par le générateur de la simulation.
- **Joueurs** (`sim/GameState`) : les champs personnels (`PERSONAL_KEYS` : joueur, sac, pioche, équipement, corde, santé…)
  sont échangés par référence (`withSlot`) ; le reste (argent, monde, structures, kits, ouvriers, wagonnets, marché,
  repères) est commun. Les phases du monde tournent sous l'emplacement 0 pour que les deux appareils s'accordent.
  `local` est le joueur de l'appareil ; `otherPlayers()` sert au rendu.
- **Actions** (`sim/actions.ts`) : tout ce que l'interface change passe par `applyAction(g, SimAction)`. Seul, elle
  s'applique tout de suite ; à deux, elle est mise en file (`Session.send`) et appliquée aux deux appareils au même pas, dans
  l'ordre des emplacements. Les retours à l'écran sont des événements `message` portant l'emplacement du joueur concerné.
- **Lockstep** (`net/lockstep.ts`) : chacun écrit ses entrées `delay` pas à l'avance. Un pas ne s'exécute que si l'on a l'entrée
  de l'autre, sinon on attend. Fiabilité par redondance : chaque paquet répète les entrées non confirmées (`ack`) et annonce
  jusqu'où l'on a écrit (`up`) ; un pas sans entrée listée est « sans changement ». Pertes, doublons et désordre sont donc sans
  effet (testé avec 15 % de pertes).
  **Avance d'écriture** : `delay` est ce que *l'autre demande* (`dl` de ses paquets, de 8 à 40 pas ≈ 133 à 670 ms), car c'est lui
  qui attend mes entrées. Celui qui attend mesure son attente (`noteStall`, appelé par `Session.advance` quand elle finit) et
  demande à l'autre d'écrire plus loin devant d'autant de pas (12 au plus par attente, une demande n'est pas surenchérie avant
  qu'elle ait fait effet) ; après 20 s de calme il redemande moins, un pas toutes les 3 s (`relax`). Ne comptent pas : une gigue
  de moins de 40 ms, une panne de plus de 1,5 s, et l'attente des premiers pas (l'autre charge encore sa partie). Un lockstep
  neuf (resynchronisation) hérite de ce que l'ancien avait appris (`inherit`). L'ancien réglage (`adapt`) remontait puis
  redescendait aussitôt à 8 pas (la décroissance était appelée toutes les 50 ms) : à 250 ms de latence, 29 % du temps était
  passé à attendre. Les deux appareils ne sont pas au même numéro de pas au même instant (l'un a quelques pas d'avance : c'est
  normal) ; les empreintes se comparent par numéro de pas.
- **Empreintes** (`net/digest.ts`) : toutes les 120 pas (2 s), chacun envoie un hachage de l'état (monde, structures, joueurs).
  Un écart déclenche une **resynchronisation** : l'hôte renvoie sa partie complète.
- **Session** (`net/session.ts`) : poignée de main (`hello` → l'hôte fait entrer l'invité, écrit la sauvegarde, la recharge
  lui-même, la découpe en morceaux de 6000 signes compressés `deflate-raw` + base64 ; l'invité réclame les morceaux
  manquants avec `need` — seulement quand plus aucun n'arrive depuis 350 ms —, puis dit `ready` ; si l'invité répète `hello`
  alors que l'hôte a déjà tout envoyé une fois, rien n'étant arrivé, l'hôte renvoie la partie), présence, `bye`, `full`,
  version de protocole.
  **Un morceau n'est jamais chargé deux fois** : tant qu'un instantané est en cours de déballage (asynchrone), les morceaux du même
  numéro qui arrivent (renvois, courtiers multiples) sont ignorés (`loadingId`) ; sinon l'invité repartait du pas 0 pendant que
  l'hôte jouait, perdait ses entrées, divergeait et déclenchait une resynchronisation, qui pouvait recommencer.
  **Instance** : chaque invité se présente avec un numéro tiré à chaque ouverture de la page (`k`, dans `hello` et `bye`). Un
  `hello` du même invité et de la même instance, alors que la partie est en route, est un doublon ou un message en retard
  (courtier lent) : ignoré, au lieu de recharger la partie des deux côtés ; un `hello` d'une autre instance (page rechargée) fait
  revenir l'invité ; un `bye` d'une instance précédente ne coupe rien.
  **Silence** (8 s) : l'hôte reprend seul (`dropPeer`, `dropped` pour la pastille « Ami hors ligne ») ; l'invité reste dans la
  partie (`reconnecting`, bandeau « Connexion interrompue : nouvelle tentative… »), renvoie `hello` toutes les 2 s et, si
  l'hôte l'entend, reçoit de nouveau la partie tout seul ; il n'abandonne (`lost`, « Réessayer ») qu'au bout d'une minute. L'hôte
  reprend aussi seul si l'invité écrit encore mais que la partie n'avance plus depuis 20 s.
  **Version** : `PROTOCOL` est « 1- » suivi d'une empreinte (SHA-1) de `src/sim`, `src/data`, `src/core`, `src/save` et `src/net`, calculée à la
  construction (`define` de `vite.config.ts`) : toute modification de ce qui décide du déroulement d'une partie change la version,
  et un invité resté sur l'ancienne page est refusé (« rechargez la page des deux côtés ») au lieu de jouer une autre partie ;
  le dessin et l'interface n'y comptent pas. Le numéro ne change à la main que si le format des messages change.
  Les affaires d'un invité qui part sont gardées chez l'hôte (`guestStash`, par identifiant d'appareil) et rendues à son retour.
  **Synchronisation bornée** : la partie de l'hôte est figée pendant qu'il envoie la partie (le lockstep attend l'invité). Elle ne
  l'est plus pour toujours : au bout de `SYNC_TIMEOUT_MS` (20 s) l'hôte reprend seul (`giveUpSync` : `dropPeer`, avis au joueur) et
  ignore les `hello` pendant `SYNC_PAUSE_MS` × le nombre d'échecs de suite (40 s au plus), pour ne pas se figer en boucle. L'invité,
  lui, se représente quand plus aucun morceau n'arrive depuis 6 s (l'hôte, qui a tout envoyé une fois, recommence) et abandonne au
  bout d'une minute (`failure = 'slow'`). Une erreur en préparant la partie (`beginSync`) n'est plus une promesse rejetée que
  personne ne voit : `syncError` prévient l'invité (`bad`, `kind: 'host'`) et l'hôte (`notice`) et l'hôte reprend seul.
  **Session fermée** : elle ne réagit plus (`closed` : messages en retard, instantané déballé ou compressé après coup, changements
  d'état) ; sinon un retour asynchrone remplaçait la partie ou l'écran de la session suivante.
  **Avis et diagnostic** : `SessionOptions.notice` donne à l'hôte ce qu'il ne verrait pas (version différente de l'invité avec les deux
  versions, mine pleine, erreur), au plus une fois par 15 s et par sujet ; `Session.failure` dit pourquoi un invité a échoué (version,
  complet, trop lent, hôte parti, illisible, perdu) pour que l'écran propose le bon geste ; `Session.log` garde les 40 derniers
  événements ; `Session.diagnostic()` assemble version, état, relais (`Transport.report()`) et journal en un texte à copier.
- **Transports** (`net/transport.ts`, `net/mqtt.ts`) : un canal « au mieux » (perte, doublon, désordre possibles).
  `MqttTransport` : client MQTT 3.1.1 minimal sur WebSocket, abonné à **trois courtiers publics** à la fois
  (`broker.emqx.io`, `broker.hivemq.com`, `test.mosquitto.org`), publie chez **tous ceux qui sont ouverts** (un courtier lent ne
  retarde pas les autres) ; sujet `empire-miner/v1/<code>` ; messages numérotés par émetteur (anti-écho, anti-doublon sur les
  6000 derniers : chacun arrive jusqu'à trois fois, une par courtier).
  Un courtier peut devenir muet sans que sa connexion se ferme (réseau mobile qui change, téléphone qui dort) : un « ping »
  toutes les 10 s, et un courtier dont rien n'est venu depuis 25 s (ou dont la connexion n'a jamais réussi à s'ouvrir) est
  abandonné et reconnecté tout de suite (sans attendre la fin de la connexion, qui peut durer des minutes) ; `wake()` (appelé par le jeu quand l'application revient au premier plan)
  fait ce contrôle en 3 s ; on ne publie pas chez un courtier dont plus de 32 Ko attendent d'être envoyés (les paquets du
  jeu se répètent, inutile de les empiler). Les morceaux de la partie, eux, partent par **un seul relais**, tiré au hasard parmi
  les relais ouverts et non encombrés (`Transport.trySend`) : `Session.pumpHost` n'avance au morceau suivant que si un relais l'a
  pris (avant, les morceaux étaient triplés, et ceux que le plafond de 32 Ko refusait étaient perdus sans que l'envoi le sache : il
  fallait que l'invité les redemande). `relays()` et `report()` disent combien de relais sont ouverts et pourquoi les autres ne
  le sont pas (refus du relais avec son code, connexion fermée, relais muet, essais). `BroadcastTransport` (deux onglets du même
  navigateur) sert aux essais : `?net=local` dans l'adresse.
- **Mise à jour** (`game/update.ts`, `vite.config.ts`) : la construction écrit `version.json` (`build` : identifiant de la
  construction, aussi dans la page sous `__BUILD_ID__` ; `protocol`) à côté de la page. `watchForUpdate` le relit 4 s après le
  démarrage, toutes les 3 minutes et quand la page revient au premier plan (`cache: 'no-store'`, adresse à paramètre variable) ; s'il
  annonce une autre construction, les menus proposent « Mise à jour disponible » (`UI.setUpdate`). `reloadFresh` recharge par une
  adresse neuve (`?v=…`, retiré au démarrage par `cleanReloadParam`) : le cache du navigateur (10 min sur GitHub Pages) ne peut pas
  répondre. Sans cela, un joueur resté sur la page d'avant une mise à jour voit « Versions différentes du jeu » sans savoir quoi faire.
- **Interface** : `Game` crée la `Session`, route les actions et `runSim` par elle, filtre les événements par joueur
  (`PERSONAL_EVENTS`), n'enregistre jamais côté invité, et désactive pause et vitesse.
- **Essais** : `tests/multiplayer-sim.test.ts` (simulation à deux, déterminisme), `tests/lockstep.test.ts` (dont l'avance
  d'écriture demandée) et `tests/session.test.ts` (réseau simulé : pertes, doublons, latence de 250 ms, pics, coupures de 20 s et
  à sens unique, `hello` et `bye` en retard, divergence, départ/retour ; les deux appareils se comparent au même pas),
  `tests/mqtt-transport.test.ts` (faux courtiers : muets, encombrés, réveil, un seul relais pour les gros messages, état des relais),
  `tests/session-lifecycle.test.ts` (l'application de chaque joueur ouvre, ferme et recrée ses sessions au milieu de pannes au
  hasard ; à la fin, l'hôte qui recrée l'invitation et l'invité qui rejoint y arrivent toujours), `tests/update.test.ts`,
  `tests-net/mqtt.check.ts` (vrai courtier local), `e2e/coop.mjs` (deux pages de navigateur, longue coupure comprise, invitation
  annulée puis recréée, diagnostic, mise à jour).

## Compte (sauvegarde en ligne)

Le jeu n'a pas de serveur : la partie du joueur peut être gardée chez **Firebase** (Authentication + Firestore), appelé directement
par `fetch` (REST), sans le SDK de Google. Mise en place, règles de sécurité, vie privée et dépannage : [COMPTE.md](COMPTE.md).
Tout vit dans `src/cloud` (et `ui/account.ts` pour l'écran) ; **rien dans `src/sim`, `src/data`, `src/core`, `src/save` ni `src/net`**
n'a changé : la version du jeu à deux (`PROTOCOL`) n'en dépend pas.

- `config.ts` : `FIREBASE` (clé et identifiant du projet, vides tant que le projet n'est pas créé : le compte est alors absent).
  `?debug&cloud=http://127.0.0.1:PORT` désigne un faux serveur, **uniquement sur cette machine** (`localEndpoints`).
- `client.ts` : `CloudClient`. Identity Toolkit (`accounts:signUp`, `signInWithPassword`, `sendOobCode`, `delete`), renouvellement du jeton
  (`securetoken`), Firestore (`GET`/`PATCH`/`DELETE` de `saves/{uid}`). Le document porte la sauvegarde emballée (`pack.ts` : deflate +
  base64, même outil que l'instantané du jeu à deux) et un résumé (`seed`, `time`, `money`, `depth`, `savedAt`, `device`). Une écriture
  passe `currentDocument.updateTime` (la révision qu'elle croit remplacer) ou `currentDocument.exists=false` : un autre appareil qui a écrit
  entre-temps fait refuser l'écriture (`conflict`). Les erreurs de Google sont ramenées à une quinzaine de codes (`CloudError`, avec leur
  texte français) ; un 404 « la base n'existe pas » n'est pas pris pour « pas de partie ».
- `reconcile.ts` : la décision, pure (`nothing`, `adopt`, `push`, `pull`, `ask`), à partir de la partie de l'appareil, de celle du compte et
  du **dernier échange réussi** de cet appareil (`SyncLink` : révision, graine, temps de jeu, heure de l'appareil). Une sauvegarde de
  l'appareil faite moins de 90 s après cet échange (`DRIFT_MS`, la dernière sauvegarde d'une page qu'on ferme) n'est pas un « travail à
  part » : sans cette marge, changer d'appareil poserait la question à chaque fois. On ne reprend en silence que **la suite** de la partie de
  l'appareil (même graine) : une autre partie arrivée sur le compte (nouvelle partie ou import ailleurs) pose la question `replaced`, car la
  prendre ferait disparaître celle de l'appareil. `recognizeOwn` : le compte contient notre propre dernier envoi (page fermée en route,
  réponse perdue) : ce n'est pas un autre appareil.
- `sync.ts` : `CloudSync`, une file d'opérations (une à la fois). `exchange` lit le résumé du compte, décide, agit (`push`, `pull`) ou pose
  la question (`ask`) ; après une sauvegarde de l'appareil (`localSaved`), un envoi direct d'une seule requête (`fastPush`), repli sur le tour
  complet s'il est refusé. Jamais de remplacement de la partie en cours de jeu (`hooks.playing`) : une partie plus récente du compte devient
  la question « newer ». `resolve(choix)` : la partie qu'on ne garde pas est mise de côté **et vérifiée** avant que l'autre soit remplacée ;
  une partie du compte illisible par cette version (`validate` = `deserialize`) n'est jamais écrite à la place d'une bonne, ni écrasée.
  `leaving()` (page fermée, arrière-plan) envoie la dernière partie emballée par une requête `keepalive`. Après une attente de réseau, l'écran
  du compte n'est redessiné que s'il est encore affiché (`Game.refreshAccount`) : la connexion s'affiche dès que Google répond, la première
  synchronisation vient après, et le joueur a pu quitter l'écran entre-temps. Jeton refusé : renouvelé et réessayé
  une fois ; renouvellement refusé : session terminée, avec un avis. Panne réseau : reste sur l'appareil, nouvel essai au retour du réseau.
- `store.ts` : session (jeton de renouvellement, jamais le mot de passe), souvenir des échanges, emplacements de sauvegarde (mêmes clés que
  `save/save.ts`, vérifiées par un essai) et partie mise de côté.
- `game/Game.ts` : crée `CloudSync` (si configuré, et pas dans l'hébergement « artifact »), appelle `localSaved` après chaque sauvegarde,
  `leaving` à la fermeture, `sync` au retour au premier plan et avant « Continuer » (cinq secondes au plus). `ui/account.ts` : l'écran
  (formulaire, état, deux parties, partie mise de côté, suppression), HTML pur.
- **Essais** : `tests/support/fakeFirebase.ts` reproduit les trois API (réponses et erreurs de Google, jetons qui expirent, révisions,
  préconditions, règles) ; `tests/cloud-{client,reconcile,sync,misc}.test.ts` ; `e2e/cloud.mjs` (deux profils de navigateur, faux serveur HTTP
  `e2e/support/fakeServer.mjs`) ; `e2e/phone.mjs` (écrans du compte sur 11 tailles d'écran). Le faux serveur ne reçoit jamais les identifiants
  du vrai projet (`TEST_CONFIG`) ; il peut répondre avec retard (`latency`) pour reproduire la lenteur de Google. `tests-net/firebase.check.ts`
  est l'essai **réel** : les autorisations CORS de Google, puis un compte jetable dans le vrai projet (création, jeton, écriture,
  préconditions, règles, deux appareils), supprimé ensuite. `tests-net/browser.check.mjs` fait de même **dans un navigateur** : le jeu de `dist/`
  servi à son adresse publique, les requêtes vers Google relayées par Node (le Chromium d'un bac à sable ne fait pas confiance au certificat de
  son mandataire, Node si).
