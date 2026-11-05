import { collection } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';

/**
 * Audit records for a tenant between two ISO timestamps, newest first, a page at a time.
 * Stops at `maxItems` so one huge range can't exhaust memory; `truncated` says when that happened.
 */
export async function queryAuditLogs(
  tenantId: string,
  from: string,
  to: string,
  maxItems = 20_000
): Promise<{ logs: AuditLog[]; truncated: boolean }> {
  const audit = collection<AuditLog & Record<string, unknown>>('auditLogs');
  const logs: AuditLog[] = [];
  let after: string | undefined;
  do {
    const page = await audit.query({
      partition: tenantId, index: 'tenantId-timestamp-index', range: { between: [from, to] }, order: 'desc', after,
      limit: Math.min(1000, maxItems - logs.length + 1),
    });
    logs.push(...page.items);
    after = page.next;
  } while (after && logs.length < maxItems);
  return { logs: logs.slice(0, maxItems), truncated: !!after || logs.length > maxItems };
}
