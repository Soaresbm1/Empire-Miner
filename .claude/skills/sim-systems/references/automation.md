# Automatisation et logistique

## Transport
- Convoyeurs (`structures/Conveyor.ts`, trois niveaux `conveyor`, `conveyor_fast`, `conveyor_express` : une seule classe paramétrée
  par l'identifiant de machine). Capacité et espacement par case : un convoyeur sature si l'aval n'absorbe pas. Mise à jour de
  l'aval vers l'amont (`downstream`, ordre recalculé par `StructureManager` quand le réseau change). `GameState.place` remplace un
  convoyeur d'un autre niveau en gardant direction et objets.
- Séparateur (`Splitter`, trois sorties à tour de rôle), trieur (`Sorter` : `filters`, `allowed()`, `sendsFront()`), pont
  (`Bridge` : relié par `StructureManager` au premier pont de même direction, sans traverser la roche). Fusion = arrivée latérale.
- Wagonnets (`src/sim/Wagons.ts`, `structures/Rail.ts`) : rails et quais fixes (`isTrack`), wagonnets mobiles sauvegardés à part ;
  quai de chargement `feedable` ; aiguillage `RailSwitch.route()`.

## Stockage et sortie
- Coffre (`structures/Storage.ts`) : filtre `allow` (vide = tout) appliqué par `room()` ; remplit d'abord le réservoir des voisins
  (`fuelWanted`), puis se vide **dans des convoyeurs seulement** (jamais coffre → coffre). Réglage de plusieurs coffres :
  `GameState.setStoragesAllow`.
- Caisse d'expédition (`structures/ShippingCrate.ts`) : accepte tout ; `mode` `market` (vend), `orders`, `site` (livre, vend le reste).

## Ouvriers (`src/sim/Workers.ts`, `src/data/workers.ts`)
- Métiers : `picker` (Ramasseur), `refueler` (Ravitailleur), `fixer` (Dépanneur : examine les machines à l'arrêt, recharge ou vide ce qui peut l'être, sinon rentre afficher la cause ; `Repair.ts`, `reports`). `WORKERS.max` (9), `WORKERS.perJob` (3), places
  ouvertes par la pioche (`WORKER_SLOTS`), prix croissant à l'embauche, pas de salaire.
- Recherche de chemin `Pather` (largeur d'abord, cases `walkable`) ; drapeaux de blocage `WorkerFlag` (`nostore`, `full`,
  `noroute`, `nocoal`, `lost`) expliqués par `ui/crew.ts` ; les constats du dépanneur (`WorkerSystem.reports`, sauvegardés) par `repairNotes`.

## Mesure des lignes (lecture seule, ni sauvegardé ni dans l'empreinte)
- `src/sim/Flow.ts` : compteur par structure (anneau de 12 × 5 s), états en marche / bloqué / à sec relevés toutes les 0,05 s par
  `StructureManager.update`. Lecture : `stateOf`, `saturated`, `toneOf` ; vue goulots touche G (`Renderer.drawFlowView`).
- `src/sim/Forecast.ts` : prévisions « au rythme actuel » pour le chantier et les commandes (limites dans ARCHITECTURE).

## Tests
`automation`, `adjacent-output`, `fast-conveyors`, `splitter-bridge`, `sorter`, `chest-select`, `shipping`, `wagons`,
`rail-switch`, `workers`, `driller`, `driller-quota`, `workers-ui`, `flow`, `flow-ui`.

## Pistes notées (ROADMAP)
Chargeur / déchargeur, plusieurs wagonnets par ligne avec signaux, ascenseur de puits, copier-coller d'une ligne, débit par
ligne entière avec alerte d'arrêt.
