# Empire Miner

Jeu de minage, de progression et d'automatisation.
On commence avec une vieille pioche dans une petite mine ; on finit (à terme) à la tête d'une
exploitation industrielle où des milliers de minerais circulent sur des chaînes que l'on a
construites soi-même — dans **la même mine**, qui garde la trace de chaque coup de pioche.

> Faire à la main → gagner de l'argent → améliorer → automatiser → nouveaux problèmes → automatiser encore.

## Jouer

Depuis la racine du dépôt :

```bash
npm install
npm run dev          # http://localhost:5173
```

Version autonome en un seul fichier HTML (ouvrable sans serveur) : `npm run build:single` → `dist-single/index.html`.

### Commandes

| Action | Touche |
| --- | --- |
| Se déplacer | `ZQSD` (AZERTY) / `WASD` (QWERTY) ou flèches |
| Miner | maintenir le **clic gauche** sur une paroi proche, ou `Espace` pour frapper devant soi |
| Interagir (comptoir, atelier, coffre, foreuse) | `E` |
| Sac et carnet | `I` ou `Tab` (hors construction) |
| Mode construction | `B` — machines rangées par onglets : `Tab` (ou clic) change d'onglet, `1-9` (ou clic) choisit la machine ; clic gauche : poser (glisser pour tracer convoyeurs et rails), clic droit : démonter, `R` : tourner. Une ligne d'état dit si la pose est possible, et pourquoi sinon |
| Pioche ↔ marteau-piqueur | `T` (une fois le marteau-piqueur acheté) |
| Monter / descendre d'un wagonnet | `F` |
| Carte de la mine | `M` (ou clic sur la mini-carte) |
| Poser un repère là où on est | `N` (sur la carte : clic) |
| Zoom | molette |
| Pause, sauvegarde, chargement, export | `Échap` |

Les touches sont lues par position physique : ZQSD et WASD fonctionnent sans réglage. Seule la carte se lit à la
lettre tapée : c'est la touche marquée M, quel que soit le clavier.

## Contenu de la version 0.1 (tranche verticale)

- Mine explorable persistante générée à partir d'une graine, galeries de départ, cavernes à découvrir.
- Minage physique : chaque coup inflige des dégâts, fissures visibles, la roche lâche des minerais au sol.
- Ramassage physique, sac limité **en poids**, choix de ce que l'on ramasse, possibilité de jeter.
- Les **pierres laissées par terre s'effritent** au bout de 60 s (elles clignotent les 5 dernières secondes) pour ne
  pas encombrer les galeries ; les minerais, eux, restent au sol indéfiniment.
- Profondeur réelle (2,5 m par rangée), jusqu'à 607 m : roche tendre → roche dure (100 m) → basalte (300 m) →
  roche volcanique (450 m, la Fournaise).
- Ressources : pierre, charbon, cuivre, fer, argent, or, diamant (valeur, poids, rareté, résistance, profondeur).
- Comptoir de vente et atelier en surface ; 4 pioches, 3 moyens de transport (sac, grand sac, brouette).
- **Marteau-piqueur** (900 $, pioche en fer) : attaque la paroi sur 3 cases de large (la case visée et ses voisines,
  perpendiculairement au coup), très vite, en brûlant le charbon du sac (1 unité / 12 s de travail). `T` passe de la
  pioche au marteau ; sans charbon, on repasse automatiquement à la pioche.
- **Foreuse de percement** (1 200 $, pioche en fer) : une **base fixe** et une foreuse sur chenilles qui en sort
  pour percer toute seule un tunnel droit devant la flèche de la base (10, 25, 50 cases ou sans limite), jusqu'au
  basalte. La foreuse emporte 2 unités de charbon prises dans la base (1 unité / 20 s de perçage ; rouler est
  gratuit) et **revient à la base** quand elle n'a plus de charbon (elle refait le plein et repart au bout du
  tunnel), quand elle ne peut plus percer (roche indestructible ou trop dure, machine, bord de la mine), quand le
  tunnel est fini ou quand on la rappelle. Une base alimentée par un convoyeur ou un coffre de charbon collé la fait
  creuser sans s'arrêter. Les minerais tombent derrière elle, les filons percés laissent leur gisement, le tunnel
  apparaît sur la carte et son phare l'éclaire. Elle patiente si le joueur est sur son chemin ; on ne tourne, n'améliore
  ou ne démonte la base que foreuse rangée. **Améliorations** (touche E sur la base, chaque niveau garde les précédents ;
  démontée, elle garde son niveau) :
  - niveau 2, **moteur renforcé** (600 $) : perce 2 fois plus vite, roule plus vite, emporte 4 unités de charbon ;
  - niveau 3, **tête large** (1 100 $) : tunnel de 3 cases de large (les côtés indestructibles sont épargnés) ;
  - niveau 4, **benne à minerai** (1 800 $) : ramasse le minerai percé (30 morceaux, la pierre reste au sol) et le ramène
    à la base, qui le pousse dans un convoyeur ou un coffre collé (ou on le récupère depuis son panneau) ; le charbon
    ramené remplit la réserve de la base. Benne pleine, elle rentre la vider et repart.
- Première automatisation : **foreuse à charbon → convoyeurs → coffre**, avec minerais visibles sur les
  convoyeurs, capacité et débit réels (saturation possible), alimentation en charbon manuelle ou par convoyeur.
- Trois niveaux de **convoyeurs** : de base (2,25 objets/s), **rapide** (×2, pioche améliorée) et **express**
  (×4, pioche en fer). Poser un convoyeur sur un convoyeur d'un autre niveau le remplace sur place (direction et
  minerais conservés, ancien convoyeur rendu au stock) : on améliore une ligne entière en glissant dessus.
- **Séparateur** : le minerai entre par l'arrière et ressort à tour de rôle devant, à gauche et à droite (les
  sorties bloquées ou vides sont sautées). Pour fusionner deux lignes, il suffit de faire arriver un convoyeur
  sur le côté d'un autre.
- **Trieur** : le minerai entre par l'arrière ; le minerai choisi dans son panneau (`E`) part tout droit, tout le
  reste part sur les côtés (à tour de rôle). Tri strict : si la sortie avant est pleine, le minerai choisi attend.
- **Pont de convoyeur**, posé par paire dans la même direction (jusqu'à 5 cases d'écart) : le minerai passe
  au-dessus de ce qui se trouve entre les deux ponts, ce qui permet de croiser deux lignes. Pas à travers la roche.
- **Wagonnets et rails** : rails posés en glissant (virages automatiques), **quai de chargement** (alimenté par le
  sac du joueur, un convoyeur, une foreuse ou un coffre) et **quai de déchargement** (qui se vide dans ce qui est
  collé : convoyeur, coffre, caisse d'expédition). Le wagonnet fait l'aller-retour tout seul et transporte par lots
  de 100 kg ; il part quand il est plein ou quand il n'y a plus rien à charger. On peut monter dedans (`F`) pour
  voyager : il attend au terminus que le joueur descende.
- **Aiguillages** : posés sur un embranchement (ils remplacent le rail), ils envoient les wagonnets venus de la
  pointe dans la branche choisie avec `E` (tout droit, à gauche, à droite ou en alternance) ; au retour, les
  wagonnets repartent vers la pointe. Sans aiguillage, un embranchement fait aller tout droit.
- Un **coffre** se vide dans tout convoyeur collé qui ne pointe pas vers lui (tampon au milieu d'une chaîne,
  ou dépôt manuel qui repart sur les convoyeurs) ; une **foreuse** pousse sa production devant sa flèche en
  priorité, sinon dans n'importe quel convoyeur collé.
- Un **coffre de charbon collé à une foreuse** la recharge automatiquement (en priorité sur les convoyeurs).
  Une foreuse posée sur du charbon qui remplit un coffre devant elle s'alimente donc toute seule.
- **Foreuse améliorable** sur place (`E` sur la foreuse) : niveau 2 (280 $) = elle fore aussi les cases à gauche
  et à droite, niveau 3 (650 $, pioche en fer) = aussi la case derrière elle. La sortie reste devant la flèche.
  Chaque case couverte qui a un gisement produit à la cadence de base (jusqu'à ×4), pour le même charbon ; elle
  continue tant qu'une de ses cases a encore un gisement. Le panneau montre, niveau par niveau, les cases forées
  à cet endroit. Démontée, une foreuse améliorée revient dans le stock avec son niveau (« Foreuse à charbon
  niv. 3 » dans la barre de construction) et se repose ailleurs sans perdre son amélioration.
- **Four** (350 $, pioche améliorée) et **fonderie** (1 500 $, pioche en fer, 2×2 cases) : ils fondent le cuivre, le
  fer, l'argent et l'or en **lingots**, vendus 2,5 fois plus cher que le minerai (même poids). Le minerai entre par
  un convoyeur (ou une foreuse, ou la base d'une foreuse de percement collée) sur n'importe quel côté sauf la sortie,
  ou se dépose du sac depuis leur panneau (`E`) ; le charbon entre de partout (convoyeur, coffre collé, sac) et ne
  brûle que pendant la fonte. Les lingots sont poussés devant la flèche (convoyeur, coffre, caisse d'expédition) ou
  récupérés dans le sac. Four : un lingot toutes les 3 s (8 lingots par charbon) ; fonderie : toutes les 0,5 s
  (30 lingots par charbon). Objectif : fondre 10 lingots.
- **Dangers** en profondeur, avec une **barre de santé** (on récupère hors de danger ; à 0, on s'évanouit et on se
  réveille au camp, le sac reste là où on est tombé) :
  - **éboulements** (dès 60 m) : une salle creusée à la main trop grande (plus de 10 cases creusées autour de la
    dernière) fait craquer le plafond : 4 s d'alerte (zone qui clignote, poussière, grondement), puis des éboulis
    tombent et blessent. Un **étai** (15 $, on passe dessous) consolide 3 cases autour de lui, même pendant l'alerte.
    Les tunnels d'une case, les galeries naturelles et ceux de la foreuse de percement ne s'effondrent pas ;
  - **grisou** (dès 120 m) : des poches cachées dans la roche (petites taches jaunâtres sur la paroi) envahissent la
    galerie quand on les perce ; le gaz blesse, se dissipe lentement, et un **ventilateur** (180 $) le chasse en
    quelques secondes ;
  - **eau** (dès 70 m) : des poches (suintements bleus) inondent la galerie ; l'eau ralentit, profonde elle épuise ;
    une **pompe** (240 $, sans charbon : elle tourne toute seule) l'assèche.
  Le HUD affiche la santé et le danger du moment, la carte montre les galeries inondées ou envahies de grisou.
- Le mode construction (`B`) range les machines en stock par onglets (extraction, fonte, transport, rails,
  stockage, sécurité), chacune avec son icône et son stock. La fiche de la machine choisie rappelle ses règles de
  pose (sur un gisement, en surface…), et une ligne d'état dit en direct si la pose est possible là où vise la
  souris, et pourquoi sinon. La caméra remonte pour que la barre ne cache pas le joueur. Le mode s'ouvre même
  sans aucune machine en stock, pour démonter au clic droit.
- Vente automatique : **caisse d'expédition** à poser en surface. Tout ce qui y arrive est vendu au prix du
  comptoir à chaque passage du transporteur (toutes les 15 s) ; sa capacité est limitée (120 kg), pleine elle
  bloque les convoyeurs. Le HUD affiche le revenu automatique par minute.
- **La Fournaise** (sous 450 m) : roche volcanique aux fissures rougeoyantes, or plus abondant et, sous 500 m, des
  **filons de diamant** (la ressource la plus précieuse, taillée seulement par la Pioche pro en acier, qui ne se
  fond pas). La chaleur y ralentit les foreuses, la foreuse de percement et les fours, de 85 % de leur cadence à
  450 m jusqu'à 50 % au fond (la température s'affiche sous la profondeur, un thermomètre signale les machines
  ralenties). Un **ventilateur** à 4 cases les rafraîchit et leur rend leur cadence normale. Les anciennes
  sauvegardes se chargent et la mine se prolonge simplement par le bas.
- **Tableau d'affichage** : un panneau de bois au milieu du camp, entre le Comptoir et l'Atelier (`E` devant lui).
  Il affiche les **statistiques de production** : trois chiffres (ventes, minerai extrait, lingots fondus par
  minute, moyennés sur les 5 dernières minutes), un histogramme des gains des 10 dernières minutes (comptoir et
  caisses d'expédition), un tableau par ressource (extrait, fondu, vendu) et la liste des machines à surveiller
  (sans charbon, sortie bloquée, coffre plein, ralenties par la chaleur…). Les mesures sont sauvegardées ; les
  anciennes sauvegardes trouvent le tableau au camp, avec des mesures à zéro.
- **Mini-carte** en haut à droite (la mine autour du joueur) et **carte complète** avec `M` : galeries, roche,
  filons et gisements repérés, machines, rails, wagonnets, position du joueur et zones de profondeur (100 m,
  300 m, 450 m). Seul ce que le joueur a déjà vu y apparaît.
- **Repères** : `N` marque l'endroit où l'on se trouve, et un clic sur la carte complète pose un repère ailleurs.
  Quatre types (repère, filon, base, danger), chacun avec sa couleur et son symbole, jusqu'à 24 repères. Le nom est
  donné d'après ce qu'il y a à cet endroit (« Filon d'or », « Gisement de fer », « Fonderie », « Grisou »…), sinon
  « Repère 3 ». Les repères apparaissent sur la carte, la mini-carte et dans la mine (fanion et nom). Un repère
  « suivi » s'affiche sous la mini-carte avec sa distance, et une flèche au bord de l'écran montre sa direction.
- Sauvegarde automatique (chaque minute), manuelle, export/import de fichier.
- Sons synthétisés, éclairage de la mine, particules, objectifs guidant les premières minutes.

## Tests

```bash
npm test             # tests unitaires de la simulation (Vitest, sans navigateur)
npm run build && npm run e2e   # partie jouée dans Chromium avec clavier/souris, captures dans e2e/screenshots/
```

Le test de bout en bout rejoue la tranche verticale : lancer une partie, descendre, miner, ramasser,
remplir le sac, vendre, acheter la pioche améliorée et mesurer qu'elle mine plus vite, sauvegarder,
recharger, puis acheter et poser une foreuse, des convoyeurs et un coffre et vérifier que le minerai y arrive ;
enfin prolonger la ligne dans le puits jusqu'à une caisse d'expédition en surface et vérifier que l'argent
rentre pendant que le joueur reste au fond de la mine. Il construit ensuite chaque machine (convoyeurs rapides,
séparateur, pont, trieur, wagonnets, aiguillage), améliore une foreuse jusqu'au niveau 3 depuis son panneau,
creuse au marteau-piqueur, lance une foreuse de percement sur 10 cases (elle sort de sa base, perce le tunnel
puis y revient), l'améliore depuis son panneau, pose un four, le charge depuis son panneau et récupère les
lingots, fait craquer un plafond à 100 m et le retient avec un étai posé à temps, perce une poche de grisou,
ouvre la carte, pose des repères (touche N et clic sur la carte) et en suit un.

## Choix techniques

- **2D vue de dessus en 3/4** (murs avec face avant) : la lisibilité d'un plan est indispensable pour
  concevoir des chaînes de convoyeurs, et elle reste très bonne pour le minage. La 3D n'apporterait rien au
  gameplay pour un coût élevé.
- **TypeScript + Vite + Canvas 2D**, moteur maison léger : aucune dépendance d'exécution, textures et sons
  générés par le code, rendu du terrain mis en cache par blocs.
- **Simulation séparée du rendu** : tout le jeu (monde, minage, économie, machines) tourne à pas fixe sans
  navigateur, ce qui permet de le tester et de le faire grandir sereinement.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/ROADMAP.md](docs/ROADMAP.md).
