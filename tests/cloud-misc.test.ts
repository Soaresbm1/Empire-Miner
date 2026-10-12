import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudError } from '../src/cloud/client';
import { GOOGLE_ENDPOINTS, TEST_CONFIG, cloudSetup, localEndpoints } from '../src/cloud/config';
import { deviceName } from '../src/cloud/device';
import { packSave, unpackSave } from '../src/cloud/pack';
import { ASIDE_KEY, CloudStore, SLOT_KEY, browserSaves } from '../src/cloud/store';
import type { Ask, SyncView } from '../src/cloud/sync';
import { loadFromBrowser, saveToBrowser } from '../src/save/save';
import { GameState } from '../src/sim/GameState';
import { accountHtml, emptyForm, stateLine, when, type AccountModel } from '../src/ui/account';
import { MemoryStorage, makeSave } from './support/cloudKit';

afterEach(() => vi.unstubAllGlobals());

describe('compte : réglages', () => {
  it('le faux serveur local n’est admis que chez soi', () => {
    expect(localEndpoints('http://127.0.0.1:5123')).toEqual({ identity: 'http://127.0.0.1:5123/identity/v1', token: 'http://127.0.0.1:5123/token/v1', firestore: 'http://127.0.0.1:5123/firestore/v1' });
    expect(localEndpoints('http://localhost:8080')?.identity).toBe('http://localhost:8080/identity/v1');
    expect(localEndpoints('http://[::1]:9000')).not.toBeNull();
    expect(localEndpoints('https://pirate.example')).toBeNull();
    expect(localEndpoints('http://127.0.0.1.pirate.example')).toBeNull();
    expect(localEndpoints('http://192.168.1.20:5000')).toBeNull();
    expect(localEndpoints('ftp://127.0.0.1')).toBeNull();
    expect(localEndpoints('pas une adresse')).toBeNull();
  });

  it('pas de compte tant que le projet n’est pas renseigné', () => {
    const none = { apiKey: '', projectId: '' };
    expect(cloudSetup('', none)).toBeNull();
    expect(cloudSetup('?debug', none)).toBeNull();
    expect(cloudSetup('', { apiKey: 'AIza-cle', projectId: '' })).toBeNull();
    expect(cloudSetup('', { apiKey: '', projectId: 'mon-projet' })).toBeNull();
    // Le faux serveur ne s’active qu’en mode debug, et chez soi.
    expect(cloudSetup('?cloud=http://127.0.0.1:5123', none)).toBeNull();
    expect(cloudSetup('?debug&cloud=https://pirate.example', none)).toBeNull();
  });

  it('le projet renseigné donne les adresses de Google ; un faux serveur local, des identifiants d’essai, jamais ceux du projet', () => {
    const config = { apiKey: 'AIza-cle', projectId: 'mon-projet' };
    expect(cloudSetup('', config)).toEqual({ config, endpoints: GOOGLE_ENDPOINTS, local: false });
    // Sans `debug`, ou hors de cette machine : on reste chez Google, jamais chez l’adresse donnée.
    expect(cloudSetup('?cloud=http://127.0.0.1:5123', config)?.local).toBe(false);
    expect(cloudSetup('?debug&cloud=https://pirate.example', config)).toEqual({ config, endpoints: GOOGLE_ENDPOINTS, local: false });
    const local = cloudSetup('?debug&cloud=http://127.0.0.1:5123', config);
    expect(local?.local).toBe(true);
    expect(local?.endpoints.firestore).toBe('http://127.0.0.1:5123/firestore/v1');
    expect(local?.config).toEqual(TEST_CONFIG);
    expect(JSON.stringify(local)).not.toContain('AIza-cle');
    expect(cloudSetup('?debug&cloud=http://127.0.0.1:5123', { apiKey: '', projectId: '' })?.config).toEqual(TEST_CONFIG);
    expect(GOOGLE_ENDPOINTS.identity).toMatch(/^https:\/\/identitytoolkit\.googleapis\.com\//);
  });
});

describe('compte : la sauvegarde dans le compte', () => {
  it('se compresse et se retrouve à l’identique', async () => {
    const raw = makeSave(7, 1234, 5678, 90);
    const data = await packSave(raw);
    expect(data.startsWith('z:')).toBe(true);
    expect(data.length).toBeLessThan(raw.length * 0.7);
    expect(await unpackSave(data)).toBe(raw);
  });

  it('lit aussi une sauvegarde non compressée, et refuse un format inconnu', async () => {
    const raw = '{"accents":"éè à"}';
    const p = `p:${btoa(String.fromCharCode(...new TextEncoder().encode(raw)))}`;
    expect(await unpackSave(p)).toBe(raw);
    await expect(unpackSave('x:abc')).rejects.toThrow();
    await expect(unpackSave('abc')).rejects.toThrow();
  });
});

describe('compte : appareil', () => {
  it('nomme le genre d’appareil', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148 Safari/604.1')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome Mobile Safari')).toBe('téléphone Android');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit Chrome Safari')).toBe('tablette Android');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome')).toBe('Windows');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64) Firefox')).toBe('Linux');
    expect(deviceName('')).toBe('un appareil');
  });
});

describe('compte : ce que l’appareil garde', () => {
  it('les emplacements du compte sont ceux de la sauvegarde du jeu', () => {
    const kv = new MemoryStorage();
    vi.stubGlobal('localStorage', kv);
    // Ce que le jeu écrit, le compte le lit…
    expect(saveToBrowser(new GameState(5))).toBe(true);
    expect(kv.getItem(SLOT_KEY)).not.toBeNull();
    expect(browserSaves(kv).read()).toBe(kv.getItem(SLOT_KEY));
    // …et ce que le compte écrit, le jeu le charge.
    const mine = makeSave(9, 777, 1, 2);
    expect(browserSaves(kv).write(mine)).toBe(true);
    expect(loadFromBrowser()?.seed).toBe(9);
    expect(ASIDE_KEY).not.toBe(SLOT_KEY);
  });

  it('retient la session et le dernier échange, par compte', () => {
    const kv = new MemoryStorage();
    const store = new CloudStore(kv);
    expect(store.session()).toBeNull();
    store.setSession({ uid: 'u1', email: 'a@b.fr', idToken: 'id', refreshToken: 're', expiresAt: 123 });
    expect(new CloudStore(kv).session()).toEqual({ uid: 'u1', email: 'a@b.fr', idToken: 'id', refreshToken: 're', expiresAt: 123 });
    store.setMemory({ uid: 'u1', link: { rev: 'r1', seed: 1, time: 50, at: 1000 }, sent: { seed: 1, time: 60 } });
    expect(store.memory('u1')).toEqual({ uid: 'u1', link: { rev: 'r1', seed: 1, time: 50, at: 1000 }, sent: { seed: 1, time: 60 } });
    expect(store.memory('u2')).toEqual({ uid: 'u2', link: null, sent: null });
    store.setSession(null);
    store.setMemory(null);
    expect(store.session()).toBeNull();
    expect(store.memory('u1').link).toBeNull();
  });

  it('un stockage abîmé ou interdit ne casse rien', () => {
    const kv = new MemoryStorage();
    kv.setItem('empire-miner.account', 'pas du json');
    kv.setItem('empire-miner.cloud', '{"uid":"u1","link":{"rev":3}}');
    const store = new CloudStore(kv);
    expect(store.session()).toBeNull();
    expect(store.memory('u1').link).toBeNull();
    const none = new CloudStore(null);
    none.setSession({ uid: 'u', email: 'e', idToken: '', refreshToken: 'r', expiresAt: 0 });
    expect(none.session()).toBeNull();
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => undefined,
    };
    expect(new CloudStore(refusing).session()).toBeNull();
    const saves = browserSaves(refusing);
    expect(saves.read()).toBeNull();
    expect(saves.write('x')).toBe(false);
    expect(() => saves.writeAside('x')).not.toThrow();
    expect(browserSaves(null).write('x')).toBe(false);
  });
});

interface Opts {
  view?: Partial<SyncView>;
  form?: AccountModel['form'];
  canTakeAside?: boolean;
}
const model = (over: Opts = {}): AccountModel => ({
  view: { account: null, phase: 'idle', error: null, cloud: null, syncedAt: 0, ask: null, aside: null, ...over.view },
  form: over.form ?? emptyForm(),
  canTakeAside: over.canTakeAside ?? true,
});
const brief = (time: number, over = {}) => ({ seed: 1, time, money: 12345, depth: 87.6, savedAt: '2026-10-12T09:30:00.000Z', ...over });
const signedIn = { uid: 'u1', email: 'ami@exemple.fr' };

describe('compte : l’écran', () => {
  it('déconnecté : le formulaire, sans rien qui ressemble à une session', () => {
    const html = accountHtml(model());
    expect(html).toContain('id="acct-email"');
    expect(html).toContain('id="acct-pass"');
    for (const a of ['accountIn', 'accountUp', 'accountReset', 'accountBack']) expect(html).toContain(`data-action="${a}"`);
    expect(html).not.toContain('accountOut');
    expect(html).toContain('type="password"');
    expect(html).toContain('type="email"');
  });

  it('ce qui est tapé ou renvoyé par le serveur est échappé', () => {
    const html = accountHtml(model({ form: { ...emptyForm(), email: '"><img src=x onerror=alert(1)>', error: '<b>Oups</b>', info: '<i>ok</i>' } }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Oups');
    expect(html).not.toContain('<i>ok');
    expect(html).toContain('&lt;b&gt;Oups');
  });

  it('en attente : les boutons sont désactivés et un sablier tourne', () => {
    const html = accountHtml(model({ form: { ...emptyForm(), busy: true } }));
    expect(html).toContain('net-spinner');
    expect(html.match(/ disabled/g)?.length).toBe(3);
  });

  it('connecté : l’adresse, la partie du compte, l’état, et de quoi se déconnecter ou supprimer', () => {
    const html = accountHtml(model({ view: { account: signedIn, cloud: { ...brief(3725), rev: 'r', device: 'iPhone' }, syncedAt: new Date('2026-10-12T09:45:00').getTime() } }));
    expect(html).toContain('ami@exemple.fr');
    expect(html).toMatch(/12\s345/);
    expect(html).toContain('profondeur 87 m');
    expect(html).toContain('1 h 02');
    expect(html).toContain('depuis iPhone');
    expect(html).toContain('À jour · 09:45');
    for (const a of ['accountSync', 'accountOut', 'accountDelete', 'accountBack']) expect(html).toContain(`data-action="${a}"`);
    expect(html).not.toContain('id="acct-pass"');
  });

  it('connecté sans partie sur le compte', () => {
    expect(accountHtml(model({ view: { account: signedIn } }))).toContain('Pas encore de partie sur le compte');
  });

  it('dit les pannes avec leurs mots, et le détail pour qui doit le transmettre', () => {
    const offline = stateLine(model({ view: { account: signedIn, phase: 'offline', error: new CloudError('network') } }).view);
    expect(offline.tone).toBe('warn');
    expect(offline.text).toMatch(/Pas de connexion/);
    const denied = model({ view: { account: signedIn, phase: 'error', error: new CloudError('denied', '403 PERMISSION_DENIED Missing or insufficient permissions.') } });
    expect(stateLine(denied.view).tone).toBe('bad');
    const html = accountHtml(denied);
    expect(html).toContain('refusé l’accès');
    expect(html).toContain('Détail : denied : 403 PERMISSION_DENIED');
    // Le détail vient du serveur : il est montré tel quel, mais jamais comme du HTML.
    const hostile = accountHtml(model({ view: { account: signedIn, phase: 'error', error: new CloudError('server', '<img src=x onerror=alert(1)>') } }));
    expect(hostile).not.toContain('<img');
    expect(hostile).toContain('&lt;img');
    expect(stateLine(model({ view: { account: signedIn, phase: 'busy' } }).view).text).toBe('Synchronisation…');
    expect(stateLine(model({ view: { account: signedIn } }).view).text).toBe('Pas encore synchronisé.');
  });

  it('la partie mise de côté se reprend au menu principal, pas en cours de partie', () => {
    const view = { account: signedIn, aside: brief(900, { money: 42 }) };
    const menu = accountHtml(model({ view, canTakeAside: true }));
    expect(menu).toContain('Partie mise de côté');
    expect(menu).toContain('data-action="accountAside"');
    const playing = accountHtml(model({ view, canTakeAside: false }));
    expect(playing).not.toContain('data-action="accountAside"');
    expect(playing).toContain('revenez au menu principal');
    expect(accountHtml(model({ view: { account: signedIn } }))).not.toContain('Partie mise de côté');
  });

  it('deux parties : les deux sont montrées, la plus avancée est dite, et on choisit', () => {
    const ask: Ask = { why: 'diverged', cloud: { ...brief(7200), rev: 'r', device: 'Windows' }, local: brief(3600, { money: 99 }) };
    const html = accountHtml(model({ view: { account: signedIn, ask } }));
    expect(html).toContain('Quelle partie garder');
    expect(html).toContain('Sur le compte');
    expect(html).toContain('Sur cet appareil');
    expect(html).toContain('depuis Windows');
    expect(html.match(/la plus avancée/g)).toHaveLength(1);
    expect(html.indexOf('la plus avancée')).toBeLessThan(html.indexOf('Sur cet appareil'));
    expect(html).toContain('data-action="accountKeep" data-arg="cloud"');
    expect(html).toContain('data-action="accountKeep" data-arg="local"');
    expect(html).toContain('ont avancé');
    // Deux parties qui ne sont pas la même : aucune n’est « plus avancée ».
    const other = accountHtml(model({ view: { account: signedIn, ask: { ...ask, local: brief(9999, { seed: 2 }) } } }));
    expect(other).not.toContain('la plus avancée');
    expect(accountHtml(model({ view: { account: signedIn, ask: { ...ask, why: 'first' } } }))).toContain('déjà une partie');
    expect(accountHtml(model({ view: { account: signedIn, ask: { ...ask, why: 'newer' } } }))).toContain('plus récente');
  });

  it('supprimer le compte : le mot de passe est redemandé', () => {
    const html = accountHtml(model({ view: { account: signedIn }, form: { ...emptyForm(), confirmDelete: true, error: 'E-mail ou mot de passe incorrect.' } }));
    expect(html).toContain('id="acct-del"');
    expect(html).toContain('data-action="accountDeleteYes"');
    expect(html).toContain('data-action="accountDeleteNo"');
    expect(html).toContain('incorrect');
  });

  it('une date illisible ne casse pas l’écran', () => {
    expect(when('')).toBe('');
    expect(when('pas une date')).toBe('');
    expect(when('2026-10-12T09:30:00.000Z')).toMatch(/^12\/10\/2026 \d\d:\d\d$/);
    const html = accountHtml(model({ view: { account: signedIn, cloud: { ...brief(10, { savedAt: '???' }), rev: 'r', device: '' } } }));
    expect(html).toContain('Date inconnue');
  });
});
