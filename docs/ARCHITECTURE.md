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
puits. Il émet l'événement `worker` (éclat et son). **Machines qui gardent leur minerai** : `heldOre` (foreuse à charbon dont
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
panneau qu'on vient de fermer. Les bandes d'onglets défilent de côté seulement (`overflow-y: hidden`) : sinon leur premier glissé
vertical est avalé par la bande. La carte complète gère elle-même glissé, toucher (repère) et pincement à deux doigts.

Plein écran (`ui/fullscreen.ts`) : `displayMode()` dit si le jeu est déjà une application (`navigator.standalone`,
`display-mode`), plein écran, plein écran possible par bouton (API Fullscreen, hors iPhone), ou seulement par l'écran d'accueil
(iPhone : `installPanel`). Le manifeste (`public/manifest.webmanifest`, `display: fullscreen`), les icônes (`public/*.png`, générées
par `node scripts/make-icons.mjs`) et les balises `apple-mobile-web-app-*` de `index.html` permettent « Sur l'écran d'accueil ». `Game`
garde l'écran allumé (Screen Wake Lock) et refait l'ajustement au changement d'orientation ou de `visualViewport`.

Tests : `e2e/phone.mjs` ouvre le jeu dans Chromium en émulation tactile à 11 tailles (dont celle d'un iPhone dans Safari avec ses
barres, 874×282, et des marges d'encoche simulées par `Emulation.setSafeAreaInsetsOverride`), mesure les rectangles de chaque cadre et
bouton (dans la zone sûre, sans recouvrement, taille de doigt, part de monde visible, menus sans défilement, panneaux de toutes sortes) et
écrit des captures dans `e2e/screenshots/phone/` ; `e2e/touch.mjs` envoie de vrais gestes (`Input.dispatchTouchEvent`) ;
`e2e/playthrough.mjs` rejoue une partie complète au clavier et à la souris.

Repères (`sim/Markers.ts`) : `GameState.markers` (un `MarkerBook`) garde la liste, le repère suivi et
les sauvegarde ; `GameState.addMarker` les nomme d'après le terrain et les machines. La carte complète
convertit un clic en case (`MineMap.tileAt`, via la dernière vue dessinée, donc aussi quand la carte est zoomée) ;
l'interface transmet la position du clic (en pixels du canvas) au relâchement, s'il n'y a pas eu de glissé.

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
- **Lockstep** (`net/lockstep.ts`) : chacun écrit ses entrées `delay` pas à l'avance (8 pas ≈ 133 ms, jusqu'à 30 si le réseau
  est lent). Un pas ne s'exécute que si l'on a l'entrée de l'autre, sinon on attend. Fiabilité par redondance : chaque
  paquet répète les entrées non confirmées (`ack`) et annonce jusqu'où l'on a écrit (`up`) ; un pas sans entrée listée est « sans
  changement ». Pertes, doublons et désordre sont donc sans effet (testé avec 15 % de pertes).
- **Empreintes** (`net/digest.ts`) : toutes les 120 pas (2 s), chacun envoie un hachage de l'état (monde, structures, joueurs).
  Un écart déclenche une **resynchronisation** : l'hôte renvoie sa partie complète.
- **Session** (`net/session.ts`) : poignée de main (`hello` → l'hôte fait entrer l'invité, écrit la sauvegarde, la recharge
  lui-même, la découpe en morceaux de 6000 signes compressés `deflate-raw` + base64 ; l'invité réclame les morceaux
  manquants avec `need`, puis dit `ready`), présence (silence > 8 s = parti), `bye`, `full`, version de protocole.
  Les affaires d'un invité qui part sont gardées chez l'hôte (`guestStash`, par identifiant d'appareil) et rendues à son retour.
- **Transports** (`net/transport.ts`, `net/mqtt.ts`) : un canal « au mieux » (perte, doublon, désordre possibles).
  `MqttTransport` : client MQTT 3.1.1 minimal sur WebSocket, abonné à **trois courtiers publics** à la fois
  (`broker.emqx.io`, `broker.hivemq.com`, `test.mosquitto.org`), publie sur deux ; sujet `empire-miner/v1/<code>` ; messages
  numérotés par émetteur (anti-écho, anti-doublon). `BroadcastTransport` (deux onglets du même navigateur) sert aux essais :
  `?net=local` dans l'adresse.
- **Interface** : `Game` crée la `Session`, route les actions et `runSim` par elle, filtre les événements par joueur
  (`PERSONAL_EVENTS`), n'enregistre jamais côté invité, et désactive pause et vitesse.
- **Essais** : `tests/multiplayer-sim.test.ts` (simulation à deux, déterminisme), `tests/lockstep.test.ts` et
  `tests/session.test.ts` (réseau simulé : pertes, doublons, coupures, divergence, départ/retour), `tests-net/mqtt.check.ts`
  (vrai courtier local), `e2e/coop.mjs` (deux pages de navigateur).
