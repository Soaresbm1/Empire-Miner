# Feuille de route

## ✅ v0.1 — Tranche verticale
Minage manuel physique, ressources au sol, sac limité en poids, vente, pioches et sacs,
profondeur et roches plus dures, sauvegarde/chargement, première automatisation
(foreuse à charbon → convoyeurs → coffre).

## v0.2 — Boucle d'automatisation complète (en cours)
- ✅ Caisse d'expédition en surface : les convoyeurs qui y arrivent vendent automatiquement.
- ✅ Convoyeurs rapides et express (niveaux 2 et 3), amélioration d'une ligne sur place.
- ✅ Séparateurs (3 sorties à tour de rôle) et ponts de convoyeur (croisements) ; les fusions se font par
  arrivée latérale sur un convoyeur.
- ✅ Trieur (un minerai tout droit, le reste sur les côtés), réglable avec `E`.
- ✅ Foreuse améliorable (niveaux 2 et 3 : cases gauche/droite, puis derrière).
- Chargeur/déchargeur : transfert coffre → convoyeur.
- Indicateurs de débit (objets/min) sur les machines et convoyeurs.
- ✅ Carte de la mine : mini-carte dans le HUD et carte complète (touche M).
- ✅ Repères posés par le joueur (touche N, clic sur la carte), suivis avec une flèche.

## v0.3 — Transport et profondeur
- ✅ Wagonnets et rails : quais de chargement / déchargement, navette automatique, voyage à bord.
- ✅ Aiguillages (branche fixe ou alternance).
- Plusieurs wagonnets par ligne avec signaux ; ascenseur de puits.
- Éclairage posable (lampes), obscurité plus contraignante en profondeur.
- ✅ Marteau-piqueur (front de 3 cases, au charbon) et foreuse de percement (base fixe, la foreuse sort percer
  le tunnel et revient faire le plein ; améliorations : moteur, tête large, benne à minerai).
- Électricité : générateurs, câbles, machines électriques plus puissantes.

## v0.4 — Traitement
- ✅ Trieur (filtre par ressource).
- ✅ Four et fonderie : minerai → lingots (2,5 fois plus chers), au charbon.
- ✅ Commandes des clients (Tableau d'affichage) : quantités précises, primes sur le prix de base, échéances, rang, livraison à la main
  ou par caisse d'expédition réglée sur « Commandes ».
- ✅ Grand Chevalement : le grand chantier du camp en cinq phases (matériaux, argent, commandes honorées), la tour grandit,
  écran de fin avec les chiffres de la partie.
- ✅ Manufacture : plaques (cuivre, fer, argent, or), acier et diamant taillé, à recette choisie ; ils suivent le cours de leur
  métal, les clients en demandent et les deux dernières phases du Grand Chevalement en réclament.
- ✅ Clients récurrents : réputation par client (cinq niveaux : plus de retours, de prime et de temps), commandes exclusives du client le plus
  fidèle à chaque nouveau rang, pénalités douces (un point par retard ou abandon, jamais sous zéro).
- ✅ Rendement des lignes : débit réel de chaque machine et convoyeur (infobulle, panneau), vue « goulots » (touche G), prévisions
  « au rythme actuel » au Grand Chevalement et sur les commandes.
- ✅ Dépanneur (ouvrier) : examine les machines à l'arrêt, recharge ou vide ce qui peut l'être, signale le reste au camp (Machines à surveiller, infobulle de la vue goulots) ; il remplace le Foreur (qui posait des foreuses).
- ✅ Alerte « machine à l'arrêt » : pastille du HUD, message et anneau sur la carte ; un appui centre la carte sur la machine.
- Concasseur (pierre → gravier), alliages (ex. bronze), composants : ✅ fil de cuivre, engrenage et mécanisme (recettes à plusieurs étages) ; restent les fils d'autres métaux et les alliages liés au concasseur.

## v0.5 — Énergie et contraintes
- Générateurs (charbon), réseau électrique, consommation des machines.
- ✅ Dangers : éboulements (étais), grisou (ventilateurs), eau (pompes), santé du joueur.
- Chaleur en profondeur, coups de grisou qui explosent près d'une flamme, détecteur de poches.

## Après le Grand Chevalement (idées)
- ✅ Un second chantier plus lointain, l'Ascenseur de puits (quatre phases après le couronnement, mécanismes et commandes comme monnaie de progression) ; le **puits** (source renouvelable de minerai, débloquée à la phase 7, charbon et mécanismes) est fait ; plus loin, une ville au camp.
- Clients aux goûts propres (un client qui ne demande que certaines marchandises), commandes « cadeau » quand on est Partenaire, contrats qui se renouvellent.
- Ouvriers « livreurs » qui portent leurs lingots du coffre au chantier ; objectifs quotidiens de commandes.

## Idées pour la suite du rendement
- Copier-coller une ligne de machines et de convoyeurs, avec un « annuler » pour la dernière pose.
- Un débit par ligne entière (de la foreuse à la caisse), nommé et gardé dans la sauvegarde ; une alerte quand une ligne entière s'arrête (l'alerte actuelle est par machine).
- Déduire de la prévision le charbon que brûlent les machines, et partager la production entre plusieurs besoins sur la même ressource.

## Plus tard
- Ressources rares et fictives au-delà de 450 m, mine agrandie ou étages multiples.
- Employés/automates de maintenance, statistiques de production, optimisation pour des milliers d'objets
  (rendu WebGL si nécessaire, simulation par lots).
