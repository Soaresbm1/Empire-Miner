# Empire Miner

Jeu de minage, de progression et d'automatisation.
On commence avec une vieille pioche dans une petite mine ; on finit (à terme) à la tête d'une
exploitation industrielle où des milliers de minerais circulent sur des chaînes que l'on a
construites soi-même — dans **la même mine**, qui garde la trace de chaque coup de pioche.

> Faire à la main → gagner de l'argent → améliorer → automatiser → nouveaux problèmes → automatiser encore.

## Jouer

```bash
cd empire-miner
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
| Sac et carnet | `I` ou `Tab` |
| Mode construction | `B` — clic gauche : poser (glisser pour tracer des convoyeurs), clic droit : démonter, `R` : tourner, `1-9` : choisir |
| Zoom | molette |
| Pause, sauvegarde, chargement, export | `Échap` |

Les touches sont lues par position physique : ZQSD et WASD fonctionnent sans réglage.

## Contenu de la version 0.1 (tranche verticale)

- Mine explorable persistante générée à partir d'une graine, galeries de départ, cavernes à découvrir.
- Minage physique : chaque coup inflige des dégâts, fissures visibles, la roche lâche des minerais au sol.
- Ramassage physique, sac limité **en poids**, choix de ce que l'on ramasse, possibilité de jeter.
- Profondeur réelle (2,5 m par rangée) : roche tendre → roche dure (100 m) → basalte (300 m).
- Ressources : pierre, charbon, cuivre, fer, argent, or (valeur, poids, rareté, résistance, profondeur).
- Comptoir de vente et atelier en surface ; 4 pioches, 3 moyens de transport (sac, grand sac, brouette).
- Première automatisation : **foreuse à charbon → convoyeurs → coffre**, avec minerais visibles sur les
  convoyeurs, capacité et débit réels (saturation possible), alimentation en charbon manuelle ou par convoyeur.
- Trois niveaux de **convoyeurs** : de base (2,25 objets/s), **rapide** (×2, pioche améliorée) et **express**
  (×4, pioche en fer). Poser un convoyeur sur un convoyeur d'un autre niveau le remplace sur place (direction et
  minerais conservés, ancien convoyeur rendu au stock) : on améliore une ligne entière en glissant dessus.
- Un **coffre** se vide dans tout convoyeur collé qui ne pointe pas vers lui (tampon au milieu d'une chaîne,
  ou dépôt manuel qui repart sur les convoyeurs) ; une **foreuse** pousse sa production devant sa flèche en
  priorité, sinon dans n'importe quel convoyeur collé.
- Un **coffre de charbon collé à une foreuse** la recharge automatiquement (en priorité sur les convoyeurs).
  Une foreuse posée sur du charbon qui remplit un coffre devant elle s'alimente donc toute seule.
- Vente automatique : **caisse d'expédition** à poser en surface. Tout ce qui y arrive est vendu au prix du
  comptoir à chaque passage du transporteur (toutes les 15 s) ; sa capacité est limitée (120 kg), pleine elle
  bloque les convoyeurs. Le HUD affiche le revenu automatique par minute.
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
rentre pendant que le joueur reste au fond de la mine.

## Choix techniques

- **2D vue de dessus en 3/4** (murs avec face avant) : la lisibilité d'un plan est indispensable pour
  concevoir des chaînes de convoyeurs, et elle reste très bonne pour le minage. La 3D n'apporterait rien au
  gameplay pour un coût élevé.
- **TypeScript + Vite + Canvas 2D**, moteur maison léger : aucune dépendance d'exécution, textures et sons
  générés par le code, rendu du terrain mis en cache par blocs.
- **Simulation séparée du rendu** : tout le jeu (monde, minage, économie, machines) tourne à pas fixe sans
  navigateur, ce qui permet de le tester et de le faire grandir sereinement.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/ROADMAP.md](docs/ROADMAP.md).
