/**
 * Le compte du joueur : sa partie gardée en ligne, pour la retrouver sur un autre appareil sans exporter ni importer.
 *
 * Le jeu n'a pas de serveur (ce sont des fichiers sur GitHub Pages) : le compte vit chez Firebase, le service de Google —
 * Authentication (e-mail + mot de passe) et un document par joueur dans Firestore. Rien n'est installé : tout passe par
 * `fetch` vers les API REST du projet (voir client.ts).
 *
 * La clé et l'identifiant du projet ne sont pas des secrets (c'est ainsi que Firebase est conçu pour les pages web) : ce sont
 * les règles de Firestore (docs/firebase/firestore.rules) qui décident qui lit quoi. Tant qu'ils sont vides, la fonction
 * « Compte » reste cachée et le jeu se comporte comme avant.
 */

export interface CloudConfig {
  apiKey: string;
  projectId: string;
}

/** Le projet Firebase du jeu : à remplir une fois le projet créé (voir docs/COMPTE.md). */
export const FIREBASE: CloudConfig = { apiKey: '', projectId: '' };

/** Les trois adresses de l'API : l'identité, le renouvellement du jeton, la base de données. */
export interface CloudEndpoints {
  identity: string;
  token: string;
  firestore: string;
}

export const GOOGLE_ENDPOINTS: CloudEndpoints = {
  identity: 'https://identitytoolkit.googleapis.com/v1',
  token: 'https://securetoken.googleapis.com/v1',
  firestore: 'https://firestore.googleapis.com/v1',
};

export interface CloudSetup {
  config: CloudConfig;
  endpoints: CloudEndpoints;
  /** Un faux serveur sur cette machine (essais automatiques). */
  local: boolean;
}

/**
 * Les adresses d'un faux serveur sur cette machine, pour les essais : `?debug&cloud=http://127.0.0.1:PORT`. Jamais ailleurs
 * que chez soi : un lien piégé ne doit pas pouvoir envoyer le mot de passe de quelqu'un à un autre serveur.
 */
export function localEndpoints(raw: string): CloudEndpoints | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  return { identity: `${url.origin}/identity/v1`, token: `${url.origin}/token/v1`, firestore: `${url.origin}/firestore/v1` };
}

/** Les identifiants que reçoit un faux serveur de test : jamais ceux du vrai projet. */
export const TEST_CONFIG: CloudConfig = { apiKey: 'cle-d-essai', projectId: 'projet-d-essai' };

/** Le compte est-il disponible ? Oui si le projet est renseigné, ou si un faux serveur local est désigné en mode `debug`. */
export function cloudSetup(search: string, configured: CloudConfig = FIREBASE): CloudSetup | null {
  const params = new URLSearchParams(search);
  const fake = params.has('debug') ? localEndpoints(params.get('cloud') ?? '') : null;
  if (fake) return { config: TEST_CONFIG, endpoints: fake, local: true };
  if (!configured.apiKey || !configured.projectId) return null;
  return { config: configured, endpoints: GOOGLE_ENDPOINTS, local: false };
}
