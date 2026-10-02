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
| Régler plusieurs coffres (sélection au clic ou au rectangle) | `C` |
| Sac et carnet | `I` ou `Tab` (hors construction) |
| Mode construction | `B` — machines rangées par onglets : `Tab` (ou clic) change d'onglet, `1-9` (ou clic) choisit la machine ; clic gauche : poser (glisser pour tracer convoyeurs et rails), clic droit : démonter, `R` : tourner. Une ligne d'état dit si la pose est possible, et pourquoi sinon |
| Pioche ↔ marteau-piqueur | `T` (une fois le marteau-piqueur acheté) |
| Monter sur la trottinette | `Maj` **maintenue** (une fois la trottinette achetée) : on monte en appuyant, on descend en relâchant |
| Corde de rappel (remonter à la surface, ou redescendre) | `V` (une fois la corde achetée) : rester immobile 3 s |
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
- Comptoir de vente et atelier en surface ; 4 pioches, 3 moyens de transport (sac, grand sac, brouette) et 4 pièces
  d'équipement de protection.
- **L'Atelier** (`E` devant le bâtiment) est organisé pour acheter vite et sans se perdre :
  - quatre onglets (Outils, Transport, Équipement, Machines), qu'on change avec `1` à `4`, les flèches `←` `→` ou la
    souris. Les onglets restent **collés en haut** quand on fait défiler, et l'Atelier **se rouvre sur le dernier
    onglet** consulté ;
  - une bande **Conseil** propose le prochain achat utile (la pioche suivante, puis l'équipement du danger dont on
    approche, puis le sac, le marteau-piqueur et la trottinette), avec son bouton d'achat, ou la barre qui montre où en
    est l'argent quand il en manque ;
  - une **pastille** sur chaque onglet compte ce qu'on peut acheter tout de suite ;
  - Outils et Transport montrent une **bande de paliers** (icône, nom, prix : acquis, en main, suivant) puis la
    comparaison « actuel → suivant » ; le marteau-piqueur et la trottinette ont leur fiche juste dessous ;
  - toutes les fiches ont la même forme (icône, étiquette « en main », « acquis », « porté » ou « conseillé »,
    chiffres « avant → après ») et un bouton grisé affiche une barre de progression et ce qu'il manque ;
  - l'onglet Machines se **filtre par catégorie** et par « Achetables » ; chaque ligne est compacte (trois
    caractéristiques, un bouton « Détails » pour tout voir) et les machines verrouillées tiennent sur une seule ligne.
    Les filtres restent collés sous les onglets.
- **Marteau-piqueur** (900 $, pioche en fer) : attaque la paroi sur 3 cases de large (la case visée et ses voisines,
  perpendiculairement au coup), très vite, en brûlant le charbon du sac (1 unité / 12 s de travail). `T` passe de la
  pioche au marteau ; sans charbon, on repasse automatiquement à la pioche.
- **Trottinette à moteur** (500 $, onglet Transport de l'Atelier) : un moyen de déplacement personnel. On monte dessus
  en **maintenant `Maj`** et on en descend en **relâchant** la touche, sans rien à activer. En roulant, la vitesse de
  marche est multipliée par 1,7 (elle se cumule avec celle du sac, par exemple la brouette), au camp comme dans les
  galeries ; en contrepartie les deux mains sont au guidon, donc **pas de minage en roulant** (un coup de pioche en
  cours est interrompu). Le mineur se tient debout sur le plateau, avec ses roues qui tournent, un peu de poussière
  et un panache du moteur ; le HUD le rappelle (`Maj Trottinette`, allumé tant qu'on roule). L'achat est sauvegardé,
  pas l'état « en train de rouler ». Dans un wagonnet, la trottinette est rangée.
- **Corde de rappel** (90 $ pièce, ou 400 $ le lot de 5, onglet Transport de l'Atelier ; 9 au plus) : le **retour rapide
  au camp**. Dans la mine, `V` : le mineur se suspend à la corde et doit rester **immobile 3 secondes** (une jauge sous ses
  pieds et le HUD comptent le temps) : on le **voit monter avec la corde**, de plus en plus vite, jusqu'à sortir de l'écran
  (son ombre reste au sol), puis il ressort **à la surface, à la verticale de l'endroit où il était** (pas au milieu du
  camp ; à la case libre la plus proche si un arbre ou un bâtiment prend la place), **avec tout son sac**, contrairement
  à un évanouissement. À la descente, il s'enfonce dans un trou ouvert à ses pieds, puis se pose au point d'accroche.
  La corde reste **accrochée là où il était**, un repère « Corde de rappel » la marque sur la carte, et depuis la surface un
  nouvel appui sur `V` le **redescend gratuitement** au même endroit (ou à la case libre la plus proche si le passage s'est
  refermé ; si tout est bouché, la corde reste accrochée). Bouger, miner, monter dans un wagonnet ou encaisser un gros
  choc (éboulement…) annule la manœuvre sans consommer la corde ; le gaz, l'eau et la chaleur, qui font mal en continu,
  ne l'interrompent pas (ils ne soignent pas pour autant : mieux vaut s'encorder avant). Une corde est conseillée par
  l'Atelier dès 80 m de profondeur. L'achat, le stock et le point d'accroche sont sauvegardés, pas la manœuvre en cours.
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
- **Trieur** : le minerai entre par l'arrière ; les minerais choisis dans son panneau (`E`) partent tout droit, tout
  le reste part sur les côtés (à tour de rôle). On en choisit **autant qu'on veut** : un clic ajoute un minerai, un
  second clic le retire, « Aucun » vide la liste (minerais et lingots se choisissent séparément). Dans la mine, le
  trieur affiche les minerais choisis (une icône, ou de petites pastilles de couleur). Tri strict : si la sortie
  avant est pleine, les minerais choisis attendent, et tout le trieur avec eux. Les anciennes sauvegardes à filtre
  unique se chargent telles quelles.
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
- On **choisit ce qu'un coffre accepte** (panneau du coffre, `E` : « Tout », ou un ou plusieurs minerais d'un clic ;
  les minerais choisis s'affichent sur une petite étiquette au coin du couvercle et dans l'infobulle). Convoyeurs,
  dépôt du sac et ouvriers ne lui apportent alors que ces minerais (un convoyeur chargé d'un minerai refusé attend,
  comme devant un coffre plein ; « Tout déposer » garde dans le sac ce que le coffre refuse). Ce qui est déjà dedans y
  reste et peut toujours en sortir. Un coffre pour le cuivre, un pour le charbon, un pour tout le reste : les ouvriers
  rangent chaque chose au bon endroit. Le réglage est sauvegardé ; un ancien coffre accepte tout.
- **Régler plusieurs coffres d'un coup** (touche `C`, ou « Sélectionner plusieurs coffres » dans le panneau d'un coffre,
  qui reprend alors son réglage comme modèle) : une barre propose d'abord le réglage à appliquer (mêmes puces « Tout »,
  « Cuivre »…), puis on désigne les coffres, **où qu'ils soient à l'écran** : un **clic** en choisit un (second clic :
  le retire), un **glissé** de souris trace un rectangle qui choisit tous les coffres de la zone (si tous y étaient déjà,
  il les retire), « Tous les coffres » et « Aucun » aident quand le camp est grand, le **clic droit** vide la sélection.
  Les coffres choisis sont cerclés de bleu et cochés ; « Appliquer à N coffres » (ou `Entrée`) leur donne le réglage et
  la sélection reste, pour recommencer avec un autre réglage. `Échap`, `C` ou l'ouverture d'un panneau quitte le mode ;
  rien n'est miné ni posé pendant ce temps.
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
- **Équipement de protection** (onglet « Équipement » de l'Atelier) : une pièce par emplacement, chacune contre un
  danger précis, portée dès l'achat, conservée si l'on s'évanouit et sauvegardée. Elle absorbe une part des dégâts :
  - **casque renforcé** (120 $) : −65 % de dégâts d'éboulement (il ne remplace pas l'étai) ;
  - **masque à gaz** (200 $) : −85 % de dégâts de grisou ;
  - **cuissardes étanches** (150 $) : on marche dans l'eau peu profonde à vitesse normale, à 75 % (au lieu de 45 %)
    dans l'eau profonde, et l'eau profonde épuise 60 % de moins ;
  - **combinaison ignifugée** (650 $) : −85 % de dégâts de chaleur dans la Fournaise.
  Chaque fiche montre les chiffres « sans → avec ». Les pièces se voient sur le mineur (casque d'acier, masque et
  filtres, jambes jaunes, veste orange et salopette argentée) et s'allument sous la barre de santé, où les pièces
  manquantes restent grisées (survol : prix et effet). Le HUD adapte ses alertes à ce que l'on porte.
- Le mode construction (`B`) range les machines en stock par onglets (extraction, fonte, transport, rails,
  stockage, sécurité), chacune avec son icône et son stock. La fiche de la machine choisie rappelle ses règles de
  pose (sur un gisement, en surface…), et une ligne d'état dit en direct si la pose est possible là où vise la
  souris, et pourquoi sinon. La caméra remonte pour que la barre ne cache pas le joueur. Le mode s'ouvre même
  sans aucune machine en stock, pour démonter au clic droit.
- Vente automatique : **caisse d'expédition** à poser en surface. Tout ce qui y arrive est vendu au cours du
  moment, comme au comptoir, à chaque passage du transporteur (toutes les 15 s) ; sa capacité est limitée (120 kg), pleine elle
  bloque les convoyeurs. Le HUD affiche le revenu automatique par minute.
- **La Fournaise** (sous 450 m) : roche volcanique aux fissures rougeoyantes, or plus abondant et, sous 500 m, des
  **filons de diamant** (la ressource la plus précieuse, taillée seulement par la Pioche pro en acier, qui ne se
  fond pas). La chaleur y ralentit les foreuses, la foreuse de percement et les fours, de 85 % de leur cadence à
  450 m jusqu'à 50 % au fond (la température s'affiche sous la profondeur, un thermomètre signale les machines
  ralenties). Un **ventilateur** à 4 cases les rafraîchit et leur rend leur cadence normale. La chaleur
  **épuise aussi le mineur** loin d'un ventilateur : de 0,8 point de vie par seconde à 450 m jusqu'à 3 au fond (la
  santé ne remonte plus tant qu'il a chaud). Un ventilateur à 4 cases l'en protège (on y reprend son souffle) et la
  combinaison ignifugée en absorbe l'essentiel. Les anciennes sauvegardes se chargent et la mine se prolonge
  simplement par le bas.
- **Ouvriers** : des travailleurs qu'on **achète une seule fois** à l'Atelier (onglet Ouvriers, touche `5` ;
  300 $, 600 $, 1 000 $, 1 500 $, 2 200 $ puis 3 000 $, six au plus, avec la Pioche améliorée), sans salaire. Chacun
  a un **métier**, qu'on change gratuitement à tout moment. Le **ramasseur** va chercher les minerais laissés par
  terre (restes de la foreuse de percement, éboulements, tas oubliés, jusqu'au fond de la mine par le puits) et les
  range dans le coffre le plus proche **qui accepte ce minerai** (chaque coffre se règle : il ne prend jamais un tas
  qu'aucun coffre n'accepte, et ne range jamais dans une caisse d'expédition) ; il porte 15 kg et laisse la pierre. Le **ravitailleur** prend du charbon dans les coffres et recharge les foreuses, les fours et les foreuses
  de percement dont le réservoir est à moitié vide ou moins (une machine collée à un coffre se sert déjà seule). Ils
  marchent de case en case par le plus court chemin (90 cases au plus), en évitant la roche, les machines, le
  grisou et l'eau profonde, ne visent jamais le même tas ou la même machine, contournent un passage qui se ferme et
  attendent près de l'entrée de la mine quand il n'y a rien à faire. Le panneau montre ce que fait chacun (« Rapporte
  sa charge au coffre »…) et sa charge ; congédier demande confirmation (sans remboursement, la charge reste par
  terre). Un ouvrier bloqué (« aucun coffre n'accepte ce minerai », « plus de charbon dans les coffres ») est signalé au
  Tableau d'affichage et par un point d'exclamation au-dessus de lui ; ils apparaissent aussi sur la carte (points
  vert et orange). Casque vert pour le ramasseur, orange pour le ravitailleur. Les ouvriers sont sauvegardés
  (métier, position, charge) ; les anciennes sauvegardes n'en ont pas.
- **Cours du marché** : les prix de vente montent et descendent. Chaque minerai a un **cours**, multiplicateur de
  son prix de base (100 % = le prix de la fiche), qui dérive doucement toutes les 10 s autour de 100 % (en général
  de 80 à 120 %) ; un lingot suit le cours de son minerai, la pierre ne bouge pas. Toutes les 2,5 à 5 minutes, un
  **événement** frappe un minerai que le joueur connaît : « forte demande de cuivre » (+28 % à +65 %) ou
  « surproduction de charbon » (−20 % à −34 %), pendant deux à trois minutes. Une annonce et un petit son le
  signalent, et le HUD l'affiche sous l'argent (« ▲ Cuivre +52 % »). Le Comptoir et les caisses d'expédition paient
  au cours du moment (le prix d'un lot est arrondi une seule fois) : on peut **stocker dans un coffre quand le cours
  est bas et vendre quand il remonte**. Hausses et baisses se compensent, donc vendre tout de suite rapporte le prix
  moyen. Les 90 premières secondes sont calmes (tout à 100 %), et les cours, les courbes et les événements en cours
  sont sauvegardés ; les anciennes sauvegardes repartent d'un marché à 100 %.
- **Tableau d'affichage** : un panneau de bois au milieu du camp, entre le Comptoir et l'Atelier (`E` devant lui),
  avec deux onglets (`1` et `2`, ou les flèches ; il rouvre le dernier onglet vu). **Marché** : les événements en
  cours avec le temps qui reste, un conseil (« bon moment pour vendre : cuivre à +44 % », ou « l'or est bradé :
  gardez-le dans un coffre »), et pour chaque minerai connu sa **courbe des 10 dernières minutes** (pointillés : le
  prix de base), son prix du moment et sa tendance (▲ ▼ sur 30 s, couleur selon l'écart au prix de base). Le prix
  du lingot s'ajoute dès qu'on en a fondu un. **Production** : les **statistiques de production** : trois chiffres
  (ventes, minerai extrait, lingots fondus par minute, moyennés sur les 5 dernières minutes), un histogramme des
  gains des 10 dernières minutes (comptoir et caisses d'expédition), un tableau par ressource (extrait, fondu,
  vendu) et la liste des machines à surveiller (sans charbon, sortie bloquée, coffre plein, ralenties par la
  chaleur…). Les mesures sont sauvegardées ; les anciennes sauvegardes trouvent le tableau au camp, avec des mesures
  à zéro. Le Comptoir et le sac montrent eux aussi le prix du jour, avec sa tendance.
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
- **Graphismes en pixel art**, tous dessinés en code (aucune image externe). La lumière vient toujours d'en haut à
  gauche : le mineur (casque à lampe, sac à dos, marche à 4 images, clignement des yeux), les machines ombrées et
  animées (voyants, gyrophare, flammes, engrenages, vapeur), les bâtiments du camp (étal aux bocaux, atelier à toit
  d'ardoise et forge), les minerais rares qui étincellent. L'interface est habillée du même style : cadres de métal et
  de laiton à rivets, boutons biseautés qui s'enfoncent, barres graduées, touches en relief, icônes dessinées (pièce,
  cœur, sac, pioche, minerais). L'écran titre a un logo dessiné en pixels, et des poussières et des braises flottent
  derrière les menus.
- **Qualité graphique** : Pause → « Graphismes » fait tourner Élevée, Moyenne et Basse (nombre de particules, lueurs,
  animations de détail, décor animé des menus). Le réglage est mémorisé ; « Basse » convient aux petits appareils.

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
