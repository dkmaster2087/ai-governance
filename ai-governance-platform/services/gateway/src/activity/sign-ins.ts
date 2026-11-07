import { createHash } from 'crypto';
import { FastifyRequest } from 'fastify';
import { ActivityLog, ActivityOutcome, Actor, activityLog } from './activity-log';
import { requestMeta } from './admin-activity';

/**
 * Sign-in records: dashboard sessions, refused API keys and people signing in to MCP servers.
 *
 * Dashboard passwords are checked by Cognito in the browser, so Probaline can't see a failed password. It
 * records a session once, the first time the gateway sees a token from that sign-in (Cognito's `auth_time`).
 * Failed dashboard sign-ins are in CloudTrail (see docs/ARCHITECTURE.md, "Logs").
 */
export class SignInRecorder {
  private seenSessions = new Map<string, number>();
  private recentRefusals = new Map<string, number>();

  constructor(private log: () => ActivityLog = activityLog, private now = () => Date.now()) {}

  /** A dashboard user's session, once per sign-in. */
  dashboardSession(request: FastifyRequest, tenantId: string, claims: { sub: string; email?: string; 'custom:role'?: string; auth_time?: number }) {
    const authTime = claims.auth_time ?? 0;
    const key = `${claims.sub}|${authTime}`;
    if (this.seenSessions.has(key)) return;
    this.trim(this.seenSessions, 5000);
    this.seenSessions.set(key, this.now());
    void this.log().record({
      tenantId,
      category: 'sign_in',
      action: 'sign_in.dashboard',
      outcome: 'success',
      actor: { type: 'user', id: claims.sub, email: claims.email, role: claims['custom:role'] },
      // Same time and ID on every gateway instance, so the session is recorded once.
      ...(authTime ? { time: new Date(authTime * 1000).toISOString() } : {}),
      eventId: `si_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`,
      ...requestMeta(request),
    });
  }

  /** A known API key that was refused (revoked, expired, used for another tenant). At most one a minute per key and reason. */
  keyRefused(request: FastifyRequest, key: { tenantId: string; keyId: string; name?: string }, code: string) {
    const k = `${key.keyId}|${code}`;
    const last = this.recentRefusals.get(k);
    if (last && this.now() - last < 60_000) return;
    this.trim(this.recentRefusals, 5000);
    this.recentRefusals.set(k, this.now());
    void this.log().record({
      tenantId: key.tenantId,
      category: 'sign_in',
      action: 'sign_in.api_key',
      outcome: 'denied',
      actor: { type: 'api_key', id: key.keyId, keyId: key.keyId },
      ...requestMeta(request),
      detail: { reason: code, ...(key.name ? { keyName: key.name.slice(0, 80) } : {}) },
    });
  }

  /** Someone signing in to the company's MCP servers (or the sign-in ending). */
  mcp(request: FastifyRequest, tenantId: string, action: string, outcome: ActivityOutcome, person: { sub?: string; email?: string } | undefined, detail: Record<string, string> = {}) {
    const actor: Actor = { type: 'person', id: person?.sub ?? 'unknown', email: person?.email };
    void this.log().record({ tenantId, category: 'sign_in', action, outcome, actor, ...requestMeta(request), detail });
  }

  private trim(map: Map<string, number>, max: number) {
    if (map.size < max) return;
    for (const k of [...map.keys()].slice(0, Math.floor(max / 2))) map.delete(k);
  }
}

let shared: SignInRecorder | null = null;
export function signIns(): SignInRecorder {
  if (!shared) shared = new SignInRecorder();
  return shared;
}
