---
name: feature-workflow
description: Déroulé standard pour ajouter ou modifier une fonctionnalité d'Empire Miner (mécanique, machine, panneau, équilibrage), de la demande au rapport final, avec la définition de « terminé » propre au dépôt. À utiliser dès qu'une demande touche au comportement du jeu, pas pour une simple question ou une correction de texte.
---

# Déroulé d'une fonctionnalité

## Définition de « terminé » (habitude du dépôt, voir `git show --stat` des derniers commits)

Une fonctionnalité arrive en une fois avec :
1. **la simulation** (`src/sim`, `src/data`) : le comportement réel, déterministe ;
2. **les actions** : tout ce que le joueur déclenche passe par une `SimAction` (`src/sim/actions.ts`) ;
3. **l'interface** (`src/ui`, `src/render`) : on la voit, on s'en sert au clavier, à la souris **et au doigt** ;
4. **la sauvegarde** si un état doit durer (skill `save-integrity`) ;
5. **les tests** : unitaires du système, jeu à deux (`coop-*` : deux copies, dont une reçue en cours de route), interface
   (`*-ui.test.ts`), et e2e si le parcours du joueur change ;
6. **la documentation** : `README.md` (contenu du jeu, section Tests si un script change), `docs/ARCHITECTURE.md` (la section
   du système), `docs/ROADMAP.md` (cocher ✅ ou ajouter).

Un bouton, un écran ou une mécanique dont le comportement n'est pas implémenté **n'est pas terminé** : ni « à brancher plus
tard », ni texte provisoire présenté comme fini.

## Étapes

1. **Comprendre.** Reformuler la demande en effet pour le joueur. Une ambiguïté qui change le résultat : demander.
2. **Inspecter.** Lire la section utile de `docs/ARCHITECTURE.md` (Grep sur son titre), puis le code concerné par passages.
3. **Vérifier l'existant.** Chercher (Grep) si la mécanique, un réglage de données ou un composant d'interface existe déjà.
   Réutiliser plutôt que dupliquer (`frontTilesOf`, `pushToAdjacentConveyor`, `fuelWanted`, `morph`, `filterChips`…).
4. **Planifier** (mode Plan) si : sauvegarde ou réseau touchés, nouveau système dans `src/sim`, plus de trois fichiers, ou
   équilibrage de plusieurs chiffres. Le plan nomme les fichiers, les données, la sauvegarde et les tests.
5. **Charger ce qui sert.** `sim-systems` (où étendre minage, production, automatisation), `save-integrity` si un état est
   sauvegardé. Pas d'agent pour ce qu'une lecture suffit à faire.
6. **Implémenter**, dans l'ordre : données → simulation → `SimAction` → sauvegarde → interface → dessin. Nombres réglables dans
   `src/data`, pas en dur dans le code. Textes du jeu en français, dans le ton des existants.
7. **Tester** : écrire les tests avec le code (skill `regression-testing` pour les commandes). Un test doit pouvoir échouer :
   le vérifier une fois en cassant le comportement.
8. **Non-régression** : typecheck, tests liés, suite complète avant fusion. Si `src/sim|data|save|net` a changé : agent
   `sim-architect` pour une relecture indépendante (au besoin, pas systématiquement pour trois lignes).
9. **Interface** : si elle a changé, `npm run build` puis `e2e/phone.mjs` (pas de débordement à 11 tailles) et le script du domaine.
10. **Rapport** (format ci-dessous). Pas de commit sans autorisation.

## Rapport final

```
Ce qui change pour le joueur : …
Fichiers : src/… (rôle), tests/… (cas couverts), docs/… (sections)
Vérifications réellement lancées : typecheck OK ; vitest related : N réussis ; e2e/… : OK (ou : non lancé, parce que …)
Points ouverts : … (équilibrage à observer, limite connue, question)
Version du jeu à deux : change (src/sim modifié) / ne change pas
```

## Exemple

« Les coffres peuvent être réglés en tampon » : données (`data/machines.ts` si un réglage), `Storage` (comportement + `serialize`
/ `load`), `SimAction` `storageMode`, panneau du coffre (`ui/panels.ts`), tests `chest-select` + nouveau test du mode + cas
jeu à deux, README (contenu), ARCHITECTURE (paragraphe « Filtre de coffre »), ROADMAP.
