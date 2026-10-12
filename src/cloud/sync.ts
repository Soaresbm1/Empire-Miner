/**
 * La synchronisation entre la partie de cet appareil et celle du compte.
 *
 * Règle d'or : on n'écrase jamais une partie sans que le joueur l'ait voulu. Les cas sûrs se règlent seuls (reconcile.ts) ;
 * quand deux parties ont avancé chacune de leur côté, c'est le joueur qui choisit, et celle qu'il ne garde pas est mise de côté
 * (elle reste dans « Compte »). Les écritures dans le compte portent la révision qu'elles croient remplacer : si un autre
 * appareil a écrit entre-temps, le serveur refuse et rien n'est perdu.
 *
 * Tout passe par une seule file d'attente (une opération à la fois). Une panne de réseau ne gêne jamais le jeu : la partie reste
 * sur l'appareil et part dès que possible.
 */
import { briefOf, type Brief } from './brief';
import { CloudError, type CloudBrief, type CloudClient, type CloudDoc, type Tokens } from './client';
import { deviceName } from './device';
import { packSave, unpackSave } from './pack';
import { DRIFT_MS, recognizeOwn, reconcile } from './reconcile';
import type { CloudStore, LocalSaves } from './store';

/** Deux parties différentes : c'est au joueur de dire laquelle garder. */
export interface Ask {
  /**
   * first : cet appareil n'avait jamais parlé à ce compte et a déjà une autre partie ·
   * diverged : les deux ont avancé de leur côté depuis leur dernier échange ·
   * newer : le compte a une partie plus récente, venue d'un autre appareil, pendant que l'on jouait.
   */
  why: 'first' | 'diverged' | 'newer';
  cloud: CloudBrief;
  local: Brief;
}

export type SyncPhase = 'idle' | 'busy' | 'offline' | 'error';

/** Ce que l'interface montre. */
export interface SyncView {
  account: { uid: string; email: string } | null;
  phase: SyncPhase;
  /** Le dernier échec (effacé au prochain échange réussi). */
  error: CloudError | null;
  /** La partie du compte, telle qu'on la connaît. */
  cloud: CloudBrief | null;
  /** Instant (ms) du dernier échange réussi ; 0 si aucun depuis l'ouverture. */
  syncedAt: number;
  ask: Ask | null;
  /** La partie mise de côté, s'il y en a une. */
  aside: Brief | null;
}

export interface SyncHooks {
  /** Une partie est en cours : on ne la remplace pas sous les doigts du joueur. */
  playing(): boolean;
  /** La partie du compte vient d'être écrite à la place de celle de l'appareil. */
  pulled(): void;
  /** Quelque chose a changé (de quoi redessiner l'écran du compte). */
  changed(): void;
  notice(text: string, kind: 'info' | 'good' | 'warn' | 'bad'): void;
  /** Vérifie qu'un texte de sauvegarde est lisible par cette version du jeu (lève sinon). */
  validate(json: string): void;
}

export interface SyncOptions {
  now?: () => number;
  /** Attente entre une sauvegarde de l'appareil et son envoi au compte (ms). */
  pushDelay?: number;
  /** Écart minimal entre deux envois (ms). */
  pushEvery?: number;
  /** Attente avant de réessayer après un échec qui peut s'arranger (ms). */
  retryAfter?: number;
  /** Voir DRIFT_MS (reconcile.ts). */
  drift?: number;
}

/** Une partie emballée, prête à partir. */
interface Prepared {
  raw: string;
  brief: Brief;
  data: string;
}

const MIN_TOKEN_LIFE = 120000;
/** Taille maximale de la sauvegarde emballée (signes) : les règles de Firestore en refusent plus de 500 000 (docs/firebase/firestore.rules). */
const MAX_DATA = 480000;

export class CloudSync {
  private tokens: Tokens | null;
  private chain: Promise<unknown> = Promise.resolve();
  private busy = 0;
  private error: CloudError | null = null;
  private cloud: CloudBrief | null = null;
  private syncedAt = 0;
  private ask: Ask | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private lastPush = 0;
  private prepared: Prepared | null = null;
  /** L'emballage de la dernière sauvegarde, en cours ou terminé. */
  private packing: Promise<void> = Promise.resolve();
  /** Voir DRIFT_MS (reconcile.ts) ; modifiable (les essais en navigateur le mettent à zéro). */
  drift: number;
  private readonly now: () => number;
  private readonly pushDelay: number;
  private readonly pushEvery: number;
  private readonly retryAfter: number;

  constructor(
    private readonly client: CloudClient,
    private readonly saves: LocalSaves,
    private readonly store: CloudStore,
    private readonly hooks: SyncHooks,
    opts: SyncOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.pushDelay = opts.pushDelay ?? 4000;
    this.pushEvery = opts.pushEvery ?? 30000;
    this.retryAfter = opts.retryAfter ?? 60000;
    this.drift = opts.drift ?? DRIFT_MS;
    this.tokens = store.session();
  }

  get signedIn(): boolean {
    return !!this.tokens;
  }

  get view(): SyncView {
    const t = this.tokens;
    const aside = this.saves.readAside();
    return {
      account: t ? { uid: t.uid, email: t.email } : null,
      phase: this.busy > 0 ? 'busy' : this.error ? (this.error.code === 'network' ? 'offline' : 'error') : 'idle',
      error: this.error,
      cloud: this.cloud,
      syncedAt: this.syncedAt,
      ask: this.ask,
      aside: aside ? briefOf(aside) : null,
    };
  }

  // ------------------------------------------------------------------ compte

  async signUp(email: string, password: string): Promise<void> {
    await this.enter(await this.client.signUp(email, password));
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.enter(await this.client.signIn(email, password));
  }

  resetPassword(email: string): Promise<void> {
    return this.client.sendReset(email);
  }

  /** Se déconnecte : la partie reste sur l'appareil, le compte aussi (ailleurs). */
  signOut(): void {
    this.tokens = null;
    this.store.setSession(null);
    this.forget();
    this.changed();
  }

  /** Supprime le compte et la partie qu'il garde. Le mot de passe est redemandé : c'est irréversible. */
  async deleteAccount(password: string): Promise<void> {
    const a = this.tokens;
    if (!a) return;
    const t = await this.client.signIn(a.email, password);
    await this.client.deleteSave(t.idToken, t.uid);
    await this.client.deleteAccount(t.idToken);
    this.store.setMemory(null);
    this.tokens = null;
    this.store.setSession(null);
    this.forget();
    this.changed();
  }

  private async enter(t: Tokens): Promise<void> {
    this.tokens = t;
    this.store.setSession(t);
    this.forget();
    this.changed();
    await this.sync();
  }

  private forget(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.prepared = null;
    this.error = null;
    this.ask = null;
    this.cloud = null;
    this.syncedAt = 0;
  }

  // ------------------------------------------------------------------ échanges

  /** Ouverture du jeu : si un compte est connecté, un premier échange. */
  boot(): Promise<void> {
    return this.tokens ? this.sync() : Promise.resolve();
  }

  /** Compare l'appareil et le compte, et fait ce qu'il faut. Ne lève jamais : un échec se lit dans `view.error`. */
  sync(): Promise<void> {
    return this.run(() => this.exchange(false));
  }

  /** Résolu quand toutes les opérations en cours ou en attente, et l'emballage de la dernière sauvegarde, sont terminés. */
  idle(): Promise<void> {
    return Promise.all([this.chain, this.packing]).then(() => undefined);
  }

  /** La partie de l'appareil vient d'être écrite : elle partira bientôt dans le compte. */
  localSaved(): void {
    if (!this.tokens) return;
    this.packing = this.prepare();
    this.schedule(Math.max(this.pushDelay, this.lastPush + this.pushEvery - this.now()));
  }

  /**
   * La page se ferme ou passe en arrière-plan : la dernière partie emballée part tout de suite, par une requête qui survit à la
   * page. Elle ne remplace que la révision connue de cet appareil, et on note ce qu'on envoie pour reconnaître son propre envoi
   * à la prochaine ouverture (sans quoi il ressemblerait à une avance d'un autre appareil).
   */
  leaving(): void {
    const t = this.tokens;
    const p = this.prepared;
    if (!t || !p || this.ask || this.busy > 0 || !t.idToken || t.expiresAt - this.now() < 30000 || p.data.length >= MAX_DATA) return;
    const mem = this.store.memory(t.uid);
    // Rien de neuf, ou plus ancien que ce que le compte tient déjà de cet appareil (cela arrive si l'envoi ordinaire a emballé lui-même).
    if (!mem.link || (mem.link.seed === p.brief.seed && p.brief.time <= mem.link.time)) return;
    // Déjà parti (la page change d'état plusieurs fois en se fermant).
    if (mem.sent && mem.sent.seed === p.brief.seed && mem.sent.time === p.brief.time) return;
    this.store.setMemory({ ...mem, sent: { seed: p.brief.seed, time: p.brief.time } });
    void this.client.putSave(t.idToken, t.uid, { ...p.brief, data: p.data, device: deviceName() }, mem.link.rev, true).catch(() => undefined);
  }

  private run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.chain.then(op);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private schedule(ms: number): void {
    if (!this.tokens) return;
    const at = this.now() + ms;
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(() => this.exchange(true));
    }, ms);
  }

  private async prepare(): Promise<void> {
    const raw = this.saves.read();
    if (!raw || this.prepared?.raw === raw) return;
    const brief = briefOf(raw);
    if (!brief) return;
    try {
      const data = await packSave(raw);
      if (this.saves.read() === raw) this.prepared = { raw, brief, data };
    } catch {
      /* l'envoi emballera lui-même */
    }
  }

  private pulled(): void {
    try {
      this.hooks.pulled();
    } catch (e) {
      console.warn('[compte]', e);
    }
  }

  /** Les rappels de l'interface ne doivent jamais faire échouer un échange. */
  private changed(): void {
    try {
      this.hooks.changed();
    } catch (e) {
      console.warn('[compte]', e);
    }
  }

  private ok(): void {
    this.error = null;
    this.syncedAt = this.now();
  }

  private fail(e: unknown): void {
    const err = e instanceof CloudError ? e : new CloudError('server', e instanceof Error ? e.message : String(e));
    this.error = err;
    if (err.code !== 'network' && err.code !== 'conflict') console.warn('[compte]', err.message);
    if (err.code === 'network' || err.code === 'server' || err.code === 'too-many') this.schedule(this.retryAfter);
  }

  private async token(force = false): Promise<Tokens> {
    const t = this.tokens;
    if (!t) throw new CloudError('session');
    if (!force && t.idToken && t.expiresAt - this.now() > MIN_TOKEN_LIFE) return t;
    try {
      const fresh = await this.client.refresh(t.refreshToken, t.email);
      if (this.tokens === t) {
        this.tokens = fresh;
        this.store.setSession(fresh);
      }
      return fresh;
    } catch (e) {
      if (e instanceof CloudError && e.code === 'session' && this.tokens === t) {
        this.tokens = null;
        this.store.setSession(null);
        this.hooks.notice('Votre session a expiré : reconnectez-vous à votre compte.', 'warn');
      }
      throw e;
    }
  }

  /**
   * Une opération sur le compte avec un jeton valide. Si le serveur refuse le jeton (révoqué, horloge de l'appareil fausse), on
   * en demande un neuf et on réessaie une fois ; si le renouvellement est refusé aussi, la session est terminée.
   */
  private async authed<T>(op: (t: Tokens) => Promise<T>): Promise<T> {
    try {
      return await op(await this.token());
    } catch (e) {
      if (!(e instanceof CloudError) || e.code !== 'session' || !this.tokens) throw e;
      return op(await this.token(true));
    }
  }

  /**
   * Un échange. `fast` : on vient de sauvegarder sur l'appareil, et le compte n'a, à notre connaissance, pas bougé : on tente
   * d'abord l'envoi directement (une seule requête) ; s'il est refusé, on refait le tour complet.
   */
  private async exchange(fast: boolean): Promise<void> {
    if (!this.tokens) return;
    this.busy++;
    this.changed();
    try {
      if (fast && (await this.fastPush())) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const t = await this.token();
        const cloud = await this.authed((a) => this.client.getBrief(a.idToken, a.uid));
        this.cloud = cloud;
        const raw = this.saves.read();
        const local = raw ? briefOf(raw) : null;
        const mem = this.store.memory(t.uid);
        const link = recognizeOwn(mem.link, mem.sent, cloud, this.now());
        if (link !== mem.link) this.store.setMemory({ uid: t.uid, link, sent: null });
        const plan = reconcile(local, cloud, link, this.drift);
        switch (plan.do) {
          case 'nothing':
            this.ask = null;
            this.ok();
            return;
          case 'adopt':
            this.remember(t.uid, cloud!.rev, local!);
            this.ask = null;
            this.ok();
            return;
          case 'push':
            try {
              await this.push(raw!, local!, cloud?.rev ?? null);
              this.ask = null;
              this.ok();
              return;
            } catch (e) {
              if (e instanceof CloudError && e.code === 'conflict') continue;
              throw e;
            }
          case 'pull':
            if (this.hooks.playing()) {
              // Pas sous les doigts du joueur. (Sans sauvegarde de l'appareil, le prochain envoi reposera la question.)
              if (local) this.setAsk({ why: 'newer', cloud: cloud!, local });
              else this.ok();
              return;
            }
            await this.pull();
            this.ask = null;
            this.ok();
            return;
          case 'ask':
            this.setAsk({ why: plan.why, cloud: cloud!, local: local! });
            return;
        }
      }
      throw new CloudError('conflict');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy--;
      this.changed();
    }
  }

  /** L'envoi direct : vrai s'il a réussi (ou s'il n'y avait rien à envoyer). */
  private async fastPush(): Promise<boolean> {
    const t = await this.token();
    const mem = this.store.memory(t.uid);
    const raw = this.saves.read();
    const local = raw ? briefOf(raw) : null;
    if (!mem.link || !local || this.ask) return false;
    if (local.seed === mem.link.seed && local.time === mem.link.time) return false;
    try {
      await this.push(raw!, local, mem.link.rev);
      this.ok();
      return true;
    } catch (e) {
      if (e instanceof CloudError && e.code === 'conflict') return false;
      throw e;
    }
  }

  private setAsk(ask: Ask): void {
    const first = !this.ask;
    this.ask = ask;
    this.ok();
    if (first && this.hooks.playing()) this.hooks.notice('Votre compte contient une autre partie : choisissez laquelle garder dans le menu, au bouton « Compte ».', 'warn');
  }

  private remember(uid: string, rev: string, b: Brief): void {
    this.store.setMemory({ uid, link: { rev, seed: b.seed, time: b.time, at: this.now() }, sent: null });
  }

  /** Écrit la partie de l'appareil dans le compte, à la place de la révision `rev` (null : le compte est vide). */
  private async push(raw: string, brief: Brief, rev: string | null): Promise<void> {
    const t = await this.token();
    const p = this.prepared;
    const data = p && p.raw === raw ? p.data : await packSave(raw);
    if (data.length >= MAX_DATA) throw new CloudError('too-big', `${data.length} signes`);
    this.store.setMemory({ ...this.store.memory(t.uid), sent: { seed: brief.seed, time: brief.time } });
    const device = deviceName();
    const next = await this.authed((a) => this.client.putSave(a.idToken, a.uid, { ...brief, data, device }, rev));
    this.remember(t.uid, next, brief);
    this.cloud = { ...brief, rev: next, device };
    this.lastPush = this.now();
  }

  /** Remplace la partie de l'appareil par celle du compte (l'appareil n'a pas bougé depuis leur dernier échange). */
  private async pull(): Promise<void> {
    const t = await this.token();
    const doc = await this.authed((a) => this.client.getSave(a.idToken, a.uid));
    if (!doc) return;
    const json = await this.readable(doc);
    // Déconnecté (ou un autre compte) pendant le téléchargement : la partie de l'appareil n'est plus à remplacer.
    if (this.tokens?.uid !== t.uid) return;
    if (!this.saves.write(json)) throw new CloudError('storage');
    this.remember(t.uid, doc.rev, briefOf(json)!);
    this.cloud = this.brief(doc);
    this.pulled();
  }

  /** Le texte de la partie du compte, vérifié lisible par cette version du jeu. */
  private async readable(doc: CloudDoc): Promise<string> {
    try {
      const json = await unpackSave(doc.data);
      if (!briefOf(json)) throw new Error('Ce n’est pas une sauvegarde Empire Miner');
      this.hooks.validate(json);
      return json;
    } catch (e) {
      throw new CloudError('unreadable', e instanceof Error ? e.message : '');
    }
  }

  /** Le résumé d'une partie du compte, sans la sauvegarde elle-même (qu'on ne garde pas en mémoire). */
  private brief(doc: CloudDoc): CloudBrief {
    return { rev: doc.rev, seed: doc.seed, time: doc.time, money: doc.money, depth: doc.depth, savedAt: doc.savedAt, device: doc.device };
  }

  // ------------------------------------------------------------------ choix du joueur

  /** Le joueur a choisi laquelle des deux parties garder ; l'autre est mise de côté. */
  resolve(choice: 'cloud' | 'local'): Promise<void> {
    return this.run(async () => {
      if (await this.apply(choice)) await this.exchange(false);
    });
  }

  /** Vrai si ce qu'on a montré au joueur a changé entre-temps : il faut alors refaire le tour (et peut-être lui redemander). */
  private async apply(choice: 'cloud' | 'local'): Promise<boolean> {
    const ask = this.ask;
    if (!ask || !this.tokens) return false;
    this.busy++;
    this.changed();
    try {
      const t = await this.token();
      const doc = await this.authed((a) => this.client.getSave(a.idToken, a.uid));
      const raw = this.saves.read();
      const local = raw ? briefOf(raw) : null;
      if (!doc || !raw || !local || doc.rev !== ask.cloud.rev) {
        this.ask = null;
        return true;
      }
      const json = await this.readable(doc);
      if (this.tokens?.uid !== t.uid) return false;
      if (choice === 'cloud') {
        this.keepAside(raw);
        if (!this.saves.write(json)) throw new CloudError('storage');
        this.remember(t.uid, doc.rev, briefOf(json)!);
        this.cloud = this.brief(doc);
        this.ask = null;
        this.ok();
        this.pulled();
      } else {
        this.keepAside(json);
        await this.push(raw, local, doc.rev);
        this.ask = null;
        this.ok();
      }
      return false;
    } catch (e) {
      if (e instanceof CloudError && e.code === 'conflict') {
        this.ask = null;
        return true;
      }
      this.fail(e);
      return false;
    } finally {
      this.busy--;
      this.changed();
    }
  }

  /** Met une partie de côté, et vérifie qu'elle y est bien avant que l'autre soit remplacée. */
  private keepAside(raw: string): void {
    this.saves.writeAside(raw);
    if (this.saves.readAside() !== raw) throw new CloudError('storage');
  }

  /**
   * Reprend la partie mise de côté : elle prend la place de celle de l'appareil, qui passe de côté à son tour (on peut
   * revenir en arrière). Retourne le texte de la partie reprise, null s'il n'y en a pas.
   */
  takeAside(): string | null {
    const aside = this.saves.readAside();
    if (!aside || !briefOf(aside)) return null;
    const current = this.saves.read();
    if (!this.saves.write(aside)) return null;
    this.saves.writeAside(current);
    this.localSaved();
    this.changed();
    return aside;
  }
}
