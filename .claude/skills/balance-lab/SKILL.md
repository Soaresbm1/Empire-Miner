---
name: balance-lab
description: Banc de simulation et d'équilibrage d'Empire Miner (tests/balance, npm run balance) : invariants sur des parties de plusieurs heures (déterminisme, sauvegarde, conservation des objets), vitesse de la simulation, économie des lignes de production, réserves des cartes. À utiliser pour mesurer l'effet d'un changement de chiffres, chercher une stratégie trop rentable ou une économie bloquée, vérifier les performances, ou ajouter un scénario au banc.
---

# Banc de simulation

`npm run balance` (≈ 3 min) lance `bench.sim.ts` (≈ 40 s) puis `progression.sim.ts` (≈ 2 min) avec sa propre configuration (`tests/balance/vitest.config.ts`) :
`npm test` ne le lance pas. Le rapport est écrit dans `tests/balance/out/rapport.md` et `rapport.json` (ignorés par git) et
affiché à la fin. Un rapport se **cite** (chiffres, graine, durée simulée), il ne se commite pas.

## Fichiers

- `harness.ts` : `Bench` fait tourner une `GameState` au pas du jeu et tient un **registre** de chaque objet (extrait, fondu,
  fabriqué, ajouté par le banc, vendu, transformé, livré, effrité, présent), en enveloppant les méthodes de **cette instance**
  seulement (le jeu n'est pas modifié). Aussi : `digest`, `reload` (sauvegarde → chargement), `saveOf`, `stepsPerSecond`.
- `scenarios.ts` : usines construites avec les vraies règles de pose. `referenceLine` (gisement de la galerie est → foreuse →
  convoyeurs → puits → caisse d'expédition en surface, variante avec four), `crowdedFactory` (jusqu'à 1 500 structures), `refuel`
  (le joueur remplit toute machine à moitié vide ; le charbon ajouté est noté), `measureLine`.
- `player.ts`, `profiles.ts` : le joueur macro et ses quatre profils (voir plus bas).
- `report.ts` : `record(section, ligne)` et l’écriture du rapport.

## Ce qui fait échouer le banc (défaut à corriger, jamais à contourner)

- **Déterminisme** : même graine, mêmes gestes → même empreinte à chaque minute (30 min).
- **Sauvegarde fidèle** : `saveOf(reload(g))` égale `saveOf(g)`, toutes les 10 min pendant 1 h.
- **Resynchronisation** : deux rechargements de la même sauvegarde avancent ensemble (15 min).
- **Conservation** : produit − consommé = présent, pour chaque ressource sauf le charbon (son réservoir se mélange au contenu des
  machines : sa consommation est déduite, `fuelBurned`). 2 h de ligne avec four, 1 h d'usine chargée.
- **Argent** fini et jamais négatif pendant 4 h ; il égale la somme des ventes.
- **Vitesse** : plus de 240 pas par seconde (vitesse ×4) avec 1 500 structures.

## Ce qui est mesuré (rapporté, pas jugé par le banc)

- Économie de chaque ligne (minerai × brut / four) : extraction, ventes au cours du marché et **au prix de base** (sans le hasard
  du marché), charbon brûlé et sa valeur, gain net par minute, investissement, temps de remboursement, durée de vie d'un gisement
  moyen (`ResourceDef.deposit`), gain net par gisement.
- Réserves des cartes (5 graines) : cases de gisement et réserve pour foreuses, blocs de filon à la pioche, valeur, par zone.
- Écart après rechargement (information : des curseurs de répartition ne sont pas sauvegardés, l'empreinte diverge sans que le
  gain change).

## Le joueur macro (`player.ts`, `profiles.ts`, `progression.sim.ts`)

Quatre profils jouent 3 h de jeu sur la même carte (`BALANCE_SEEDS=11,12,13`, `BALANCE_MINUTES=180`, `BALANCE_PROFILE=<id>` pour
en isoler un ; une graine ≈ 2 min de calcul, trois ≈ 9 min). Ils ne diffèrent que par leurs **achats** : `prudent` (réserve,
équipement d'abord), `agressif` (tout dépensé tout de suite), `automatisation` (pioche améliorée puis uniquement des lignes),
`equilibre` (alterne). Le rapport donne, par profil et par graine : minutes de jeu pour atteindre 14 étapes (première vente, pioche
améliorée / en fer / pro, grand sac, première foreuse, première vente automatique, premier lingot, 100 / 300 / 450 m, 1 k / 10 k /
100 k $), argent, part du revenu automatique, état des foreuses (en marche, sans charbon, épuisées, sortie bloquée), goulot des
lignes (caisses, convoyeurs bloqués).

**Réel** : chaque coup de pioche (`GameState.update` avec une intention de minage), le ramassage et le poids du sac, la vente au
comptoir au cours du marché, les achats à l'Atelier, la pose par `GameState.place` (portée, kits, emplacement), le charbon.
**Simplifié, donc biaisé (à dire dans tout rapport)** :
- les déplacements sont instantanés mais leur durée (plus court chemin ÷ vitesse) est jouée ;
- il connaît toute la carte, choisit toujours le filon le plus rentable par seconde, et ne cherche jamais ;
- il ignore les dangers dans ses choix (d'où 27 à 70 évanouissements en 3 h) et ne se soigne pas ;
- il ne pose que des lignes foreuse → convoyeurs → **une seule** caisse d'expédition (four en option) ; ni commandes, ni chantier,
  ni ouvriers, ni amélioration de machines, ni second convoyeur ou seconde caisse ;
- il ravitaille en charbon à la main, en tournée.
Les temps mesurés sont donc des **planchers** : un humain est plus lent. Ce qui compte, c'est l'écart entre profils et entre
versions du jeu, pas la valeur absolue.

## Constats déjà faits (14/10/2026, à revérifier avant de les citer)

- **Écart de sauvegarde (corrigeable, non corrigé)** : au chargement, l'âge d'un tas de minerai au sol de moins de 1 s est ramené à
  1 s (`save.ts`, `deserialize` : `Math.max(1, âge)`). Effet : un dixième de seconde sur le délai de ramassage ou d'effritement.
  Le banc le tolère explicitement (`withDropAgesFloored`).
- **Gisements de foreuse éphémères** : une ligne de référence épuise un gisement moyen en 12 à 16 min (24 unités/min pour 300 de
  réserve). En fin de partie, presque toutes les foreuses des profils sont « épuisées ».
- **Un seul convoyeur partagé sature** : avec 40 lignes sur une caisse et un tronc commun, 36 à 39 foreuses sur 40 ont leur
  sortie bloquée et 60 % des convoyeurs sont bloqués ; le profil `automatisation` finit en dessous de `equilibre` (28 000 $
  contre 60 000 $ sur la graine 11). La limite exacte (convoyeur ou caisse) n'est pas isolée, et le joueur macro ne sait pas y
  remédier : ne pas en conclure que l'automatisation ne rapporte pas.
- **Rythme** : pioche pro entre 10 et 61 min, Fournaise (450 m) entre 26 et 74 min, 100 000 $ jamais atteints en 3 h.

## Autres limites du banc

- Gisement des lignes de `referenceLine` posé à la main ; foreuse au niveau 1 ; pas de Manufacture, fonderie, ouvriers ni wagonnets.
- Charbon valorisé au prix de base ; 3 graines au plus (la dispersion entre graines est visible dans les tableaux).

## Ajouter un scénario ou une mesure

1. Construire avec `build(g, id, x, y, dir, from)` (vraies règles, échoue en disant pourquoi) ; noter tout objet ajouté par
   `bench.inject(res, n)`, sinon la conservation échoue à juste titre.
2. Faire tourner avec `bench.run(secondes, { every, tick, sampleEvery })` ; toujours finir par `expect(bench.conservation()).toEqual({})`.
3. `record('section', { … })` avec des noms de colonnes en français ; une ligne par cas.
4. Garder le banc court : une heure de jeu prend 0,3 s (partie neuve) à 50 s (1 500 structures) ; une partie de joueur macro de 3 h prend 30 à 60 s.

## Lire un rapport d'équilibrage

Comparer **avant / après** un changement de chiffres (même graine, même durée), au prix de base. Signaux à remonter :
remboursement en quelques secondes, gain net négatif, foreuse rarement occupée (goulot en aval), gisement épuisé avant d'être
remboursé, valeur totale d'une zone très supérieure à celle des autres. Ce sont des **observations** à soumettre à la personne,
pas des corrections à faire d'office.
