import { createHash, KeyObject, randomBytes } from 'crypto';
import { createLogger } from '@ai-governance/utils';
import { callBackend, checkBaseUrl, EgressError } from './egress';
import { Claims, decodeJwt, JwtError, keyFromJwk, verifyJwt } from './jwt';

const logger = createLogger('gateway:mcp-oidc');

/**
 * Signing people in through the company's own identity provider (Entra ID, Okta, Google, or any OpenID
 * Connect provider). Probaline is an OIDC client of it: the person signs in there, Probaline checks the
 * ID token it gets back, and reads who they are and which groups they're in. Probaline keeps no passwords.
 */

/** A company's identity-provider settings. The client secret is in the secret store. */
export interface SignInConfig {
  tenantId: string;
  recordKey: 'signin';
  issuer: string;
  clientId: string;
  secretArn?: string;
  secretHint?: string;
  /** Claim holding the person's groups (Entra: `groups` or `roles`; Okta: `groups`, once configured). */
  groupsClaim: string;
  /** Scopes asked for besides `openid email profile` (e.g. `offline_access`, `groups`). */
  extraScopes: string[];
  /** How long a sign-in lasts before the person signs in again, when the provider gives no refresh token. */
  sessionHours: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface Person { sub: string; email?: string; name?: string; groups: string[] }
export interface IdpTokens { idToken: string; refreshToken?: string }

export class OidcError extends Error {
  constructor(message: string, readonly code = 'SIGN_IN_FAILED') { super(message); }
}

const HOUR = 3_600_000;
export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function getJson(url: string, init: { method?: string; headers?: Record<string, string>; form?: Record<string, string> } = {}): Promise<{ status: number; json: any }> {
  let u: URL;
  try { u = checkBaseUrl(url); } catch (err) { throw new OidcError(`The identity provider address ${url} isn't allowed: ${(err as Error).message}`, 'IDP_ADDRESS'); }
  // checkBaseUrl refuses queries; put them back.
  const full = new URL(url);
  u.search = full.search;
  const body = init.form ? new URLSearchParams(init.form).toString() : undefined;
  let r;
  try {
    r = await callBackend({ url: u, method: init.method ?? 'GET', headers: { accept: 'application/json', 'user-agent': 'Probaline-MCP/1.0', ...(init.headers ?? {}) }, body, contentType: 'application/x-www-form-urlencoded', maxBytes: 500_000, timeoutMs: 10_000 });
  } catch (err) {
    throw new OidcError(`Couldn't reach the identity provider: ${(err as EgressError).message}`, 'IDP_UNREACHABLE');
  }
  try { return { status: r.status, json: JSON.parse(r.body) }; } catch { throw new OidcError(`The identity provider answered ${r.status} with something that isn't JSON`, 'IDP_BAD_ANSWER'); }
}

export class OidcClient {
  private discoveries = new Map<string, { doc: Discovery; until: number }>();
  private keySets = new Map<string, { keys: Map<string, KeyObject>; until: number; fetchedAt: number }>();

  async discover(issuer: string): Promise<Discovery> {
    const hit = this.discoveries.get(issuer);
    if (hit && hit.until > Date.now()) return hit.doc;
    const { status, json } = await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (status !== 200) throw new OidcError(`The identity provider's discovery document answered ${status}`, 'IDP_DISCOVERY');
    for (const f of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (typeof json[f] !== 'string') throw new OidcError(`The identity provider's discovery document has no ${f}`, 'IDP_DISCOVERY');
    }
    // The document must be for the issuer that was configured (stops one provider standing in for another).
    if (json.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
      throw new OidcError(`The identity provider says its issuer is ${json.issuer}, not ${issuer}`, 'IDP_DISCOVERY');
    }
    const doc: Discovery = { issuer: json.issuer, authorization_endpoint: json.authorization_endpoint, token_endpoint: json.token_endpoint, jwks_uri: json.jwks_uri };
    this.discoveries.set(issuer, { doc, until: Date.now() + HOUR });
    return doc;
  }

  private async key(jwksUri: string, kid?: string): Promise<KeyObject | null> {
    const load = async () => {
      const { status, json } = await getJson(jwksUri);
      if (status !== 200 || !Array.isArray(json.keys)) throw new OidcError('The identity provider\'s signing keys couldn\'t be read', 'IDP_KEYS');
      const keys = new Map<string, KeyObject>();
      for (const k of json.keys) {
        if (k.use && k.use !== 'sig') continue;
        try { keys.set(k.kid ?? '', keyFromJwk(k)); } catch { /* a key type we don't use */ }
      }
      const entry = { keys, until: Date.now() + HOUR, fetchedAt: Date.now() };
      this.keySets.set(jwksUri, entry);
      return entry;
    };
    let set = this.keySets.get(jwksUri);
    if (!set || set.until < Date.now()) set = await load();
    let found = kid !== undefined ? set.keys.get(kid) : set.keys.size === 1 ? [...set.keys.values()][0] : undefined;
    // Keys rotate: look again for an unknown kid, at most once a minute.
    if (!found && Date.now() - set.fetchedAt > 60_000) {
      set = await load();
      found = kid !== undefined ? set.keys.get(kid) : undefined;
    }
    return found ?? null;
  }

  async authorizeUrl(cfg: SignInConfig, o: { redirectUri: string; state: string; nonce: string; challenge: string }): Promise<string> {
    const d = await this.discover(cfg.issuer);
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', o.redirectUri);
    u.searchParams.set('scope', ['openid', 'email', 'profile', ...cfg.extraScopes].join(' '));
    u.searchParams.set('state', o.state);
    u.searchParams.set('nonce', o.nonce);
    u.searchParams.set('code_challenge', o.challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.href;
  }

  private async token(cfg: SignInConfig, secret: string, form: Record<string, string>): Promise<IdpTokens> {
    const d = await this.discover(cfg.issuer);
    const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(secret)}`).toString('base64');
    const { status, json } = await getJson(d.token_endpoint, { method: 'POST', headers: { authorization: `Basic ${basic}` }, form });
    if (status !== 200 || typeof json.id_token !== 'string') {
      throw new OidcError(`The identity provider refused: ${json.error_description || json.error || `status ${status}`}`, json.error === 'invalid_grant' ? 'IDP_INVALID_GRANT' : 'IDP_TOKEN');
    }
    return { idToken: json.id_token, refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined };
  }

  exchange(cfg: SignInConfig, secret: string, code: string, redirectUri: string, verifier: string) {
    return this.token(cfg, secret, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  }

  refresh(cfg: SignInConfig, secret: string, refreshToken: string) {
    return this.token(cfg, secret, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: ['openid', 'email', 'profile', ...cfg.extraScopes].join(' ') });
  }

  /** Check an ID token and read the person from it. */
  async person(cfg: SignInConfig, idToken: string, nonce?: string): Promise<Person> {
    const d = await this.discover(cfg.issuer);
    let claims: Claims;
    try {
      claims = await verifyJwt(idToken, { issuer: d.issuer, audience: cfg.clientId, key: (h) => this.key(d.jwks_uri, h.kid) });
    } catch (err) {
      const { header } = (() => { try { return decodeJwt(idToken); } catch { return { header: {} as any }; } })();
      logger.warn('ID token refused', { tenantId: cfg.tenantId, error: (err as Error).message, alg: header.alg });
      throw new OidcError(`The identity provider's ID token was refused: ${(err as JwtError).message}`, 'IDP_ID_TOKEN');
    }
    if (nonce !== undefined && claims.nonce !== nonce) throw new OidcError('The ID token was not for this sign-in', 'IDP_ID_TOKEN');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('The ID token has no subject', 'IDP_ID_TOKEN');
    const raw = claims[cfg.groupsClaim];
    const groups = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).filter((g): g is string => typeof g === 'string').slice(0, 200);
    const email = [claims.email, claims.preferred_username, claims.upn].find((v): v is string => typeof v === 'string' && v.includes('@'));
    return { sub: claims.sub, email: email?.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : undefined, groups };
  }
}

let shared: OidcClient | null = null;
export const oidcClient = () => (shared ??= new OidcClient());
