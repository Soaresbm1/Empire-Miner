import { describe, expect, it } from 'vitest';
import { CloudClient, CloudError, type CloudWrite } from '../src/cloud/client';
import { ENDPOINTS, clientFor } from './support/cloudKit';
import { FakeFirebase } from './support/fakeFirebase';

const write = (over: Partial<CloudWrite> = {}): CloudWrite => ({ data: 'z:abc', seed: 42, time: 123.5, money: 99, depth: 12, savedAt: '2026-10-12T10:00:00.000Z', device: 'Mac', ...over });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CloudError ? e.code : `autre : ${String(e)}`;
  }
}

describe('compte : client Firebase', () => {
  it('crée un compte puis s’y connecte', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    const t = await c.signUp('ami@exemple.fr', 'secret1');
    expect(t.email).toBe('ami@exemple.fr');
    expect(t.uid).toBeTruthy();
    expect(t.idToken).toBeTruthy();
    expect(t.refreshToken).toBeTruthy();
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    const again = await c.signIn('AMI@exemple.fr', 'secret1');
    expect(again.uid).toBe(t.uid);
  });

  it('dit pourquoi un compte ne se crée pas ou ne s’ouvre pas', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    expect(await code(c.signUp('pas-un-mail', 'secret1'))).toBe('invalid-email');
    expect(await code(c.signUp('ami@exemple.fr', '123'))).toBe('weak-password');
    await c.signUp('ami@exemple.fr', 'secret1');
    expect(await code(c.signUp('ami@exemple.fr', 'secret1'))).toBe('email-exists');
    expect(await code(c.signIn('ami@exemple.fr', 'mauvais!'))).toBe('bad-credentials');
    expect(await code(c.signIn('inconnu@exemple.fr', 'secret1'))).toBe('bad-credentials');
  });

  it('bloque après trop d’essais ratés', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    await c.signUp('ami@exemple.fr', 'secret1');
    for (let i = 0; i < fake.maxFailures; i++) await code(c.signIn('ami@exemple.fr', 'non'));
    expect(await code(c.signIn('ami@exemple.fr', 'secret1'))).toBe('too-many');
  });

  it('une clé d’API fausse, un service non activé : « non disponible »', async () => {
    const fake = new FakeFirebase();
    const wrong = new CloudClient({ config: { apiKey: 'autre', projectId: fake.projectId }, endpoints: ENDPOINTS, fetch: fake.fetch });
    expect(await code(wrong.signIn('a@b.fr', 'secret1'))).toBe('unavailable');
    fake.inject(/signInWithPassword/, 400, { error: { code: 400, message: 'OPERATION_NOT_ALLOWED' } });
    expect(await code(clientFor(fake).signIn('a@b.fr', 'secret1'))).toBe('unavailable');
    fake.inject(/signUp/, 400, { error: { code: 400, message: 'CONFIGURATION_NOT_FOUND' } });
    expect(await code(clientFor(fake).signUp('a@b.fr', 'secret1'))).toBe('unavailable');
  });

  it('sans réseau, ou si le serveur ne répond pas : « network »', async () => {
    const fake = new FakeFirebase();
    fake.down = true;
    expect(await code(clientFor(fake).signIn('a@b.fr', 'secret1'))).toBe('network');
    const slow = new CloudClient({
      config: { apiKey: fake.apiKey, projectId: fake.projectId },
      endpoints: ENDPOINTS,
      timeout: 20,
      fetch: (_url, init) => new Promise((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')))),
    });
    expect(await code(slow.signIn('a@b.fr', 'secret1'))).toBe('network');
  });

  it('renouvelle le jeton ; un jeton de renouvellement périmé : « session »', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    const t = await c.signUp('ami@exemple.fr', 'secret1');
    const fresh = await c.refresh(t.refreshToken, t.email);
    expect(fresh.uid).toBe(t.uid);
    expect(fresh.idToken).not.toBe(t.idToken);
    expect(fresh.email).toBe('ami@exemple.fr');
    expect(await code(c.refresh('nimporte-quoi', t.email))).toBe('session');
  });

  it('« mot de passe oublié » n’apprend rien sur qui a un compte', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    await c.signUp('ami@exemple.fr', 'secret1');
    await c.sendReset('ami@exemple.fr');
    await c.sendReset('inconnu@exemple.fr');
    expect(fake.mails).toEqual(['ami@exemple.fr']);
    fake.enumerationProtection = false;
    await c.sendReset('inconnu@exemple.fr');
    expect(await code(c.sendReset('pas-un-mail'))).toBe('invalid-email');
  });

  it('supprime le compte', async () => {
    const fake = new FakeFirebase();
    const c = clientFor(fake);
    const t = await c.signUp('ami@exemple.fr', 'secret1');
    await c.deleteAccount(t.idToken);
    expect(await code(c.signIn('ami@exemple.fr', 'secret1'))).toBe('bad-credentials');
  });

  describe('la partie du compte', () => {
    it('rien au départ, puis une partie qu’on retrouve en entier ou en résumé', async () => {
      const fake = new FakeFirebase();
      const urls: string[] = [];
      const c = clientFor(fake, (input, init) => {
        urls.push(String(input));
        return fake.fetch(input, init);
      });
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      expect(await c.getBrief(t.idToken, t.uid)).toBeNull();
      expect(await c.getSave(t.idToken, t.uid)).toBeNull();
      const rev = await c.putSave(t.idToken, t.uid, write(), null);
      expect(rev).toMatch(/^2026-/);
      const brief = await c.getBrief(t.idToken, t.uid);
      expect(brief).toEqual({ rev, seed: 42, time: 123.5, money: 99, depth: 12, savedAt: '2026-10-12T10:00:00.000Z', device: 'Mac' });
      const full = await c.getSave(t.idToken, t.uid);
      expect(full?.data).toBe('z:abc');
      expect(full?.rev).toBe(rev);
      // Le résumé ne télécharge pas la sauvegarde elle-même.
      const briefUrl = urls.filter((u) => u.includes('mask.fieldPaths=seed'));
      expect(briefUrl).toHaveLength(2);
      expect(briefUrl.some((u) => u.includes('mask.fieldPaths=data'))).toBe(false);
    });

    it('une écriture remplace la révision qu’elle croit remplacer, pas une autre', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      const r1 = await c.putSave(t.idToken, t.uid, write({ time: 1 }), null);
      // « Le compte est vide » alors qu’il ne l’est plus : refusé.
      expect(await code(c.putSave(t.idToken, t.uid, write({ time: 2 }), null))).toBe('conflict');
      const r2 = await c.putSave(t.idToken, t.uid, write({ time: 2 }), r1);
      expect(r2).not.toBe(r1);
      // Une révision périmée : refusé, et le compte garde la dernière partie.
      expect(await code(c.putSave(t.idToken, t.uid, write({ time: 3 }), r1))).toBe('conflict');
      expect((await c.getBrief(t.idToken, t.uid))?.time).toBe(2);
      // Une révision pour un compte qui n’a rien : refusé aussi.
      await c.deleteSave(t.idToken, t.uid);
      expect(await code(c.putSave(t.idToken, t.uid, write(), r2))).toBe('conflict');
      await c.deleteSave(t.idToken, t.uid);
    });

    it('un jeton expiré : « session » ; la partie d’un autre : « denied »', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const a = await c.signUp('a@exemple.fr', 'secret1');
      const b = await c.signUp('b@exemple.fr', 'secret1');
      await c.putSave(a.idToken, a.uid, write(), null);
      expect(await code(c.getBrief(b.idToken, a.uid))).toBe('denied');
      expect(await code(c.putSave(b.idToken, a.uid, write(), null))).toBe('denied');
      fake.expireTokens();
      expect(await code(c.getBrief(a.idToken, a.uid))).toBe('session');
    });

    it('les règles : une sauvegarde de plus de 500 000 signes est refusée', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      expect(await code(c.putSave(t.idToken, t.uid, write({ data: 'z:' + 'x'.repeat(500000) }), null))).toBe('denied');
      fake.inject(/PATCH/, 400, { error: { code: 400, message: 'Document "x" cannot be written because its size (1,100,000 bytes) exceeds the maximum allowed size of 1,048,576 bytes.', status: 'INVALID_ARGUMENT' } });
      expect(await code(c.putSave(t.idToken, t.uid, write(), null))).toBe('too-big');
    });

    it('pas de base de données Firestore dans le projet : « non disponible » (et non « pas de partie »)', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      fake.noDatabase = true;
      expect(await code(c.getBrief(t.idToken, t.uid))).toBe('unavailable');
      expect(await code(c.putSave(t.idToken, t.uid, write(), null))).toBe('unavailable');
      fake.noDatabase = false;
      fake.inject(/GET/, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Cloud Firestore API has not been used in project 123 before or it is disabled.' } });
      expect(await code(c.getBrief(t.idToken, t.uid))).toBe('unavailable');
    });

    it('d’autres pannes : trop de requêtes, serveur en panne', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      fake.inject(/GET/, 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } });
      expect(await code(c.getBrief(t.idToken, t.uid))).toBe('too-many');
      fake.inject(/GET/, 503, { error: { code: 503, status: 'UNAVAILABLE', message: 'The service is currently unavailable.' } });
      expect(await code(c.getBrief(t.idToken, t.uid))).toBe('server');
      fake.inject(/GET/, 200, { fields: {} });
      expect(await code(c.getSave(t.idToken, t.uid))).toBe('server');
    });

    it('l’écriture ne touche que ses champs : un champ qu’elle ne connaît pas reste', async () => {
      const fake = new FakeFirebase();
      const c = clientFor(fake);
      const t = await c.signUp('ami@exemple.fr', 'secret1');
      const rev = await c.putSave(t.idToken, t.uid, write(), null);
      // Un champ qu’une autre version du jeu aurait ajouté : l’écriture ne le touche pas.
      fake.doc(t.uid)!.fields.vieux = { stringValue: 'reste' };
      await c.putSave(t.idToken, t.uid, write({ time: 7 }), rev);
      expect(fake.doc(t.uid)!.fields.vieux).toEqual({ stringValue: 'reste' });
      expect(fake.doc(t.uid)!.fields.time).toEqual({ doubleValue: 7 });
      expect(fake.doc(t.uid)!.fields.seed).toEqual({ integerValue: '42' });
    });
  });
});
