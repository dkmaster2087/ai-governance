import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAccess } from '../auth/guards';
import { Approval, ApprovalService } from '../mcp/approvals';
import { mcpStore } from '../mcp/store';
import { withDefaults } from '../mcp/types';

/**
 * The approvals queue: write tools marked "needs approval" wait here until a person decides. Approvers are the
 * people a server names (any role), or the company's admins when it names nobody. Nobody decides their own.
 */

const ANY_USER = { roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'] as const };
const decisionInput = z.object({ reason: z.string().trim().max(500).optional() });

export async function mcpApprovalRoutes(app: FastifyInstance, opts: { approvals?: ApprovalService } = {}) {
  const approvals = opts.approvals ?? new ApprovalService();

  /** Approvers per server, read once per request. */
  async function approversOf(request: FastifyRequest) {
    const servers = await mcpStore.listServers(request.tenantId);
    return new Map(servers.map((s) => [s.serverId, withDefaults(s).approvals.approvers.map((e) => e.toLowerCase())]));
  }
  const me = (request: FastifyRequest) => {
    const p = request.principal;
    return p?.kind === 'user' ? { id: p.userId, email: p.email?.toLowerCase(), role: p.role } : null;
  };
  const mayDecide = (a: Pick<Approval, 'serverId'>, approvers: Map<string, string[]>, who: NonNullable<ReturnType<typeof me>>) => {
    const listed = approvers.get(a.serverId) ?? [];
    if (listed.length) return !!who.email && listed.includes(who.email);
    return who.role === 'tenant_admin' || who.role === 'platform_admin';
  };

  app.get('/v1/mcp/approvals', { preHandler: requireAccess({ roles: [...ANY_USER.roles] }) }, async (request) => {
    const who = me(request)!;
    const approvers = await approversOf(request);
    const all = await approvals.list(request.tenantId);
    // Admins and auditors see everything; others only what they may decide.
    const visible = who.role === 'tenant_user' ? all.filter((a) => mayDecide(a, approvers, who)) : all;
    return visible.slice(0, 500).map((a) => ({
      ...a,
      canDecide: a.status === 'pending' && mayDecide(a, approvers, who)
        && !((a.caller.email && a.caller.email === who.email) || (a.caller.userId && a.caller.userId === who.id)),
    }));
  });

  const decide = (decision: 'approved' | 'refused') => async (request: FastifyRequest, reply: any) => {
    const who = me(request)!;
    const { approvalId } = request.params as { approvalId: string };
    const parsed = decisionInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid reason', code: 'INVALID_DECISION' });
    const a = await approvals.get(request.tenantId, approvalId);
    if (!a) return reply.status(404).send({ error: 'Request not found', code: 'NOT_FOUND' });
    if (!mayDecide(a, await approversOf(request), who)) return reply.status(403).send({ error: 'You are not an approver for this MCP server', code: 'NOT_AN_APPROVER' });
    const r = await approvals.decide(request.tenantId, approvalId, decision, { id: who.id, email: who.email }, parsed.data.reason);
    if (r === 'not_found') return reply.status(404).send({ error: 'Request not found', code: 'NOT_FOUND' });
    if (r === 'already_decided') return reply.status(409).send({ error: 'Someone already decided this request', code: 'ALREADY_DECIDED' });
    if (r === 'expired') return reply.status(409).send({ error: 'This request has expired', code: 'EXPIRED' });
    if (r === 'own_request') return reply.status(403).send({ error: 'You can’t decide your own request', code: 'OWN_REQUEST' });
    return r;
  };
  app.post('/v1/mcp/approvals/:approvalId/approve', { preHandler: requireAccess({ roles: [...ANY_USER.roles] }) }, decide('approved'));
  app.post('/v1/mcp/approvals/:approvalId/refuse', { preHandler: requireAccess({ roles: [...ANY_USER.roles] }) }, decide('refused'));
}
