# Compte : la partie gardée en ligne

Le jeu peut garder la partie d'un joueur **sur son compte** (adresse e-mail + mot de passe) : en changeant d'appareil, on se
connecte et on retrouve sa partie, sans exporter ni importer de fichier. Le jeu est un ensemble de fichiers (GitHub Pages) et n'a
pas de serveur à lui : le compte vit chez **Firebase**, le service de Google (offre gratuite « Spark », pas de carte bancaire) :

- *Authentication* : les comptes (e-mail + mot de passe, « mot de passe oublié » par e-mail) ;
- *Firestore* : **un seul document par joueur**, `saves/{identifiant}`, qui contient sa sauvegarde compressée (10 à 40 Ko) et un
  résumé (date, argent, profondeur, temps de jeu, genre d'appareil).

Le jeu parle directement aux API REST de Google (`fetch`), sans leur bibliothèque : rien à installer, rien de plus à charger.
Tant que le projet n'est pas renseigné (`src/cloud/config.ts`), le bouton « Compte » **n'existe pas** et le jeu se comporte comme avant.

## Mise en place (une seule fois, par la personne qui publie le jeu)

1. **Créer le projet** : <https://console.firebase.google.com> (avec un compte Google) → *Créer un projet* (nom au choix, sans
   Google Analytics).
2. **Authentication** : menu *Build* → *Authentication* → *Commencer* → onglet *Méthode de connexion* → activer
   **E-mail/Mot de passe** (la première case seulement ; pas le « lien par e-mail ») → *Enregistrer*.
3. **Firestore** : menu *Build* → *Firestore Database* → *Créer une base de données* → une région en Europe → mode *production*.
   Puis l'onglet *Règles* : remplacer tout par le contenu de [docs/firebase/firestore.rules](firebase/firestore.rules) → *Publier*.
   Ces règles ne laissent chaque joueur lire, écrire ou supprimer **que son propre document**, et refusent une sauvegarde de plus de
   500 000 signes.
4. **Récupérer les deux valeurs** : roue dentée → *Paramètres du projet* → *Vos applications* → icône web `</>` → un nom, sans
   hébergement → *Enregistrer*. On obtient `apiKey` et `projectId`. **Ce ne sont pas des secrets** : Firebase est conçu pour que la
   clé soit dans la page (ce sont les règles ci-dessus qui protègent les données).
5. **Les écrire dans le jeu** : `src/cloud/config.ts`, constante `FIREBASE = { apiKey: '…', projectId: '…' }`. Publier.
6. *(Facultatif, recommandé)* **Limiter la clé à ce site** : <https://console.cloud.google.com> → *API et services* → *Identifiants* →
   la clé du projet → *Restrictions relatives aux applications* → *Sites Web* → ajouter `https://<utilisateur>.github.io/*`
   (et `http://localhost:*` pour essayer en local).
7. *(Facultatif)* **E-mails en français** : *Authentication* → *Modèles* → *Réinitialisation du mot de passe* → langue *Français*.

## Pour le joueur

- Menu principal ou menu pause → **Compte** → *Créer un compte* (ou *Se connecter*). Le bouton montre ✓ quand on est connecté.
- **Rien d'autre à faire** : à chaque sauvegarde du jeu (toutes les minutes, au menu pause → *Sauvegarder*, en quittant, en mettant
  l'application en arrière-plan), la partie part sur le compte. Sans réseau, elle reste sur l'appareil et part dès que possible.
- **Nouvel appareil** : *Compte* → *Se connecter* → *Continuer*. Avant de reprendre une partie, le jeu prend ce qu'un autre appareil a pu
  y laisser (cinq secondes au plus).
- **Deux parties qui diffèrent** (on a joué ici et ailleurs sans se synchroniser, ou on se connecte pour la première fois sur un appareil
  qui a déjà une autre partie) : le jeu montre les deux (date, argent, profondeur, temps de jeu) et **demande laquelle garder**. L'autre
  n'est pas perdue : elle est **mise de côté** (écran *Compte* → *La reprendre*, depuis le menu principal).
- *Se déconnecter* garde la partie sur l'appareil. *Supprimer mon compte* efface le compte et la partie en ligne (mot de passe redemandé).

## Vie privée

Chez Google (Firebase) : l'adresse e-mail, une empreinte du mot de passe (que le jeu ne voit ni ne garde), et la sauvegarde. Rien
d'autre : pas de statistiques, pas de publicité. Sur l'appareil : un jeton de session (`localStorage`), jamais le mot de passe.

## Comment la synchronisation décide (src/cloud)

Chaque appareil se souvient de son **dernier échange réussi** avec le compte : la révision du document (`updateTime`, décidée par le
serveur) et la partie échangée (graine, temps de jeu). De là (`reconcile.ts`, une fonction pure testée cas par cas) :

| Compte | Appareil | Décision |
|---|---|---|
| vide | une partie | l'envoyer |
| une partie | aucune | la prendre |
| inchangé depuis le dernier échange | a avancé | l'envoyer |
| a changé | n'a pas bougé, ou a seulement fait sa dernière sauvegarde (moins de 90 s après le dernier échange) | prendre celle du compte (ce que l'appareil avait en plus, au plus quelques dizaines de secondes de jeu, n'est pas gardé) |
| a changé | a avancé de son côté | **demander** |
| a une partie | jamais échangé, et une autre partie | **demander** |
| même partie, même temps de jeu | même partie | rien (on retient la révision) |

Une écriture dans le compte précise la révision qu'elle croit remplacer (*précondition*) : si un autre appareil a écrit entre-temps, le
serveur la **refuse** et rien n'est écrasé. Une écriture dont la réponse s'est perdue (réseau coupé juste après) est reconnue à la
prochaine ouverture (`sent`). En cours de partie, jamais de remplacement silencieux : une partie plus récente du compte est signalée
(« Quelle partie garder ? »), jamais chargée sans que le joueur le veuille.

## Quand ça ne marche pas

L'écran *Compte* dit pourquoi, avec le détail technique en petit (à transmettre tel quel).

| Message | Cause probable |
|---|---|
| Le compte n'est pas disponible pour le moment (service non réglé) | Authentication ou Firestore pas activé, clé d'API fausse ou limitée à un autre site |
| Le service a refusé l'accès (règles de la base de données) | les règles ne sont pas publiées (étape 3) |
| E-mail ou mot de passe incorrect | … ou compte inexistant (Firebase ne dit pas lequel) |
| Trop d'essais | protection de Firebase : attendre quelques minutes, ou « Mot de passe oublié » |
| Pas de connexion à Internet | hors ligne : la partie reste sur l'appareil et part au retour du réseau |
| La partie du compte n'est pas lisible par cette version du jeu | le compte a une partie écrite par une version plus récente : mettre le jeu à jour |

## Essais

- `tests/cloud-*.test.ts` : client (contre un **faux Firebase**, `tests/support/fakeFirebase.ts`, qui reproduit réponses et erreurs de
  Google : jetons qui expirent, révisions, préconditions, règles), décisions de synchronisation, synchronisation à deux appareils
  (parties qui divergent, réseau coupé, réponse perdue, partie illisible, navigateur plein…), écran.
- `node e2e/cloud.mjs` (après `npm run build`) : **deux appareils** (deux profils de navigateur) et le faux Firebase derrière un petit
  serveur HTTP (`?debug&cloud=http://127.0.0.1:PORT`, réservé à cette machine : un lien piégé ne peut pas envoyer un mot de passe ailleurs).
- `node e2e/phone.mjs` vérifie aussi les écrans du compte sur 11 tailles d'écran.
- Les essais ci-dessus ne parlent jamais au vrai Firebase (le faux serveur reçoit des identifiants d'essai, jamais ceux du projet).

**Essai réel** : `npx vite-node tests-net/firebase.check.ts` (avec `NODE_USE_ENV_PROXY=1` derrière un mandataire) parle au **vrai** projet
(celui de `src/cloud/config.ts`) avec l'origine et la page du jeu publié, et vérifie de bout en bout ce que le jeu fait avec Google :
- les autorisations « CORS » que le navigateur exige (requêtes préliminaires pour POST, GET, PATCH, DELETE avec `Authorization` et
  `Content-Type`, réponses d'erreur lisibles par la page) ;
- un **compte jetable** : création, mauvais mot de passe, jeton renouvelé, adresse ou mot de passe refusés, envoi et lecture de la partie,
  écriture périmée refusée (`conflict`), règles de sécurité (document d'un autre, taille, accès sans jeton) ;
- la **synchronisation entre deux appareils** (reprise sans question, avance, question quand les deux ont joué, partie mise de côté) ;
puis il supprime le compte et sa partie. Aucun e-mail n'est envoyé. Réussi le 12 octobre 2026 sur le projet `empire-miner` (35 vérifications).
À relancer après tout changement des règles ou de la configuration. Si Google répond « API key not valid », la clé de `src/cloud/config.ts`
est mal recopiée (`0` et `O`, `I` et `l` se ressemblent) : la reprendre avec l'icône « copier » (*Paramètres du projet* → *Général* →
*Vos applications*). Le script envoie l'origine et la page du jeu : une clé limitée aux sites autorisés (étape 6) l'accepte.

**Pas essayé** : le jeu dans un vrai navigateur face au vrai Google (le Chromium de l'environnement de développement ne fait pas confiance
au certificat du mandataire). Les deux moitiés sont vérifiées séparément : l'écran et la synchronisation contre un faux serveur identique
à Google (e2e), les requêtes elles-mêmes — y compris les autorisations CORS — contre le vrai Google (essai réel).
