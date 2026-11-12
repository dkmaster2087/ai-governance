import { collection } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { databaseCutoff, readArchive } from './archive';

/**
 * Audit records for a tenant between two ISO timestamps, newest first, a page at a time.
 * Stops at `maxItems` so one huge range can't exhaust memory; `truncated` says when that happened.
 *
 * The recent window comes from the database. Anything older than the window comes from the archive copy, which
 * is slower; `archived` says when that happened.
 */
export async function queryAuditLogs(
  tenantId: string,
  from: string,
  to: string,
  maxItems = 20_000
): Promise<{ logs: AuditLog[]; truncated: boolean; archived: boolean }> {
  const cutoff = databaseCutoff();
  const dbFrom = cutoff && from < cutoff ? cutoff : from;

  const audit = collection<AuditLog & Record<string, unknown>>('auditLogs');
  const logs: AuditLog[] = [];
  let after: string | undefined;
  if (to >= dbFrom) {
    do {
      const page = await audit.query({
        partition: tenantId, index: 'tenantId-timestamp-index', range: { between: [dbFrom, to] }, order: 'desc', after,
        limit: Math.min(1000, maxItems - logs.length + 1),
      });
      logs.push(...page.items);
      after = page.next;
    } while (after && logs.length < maxItems);
  }
  if (after || logs.length > maxItems) return { logs: logs.slice(0, maxItems), truncated: true, archived: false };

  // The older part of the range, if any, from the archive. It ends just before the database part starts.
  if (!cutoff || from >= cutoff) return { logs, truncated: false, archived: false };
  const olderTo = to < cutoff ? to : new Date(Date.parse(cutoff) - 1).toISOString();
  const older = await readArchive(tenantId, from, olderTo, maxItems - logs.length);
  return { logs: [...logs, ...older.logs], truncated: older.truncated, archived: true };
}

/** Prompts to AI models, as opposed to tool calls through MCP servers, which have their own pages. */
export const isModelTraffic = (log: AuditLog) => log.metadata?.kind !== 'mcp_tool_call';
