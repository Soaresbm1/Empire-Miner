---
name: save-integrity
description: Règles de compatibilité des sauvegardes et du jeu à deux d'Empire Miner. À charger avant de toucher src/save, un champ sauvegardé (serialize/load d'une structure, d'un système de src/sim), l'ordre des ressources, blocs, machines ou recettes, ou tout état qui doit survivre à un rechargement ou à une resynchronisation.
---

# Intégrité des sauvegardes et du jeu à deux

Une partie de joueur ne doit **jamais** devenir illisible ni changer de sens après une mise à jour. Une même sauvegarde sert à
trois choses : le stockage (navigateur, fichier exporté, compte en ligne), l'**empreinte** du jeu à deux (`src/net/digest.ts`
hache `serialize(g)`) et la **resynchronisation** (l'hôte envoie sa partie, l'invité la recharge).

## Ce qui est sauvegardé et comment

- `src/save/save.ts` : `serialize` écrit `SaveData`, `deserialize` régénère le monde depuis la graine puis réapplique les écarts.
  `SAVE_VERSION = 1` n'a jamais changé : la compatibilité tient par des **champs facultatifs** vérifiés au chargement.
- Chaque système a son couple `serialize()` / `load(data)` (structures : `Structure.serialize` et la fabrique `load` de
  `structures/registry.ts` ; `Market`, `Contracts`, `Project`, `WorkerSystem`, `MarkerBook`, `ProductionLog`…).
- Non sauvegardé, recalculé : poches de grisou et d'eau (depuis la graine), compteurs de débit `Flow`, curseurs de sortie
  (`outCursor`…), vitesse de jeu et pause.

## Règles

1. **Champ nouveau = facultatif.** Type `champ?: …` dans `SaveData` ou la sauvegarde de la structure, avec un commentaire qui dit
   ce que vaut son absence (« absent des anciennes sauvegardes : … »). Le chargement remplace une valeur absente par la valeur neutre.
2. **Tout se vérifie au chargement** : type, bornes, identifiants connus (`hasResource`, `isJob`, `hasRecipe`…). Une valeur
   aberrante est ignorée ou bornée, jamais une exception qui rend la partie illisible (modèle : `loadPersonal`, `Crafter.load`).
3. **Identifiants rangés par ordre d'ajout, jamais réordonnés** :
   - `RESOURCES` (`data/resources.ts`) : la grille `deposit` garde l'index de la ressource + 1 (`resourceIndex`, `World.setDeposit`). Un minerai nouveau
     se range après le dernier minerai (avant les lingots, qui n'ont pas de gisement) ; un lingot ou un produit nouveau, en fin de
     sa famille. Ne jamais déplacer une ressource existante ;
   - `BLOCKS` (`data/blocks.ts`) : la grille `tiles` garde l'identifiant de bloc, attribué dans l'ordre des `add(...)`. Les
     premières roches (`FIRST_ROCKS`) et premiers filons (`FIRST_ORES`) sont figés ; roches et filons ajoutés depuis sont créés
     **après** (l'éboulis, puis `HOST_ROCKS.slice(FIRST_ROCKS)`, puis les autres filons). Un bloc nouveau s'ajoute toujours à la fin ;
   - identifiants de machines (`type` des structures) et de recettes : ne pas renommer ; une machine retirée garde une fabrique
     ou est ignorée au chargement (`if (!f) continue`).
4. **Ce qui change la suite de la partie doit être sauvegardé, ou se recalculer à l'identique** depuis ce qui l'est. Sinon, après
   une resynchronisation, les deux appareils divergent (l'empreinte diffère toutes les 2 s et la partie se recharge en boucle).
5. **Ce qui n'est qu'affichage n'entre ni dans la sauvegarde ni dans l'empreinte** (exemple : `Flow`).
6. **Rien de non déterministe dans les valeurs sauvegardées** : pas d'heure de l'appareil (sauf `savedAt`, exclu de l'empreinte),
   pas de `Math.random`, nombres arrondis comme le voisinage (`round2`).
7. **Changement du contenu d'une phase, d'une recette, d'un bâtiment du camp** : prévoir le cas de l'ancienne partie
   (`Project.load` rend ce qui ne sert plus via `giveBack`, `evict` remet au stock une machine posée là où un bâtiment apparaît).
8. **Écrire n'est pas `localStorage` seulement** : `saveToBrowser` garde la sauvegarde précédente en secours ; le compte en ligne
   (`src/cloud`) ne remplace jamais une partie lisible par une partie que `deserialize` refuse.

## Vérifications obligatoires

- **Aller-retour** : `deserialize(serialize(g))` redonne le même état. Le comparer par `stateDigest` (`src/net/digest.ts`) ou par
  `serialize` sans `savedAt`, **et** faire tourner les deux copies quelques secondes (`run` de `tests/helpers.ts`) : elles doivent
  rester identiques.
- **Ancienne sauvegarde** : un `SaveData` **sans** le nouveau champ se charge et donne la valeur neutre.
- **Valeur aberrante** : un champ corrompu (mauvais type, hors bornes, identifiant inconnu) est ignoré sans exception.
- **Jeu à deux** : un scénario rejoué sur deux copies, dont une reçue en cours de route, reste identique (modèle :
  `tests/coop-orders.test.ts`, `tests/coop-crafter.test.ts`).
- Tests existants à relancer : `tests/save.test.ts`, `tests/multiplayer-sim.test.ts`, et le test du système concerné.

## Exemple

Ajouter un « mode » à un coffre : `mode?: 'normal' | 'tampon'` dans sa sauvegarde, écrit seulement s'il n'est pas `'normal'`
(comme `ShippingCrate.mode`) ; `Storage.load` n'accepte que les deux valeurs connues ; une `SimAction` le change ; tests :
aller-retour, ancienne sauvegarde sans `mode`, valeur inconnue, et deux copies qui changent le mode au même pas.
