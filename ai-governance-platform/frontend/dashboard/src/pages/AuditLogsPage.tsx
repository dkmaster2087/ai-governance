import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { fetchAuditLogs } from '../lib/api';
import { mockAuditLogs } from '../lib/mock-data';
import { Badge } from '../components/ui/Badge';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

export function AuditLogsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState('all');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => fetchAuditLogs({ limit: 100 }),
    placeholderData: { logs: mockAuditLogs },
  });

  const logs: typeof mockAuditLogs = data?.logs?.length ? data.logs : mockAuditLogs;

  const filtered = logs.filter((log) => {
    const matchSearch =
      !search ||
      log.userId.includes(search) ||
      log.modelId.includes(search) ||
      log.requestId.includes(search);
    const matchDecision = decision === 'all' || log.policyDecision === decision;
    return matchSearch && matchDecision;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className={clsx('absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4', t.muted)} />
          <input
            type="text"
            placeholder="Search by user, model, request ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={clsx('w-full border rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </div>
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          className={clsx('border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
        >
          <option value="all">All decisions</option>
          <option value="allow">Allowed</option>
          <option value="block">Blocked</option>
        </select>
        <button
          onClick={() => refetch()}
          className={clsx('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors', t.btnSecondary)}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm transition-colors">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Table */}
      <div className={clsx('border rounded-xl overflow-hidden', t.card)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Timestamp', 'User', 'Model', 'Provider', 'Decision', 'PII', 'Tokens', 'Cost', 'Latency'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className={clsx('h-4 rounded animate-pulse w-20', isDark ? 'bg-slate-800' : 'bg-gray-200')} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className={clsx('px-4 py-12 text-center', t.sub)}>
                    No logs found
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr key={log.logId} className={clsx('transition-colors', t.hoverRow)}>
                    <td className={clsx('px-4 py-3 whitespace-nowrap font-mono text-xs', t.sub)}>
                      {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.body)}>{log.userId}</td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap font-mono text-xs max-w-[160px] truncate', t.body)}>
                      {log.modelId}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={log.provider} variant="neutral" />
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={log.policyDecision}
                        variant={log.policyDecision === 'block' ? 'block' : 'allow'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {log.piiDetected ? (
                        <Badge label="Detected" variant="warn" />
                      ) : (
                        <span className={clsx('text-xs', t.faint)}>—</span>
                      )}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>
                      {log.inputTokens + log.outputTokens}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>
                      ${log.estimatedCost.toFixed(4)}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>
                      {log.latencyMs}ms
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={clsx('px-4 py-3 border-t text-xs', t.border, t.muted)}>
          Showing {filtered.length} of {logs.length} entries
        </div>
      </div>
    </div>
  );
}
