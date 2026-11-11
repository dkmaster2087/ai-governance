import { createPublicKey, createVerify, JsonWebKey, KeyObject } from 'crypto';

/**
 * Checks the `X-Probaline-Identity` header Probaline adds to every call it makes to your API: a five-minute
 * ES256 token naming who asked (person or workload), through which agent and tool, for which API. Refuse calls
 * without a valid one and only calls that came through Probaline reach your API.
 *
 * No dependencies: Node's own crypto and fetch (Node 18 or later).
 */

export const HEADER = 'x-probaline-identity';
export const TOKEN_TYPE = 'probaline-identity+jwt';

export interface Identity {
  /** `person:<email or id>`, `key:<api key id>` or `test:<user>`. */
  sub: string;
  kind: 'person' | 'key' | 'test' | string;
  email?: string;
  name?: string;
  groups?: string[];
  tenant: string;
  server: string;
  tool: string;
  agent?: string;
  /** Probaline's request ID, the same one in Probaline's evidence. */
  rid: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  jti?: string;
}

export type VerifyErrorCode = 'missing' | 'malformed' | 'wrong_type' | 'unknown_key' | 'bad_signature' | 'wrong_issuer' | 'wrong_audience' | 'expired' | 'not_yet_valid' | 'keys_unavailable';

export class VerifyError extends Error {
  constructor(readonly code: VerifyErrorCode, message: string) { super(message); this.name = 'VerifyError'; }
}

export interface VerifierOptions {
  /** Your Probaline gateway's address, e.g. `https://gateway.acme.example`: the token's issuer. */
  issuer: string;
  /** This API's base URL exactly as it was added to the Probaline MCP server: the token's audience. */
  audience: string;
  /** Defaults to `<issuer>/.well-known/jwks.json`. */
  jwksUrl?: string;
  /** Allowed clock difference, seconds. Default 30. */
  clockToleranceSec?: number;
  /** How long to keep the keys, ms. Default 5 minutes; an unknown key ID refetches (at most every 30 s). */
  cacheMs?: number;
  /** For tests, or to go through a proxy. */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  now?: () => number;
}

const trim = (u: string) => u.replace(/\/+$/, '');
const part = (s: string) => {
  try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { throw new VerifyError('malformed', 'The identity token is malformed'); }
};

export class Verifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private loading?: Promise<void>;
  private readonly jwksUrl: string;

  constructor(private readonly o: VerifierOptions) {
    if (!/^https?:\/\//.test(o.issuer)) throw new Error('issuer must be the gateway’s address, like https://gateway.acme.example');
    if (!o.audience) throw new Error('audience must be this API’s base URL as added to Probaline');
    this.jwksUrl = o.jwksUrl ?? `${trim(o.issuer)}/.well-known/jwks.json`;
  }

  private now() { return Math.floor((this.o.now?.() ?? Date.now()) / 1000); }

  private async refresh(force: boolean) {
    const age = Date.now() - this.fetchedAt;
    if (!force && age < (this.o.cacheMs ?? 300_000) && this.keys.size) return;
    if (force && age < 30_000) return; // don't let unknown key IDs hammer the gateway
    this.loading ??= (async () => {
      try {
        const res = await (this.o.fetch ?? ((u: string) => fetch(u)))(this.jwksUrl);
        if (!res.ok) throw new VerifyError('keys_unavailable', `Couldn’t fetch Probaline’s keys (${res.status})`);
        const body = await res.json();
        const next = new Map<string, KeyObject>();
        for (const k of (body?.keys ?? []) as Array<JsonWebKey & { kid?: string; alg?: string }>) {
          if (k.kty !== 'EC' || k.crv !== 'P-256' || !k.kid) continue;
          next.set(k.kid, createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, format: 'jwk' }));
        }
        this.keys = next;
        this.fetchedAt = Date.now();
      } catch (err) {
        if (err instanceof VerifyError) throw err;
        throw new VerifyError('keys_unavailable', `Couldn’t fetch Probaline’s keys: ${(err as Error).message}`);
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  /** The identity in a header value, or a VerifyError saying why not. */
  async verify(token: string | undefined | null): Promise<Identity> {
    if (!token) throw new VerifyError('missing', 'No X-Probaline-Identity header: the call didn’t come through Probaline');
    const parts = token.trim().split('.');
    if (parts.length !== 3) throw new VerifyError('malformed', 'The identity token is malformed');
    const header = part(parts[0]);
    const claims = part(parts[1]) as Identity & { nbf?: number };
    // Only ES256: never `none`, never a shared secret.
    if (header.alg !== 'ES256' || header.typ !== TOKEN_TYPE) throw new VerifyError('wrong_type', 'Not a Probaline identity token');

    await this.refresh(false);
    let key = this.keys.get(header.kid);
    if (!key) { await this.refresh(true); key = this.keys.get(header.kid); }
    if (!key) throw new VerifyError('unknown_key', 'The identity token was signed with a key Probaline doesn’t publish');
    const ok = createVerify('sha256').update(`${parts[0]}.${parts[1]}`).verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new VerifyError('bad_signature', 'The identity token’s signature is wrong');

    if (trim(String(claims.iss)) !== trim(this.o.issuer)) throw new VerifyError('wrong_issuer', 'The identity token is from a different Probaline gateway');
    const auds = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).map((a) => trim(String(a)));
    if (!auds.includes(trim(this.o.audience))) throw new VerifyError('wrong_audience', 'The identity token is for a different API');
    const now = this.now();
    const leeway = this.o.clockToleranceSec ?? 30;
    if (typeof claims.exp !== 'number' || now > claims.exp + leeway) throw new VerifyError('expired', 'The identity token has expired');
    if ((typeof claims.nbf === 'number' && now + leeway < claims.nbf) || (typeof claims.iat === 'number' && now + leeway < claims.iat)) {
      throw new VerifyError('not_yet_valid', 'The identity token isn’t valid yet');
    }
    return claims;
  }
}

export const createVerifier = (o: VerifierOptions) => new Verifier(o);

// ── Middleware ─────────────────────────────────────────────────────────────────────────────────────────────

export interface GuardOptions extends VerifierOptions {
  /**
   * Log calls without a valid identity instead of refusing them: the incoming preview. Turn it off once the
   * report shows only Probaline calls.
   */
  reportOnly?: boolean;
  /** Called for every call without a valid identity (refused or, in report-only mode, let through). */
  onReject?: (info: { code: VerifyErrorCode; message: string; method?: string; path?: string; ip?: string }) => void;
}

const defaultReport = (info: { code: string; message: string; method?: string; path?: string; ip?: string }) =>
  console.warn(JSON.stringify({ level: 'warn', event: 'Call without a valid Probaline identity', ...info }));

/** Shared by the Express and Fastify adapters: the identity, or null when report-only let it through. */
export async function check(verifier: Verifier, o: GuardOptions, header: unknown, meta: { method?: string; path?: string; ip?: string }) {
  try {
    return { identity: await verifier.verify(Array.isArray(header) ? header[0] : (header as string | undefined)) };
  } catch (err) {
    const e = err instanceof VerifyError ? err : new VerifyError('malformed', (err as Error).message);
    (o.onReject ?? defaultReport)({ code: e.code, message: e.message, ...meta });
    return o.reportOnly ? { identity: null } : { error: e };
  }
}

/** Express (or Connect) middleware. Sets `req.probaline` to the identity. */
export function expressGuard(o: GuardOptions) {
  const v = createVerifier(o);
  return (req: any, res: any, next: (err?: unknown) => void) => {
    check(v, o, req.headers?.[HEADER], { method: req.method, path: req.originalUrl ?? req.url, ip: req.ip }).then((r) => {
      if (r.error) {
        const status = r.error.code === 'keys_unavailable' ? 503 : 401;
        res.status(status).set('www-authenticate', 'Probaline-Identity').json({ error: r.error.message, code: r.error.code });
        return;
      }
      req.probaline = r.identity;
      next();
    }, next);
  };
}

/** Fastify `onRequest` hook. Sets `request.probaline` to the identity. */
export function fastifyGuard(o: GuardOptions) {
  const v = createVerifier(o);
  return async (request: any, reply: any) => {
    const r = await check(v, o, request.headers?.[HEADER], { method: request.method, path: request.url, ip: request.ip });
    if (r.error) {
      const status = r.error.code === 'keys_unavailable' ? 503 : 401;
      return reply.code(status).header('www-authenticate', 'Probaline-Identity').send({ error: r.error.message, code: r.error.code });
    }
    request.probaline = r.identity;
  };
}
