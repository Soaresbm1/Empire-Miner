/**
 * Un faux Firebase pour les essais : les trois API que le jeu appelle (Authentication, renouvellement du jeton, Firestore),
 * avec leurs réponses et leurs erreurs telles que les documente Google. Sert aux essais unitaires (par `fetch`) et au test de
 * bout en bout (derrière un petit serveur HTTP, e2e/cloud.mjs).
 *
 * Ce que le vrai serveur fait et que celui-ci reproduit : jetons qui expirent, révision (`updateTime`) décidée par le serveur,
 * préconditions d'écriture (`currentDocument.updateTime`, `currentDocument.exists`), masque de champs, règles de sécurité
 * (chacun son document, `data` est un texte de moins de 500 000 signes).
 */

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeResponse {
  status: number;
  body: string;
}

interface User {
  uid: string;
  email: string;
  password: string;
  failures: number;
}

interface Doc {
  fields: Record<string, any>;
  createTime: string;
  updateTime: string;
}

interface Injected {
  match: RegExp;
  status: number;
  body: unknown;
  times: number;
}

export class FakeFirebase {
  readonly apiKey = 'cle-d-essai';
  readonly projectId = 'projet-d-essai';
  now: () => number = Date.now;
  /** Durée de vie d'un jeton d'accès (s). */
  tokenTtl = 3600;
  /** Essais de mot de passe ratés avant que le compte soit bloqué. */
  maxFailures = 5;
  /** Protection contre l'énumération des comptes (par défaut chez Google) : « mot de passe oublié » répond toujours oui. */
  enumerationProtection = true;
  /** Coupure du réseau : `fetch` échoue comme un navigateur hors connexion. */
  down = false;
  /** Pas de base Firestore créée dans le projet. */
  noDatabase = false;
  readonly users = new Map<string, User>();
  readonly docs = new Map<string, Doc>();
  readonly mails: string[] = [];
  /** Les requêtes reçues : « POST accounts:signUp », « GET saves/uid »… */
  readonly log: string[] = [];
  private readonly idTokens = new Map<string, { uid: string; exp: number }>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly injected: Injected[] = [];
  private serial = 0;

  // ------------------------------------------------------------------ pour les essais

  /** Fait échouer les prochaines requêtes dont « METHODE chemin » correspond. */
  inject(match: RegExp, status: number, body: unknown, times = 1): void {
    this.injected.push({ match, status, body, times });
  }

  /** Le document du joueur `uid`, tel qu'il est gardé. */
  doc(uid: string): Doc | undefined {
    return this.docs.get(uid);
  }

  /** Un compte déjà créé (retourne son identifiant). */
  addUser(email: string, password: string): string {
    const uid = `u${this.users.size + 1}${Math.floor(this.serial++ * 7 + 13)}`;
    this.users.set(email.toLowerCase(), { uid, email, password, failures: 0 });
    return uid;
  }

  /** Les jetons d'accès déjà émis cessent de valoir (le serveur les a fait expirer). */
  expireTokens(): void {
    this.idTokens.clear();
  }

  /** `fetch` branché sur ce faux serveur. */
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new TypeError('Failed to fetch');
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const res = this.handle({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input instanceof Request ? input.url : input), headers, body: typeof init?.body === 'string' ? init.body : '' });
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
  };

  // ------------------------------------------------------------------ le serveur

  handle(req: FakeRequest): FakeResponse {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(identity|token|firestore)\/v1\//, '');
    this.log.push(`${req.method} ${path.replace(/^projects\/[^/]+\/databases\/\(default\)\/documents\//, '')}`);
    const hit = this.injected.find((i) => i.times > 0 && i.match.test(`${req.method} ${path}`));
    if (hit) {
      hit.times--;
      return { status: hit.status, body: JSON.stringify(hit.body) };
    }
    if (path.startsWith('accounts:')) return this.identity(path.slice('accounts:'.length), url, req);
    if (path === 'token') return this.refresh(req);
    if (path.startsWith('projects/')) return this.firestore(path, url, req);
    return this.error(404, 'NOT_FOUND', 'Not Found');
  }

  private error(code: number, message: string, status = 'INVALID_ARGUMENT'): FakeResponse {
    return { status: code, body: JSON.stringify({ error: { code, message, status, errors: [{ message, domain: 'global', reason: 'invalid' }] } }) };
  }

  private ok(body: unknown): FakeResponse {
    return { status: 200, body: JSON.stringify(body) };
  }

  private issue(u: User): Record<string, unknown> {
    const idToken = `id-${u.uid}-${++this.serial}`;
    const refreshToken = `re-${u.uid}-${++this.serial}`;
    this.idTokens.set(idToken, { uid: u.uid, exp: this.now() + this.tokenTtl * 1000 });
    this.refreshTokens.set(refreshToken, u.uid);
    return { kind: 'identitytoolkit#VerifyPasswordResponse', localId: u.uid, email: u.email, idToken, refreshToken, expiresIn: String(this.tokenTtl), registered: true };
  }

  private identity(op: string, url: URL, req: FakeRequest): FakeResponse {
    if (url.searchParams.get('key') !== this.apiKey) return this.error(400, 'API key not valid. Please pass a valid API key.');
    const body = JSON.parse(req.body || '{}') as Record<string, any>;
    const email = String(body.email ?? '').trim();
    switch (op) {
      case 'signUp': {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return this.error(400, 'INVALID_EMAIL');
        if (String(body.password ?? '').length < 6) return this.error(400, 'WEAK_PASSWORD : Password should be at least 6 characters');
        if (this.users.has(email.toLowerCase())) return this.error(400, 'EMAIL_EXISTS');
        this.addUser(email, String(body.password));
        return this.ok(this.issue(this.users.get(email.toLowerCase())!));
      }
      case 'signInWithPassword': {
        const u = this.users.get(email.toLowerCase());
        if (u && u.failures >= this.maxFailures) return this.error(400, 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled due to many failed login attempts.');
        if (!u || u.password !== body.password) {
          if (u) u.failures++;
          return this.error(400, 'INVALID_LOGIN_CREDENTIALS');
        }
        u.failures = 0;
        return this.ok(this.issue(u));
      }
      case 'sendOobCode': {
        if (body.requestType !== 'PASSWORD_RESET') return this.error(400, 'INVALID_REQ_TYPE');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return this.error(400, 'INVALID_EMAIL');
        const known = this.users.has(email.toLowerCase());
        if (!known && !this.enumerationProtection) return this.error(400, 'EMAIL_NOT_FOUND');
        if (known) this.mails.push(email);
        return this.ok({ email });
      }
      case 'delete': {
        const t = this.idTokens.get(String(body.idToken ?? ''));
        if (!t || t.exp <= this.now()) return this.error(400, 'INVALID_ID_TOKEN');
        for (const [k, u] of this.users) if (u.uid === t.uid) this.users.delete(k);
        this.idTokens.delete(String(body.idToken));
        return this.ok({ kind: 'identitytoolkit#DeleteAccountResponse' });
      }
    }
    return this.error(404, 'OPERATION_NOT_ALLOWED');
  }

  private refresh(req: FakeRequest): FakeResponse {
    const form = new URLSearchParams(req.body);
    if (form.get('grant_type') !== 'refresh_token') return this.error(400, 'INVALID_GRANT_TYPE');
    const uid = this.refreshTokens.get(form.get('refresh_token') ?? '');
    const user = [...this.users.values()].find((u) => u.uid === uid);
    if (!uid) return this.error(400, 'INVALID_REFRESH_TOKEN');
    if (!user) return this.error(400, 'USER_NOT_FOUND');
    const t = this.issue(user);
    return this.ok({ access_token: t.idToken, expires_in: t.expiresIn, token_type: 'Bearer', refresh_token: t.refreshToken, id_token: t.idToken, user_id: uid, project_id: '123' });
  }

  private firestore(path: string, url: URL, req: FakeRequest): FakeResponse {
    const m = /^projects\/([^/]+)\/databases\/\(default\)\/documents\/saves\/([^/]+)$/.exec(path);
    if (!m) return this.error(404, 'Not Found', 'NOT_FOUND');
    if (m[1] !== this.projectId || this.noDatabase) {
      return this.error(404, `The database (default) does not exist for project ${m[1]} Please visit https://console.cloud.google.com/datastore/setup?project=${m[1]} to add a Cloud Datastore or Cloud Firestore database.`, 'NOT_FOUND');
    }
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const auth = token ? this.idTokens.get(token) : undefined;
    if (!auth || auth.exp <= this.now()) return this.error(401, 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.', 'UNAUTHENTICATED');
    const uid = decodeURIComponent(m[2]);
    const name = `projects/${this.projectId}/databases/(default)/documents/saves/${uid}`;
    const denied = () => this.error(403, 'Missing or insufficient permissions.', 'PERMISSION_DENIED');
    if (auth.uid !== uid) return denied();
    const doc = this.docs.get(uid);

    if (req.method === 'GET') {
      if (!doc) return this.error(404, `Document "${name}" not found.`, 'NOT_FOUND');
      const mask = url.searchParams.getAll('mask.fieldPaths');
      const fields = mask.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => mask.includes(k))) : doc.fields;
      return this.ok({ name, fields, createTime: doc.createTime, updateTime: doc.updateTime });
    }
    if (req.method === 'DELETE') {
      this.docs.delete(uid);
      return this.ok({});
    }
    if (req.method === 'PATCH') {
      const incoming = (JSON.parse(req.body || '{}') as { fields?: Record<string, any> }).fields ?? {};
      const mask = url.searchParams.getAll('updateMask.fieldPaths');
      // Avec un masque : seuls les champs du masque changent (absents du corps, ils sont supprimés). Sans masque : tout est remplacé.
      const next: Record<string, any> = mask.length && doc ? { ...doc.fields } : {};
      if (mask.length) {
        for (const k of mask) {
          if (k in incoming) next[k] = incoming[k];
          else delete next[k];
        }
      } else {
        Object.assign(next, incoming);
      }
      // Les règles : `data` est un texte de moins de 500 000 signes.
      const data = next.data?.stringValue;
      if (typeof data !== 'string' || data.length >= 500000) return denied();
      const wantTime = url.searchParams.get('currentDocument.updateTime');
      const mustBeNew = url.searchParams.get('currentDocument.exists') === 'false';
      if (mustBeNew && doc) return this.error(409, `Document already exists: ${name}`, 'ALREADY_EXISTS');
      if (wantTime && !doc) return this.error(404, `No document to update: ${name}`, 'NOT_FOUND');
      if (wantTime && doc && doc.updateTime !== wantTime) {
        return this.error(400, `The stored version (${doc.updateTime}) of the document does not match the required base version (${wantTime})`, 'FAILED_PRECONDITION');
      }
      const stamp = `2026-01-01T00:00:00.${String(++this.serial).padStart(6, '0')}Z`;
      const saved: Doc = { fields: next, createTime: doc?.createTime ?? stamp, updateTime: stamp };
      this.docs.set(uid, saved);
      return this.ok({ name, fields: saved.fields, createTime: saved.createTime, updateTime: saved.updateTime });
    }
    return this.error(405, 'Method not allowed', 'INVALID_ARGUMENT');
  }
}
