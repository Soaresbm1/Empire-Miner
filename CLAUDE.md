# Empire Miner : consignes pour Claude Code

Jeu de minage, de progression et d'automatisation en 2D vue de dessus 3/4. TypeScript strict, Vite, Canvas 2D, moteur maison,
aucune dépendance d'exécution (textures et sons générés par le code). **Tout le dépôt est en français** : commentaires, textes du
jeu, documentation, messages de commit. Écrire comme le code voisin (même densité de commentaires, mêmes tournures).

## Commandes

| Quoi | Commande | Durée (poste Windows) |
|---|---|---|
| Types | `npm run typecheck` | ≈ 3 s |
| Tests ciblés | `npx vitest run tests/<nom>.test.ts` ou `npx vitest related <fichiers…> --run` | quelques s |
| Suite complète | `npm test -- --testTimeout=120000` | ≈ 7 min |
| Construction | `npm run build` (inclut `tsc --noEmit`) | — |
| Navigateur | `npm run build` puis `node e2e/<script>.mjs` (Chromium : variable `CHROME_PATH`) | 1 à 5 min |

- **Windows** : sans `--testTimeout=120000`, 10 tests de `tests/session.test.ts` (jeu à deux sur réseau simulé) dépassent la
  limite par défaut de 5 s et échouent ; ils passent avec plus de temps. Ce fichier représente ≈ 6 min de la suite : ne le lancer
  que si `src/net`, `src/save` ou la simulation commune ont changé.
- **Jamais sans accord explicite** : `tests-net/*` (vrai Firebase, compte jetable ; courtiers MQTT publics).
- Le CI (`.github/workflows/pages.yml`) lance `npm test` puis `npm run build` et publie sur GitHub Pages à chaque fusion dans `main`.

## Carte du code

Référence complète : `docs/ARCHITECTURE.md` (≈ 26 000 tokens : en lire **la section utile**, trouvée par Grep sur son titre).

| Dossier | Rôle |
|---|---|
| `src/data/` | Données pures : ressources, blocs, outils, machines, recettes, marché, commandes, chantier, ouvriers |
| `src/sim/` | Simulation sans DOM, à pas fixe (1/60 s) : `GameState.update(dt, intent)`, structures, ouvriers, marché, commandes |
| `src/save/` | Sauvegarde versionnée (`serialize` / `deserialize`) |
| `src/net/` | Jeu à deux en lockstep : session, transports, empreinte (`digest.ts`) |
| `src/game/` | `Game` : boucle, entrées → intentions, menus, sauvegardes |
| `src/render/`, `src/ui/`, `src/audio/` | Présentation : Canvas, HUD et panneaux HTML, sons |
| `src/cloud/` | Compte en ligne (Firebase en REST) |
| `tests/` (Vitest), `e2e/` (Chromium), `tests-net/` (réseau réel) | Vérifications |

Fichiers très longs (`render/Renderer.ts`, `game/Game.ts`, `sim/GameState.ts`, plus de 2 000 lignes) : les lire par passages.

## Règles qui ne se discutent pas

1. **La simulation ne connaît pas la présentation.** `src/sim` et `src/data` n'importent rien de `ui/`, `render/`, `game/`, ni le DOM.
   La simulation émet des `SimEvent` ; `Game` en fait sons, particules et messages.
2. **Déterminisme.** Dans `src/sim` et `src/net/digest.ts` : ni `Math.random`, `hypot`, `exp`, `log`, `sin`, `cos`, `tan`, `atan2`,
   `pow`, ni `**`. Utiliser `core/dmath.ts` (`hyp`, `dexp`, `dlog`, `smallCosSin`) et les tirages de la simulation
   (`GameState.random()`, `core/rng.ts`, ou un hachage comme le marché). Vérifié par `tests/multiplayer-sim.test.ts`.
3. **Toute modification de partie passe par une `SimAction`** (`src/sim/actions.ts`, `applyAction`) : seul, elle s'applique tout
   de suite ; à deux, elle est jouée par les deux appareils au même pas. L'interface lit l'état, elle ne le modifie pas.
4. **Sauvegardes** : une ancienne partie doit toujours se charger. Champ nouveau = facultatif et vérifié au chargement ; ne jamais
   réordonner `RESOURCES` (les index des gisements sauvegardés en dépendent). Voir le skill `save-integrity`.
5. **Version du jeu à deux** : modifier `src/sim`, `src/data`, `src/core`, `src/save` ou `src/net` change `PROTOCOL`
   (empreinte calculée par `vite.config.ts`). C'est voulu, mais pas pour un changement cosmétique.
6. **Une fonctionnalité est terminée quand elle marche** : comportement implémenté, testé (simulation, jeu à deux, interface),
   documentation mise à jour (README, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`). Un bouton sans effet n'est pas terminé.
7. **Rendre compte honnêtement** : ne citer que les tests réellement lancés, avec leur résultat ; dire ce qui n'a pas été vérifié.

## Git

- Aucun commit, push ou merge sans autorisation explicite. Une branche par changement.
- Titre de commit : `Domaine : ce qui change pour le joueur (#PR)`, en français (voir `git log`).
- Fins de ligne : LF partout (`.gitattributes`).

## Studio IA du projet

- Skills (`.claude/skills/`) : `feature-workflow` (déroulé d'une fonctionnalité), `save-integrity` (sauvegarde et jeu à deux),
  `regression-testing` (quels tests lancer), `sim-systems` (minage, production, automatisation : où et comment étendre).
- Agents (`.claude/agents/`) : `qa-balance` (lance les tests, rend un rapport court), `sim-architect` (relecture d'un changement
  de simulation avant commit). L'implémentation reste dans la session principale ; pas d'agent quand une lecture suffit.
- Hooks (`.claude/hooks/`, scripts Node) : garde-fous des commandes et fichiers sensibles, contrôle du déterminisme à l'écriture,
  typecheck et tests liés en fin de tâche.

## Points ouverts (à traiter séparément)

- `npm audit` : 4 vulnérabilités « high », toutes dans des outils de développement (`braces` et `micromatch` via
  `vite-plugin-singlefile`, `source-map-js`). La correction complète impose une version cassante de `vite-plugin-singlefile`.
- Les scripts `e2e/` ont un `CHROME_PATH` par défaut pour Linux ; sous Windows, il vient de `.claude/settings.local.json`.
- Sous Windows, 8 scripts e2e (`cloud`, `coop`, `crafter`, `flow`, `menus`, `orders`, `phone`, `playthrough`) s'arrêtent au
  démarrage : `new URL('./screenshots/', import.meta.url).pathname` donne `C:\C:\…`. Correction possible : `fileURLToPath`
  (`node:url`). `touch.mjs` et `panels.mjs` n'en dépendent pas (`touch.mjs` vérifié : 43 vérifications réussies ;
  `panels.mjs` non lancé).
