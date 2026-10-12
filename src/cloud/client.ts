/**
 * Client des API REST de Firebase, sans le SDK de Google (qui pèserait plus lourd que le jeu) :
 *  - Authentication (Identity Toolkit) : créer un compte, se connecter, renouveler le jeton, mot de passe oublié, supprimer ;
 *  - Firestore : un seul document par joueur, `saves/{uid}`, qui contient la sauvegarde compressée et un résumé.
 *
 * Le document porte une date de mise à jour décidée par le serveur (`updateTime`) : c'est la « révision ». Une écriture
 * précise la révision qu'elle croit remplacer ; si quelqu'un d'autre a écrit entre-temps, le serveur refuse (`conflict`) et
 * rien n'est écrasé. Les règles de Firestore (docs/firebase/firestore.rules) n'autorisent chaque joueur que sur son document.
 */
import type { Brief } from './brief';
import type { CloudConfig, CloudEndpoints } from './config';

export type CloudErrorCode =
  | 'invalid-email'
  | 'email-exists'
  | 'weak-password'
  | 'bad-credentials'
  | 'too-many'
  | 'disabled'
  | 'unavailable'
  | 'session'
  | 'denied'
  | 'conflict'
  | 'network'
  | 'server'
  | 'too-big'
  | 'unreadable'
  | 'storage';

/** Ce que le joueur lit quand ça n'a pas marché. */
export const CLOUD_ERROR_TEXT: Record<CloudErrorCode, string> = {
  'invalid-email': 'Cette adresse e-mail n’a pas la bonne forme.',
  'email-exists': 'Un compte existe déjà avec cette adresse : connectez-vous.',
  'weak-password': 'Mot de passe trop court : 6 caractères au moins.',
  'bad-credentials': 'E-mail ou mot de passe incorrect.',
  'too-many': 'Trop d’essais : patientez quelques minutes, ou refaites votre mot de passe.',
  disabled: 'Ce compte est désactivé.',
  unavailable: 'Le compte n’est pas disponible pour le moment (service non réglé).',
  session: 'Votre session a expiré : reconnectez-vous.',
  denied: 'Le service a refusé l’accès (règles de la base de données).',
  conflict: 'La partie du compte a changé entre-temps.',
  network: 'Pas de connexion à Internet.',
  server: 'Le service ne répond pas comme prévu. Réessayez plus tard.',
  'too-big': 'La partie est trop grosse pour le compte.',
  unreadable: 'La partie du compte n’est pas lisible par cette version du jeu : mettez le jeu à jour.',
  storage: 'Impossible d’enregistrer la partie dans ce navigateur.',
};

export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    detail = '',
  ) {
    super(detail ? `${code} : ${detail}` : code);
    this.name = 'CloudError';
  }

  /** Le message à montrer au joueur. */
  get text(): string {
    return CLOUD_ERROR_TEXT[this.code];
  }
}

/** Une session ouverte : le jeton d'accès (une heure), celui qui sert à le renouveler, et l'identité. */
export interface Tokens {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  /** Instant (ms) où `idToken` expire. */
  expiresAt: number;
}

/** Le résumé de la partie du compte, avec sa révision. */
export interface CloudBrief extends Brief {
  rev: string;
  /** D'où elle vient (« iPhone », « Windows »…). */
  device: string;
}

/** La partie du compte : résumé + sauvegarde compressée. */
export interface CloudDoc extends CloudBrief {
  data: string;
}

/** Ce qu'on écrit dans le compte. */
export interface CloudWrite extends Brief {
  data: string;
  device: string;
}

export interface ClientOptions {
  config: CloudConfig;
  endpoints: CloudEndpoints;
  fetch?: typeof fetch;
  now?: () => number;
  /** Délai au-delà duquel une requête est abandonnée (ms). */
  timeout?: number;
}

type Json = Record<string, any> | null;

const BRIEF_FIELDS = ['savedAt', 'seed', 'time', 'money', 'depth', 'device'];
const WRITE_FIELDS = ['data', ...BRIEF_FIELDS];

/** Le code d'une erreur de l'API d'identité (« EMAIL_EXISTS », « WEAK_PASSWORD : Password should be… »). */
function identityCode(status: number, message: string): CloudErrorCode {
  const key = message.split(/[\s:]/)[0];
  switch (key) {
    case 'INVALID_EMAIL':
    case 'MISSING_EMAIL':
      return 'invalid-email';
    case 'EMAIL_EXISTS':
      return 'email-exists';
    case 'WEAK_PASSWORD':
    case 'MISSING_PASSWORD':
      return 'weak-password';
    case 'INVALID_LOGIN_CREDENTIALS':
    case 'INVALID_PASSWORD':
    case 'EMAIL_NOT_FOUND':
      return 'bad-credentials';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return 'too-many';
    case 'USER_DISABLED':
      return 'disabled';
    case 'OPERATION_NOT_ALLOWED':
    case 'PASSWORD_LOGIN_DISABLED':
    case 'CONFIGURATION_NOT_FOUND':
    case 'ADMIN_ONLY_OPERATION':
      return 'unavailable';
    case 'TOKEN_EXPIRED':
    case 'INVALID_REFRESH_TOKEN':
    case 'INVALID_ID_TOKEN':
    case 'MISSING_REFRESH_TOKEN':
    case 'USER_NOT_FOUND':
    case 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN':
      return 'session';
  }
  if (/API key/i.test(message) || status === 403) return 'unavailable';
  if (status === 429) return 'too-many';
  return 'server';
}

function str(v: string): { stringValue: string } {
  return { stringValue: v };
}

function field(fields: Record<string, any> | undefined, name: string): { stringValue?: string; integerValue?: string; doubleValue?: number } {
  return fields?.[name] ?? {};
}

function num(fields: Record<string, any> | undefined, name: string): number {
  const f = field(fields, name);
  const v = f.integerValue ?? f.doubleValue;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
}

function briefOfDoc(doc: Record<string, any>): CloudBrief {
  const f = doc.fields as Record<string, any> | undefined;
  return {
    rev: String(doc.updateTime ?? ''),
    seed: num(f, 'seed'),
    time: num(f, 'time'),
    money: num(f, 'money'),
    depth: num(f, 'depth'),
    savedAt: field(f, 'savedAt').stringValue ?? '',
    device: field(f, 'device').stringValue ?? '',
  };
}

export class CloudClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeout: number;

  constructor(private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.timeout = opts.timeout ?? 20000;
  }

  // ------------------------------------------------------------------ identité

  signUp(email: string, password: string): Promise<Tokens> {
    return this.credentials('accounts:signUp', email, password);
  }

  signIn(email: string, password: string): Promise<Tokens> {
    return this.credentials('accounts:signInWithPassword', email, password);
  }

  /** Un jeton d'accès tout neuf à partir du jeton de renouvellement ; `session` si celui-ci n'est plus bon. */
  async refresh(refreshToken: string, email: string): Promise<Tokens> {
    const { endpoints, config } = this.opts;
    const res = await this.call(`${endpoints.token}/token?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (res.status >= 400) throw this.identityError(res);
    return this.tokens(res.body, email);
  }

  /** Envoie l'e-mail de nouveau mot de passe. Une adresse inconnue n'est pas une erreur (on ne dit pas qui a un compte). */
  async sendReset(email: string): Promise<void> {
    const res = await this.identity('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
    if (res.status < 400) return;
    const err = this.identityError(res);
    if (err.code !== 'bad-credentials') throw err;
  }

  async deleteAccount(idToken: string): Promise<void> {
    const res = await this.identity('accounts:delete', { idToken });
    if (res.status >= 400) throw this.identityError(res);
  }

  private async credentials(op: string, email: string, password: string): Promise<Tokens> {
    const res = await this.identity(op, { email, password, returnSecureToken: true });
    if (res.status >= 400) throw this.identityError(res);
    return this.tokens(res.body, email);
  }

  private identity(op: string, body: unknown): Promise<{ status: number; body: Json }> {
    const { endpoints, config } = this.opts;
    return this.call(`${endpoints.identity}/${op}?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private identityError(res: { status: number; body: Json }): CloudError {
    const message = String(res.body?.error?.message ?? '');
    return new CloudError(identityCode(res.status, message), `${res.status} ${message}`.trim());
  }

  private tokens(body: Json, email: string): Tokens {
    const idToken = body?.idToken ?? body?.id_token;
    const refreshToken = body?.refreshToken ?? body?.refresh_token;
    const uid = body?.localId ?? body?.user_id;
    if (typeof idToken !== 'string' || typeof refreshToken !== 'string' || typeof uid !== 'string') throw new CloudError('server', 'réponse incomplète');
    const ttl = Number(body?.expiresIn ?? body?.expires_in ?? 3600);
    return { uid, email: typeof body?.email === 'string' ? body.email : email, idToken, refreshToken, expiresAt: this.now() + (Number.isFinite(ttl) ? ttl : 3600) * 1000 };
  }

  // ------------------------------------------------------------------ la partie du compte

  private docUrl(uid: string): string {
    const { endpoints, config } = this.opts;
    return `${endpoints.firestore}/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/saves/${encodeURIComponent(uid)}`;
  }

  /** Le résumé de la partie du compte (sans la télécharger) ; null s'il n'y en a pas. */
  async getBrief(idToken: string, uid: string): Promise<CloudBrief | null> {
    const q = BRIEF_FIELDS.map((f) => `mask.fieldPaths=${f}`).join('&');
    const res = await this.call(`${this.docUrl(uid)}?${q}`, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404 && !this.noDatabase(res)) return null;
    if (res.status >= 400) throw this.storeError(res, false);
    return briefOfDoc(res.body ?? {});
  }

  /** La partie du compte, sauvegarde comprise ; null s'il n'y en a pas. */
  async getSave(idToken: string, uid: string): Promise<CloudDoc | null> {
    const res = await this.call(this.docUrl(uid), { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404 && !this.noDatabase(res)) return null;
    if (res.status >= 400) throw this.storeError(res, false);
    const data = field(res.body?.fields, 'data').stringValue;
    if (typeof data !== 'string' || !data) throw new CloudError('server', 'document sans sauvegarde');
    return { ...briefOfDoc(res.body ?? {}), data };
  }

  /**
   * Écrit la partie du compte en remplaçant la révision `rev` (null : le compte n'a encore rien, il ne doit toujours rien avoir).
   * Retourne la nouvelle révision. `conflict` si le compte a changé depuis.
   */
  async putSave(idToken: string, uid: string, w: CloudWrite, rev: string | null, keepalive = false): Promise<string> {
    const q = new URLSearchParams();
    for (const f of WRITE_FIELDS) q.append('updateMask.fieldPaths', f);
    if (rev) q.set('currentDocument.updateTime', rev);
    else q.set('currentDocument.exists', 'false');
    const fields = {
      data: str(w.data),
      savedAt: str(w.savedAt),
      seed: { integerValue: String(Math.trunc(w.seed)) },
      time: { doubleValue: w.time },
      money: { doubleValue: w.money },
      depth: { doubleValue: w.depth },
      device: str(w.device),
    };
    const res = await this.call(
      `${this.docUrl(uid)}?${q}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }), keepalive },
    );
    if (res.status >= 400) throw this.storeError(res, true);
    const next = String(res.body?.updateTime ?? '');
    if (!next) throw new CloudError('server', 'écriture sans révision');
    return next;
  }

  async deleteSave(idToken: string, uid: string): Promise<void> {
    const res = await this.call(this.docUrl(uid), { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status >= 400 && res.status !== 404) throw this.storeError(res, false);
  }

  /**
   * Un 404 qui parle de la base elle-même (jamais créée : « The database (default) does not exist for project… »), pas d'un
   * document absent (« Document "projects/…/databases/(default)/documents/saves/… " not found »).
   */
  private noDatabase(res: { body: Json }): boolean {
    const message = String(res.body?.error?.message ?? '');
    return /does not exist/i.test(message) && /database/i.test(message);
  }

  private storeError(res: { status: number; body: Json }, write: boolean): CloudError {
    const message = String(res.body?.error?.message ?? '');
    const status = String(res.body?.error?.status ?? '');
    const detail = `${res.status} ${status} ${message}`.trim();
    if (res.status === 401 || status === 'UNAUTHENTICATED') return new CloudError('session', detail);
    if (this.noDatabase(res) || /has not been used|is disabled/i.test(message)) return new CloudError('unavailable', detail);
    if (res.status === 403 || status === 'PERMISSION_DENIED') return new CloudError('denied', detail);
    if (write && (status === 'FAILED_PRECONDITION' || status === 'ALREADY_EXISTS' || status === 'ABORTED' || res.status === 409 || res.status === 412)) return new CloudError('conflict', detail);
    if (write && res.status === 404) return new CloudError('conflict', detail);
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') return new CloudError('too-many', detail);
    if (res.status === 413 || (res.status === 400 && /too large|exceeds|too big|maximum/i.test(message))) return new CloudError('too-big', detail);
    return new CloudError('server', detail);
  }

  // ------------------------------------------------------------------ réseau

  private async call(url: string, init: RequestInit): Promise<{ status: number; body: Json }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const res = await this.fetchFn(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      let body: Json = null;
      if (text) {
        try {
          body = JSON.parse(text) as Json;
        } catch {
          body = null;
        }
      }
      return { status: res.status, body };
    } catch {
      throw new CloudError('network');
    } finally {
      clearTimeout(timer);
    }
  }
}
