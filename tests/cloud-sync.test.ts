import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { briefOf } from '../src/cloud/brief';
import { packSave } from '../src/cloud/pack';
import { Device, makeDevice, makeSave } from './support/cloudKit';
import { FakeFirebase } from './support/fakeFirebase';

const MAIL = 'ami@exemple.fr';
const PASS = 'secret1';

/** Deux appareils qui partagent un compte, déjà d'accord sur la partie `seed`, au temps `time`. */
async function synced(fake: FakeFirebase, seed = 1, time = 100, opts: Parameters<typeof makeDevice>[1] = {}): Promise<{ a: Device; b: Device; uid: string }> {
  const a = makeDevice(fake, opts);
  const b = makeDevice(fake, opts);
  a.saves.write(makeSave(seed, time, 500, 20));
  await a.sync.signUp(MAIL, PASS);
  await b.sync.signIn(MAIL, PASS);
  return { a, b, uid: a.sync.view.account!.uid };
}

/** Une sauvegarde de l'appareil qui avance, sans que la synchronisation le sache (jeu hors ligne, onglet en veille…). */
const advance = (d: Device, seed: number, time: number, money = 600) => d.saves.write(makeSave(seed, time, money, 25));

/** Du texte qui ne se compresse pas. */
function noise(n: number): string {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(n, i + 65536)));
  let bin = '';
  for (let i = 0; i < n; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Laisse l'emballage (flux de compression) se terminer. */
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.useRealTimers());

describe('compte : synchronisation', () => {
  describe('un seul appareil', () => {
    it('crée le compte et y envoie la partie de l’appareil', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100, 500, 20));
      await a.sync.signUp(MAIL, PASS);
      const v = a.sync.view;
      expect(v.account?.email).toBe(MAIL);
      expect(v.phase).toBe('idle');
      expect(v.error).toBeNull();
      expect(v.cloud).toMatchObject({ seed: 1, time: 100, money: 500, depth: 20 });
      const doc = fake.doc(v.account!.uid)!;
      expect(doc.fields.seed).toEqual({ integerValue: '1' });
      // L’envoi d’un compte vide précise qu’il ne doit rien y avoir.
      expect(fake.log.filter((l) => l.startsWith('PATCH'))).toHaveLength(1);
    });

    it('sans partie sur l’appareil ni sur le compte : rien à faire', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      await a.sync.signUp(MAIL, PASS);
      expect(a.sync.view.phase).toBe('idle');
      expect(fake.log.some((l) => l.startsWith('PATCH'))).toBe(false);
      expect(a.events.pulled).toBe(0);
    });

    it('garde la session d’une visite à l’autre (rechargement de la page)', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      const again = makeDevice(fake, { kv: a.kv });
      expect(again.sync.signedIn).toBe(true);
      expect(again.sync.view.account?.email).toBe(MAIL);
      fake.log.length = 0;
      await again.sync.boot();
      // Rien n’a changé : une lecture du résumé, c’est tout.
      expect(fake.log).toEqual([`GET saves/${a.sync.view.account!.uid}`]);
      expect(again.sync.view.phase).toBe('idle');
    });

    it('se déconnecter garde la partie ; se reconnecter ne demande rien et envoie ce qui a avancé entre-temps', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      a.sync.signOut();
      expect(a.sync.signedIn).toBe(false);
      expect(a.store.session()).toBeNull();
      expect(briefOf(a.saves.read()!)?.time).toBe(100);
      advance(a, 1, 300);
      await a.sync.signIn(MAIL, PASS);
      expect(a.sync.view.ask).toBeNull();
      expect(fake.doc(a.sync.view.account!.uid)!.fields.time).toEqual({ doubleValue: 300 });
    });

    it('un autre compte sur le même appareil : on ne confond pas les souvenirs', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      a.sync.signOut();
      // Le compte d’un autre joueur est vide : la partie de l’appareil y est proposée telle quelle, sans écraser le premier.
      await a.sync.signUp('autre@exemple.fr', PASS);
      expect(fake.docs.size).toBe(2);
      expect(a.sync.view.ask).toBeNull();
    });
  });

  describe('deux appareils', () => {
    it('un appareil neuf qui se connecte reprend la partie du compte', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      const raw = makeSave(1, 100, 500, 20);
      a.saves.write(raw);
      await a.sync.signUp(MAIL, PASS);
      const b = makeDevice(fake);
      await b.sync.signIn(MAIL, PASS);
      expect(b.saves.read()).toBe(raw);
      expect(b.events.pulled).toBe(1);
      expect(b.sync.view.ask).toBeNull();
      expect(b.sync.view.cloud).toMatchObject({ seed: 1, time: 100 });
    });

    it('la partie avance sur un appareil, l’autre la reprend sans rien demander (l’autre n’a pas bougé)', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const next = makeSave(1, 400, 900, 30);
      a.saves.write(next);
      a.sync.localSaved();
      await vi.advanceTimersByTimeAsync(10);
      await a.sync.idle();
      vi.useRealTimers();
      await b.sync.sync();
      expect(b.saves.read()).toBe(next);
      expect(b.sync.view.ask).toBeNull();
      expect(b.events.pulled).toBe(2);
    });

    it('un envoi après une sauvegarde tient en une seule requête', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fake.log.length = 0;
      a.saves.write(makeSave(1, 150, 520, 21));
      a.sync.localSaved();
      await vi.advanceTimersByTimeAsync(10);
      await a.sync.idle();
      expect(fake.log).toEqual([`PATCH saves/${uid}`]);
      expect(a.sync.view.cloud?.time).toBe(150);
    });

    it('plusieurs sauvegardes de suite ne font qu’un envoi, de la dernière', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fake.log.length = 0;
      for (const t of [110, 120, 130]) {
        a.saves.write(makeSave(1, t));
        a.sync.localSaved();
      }
      await vi.advanceTimersByTimeAsync(10);
      await a.sync.idle();
      expect(fake.log).toEqual([`PATCH saves/${uid}`]);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 130 });
    });

    it('les deux ont avancé chacun de leur côté : le joueur choisit, rien n’est écrasé avant', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      // A envoie sa partie plus avancée (t = 200) ; B a joué de son côté sans envoyer (t = 150).
      advance(a, 1, 200, 800);
      await a.sync.sync();
      const mine = makeSave(1, 150, 700, 22);
      b.saves.write(mine);
      await b.sync.sync();
      const ask = b.sync.view.ask;
      expect(ask?.why).toBe('diverged');
      expect(ask?.cloud.time).toBe(200);
      expect(ask?.local.time).toBe(150);
      expect(b.saves.read()).toBe(mine);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
      expect(b.sync.view.phase).toBe('idle');
      // Tant que la question est posée, une nouvelle sauvegarde n’envoie rien.
      fake.log.length = 0;
      advance(b, 1, 160);
      await b.sync.sync();
      expect(fake.log.filter((l) => l.startsWith('PATCH'))).toEqual([]);
      expect(b.sync.view.ask?.local.time).toBe(160);
    });

    it('choisir la partie du compte : elle remplace celle de l’appareil, qui est mise de côté', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake);
      advance(a, 1, 200, 800);
      await a.sync.sync();
      const cloudRaw = a.saves.read()!;
      const mine = makeSave(1, 150, 700, 22);
      b.saves.write(mine);
      await b.sync.sync();
      await b.sync.resolve('cloud');
      expect(b.saves.read()).toBe(cloudRaw);
      expect(b.saves.readAside()).toBe(mine);
      expect(b.sync.view.aside?.time).toBe(150);
      expect(b.sync.view.ask).toBeNull();
      expect(b.events.pulled).toBe(2);
      // A n’a pas bougé depuis : rien à faire. B non plus.
      fake.log.length = 0;
      await a.sync.sync();
      await b.sync.sync();
      expect(fake.log.filter((l) => !l.startsWith('GET'))).toEqual([]);
    });

    it('choisir la partie de l’appareil : elle remplace celle du compte, qui est mise de côté', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      advance(a, 1, 200, 800);
      await a.sync.sync();
      const cloudRaw = a.saves.read()!;
      const mine = makeSave(1, 150, 700, 22);
      b.saves.write(mine);
      await b.sync.sync();
      await b.sync.resolve('local');
      expect(b.saves.read()).toBe(mine);
      expect(b.sync.view.ask).toBeNull();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 150 });
      // La partie du compte d’avant n’est pas perdue : elle est mise de côté, telle quelle.
      expect(b.saves.readAside()).toBe(cloudRaw);
      // A, qui n’avait pas bougé, reprend celle de B.
      await a.sync.sync();
      expect(briefOf(a.saves.read()!)?.time).toBe(150);
    });

    it('un appareil qui a déjà une autre partie et se connecte pour la première fois : on demande', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 9000, 99999, 300));
      await a.sync.signUp(MAIL, PASS);
      const b = makeDevice(fake);
      const own = makeSave(2, 40, 10, 5);
      b.saves.write(own);
      await b.sync.signIn(MAIL, PASS);
      expect(b.sync.view.ask?.why).toBe('first');
      expect(b.saves.read()).toBe(own);
      expect(b.events.pulled).toBe(0);
      expect(fake.doc(a.sync.view.account!.uid)!.fields.seed).toEqual({ integerValue: '1' });
      await b.sync.resolve('cloud');
      expect(briefOf(b.saves.read()!)).toMatchObject({ seed: 1, time: 9000 });
      expect(briefOf(b.saves.readAside()!)).toMatchObject({ seed: 2, time: 40 });
    });

    it('la même partie des deux côtés (exportée puis importée) : on se met d’accord sans rien transférer', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      const raw = makeSave(1, 500, 100, 10);
      a.saves.write(raw);
      await a.sync.signUp(MAIL, PASS);
      const b = makeDevice(fake);
      b.saves.write(raw);
      fake.log.length = 0;
      await b.sync.signIn(MAIL, PASS);
      expect(b.sync.view.ask).toBeNull();
      expect(b.events.pulled).toBe(0);
      expect(fake.log.filter((l) => l.startsWith('PATCH'))).toEqual([]);
      // Et ça marche ensuite : B avance, A suit.
      advance(b, 1, 600);
      await b.sync.sync();
      await a.sync.sync();
      expect(briefOf(a.saves.read()!)?.time).toBe(600);
    });

    it('pendant qu’on joue, une partie plus récente du compte est signalée mais ne remplace rien', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake);
      advance(a, 1, 400, 900);
      await a.sync.sync();
      const mine = b.saves.read()!;
      b.events.playing = true;
      await b.sync.sync();
      expect(b.sync.view.ask?.why).toBe('newer');
      expect(b.saves.read()).toBe(mine);
      expect(b.events.pulled).toBe(1);
      expect(b.events.notices).toHaveLength(1);
      // Un second tour ne répète pas l’avis.
      await b.sync.sync();
      expect(b.events.notices).toHaveLength(1);
      // Le joueur accepte : la partie du compte est écrite (et le jeu la recharge).
      await b.sync.resolve('cloud');
      expect(briefOf(b.saves.read()!)?.time).toBe(400);
      expect(b.events.pulled).toBe(2);
      expect(b.saves.readAside()).toBe(mine);
    });

    describe('une autre partie arrive sur le compte (nouvelle partie ou import sur un autre appareil)', () => {
      /** A et B ont la même partie ; A en démarre une autre (graine 9) qui prend la place de la première sur le compte. */
      async function replacedByA() {
        const fake = new FakeFirebase();
        const { a, b, uid } = await synced(fake);
        const mine = b.saves.read()!;
        a.saves.write(makeSave(9, 5, 0, 0));
        await a.sync.sync();
        expect(fake.doc(uid)!.fields.seed).toEqual({ integerValue: '9' });
        return { fake, a, b, uid, mine };
      }

      it('B n’a pas bougé, mais ce n’est pas la suite de sa partie : il demande au lieu de la remplacer', async () => {
        const { b, mine } = await replacedByA();
        const pulled = b.events.pulled;
        await b.sync.sync();
        expect(b.sync.view.ask).toMatchObject({ why: 'replaced', cloud: { seed: 9 }, local: { seed: 1 } });
        expect(b.saves.read()).toBe(mine);
        expect(b.saves.readAside()).toBeNull();
        expect(b.events.pulled).toBe(pulled);
      });

      it('B garde celle du compte : la sienne est mise de côté, telle quelle', async () => {
        const { b, mine } = await replacedByA();
        await b.sync.sync();
        await b.sync.resolve('cloud');
        expect(briefOf(b.saves.read()!)).toMatchObject({ seed: 9, time: 5 });
        expect(b.saves.readAside()).toBe(mine);
        expect(b.sync.view.ask).toBeNull();
      });

      it('B garde la sienne : elle reprend la place sur le compte, et la nouvelle partie de A est mise de côté', async () => {
        const { fake, a, b, uid, mine } = await replacedByA();
        const theirs = a.saves.read()!;
        await b.sync.sync();
        await b.sync.resolve('local');
        expect(b.saves.read()).toBe(mine);
        expect(b.saves.readAside()).toBe(theirs);
        expect(fake.doc(uid)!.fields.seed).toEqual({ integerValue: '1' });
        // A, qui n'a pas bougé depuis, demande à son tour (sa partie n'est plus celle du compte) au lieu de perdre la sienne.
        await a.sync.sync();
        expect(a.sync.view.ask?.why).toBe('replaced');
        expect(a.saves.read()).toBe(theirs);
      });

      it('en jeu : signalé comme les autres questions, sans rien remplacer', async () => {
        const { b, mine } = await replacedByA();
        b.events.playing = true;
        await b.sync.sync();
        expect(b.sync.view.ask?.why).toBe('replaced');
        expect(b.saves.read()).toBe(mine);
        expect(b.events.notices).toHaveLength(1);
        await b.sync.sync();
        expect(b.events.notices).toHaveLength(1);
      });

      it('un appareil sans partie prend celle du compte sans rien demander', async () => {
        const { fake } = await replacedByA();
        const c = makeDevice(fake);
        await c.sync.signIn(MAIL, PASS);
        expect(c.sync.view.ask).toBeNull();
        expect(briefOf(c.saves.read()!)).toMatchObject({ seed: 9 });
      });
    });

    it('un autre appareil écrit entre notre lecture et notre envoi : refusé, rien n’est écrasé, on redemande', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      advance(a, 1, 200, 800);
      advance(b, 1, 180, 700);
      // B écrit juste après la lecture de A : on glisse l’écriture de B entre la lecture et l’envoi de A.
      let raced = false;
      const racing = makeDevice(fake, {
        kv: a.kv,
        fetch: async (input, init) => {
          const res = await fake.fetch(input, init);
          if (!raced && init?.method === 'GET') {
            raced = true;
            await b.sync.sync();
          }
          return res;
        },
      });
      await racing.sync.sync();
      expect(raced).toBe(true);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 180 });
      // A n’avait pas bougé depuis son dernier échange, mais l’appareil a avancé aussi : on demande.
      expect(racing.sync.view.ask?.why).toBe('diverged');
      expect(racing.sync.view.ask?.cloud.time).toBe(180);
    });

    it('trois refus de suite : l’échec est dit, sans question ni écrasement', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      advance(a, 1, 200);
      fake.inject(/^PATCH/, 400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'does not match the required base version' } }, 3);
      await a.sync.sync();
      expect(a.sync.view.error?.code).toBe('conflict');
      expect(a.sync.view.ask).toBeNull();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 100 });
      // Et le tour suivant réussit.
      await a.sync.sync();
      expect(a.sync.view.error).toBeNull();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
    });
  });

  describe('changer d’appareil', () => {
    it('la dernière sauvegarde d’une page fermée n’est pas un travail à part : A rouvre, reprend la partie de B, sans question', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake, 1, 100, { drift: 90000 });
      // A se sauvegarde une dernière fois en se fermant, quelques secondes de jeu après son dernier envoi.
      advance(a, 1, 112);
      // B joue et envoie.
      advance(b, 1, 400, 900);
      await b.sync.sync();
      // A rouvre sa page.
      const reopened = makeDevice(fake, { kv: a.kv, drift: 90000 });
      await reopened.sync.boot();
      expect(reopened.sync.view.ask).toBeNull();
      expect(briefOf(reopened.saves.read()!)?.time).toBe(400);
      expect(reopened.events.pulled).toBe(1);
    });

    it('en cours de partie, le même cas est signalé, jamais remplacé en silence', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake, 1, 100, { drift: 90000 });
      advance(a, 1, 112);
      advance(b, 1, 400, 900);
      await b.sync.sync();
      const mine = a.saves.read();
      a.events.playing = true;
      await a.sync.sync();
      expect(a.sync.view.ask?.why).toBe('newer');
      expect(a.saves.read()).toBe(mine);
    });

    it('plus d’une minute et demie de jeu sans échange : c’est un vrai travail, on demande', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake, 1, 100, { drift: 90000 });
      advance(a, 1, 112);
      const mem = a.store.memory(uid);
      a.store.setMemory({ ...mem, link: { ...mem.link!, at: mem.link!.at - 200000 } });
      advance(b, 1, 400, 900);
      await b.sync.sync();
      await a.sync.sync();
      expect(a.sync.view.ask?.why).toBe('diverged');
    });
  });

  describe('l’envoi direct', () => {
    it('refusé parce qu’un autre appareil a écrit : on refait le tour complet, on demande, rien n’est écrasé', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // B écrit dans le compte ; A ne le sait pas et se sauvegarde : son envoi direct porte une révision périmée.
      advance(b, 1, 180, 700);
      await b.sync.sync();
      advance(a, 1, 200, 800);
      fake.log.length = 0;
      a.sync.localSaved();
      await vi.advanceTimersByTimeAsync(10);
      await a.sync.idle();
      expect(fake.log).toEqual([`PATCH saves/${uid}`, `GET saves/${uid}`]);
      expect(a.sync.view.ask?.why).toBe('diverged');
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 180 });
    });
  });

  describe('pannes', () => {
    it('sans réseau, la partie reste sur l’appareil et part dès que le réseau revient', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fake.down = true;
      const next = makeSave(1, 300, 700, 28);
      a.saves.write(next);
      a.sync.localSaved();
      await vi.advanceTimersByTimeAsync(10);
      await a.sync.idle();
      expect(a.sync.view.phase).toBe('offline');
      expect(a.sync.view.error?.code).toBe('network');
      expect(a.saves.read()).toBe(next);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 100 });
      // Le réseau revient : le nouvel essai programmé envoie la partie.
      fake.down = false;
      await vi.advanceTimersByTimeAsync(1100);
      await a.sync.idle();
      expect(a.sync.view.phase).toBe('idle');
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 300 });
    });

    it('le serveur répond mal : on le dit et on réessaie plus tard', async () => {
      const fake = new FakeFirebase();
      const { a } = await synced(fake);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fake.inject(/^GET/, 503, { error: { code: 503, status: 'UNAVAILABLE', message: 'indisponible' } });
      await a.sync.sync();
      expect(a.sync.view.phase).toBe('error');
      expect(a.sync.view.error?.code).toBe('server');
      await vi.advanceTimersByTimeAsync(1100);
      await a.sync.idle();
      expect(a.sync.view.phase).toBe('idle');
      warn.mockRestore();
    });

    it('le jeton refusé par le serveur est renouvelé tout seul', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      fake.expireTokens();
      fake.log.length = 0;
      advance(a, 1, 250);
      await a.sync.sync();
      expect(a.sync.view.error).toBeNull();
      expect(fake.log).toContain('POST token');
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 250 });
      expect(a.sync.signedIn).toBe(true);
    });

    it('un jeton qui va expirer est renouvelé avant de servir', async () => {
      const fake = new FakeFirebase();
      let clock = Date.now();
      fake.now = () => clock;
      const { a } = await synced(fake);
      clock += 3500 * 1000;
      fake.log.length = 0;
      await a.sync.sync();
      expect(fake.log[0]).toBe('POST token');
      expect(a.sync.view.error).toBeNull();
    });

    it('session terminée (mot de passe changé ailleurs) : déconnecté, avec un avis, la partie reste', async () => {
      const fake = new FakeFirebase();
      const { a } = await synced(fake);
      const mine = a.saves.read();
      fake.expireTokens();
      fake.inject(/^POST token/, 400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
      await a.sync.sync();
      expect(a.sync.signedIn).toBe(false);
      expect(a.store.session()).toBeNull();
      expect(a.events.notices.join(' ')).toMatch(/session a expiré/);
      expect(a.sync.view.error?.code).toBe('session');
      expect(a.saves.read()).toBe(mine);
    });

    it('une écriture appliquée dont la réponse s’est perdue n’est pas prise pour un autre appareil', async () => {
      const fake = new FakeFirebase();
      let lose = false;
      const a = makeDevice(fake, {
        fetch: async (input, init) => {
          const res = await fake.fetch(input, init);
          if (lose && init?.method === 'PATCH') {
            lose = false;
            throw new TypeError('Failed to fetch');
          }
          return res;
        },
      });
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      advance(a, 1, 200, 700);
      lose = true;
      await a.sync.sync();
      expect(a.sync.view.error?.code).toBe('network');
      const uid = a.sync.view.account!.uid;
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
      // Le tour suivant reconnaît son propre envoi : pas de question, pas de nouvel envoi.
      fake.log.length = 0;
      await a.sync.sync();
      expect(a.sync.view.ask).toBeNull();
      expect(a.sync.view.error).toBeNull();
      expect(fake.log.filter((l) => l.startsWith('PATCH'))).toEqual([]);
      // Et si l’appareil a encore avancé entretemps, c’est un envoi normal.
      advance(a, 1, 260);
      await a.sync.sync();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 260 });
    });

    it('la page se ferme : la dernière partie emballée part sans attendre, et se reconnaît ensuite', async () => {
      const fake = new FakeFirebase();
      // L’envoi ordinaire est loin (une minute) : c’est bien la fermeture de la page qui envoie.
      const { a, uid } = await synced(fake, 1, 100, { pushDelay: 60000, pushEvery: 60000 });
      const sent = makeSave(1, 200, 800, 24);
      a.saves.write(sent);
      a.sync.localSaved();
      await a.sync.idle();
      // L’appareil a encore avancé depuis (le dernier emballage a un peu de retard).
      advance(a, 1, 230, 850);
      fake.log.length = 0;
      a.sync.leaving();
      // La page change d’état plusieurs fois en se fermant (arrière-plan, puis fermeture) : un seul envoi.
      a.sync.leaving();
      for (let i = 0; i < 100 && fake.log.length === 0; i++) await settle(10);
      a.sync.leaving();
      await settle(20);
      expect(fake.log).toEqual([`PATCH saves/${uid}`]);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
      // À la prochaine ouverture : c’est notre envoi, la partie plus récente de l’appareil part ensuite, sans question.
      const reopened = makeDevice(fake, { kv: a.kv });
      await reopened.sync.boot();
      expect(reopened.sync.view.ask).toBeNull();
      expect(reopened.sync.view.error).toBeNull();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 230 });
      a.sync.signOut();
    });

    it('en quittant, une partie emballée plus ancienne que ce que le compte tient déjà n’est jamais renvoyée', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake, 1, 100, { pushDelay: 60000, pushEvery: 60000 });
      // La partie emballée est celle de t = 150 ; l’envoi ordinaire (qui emballe lui-même) porte ensuite t = 200.
      a.saves.write(makeSave(1, 150));
      a.sync.localSaved();
      await a.sync.idle();
      advance(a, 1, 200, 900);
      await a.sync.sync();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
      fake.log.length = 0;
      a.sync.leaving();
      await settle(10);
      expect(fake.log).toEqual([]);
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 200 });
      a.sync.signOut();
    });

    it('en quittant, rien ne part s’il n’y a rien de neuf, ni sans échange antérieur', async () => {
      const fake = new FakeFirebase();
      const { a } = await synced(fake, 1, 100, { pushDelay: 60000, pushEvery: 60000 });
      a.sync.localSaved();
      await a.sync.idle();
      fake.log.length = 0;
      a.sync.leaving();
      await settle(10);
      expect(fake.log).toEqual([]);
      const fresh = makeDevice(fake);
      fresh.saves.write(makeSave(5, 10));
      fresh.sync.leaving();
      expect(fake.log).toEqual([]);
      a.sync.signOut();
    });
  });

  describe('déconnexion pendant un échange', () => {
    it('la partie de l’appareil n’est pas remplacée si l’on s’est déconnecté pendant le téléchargement', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      const b = makeDevice(fake, {
        fetch: async (input, init) => {
          const res = await fake.fetch(input, init);
          // Le téléchargement de la partie (sans masque de champs) : on se déconnecte juste après.
          if (init?.method === 'GET' && !String(input).includes('mask.fieldPaths')) b.sync.signOut();
          return res;
        },
      });
      await b.sync.signIn(MAIL, PASS);
      expect(b.saves.read()).toBeNull();
      expect(b.events.pulled).toBe(0);
      expect(b.sync.signedIn).toBe(false);
    });
  });

  describe('une partie du compte que cette version ne lit pas', () => {
    async function tamper(fake: FakeFirebase, uid: string): Promise<void> {
      // Une version plus récente du jeu a écrit cette partie : son résumé et son texte disent la même chose (t = 500).
      const d = JSON.parse(makeSave(1, 500));
      d.version = 999;
      fake.doc(uid)!.fields.data = { stringValue: await packSave(JSON.stringify(d)) };
      fake.doc(uid)!.fields.time = { doubleValue: 500 };
    }

    it('n’est jamais écrite à la place d’une partie lisible', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      await tamper(fake, uid);
      fake.doc(uid)!.updateTime = '2026-01-01T00:00:00.999999Z';
      const mine = b.saves.read();
      await b.sync.sync();
      expect(b.sync.view.error?.code).toBe('unreadable');
      expect(b.saves.read()).toBe(mine);
      expect(a.sync.signedIn).toBe(true);
    });

    it('et on ne l’écrase pas non plus en gardant « celle de l’appareil »', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      advance(a, 1, 200);
      await a.sync.sync();
      advance(b, 1, 150);
      await b.sync.sync();
      expect(b.sync.view.ask?.why).toBe('diverged');
      await tamper(fake, uid);
      const before = JSON.stringify(fake.doc(uid)!.fields.data);
      await b.sync.resolve('local');
      expect(b.sync.view.error?.code).toBe('unreadable');
      expect(JSON.stringify(fake.doc(uid)!.fields.data)).toBe(before);
    });
  });

  describe('une sauvegarde trop grosse pour le compte', () => {
    it('n’est pas envoyée (les règles la refuseraient) : l’échec est dit, la partie reste sur l’appareil', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      const d = JSON.parse(makeSave(1, 100));
      // Du bruit incompressible : l’emballage ne la fait pas tenir.
      d.bruit = noise(700000);
      const raw = JSON.stringify(d);
      a.saves.write(raw);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await a.sync.signUp(MAIL, PASS);
      expect(a.sync.view.error?.code).toBe('too-big');
      expect(fake.docs.size).toBe(0);
      expect(fake.log.some((l) => l.startsWith('PATCH'))).toBe(false);
      expect(a.saves.read()).toBe(raw);
      warn.mockRestore();
    });
  });

  describe('le navigateur', () => {
    it('plein : la partie du compte n’est pas écrite, rien d’autre ne bouge', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      a.saves.write(makeSave(1, 100));
      await a.sync.signUp(MAIL, PASS);
      const b = makeDevice(fake);
      b.kv.quota = 10;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await b.sync.signIn(MAIL, PASS);
      expect(b.sync.view.error?.code).toBe('storage');
      expect(b.saves.read()).toBeNull();
      warn.mockRestore();
    });

    it('assez de place pour la partie du compte mais pas pour mettre l’autre de côté : on ne remplace rien', async () => {
      const fake = new FakeFirebase();
      const { a, b } = await synced(fake);
      advance(a, 1, 200);
      await a.sync.sync();
      const cloudRaw = a.saves.read()!;
      const mine = makeSave(1, 150);
      b.saves.write(mine);
      await b.sync.sync();
      expect(b.sync.view.ask).not.toBeNull();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // De quoi remplacer la partie de l’appareil par celle du compte, pas de quoi garder les deux.
      const used = [...b.kv.map.values()].reduce((n, v) => n + v.length, 0);
      b.kv.quota = used - mine.length + cloudRaw.length + 10;
      await b.sync.resolve('cloud');
      expect(b.sync.view.error?.code).toBe('storage');
      expect(b.saves.read()).toBe(mine);
      expect(b.saves.readAside()).toBeNull();
      warn.mockRestore();
    });
  });

  describe('la partie mise de côté', () => {
    it('se reprend en échangeant les deux places, et le compte suit', async () => {
      const fake = new FakeFirebase();
      const { a, b, uid } = await synced(fake);
      advance(a, 1, 200, 800);
      await a.sync.sync();
      const cloudRaw = a.saves.read()!;
      const mine = makeSave(1, 150, 700, 22);
      b.saves.write(mine);
      await b.sync.sync();
      await b.sync.resolve('cloud');
      expect(b.saves.readAside()).toBe(mine);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const taken = b.sync.takeAside();
      expect(taken).toBe(mine);
      expect(b.saves.read()).toBe(mine);
      expect(b.saves.readAside()).toBe(cloudRaw);
      // Le compte suit ce que le joueur a repris (le compte n’avait pas bougé depuis).
      await vi.advanceTimersByTimeAsync(10);
      await b.sync.idle();
      expect(fake.doc(uid)!.fields.time).toEqual({ doubleValue: 150 });
      expect(b.sync.view.ask).toBeNull();
    });

    it('rien de côté : rien à reprendre', async () => {
      const fake = new FakeFirebase();
      const { b } = await synced(fake);
      expect(b.sync.takeAside()).toBeNull();
    });
  });

  describe('gérer le compte', () => {
    it('supprimer le compte efface la partie en ligne et garde celle de l’appareil, après avoir redemandé le mot de passe', async () => {
      const fake = new FakeFirebase();
      const { a, uid } = await synced(fake);
      const mine = a.saves.read();
      await expect(a.sync.deleteAccount('mauvais!')).rejects.toMatchObject({ code: 'bad-credentials' });
      expect(a.sync.signedIn).toBe(true);
      expect(fake.doc(uid)).toBeDefined();
      await a.sync.deleteAccount(PASS);
      expect(fake.doc(uid)).toBeUndefined();
      expect(fake.users.size).toBe(0);
      expect(a.sync.signedIn).toBe(false);
      expect(a.saves.read()).toBe(mine);
      await expect(a.sync.signIn(MAIL, PASS)).rejects.toMatchObject({ code: 'bad-credentials' });
    });

    it('mot de passe oublié', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      await a.sync.signUp(MAIL, PASS);
      await a.sync.resetPassword(MAIL);
      expect(fake.mails).toEqual([MAIL]);
      await expect(a.sync.resetPassword('pas-un-mail')).rejects.toMatchObject({ code: 'invalid-email' });
    });

    it('se connecter avec un mauvais mot de passe laisse déconnecté', async () => {
      const fake = new FakeFirebase();
      const a = makeDevice(fake);
      await a.sync.signUp(MAIL, PASS);
      a.sync.signOut();
      await expect(a.sync.signIn(MAIL, 'mauvais!')).rejects.toMatchObject({ code: 'bad-credentials' });
      expect(a.sync.signedIn).toBe(false);
    });
  });
});

beforeEach(() => vi.useRealTimers());
