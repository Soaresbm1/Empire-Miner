---
name: regression-testing
description: Choisir et lancer les bons tests d'Empire Miner après une modification (Vitest, e2e Chromium), sous Windows comme sur le CI, et rendre compte des résultats. À utiliser avant d'annoncer qu'une modification est terminée, pour une vérification de non-régression, ou quand un test échoue.
---

# Tests de non-régression

Principe : lancer **ce qui couvre les fichiers modifiés**, puis la suite complète avant une fusion. Ne citer que des tests
réellement lancés, avec leur sortie. Un échec n'est jamais « sans rapport » sans preuve (le relancer sur `main` le prouve).

## 1. Toujours

```bash
npm run typecheck                                        # ≈ 3 s
npx vitest related <fichiers modifiés…> --run --testTimeout=120000
```

`vitest related` suit les imports : il trouve les tests qui chargent le code modifié. Le hook de fin de tâche fait la même
chose automatiquement ; les tests de session n'y figurent que si `src/net` ou `src/save` ont changé.

## 2. Selon ce qui a changé (en plus)

| Modifié | Tests à lancer en plus | e2e (après `npm run build`) |
|---|---|---|
| `src/sim/**`, `src/data/**`, `actions.ts` | `multiplayer-sim`, le `coop-*` du domaine, `gameplay`, `save` | `playthrough` si la boucle de jeu change |
| `src/save/**` | `save`, `multiplayer-sim`, `cloud-sync`, `session` | — |
| `src/net/**` | `lockstep`, `session`, `session-lifecycle`, `mqtt-transport`, `multiplayer-sim`, `update` | `coop` |
| `src/cloud/**`, `ui/account.ts` | `cloud-client`, `cloud-reconcile`, `cloud-sync`, `cloud-misc` | `cloud` |
| `src/ui/**`, `*.css` | le `*-ui.test.ts` du panneau, `phone-ui`, `touch` | `phone` (11 tailles), `panels`, `menus` si menus |
| `src/render/**` | `sprites`, `quality`, `minimap`, `map-zoom`, `rope-anim` | `flow` (pixels de la vue goulots) si elle change |
| Commandes, chantier | `contracts`, `contracts-reputation`, `project`, `coop-orders`, `orders-ui` | `orders` |
| Manufacture, produits | `crafter`, `products`, `coop-crafter` | `crafter` |
| Débits, prévisions | `flow`, `flow-ui`, `forecast` | `flow` |

Fichier `tests/<nom>.test.ts` : `npx vitest run tests/<nom>.test.ts --testTimeout=120000`.

## 3. Suite complète (avant fusion, ou si `GameState`, `World` ou la sauvegarde ont changé en profondeur)

```bash
npm test -- --testTimeout=120000     # ≈ 7 min sous Windows ; 1 015 tests au 14/10/2026
```

Sous Windows, **sans** `--testTimeout=120000`, 10 tests de `tests/session.test.ts` dépassent la limite de 5 s et échouent par
lenteur (ils passent avec plus de temps). Ce n'est pas une régression : le dire si on lance `npm test` seul.

## 4. Navigateur (e2e)

- Toujours `npm run build` d'abord ; les scripts servent `dist/` avec `vite preview`.
- `CHROME_PATH` : défini pour ce poste dans `.claude/settings.local.json` (le défaut des scripts est un chemin Linux).
- `node e2e/<script>.mjs` ; captures dans `e2e/screenshots/` (ignoré par git).
- **Sous Windows, tant que ce n'est pas corrigé** : `cloud`, `coop`, `crafter`, `flow`, `menus`, `orders`, `phone` et
  `playthrough` s'arrêtent au démarrage (chemin des captures, voir `CLAUDE.md`, « Points ouverts ») ; le dire dans le rapport
  au lieu de les compter comme lancés. `touch` fonctionne (vérifié le 14/10/2026) ; `panels` n'utilise pas ce chemin.
- Liste et contenu : section « Tests » du `README.md`.

## Interdit sans accord explicite

`tests-net/*` : vrai Firebase (compte jetable créé puis supprimé) et courtiers MQTT publics. Le hook `guard` le bloque.

## Rapport attendu

```
Typecheck : OK
Tests liés (vitest related, 12 fichiers) : 184 réussis, 0 échec
Ajoutés : tests/xxx.test.ts (5 cas : aller-retour, ancienne sauvegarde, …)
Non lancé : e2e/phone.mjs (aucun changement d'interface)
```

Un test qui échoue : nom exact, message d'erreur, cause établie ou hypothèse annoncée comme telle.
