# Équilibrage des chantiers

Rapport généré par `npm run balance` (ne pas modifier à la main). Les garde-fous qui le suivent sont dans `tests/balance.test.ts`. Les chiffres viennent des données du jeu (`src/data/project.ts`, `recipes.ts`, `resources.ts`) et de vraies simulations (`src/sim/Balance.ts`).

### Acte I — Grand Chevalement

| Phase | Matériaux | Valeur marchande | Salaires | Commandes | Clients fidèles | Machine (1 Manufacture) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1. Fondations | 80 charbon, 100 cuivre, 30 lingot de cuivre | 1 560 $ | 500 $ | 0 | 0 | 0 min |
| 2. Charpente | 60 lingot de fer, 60 lingot de cuivre | 3 480 $ | 2 500 $ | 2 | 0 | 0 min |
| 3. Treuil et poulies | 120 lingot de fer, 40 lingot d'argent | 8 600 $ | 8 000 $ | 5 | 0 | 0 min |
| 4. Poulies dorées | 40 plaque d'or, 80 lingot d'argent, 50 acier | 30 500 $ | 25 000 $ | 9 | 0 | 5 min |
| 5. Couronnement | 100 plaque d'or, 100 lingot d'argent, 12 diamant taillé | 51 740 $ | 75 000 $ | 14 | 0 | 4 min |

### Acte II — Grand Ascenseur

| Phase | Matériaux | Valeur marchande | Salaires | Commandes | Clients fidèles | Machine (1 Manufacture) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1. Cage d’acier | 80 acier, 60 plaque de fer | 17 200 $ | 30 000 $ | 18 | 1 | 7 min |
| 2. Contrepoids | 100 plaque de fer, 60 plaque d'argent, 60 acier | 24 600 $ | 50 000 $ | 24 | 2 | 9 min |
| 3. Machinerie | 120 acier, 60 plaque d'or, 80 plaque de cuivre | 44 160 $ | 80 000 $ | 32 | 2 | 13 min |
| 4. Salle dorée | 150 plaque d'or, 100 plaque d'argent, 2 diamant taillé | 69 040 $ | 120 000 $ | 40 | 3 | 9 min |
| 5. Inauguration | 250 plaque d'or, 150 acier, 4 diamant taillé | 117 580 $ | 200 000 $ | 52 | 4 | 19 min |

## Minerais : besoins des deux actes et contenu des mines

Sur 80 mines. « Total » = filons + réserves des gisements (ces dernières demandent des foreuses). Le garde-fou exige que la mine la plus pauvre des 60 premières contienne au moins 1,25 fois le besoin (le diamant est le point sensible : certaines mines n'en cachent qu'une vingtaine).

| Minerai | Besoin (A I + A II) | Total, mine pauvre (5 %) | Total, médiane | Filons seuls, médiane | Marge, mine pauvre |
| --- | ---: | ---: | ---: | ---: | ---: |
| Charbon | 80 | 5197 | 10825 | 1298 | 65.0× |
| Cuivre | 270 | 3785 | 9245 | 874 | 14.0× |
| Fer | 1260 | 6581 | 11825 | 850 | 5.2× |
| Argent | 380 | 2357 | 5485 | 251 | 6.2× |
| Or | 600 | 4371 | 7259 | 279 | 7.3× |
| Diamant | 18 | 114 | 693 | 22 | 6.3× |

Besoins de l'acte II seul : 980 fer, 160 argent, 460 or, 80 cuivre, 6 diamant.

## Le rythme des commandes (acte II)

Temps de jeu minimal pour atteindre, à chaque phase, les commandes honorées et les clients fidèles demandés : un joueur qui accepte toutes les propositions (celles de ses clients de confiance d'abord) et met le délai indiqué à livrer chacune. Médiane de 3 mines.

| Livraison | Cage d’acier | Contrepoids | Machinerie | Salle dorée | Inauguration |
| --- | ---: | ---: | ---: | ---: | ---: |
| livrée tout de suite | 21 min | 42 min | 42 min | 56 min | 1 h 07 |
| 5 min pour la livrer | 47 min | 1 h 12 | 1 h 23 | 1 h 44 | 2 h 14 |
| 10 min pour la livrer | 1 h 41 | 2 h 12 | 2 h 52 | 3 h 32 | 4 h 43 |

## Le temps pour payer (acte II)

Matériaux à leur valeur marchande plus salaires, au revenu indiqué (argent par minute que la production et les ventes rapportent). Total : 752 580 $.

| Revenu | Cage d’acier | Contrepoids | Machinerie | Salle dorée | Inauguration | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 000 $ / min | 47 min | 1 h 15 | 2 h 04 | 3 h 09 | 5 h 18 | 12 h 33 |
| 3 000 $ / min | 16 min | 25 min | 41 min | 1 h 03 | 1 h 46 | 4 h 11 |
| 10 000 $ / min | 5 min | 7 min | 12 min | 19 min | 32 min | 1 h 15 |
