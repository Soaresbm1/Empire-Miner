/**
 * Essai contre le VRAI Firebase (il faut du réseau) : un compte jetable est créé et sert à vérifier de bout en bout ce que le jeu
 * fait avec Google — création, connexion, jeton renouvelé, envoi et lecture de la partie, écriture périmée refusée, règles de
 * sécurité, puis la synchronisation entre deux appareils (`CloudSync`, deux stockages distincts) — avant d'être supprimé avec sa
 * partie. Aucun e-mail n'est envoyé (pas de « mot de passe oublié » ici).
 *
 *   npx vite-node tests-net/firebase.check.ts
 *   NODE_USE_ENV_PROXY=1 npx vite-node tests-net/firebase.check.ts     (derrière un mandataire : le fetch de Node l'ignore sinon)
 *
 * Variables : FIREBASE_API_KEY et FIREBASE_PROJECT_ID (sinon les valeurs de src/cloud/config.ts).
 * Si l'essai s'interrompt brutalement, un compte « essai-… » peut rester dans Authentication : on le supprime à la main.
 */
import { briefOf } from '../src/cloud/brief';
import { CloudClient, CloudError, type CloudWrite, type Tokens } from '../src/cloud/client';
import { FIREBASE, GOOGLE_ENDPOINTS } from '../src/cloud/config';
import { packSave, unpackSave } from '../src/cloud/pack';
import { CloudStore, browserSaves } from '../src/cloud/store';
import { CloudSync } from '../src/cloud/sync';
import { deserialize } from '../src/save/save';
import { MemoryStorage, makeSave } from '../tests/support/cloudKit';

const apiKey = process.env.FIREBASE_API_KEY || FIREBASE.apiKey;
const projectId = process.env.FIREBASE_PROJECT_ID || FIREBASE.projectId;
if (!apiKey || !projectId) {
  console.log('Pas de projet Firebase : renseignez src/cloud/config.ts, ou FIREBASE_API_KEY et FIREBASE_PROJECT_ID.');
  process.exit(2);
}

let failures = 0;
const ok = (c: boolean, label: string) => {
  console.log(c ? '✔' : '✘', label);
  if (!c) failures++;
};
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CloudError ? e.code : `autre : ${String(e)}`;
  }
};
const random = (n: number) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');

const client = new CloudClient({ config: { apiKey, projectId }, endpoints: GOOGLE_ENDPOINTS, timeout: 30000 });
const email = `essai-${Date.now().toString(36)}-${random(6)}@example.com`;
const password = random(20);
const write = (raw: string, data: string): CloudWrite => {
  const b = briefOf(raw)!;
  return { ...b, data, device: 'essai' };
};

let tokens: Tokens | null = null;
try {
  // ---------------------------------------------------------------- le compte
  try {
    tokens = await client.signUp(email, password);
  } catch (e) {
    const err = e as CloudError;
    ok(false, `création du compte jetable : ${err.code} (${err.message})`);
    if (err.code === 'unavailable') console.log('  → clé d’API refusée par Google, ou « E-mail/Mot de passe » pas activé dans Authentication.');
    throw err;
  }
  ok(!!tokens.uid && !!tokens.idToken && !!tokens.refreshToken, `compte jetable créé (${email})`);
  ok((await code(client.signIn(email, `${password}x`))) === 'bad-credentials', 'un mauvais mot de passe est refusé (« bad-credentials »)');
  const again = await client.signIn(email, password);
  ok(again.uid === tokens.uid, 'la connexion retrouve le même compte');
  const fresh = await client.refresh(tokens.refreshToken, email);
  ok(fresh.uid === tokens.uid && fresh.idToken !== '', 'le jeton est renouvelé');
  ok((await code(client.refresh('pas-un-jeton', email))) === 'session', 'un jeton de renouvellement faux : « session »');
  ok((await code(client.signUp(email, password))) === 'email-exists', 'créer deux fois le même compte : « email-exists »');
  ok((await code(client.signUp('pas-un-mail', password))) === 'invalid-email', 'une adresse mal formée : « invalid-email »');
  ok((await code(client.signUp(`essai-${random(6)}@example.com`, '123'))) === 'weak-password', 'un mot de passe trop court : « weak-password »');

  // ---------------------------------------------------------------- la partie du compte
  const raw1 = makeSave(4242, 1000, 5000, 42);
  const data1 = await packSave(raw1);
  ok((await client.getBrief(tokens.idToken, tokens.uid)) === null, 'aucune partie sur le compte au départ (404 ≠ « base absente »)');
  const rev1 = await client.putSave(tokens.idToken, tokens.uid, write(raw1, data1), null);
  ok(/^\d{4}-\d\d-\d\dT/.test(rev1), `première écriture (création) : révision ${rev1}`);
  const brief = await client.getBrief(tokens.idToken, tokens.uid);
  ok(brief?.rev === rev1 && brief.seed === 4242 && brief.time === 1000 && brief.money === 5000 && brief.depth === 42 && brief.device === 'essai', 'le résumé relu est celui écrit (graine, temps, argent, profondeur, appareil)');
  const doc = await client.getSave(tokens.idToken, tokens.uid);
  ok(doc?.data === data1 && (await unpackSave(doc.data)) === raw1, `la sauvegarde relue est identique (${data1.length} signes emballés pour ${raw1.length})`);
  ok((await code(client.putSave(tokens.idToken, tokens.uid, write(raw1, data1), null))) === 'conflict', 'écrire « compte vide » alors qu’il ne l’est plus : « conflict »');
  const raw2 = makeSave(4242, 2000, 6000, 50);
  const rev2 = await client.putSave(tokens.idToken, tokens.uid, write(raw2, await packSave(raw2)), rev1);
  ok(rev2 !== rev1, 'écrire en remplaçant la bonne révision réussit, et donne une nouvelle révision');
  ok((await code(client.putSave(tokens.idToken, tokens.uid, write(raw1, data1), rev1))) === 'conflict', 'écrire avec une révision périmée : « conflict »');
  ok((await client.getBrief(tokens.idToken, tokens.uid))?.time === 2000, 'et la partie du compte n’a pas bougé');

  // ---------------------------------------------------------------- les règles de sécurité
  ok((await code(client.getBrief(tokens.idToken, 'le-document-de-quelqu-un-d-autre'))) === 'denied', 'lire le document d’un autre : « denied »');
  ok((await code(client.putSave(tokens.idToken, 'le-document-de-quelqu-un-d-autre', write(raw1, data1), null))) === 'denied', 'écrire chez un autre : « denied »');
  ok((await code(client.putSave(tokens.idToken, tokens.uid, write(raw1, `z:${'x'.repeat(500000)}`), rev2))) === 'denied', 'une sauvegarde de plus de 500 000 signes : « denied » (règle de taille)');
  const anonymous = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saves/${tokens.uid}`);
  ok(anonymous.status === 403, `sans jeton, la partie n’est pas lisible (HTTP ${anonymous.status})`);
  await client.deleteSave(tokens.idToken, tokens.uid);
  ok((await client.getBrief(tokens.idToken, tokens.uid)) === null, 'supprimer la partie du compte la fait disparaître');

  // ---------------------------------------------------------------- deux appareils, par la synchronisation du jeu
  const device = () => {
    const kv = new MemoryStorage();
    const hooks = { pulled: 0 };
    const sync = new CloudSync(
      client,
      browserSaves(kv),
      new CloudStore(kv),
      { playing: () => false, pulled: () => hooks.pulled++, changed: () => undefined, notice: () => undefined, validate: (json) => void deserialize(JSON.parse(json)) },
      { pushDelay: 0, pushEvery: 0, drift: 0 },
    );
    return { kv, saves: browserSaves(kv), sync, hooks };
  };
  const a = device();
  const b = device();
  const mine = makeSave(777, 300, 111, 7);
  a.saves.write(mine);
  await a.sync.signIn(email, password);
  ok(a.sync.view.error === null && a.sync.view.cloud?.seed === 777, 'appareil A : connecté, sa partie part sur le compte');
  await b.sync.signIn(email, password);
  ok(b.saves.read() === mine && b.hooks.pulled === 1 && b.sync.view.ask === null, 'appareil B (neuf) : se connecte et reprend la partie, à l’identique, sans question');
  const further = makeSave(777, 900, 222, 9);
  b.saves.write(further);
  await b.sync.sync();
  ok(b.sync.view.error === null, 'B avance et envoie sa progression');
  await a.sync.sync();
  ok(a.saves.read() === further && a.sync.view.ask === null, 'A reprend la progression de B, sans question (il n’avait pas bougé)');
  const aLocal = makeSave(777, 1200, 333, 10);
  const bLocal = makeSave(777, 1100, 444, 11);
  a.saves.write(aLocal);
  b.saves.write(bLocal);
  await a.sync.sync();
  await b.sync.sync();
  ok(b.sync.view.ask?.why === 'diverged' && b.saves.read() === bLocal, 'les deux ont avancé chacun de leur côté : B se voit poser la question, rien n’est écrasé');
  await b.sync.resolve('cloud');
  ok(b.saves.read() === aLocal && b.saves.readAside() === bLocal, 'B garde celle du compte : la sienne est mise de côté, telle quelle');
} catch (e) {
  if (!(e instanceof CloudError) || failures === 0) ok(false, `interruption : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  // ---------------------------------------------------------------- ménage : la partie et le compte jetables
  if (tokens) {
    try {
      const t = await client.signIn(email, password);
      await client.deleteSave(t.idToken, t.uid);
      await client.deleteAccount(t.idToken);
      ok((await code(client.signIn(email, password))) === 'bad-credentials', 'ménage : le compte jetable et sa partie sont supprimés');
    } catch (e) {
      ok(false, `ménage impossible (supprimer « ${email} » à la main dans Authentication) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nFirebase validé.');
process.exit(failures ? 1 : 0);
