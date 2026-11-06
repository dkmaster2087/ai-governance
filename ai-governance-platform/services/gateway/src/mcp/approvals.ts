import { createHash, randomBytes } from 'crypto';
import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { callBackend, checkBaseUrl } from './egress';
import { McpApi, McpTool, ServerConfig } from './types';
import type { Caller } from './calls';

const logger = createLogger('gateway:mcp-approvals');

export type ApprovalStatus = 'pending' | 'approved' | 'refused' | 'expired' | 'used';

/** A request to run a write tool that needs a person's approval. Kept 90 days. */
export interface Approval {
  tenantId: string;
  /** `<fingerprint>-<id>`: the fingerprint finds an earlier request for exactly the same call. */
  approvalId: string;
  fingerprint: string;
  serverId: string;
  serverName: string;
  tool: string;
  toolTitle: string;
  method: string;
  path: string;
  apiName: string;
  /** The arguments as checked (secrets already refused). JSON. */
  arguments: string;
  caller: { kind: Caller['kind']; id: string; label: string; email?: string; userId?: string };
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  usedAt?: string;
  usedRequestId?: string;
  ttl: number;
}

const approvals = () => collection<Approval>('mcpApprovals');
const KEEP_DAYS = 90;
/** After approval, the agent has at least this long to ask again. */
const AFTER_APPROVAL_MS = 60 * 60_000;

/** Same server, tool, caller and arguments (key order doesn't matter) → same fingerprint. */
export function fingerprint(tenantId: string, serverId: string, tool: string, callerId: string, args: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify([tenantId, serverId, tool, callerId, canonical(args)])).digest('hex').slice(0, 24);
}

export const callerLabel = (c: Caller) => c.kind === 'person' ? (c.email || c.id) : c.kind === 'test' ? `${c.email || c.userId} (test console)` : `${c.appId} (API key)`;

export type Gate =
  | { outcome: 'approved'; approval: Approval }
  | { outcome: 'pending'; approval: Approval }
  | { outcome: 'refused'; approval: Approval };

export class ApprovalService {
  constructor(private pollMs = 1000) {}

  async list(tenantId: string): Promise<Approval[]> {
    const all = await allPages((after) => approvals().query({ partition: tenantId, after }), 2000);
    const now = Date.now();
    return all.map((a) => (a.status === 'pending' && Date.parse(a.expiresAt) <= now ? { ...a, status: 'expired' as const } : a))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get = (tenantId: string, approvalId: string) => approvals().get({ tenantId, approvalId });

  /** The newest open request (pending or approved, not expired) for exactly this call. */
  private async findOpen(tenantId: string, fp: string): Promise<Approval | null> {
    const page = await approvals().query({ partition: tenantId, range: { beginsWith: `${fp}-` } });
    const now = Date.now();
    for (const a of page.items.sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
      if (a.status !== 'pending' && a.status !== 'approved') continue;
      if (Date.parse(a.expiresAt) <= now) {
        await approvals().update({ tenantId, approvalId: a.approvalId }, { set: { status: 'expired' }, where: { status: a.status } });
        continue;
      }
      return a;
    }
    return null;
  }

  /**
   * Before a write tool runs: use an approval already given for this exact call, or ask for one and wait
   * up to `waitSeconds` for a person to decide. An approval is used once.
   */
  async gate(o: { server: ServerConfig & { tenantId: string; serverId: string }; tool: McpTool; api: McpApi; args: Record<string, unknown>; caller: Caller; requestId: string }): Promise<Gate> {
    const { server, tool, caller } = o;
    const tenantId = server.tenantId;
    const fp = fingerprint(tenantId, server.serverId, tool.name, caller.id, o.args);
    let approval = await this.findOpen(tenantId, fp);
    if (!approval) {
      const now = new Date();
      approval = {
        tenantId, approvalId: `${fp}-${now.getTime().toString(36)}${randomBytes(3).toString('hex')}`, fingerprint: fp,
        serverId: server.serverId, serverName: server.name, tool: tool.name, toolTitle: tool.title, method: tool.method, path: tool.path, apiName: o.api.name,
        arguments: JSON.stringify(o.args ?? {}).slice(0, 20_000),
        caller: { kind: caller.kind, id: caller.id, label: callerLabel(caller), ...(caller.email ? { email: caller.email.toLowerCase() } : {}), ...(caller.kind === 'test' ? { userId: caller.userId } : {}) },
        status: 'pending', createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + server.approvals.expiresMinutes * 60_000).toISOString(),
        ttl: Math.floor(now.getTime() / 1000) + KEEP_DAYS * 86_400,
      };
      await approvals().put(approval);
      logger.info('Approval requested', { tenantId, approvalId: approval.approvalId, server: server.serverId, tool: tool.name });
      this.notify(server, approval).catch((err) => logger.warn('Approval notification failed', { error: (err as Error).message }));
    }

    const deadline = Date.now() + Math.max(0, server.approvals.waitSeconds) * 1000;
    for (;;) {
      if (approval!.status === 'approved') {
        const used = await approvals().update({ tenantId, approvalId: approval!.approvalId },
          { set: { status: 'used', usedAt: new Date().toISOString(), usedRequestId: o.requestId }, where: { status: 'approved' } });
        // Another call used it first: this one has to ask again.
        if (used) return { outcome: 'approved', approval: used };
        return this.gate(o);
      }
      if (approval!.status === 'refused') return { outcome: 'refused', approval: approval! };
      if (approval!.status !== 'pending' || Date.now() >= deadline) return { outcome: 'pending', approval: approval! };
      await new Promise((r) => setTimeout(r, Math.min(this.pollMs, Math.max(0, deadline - Date.now()))));
      approval = (await this.get(tenantId, approval!.approvalId)) ?? approval;
    }
  }

  /** An approver decides. Only pending, unexpired requests can be decided, once. */
  async decide(tenantId: string, approvalId: string, decision: 'approved' | 'refused', by: { id: string; email?: string }, reason?: string): Promise<Approval | 'not_found' | 'already_decided' | 'expired' | 'own_request'> {
    const a = await this.get(tenantId, approvalId);
    if (!a) return 'not_found';
    if (a.status !== 'pending') return 'already_decided';
    if (Date.parse(a.expiresAt) <= Date.now()) return 'expired';
    // Nobody approves their own request: four eyes.
    if ((a.caller.email && by.email && a.caller.email === by.email.toLowerCase()) || (a.caller.userId && a.caller.userId === by.id)) return 'own_request';
    const now = new Date();
    const updated = await approvals().update({ tenantId, approvalId }, {
      set: {
        status: decision, decidedBy: by.email || by.id, decidedAt: now.toISOString(), ...(reason ? { reason: reason.slice(0, 500) } : {}),
        ...(decision === 'approved' ? { expiresAt: new Date(Math.max(Date.parse(a.expiresAt), now.getTime() + AFTER_APPROVAL_MS)).toISOString() } : {}),
      },
      where: { status: 'pending' },
    });
    if (!updated) return 'already_decided';
    logger.info(`Approval ${decision}`, { tenantId, approvalId, by: by.email || by.id });
    return updated;
  }

  /** Tell approvers something is waiting (Slack, Teams or any incoming webhook). Only a summary is sent, never the arguments. */
  private async notify(server: ServerConfig, a: Approval) {
    if (!server.approvals.webhookUrl) return;
    const url = checkBaseUrl(server.approvals.webhookUrl);
    const text = `Probaline: ${a.caller.label} wants to run "${a.toolTitle || a.tool}" (${a.method} ${a.path}) on ${a.serverName}. Approve or refuse it in the dashboard under MCP servers → Approvals.`;
    await callBackend({ url, method: 'POST', headers: { 'user-agent': 'Probaline-MCP/1.0' }, body: JSON.stringify({ text }), maxBytes: 10_000, timeoutMs: 5000 });
  }
}
