import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, RefreshCw, FileSpreadsheet, FileText, ChevronDown, Clock, Calendar } from 'lucide-react';
import { format, subHours, subDays, subMonths, isAfter } from 'date-fns';
import clsx from 'clsx';
import { fetchAuditLogs } from '../lib/api';
import { mockAuditLogs } from '../lib/mock-data';
import { Badge } from '../components/ui/Badge';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { exportCSV, exportPDF } from '../lib/export';

type TimePeriod = '1h' | '3h' | '7h' | '24h' | '3d' | '7d' | '30d' | 'custom';

const TIME_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: '1h',  label: 'Last 1 hour' },
  { value: '3h',  label: 'Last 3 hours' },
  { value: '7h',  label: 'Last 7 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '3d',  label: 'Last 3 days' },
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

function getCutoff(period: TimePeriod): Date {
  const now = new Date();
  switch (period) {
    case '1h':  return subHours(now, 1);
    case '3h':  return subHours(now, 3);
    case '7h':  return subHours(now, 7);
    case '24h': return subHours(now, 24);
    case '3d':  return subDays(now, 3);
    case '7d':  return subDays(now, 7);
    case '30d': return subMonths(now, 1);
    default:    return subHours(now, 24);
  }
}

export function AuditLogsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState('all');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => fetchAuditLogs({ limit: 500 }),
    placeholderData: { logs: mockAuditLogs },
  });

  const logs: typeof mockAuditLogs = data?.logs?.length ? data.logs : mockAuditLogs;

  const filtered = logs.filter((log) => {
    const matchSearch =
      !search ||
      log.userId.toLowerCase().includes(search.toLowerCase()) ||
      log.modelId.toLowerCase().includes(search.toLowerCase()) ||
      log.requestId.toLowerCase().includes(search.toLowerCase());
    const matchDecision = decision === 'all' || log.policyDecision === decision;

    // Time filter
    let matchTime = true;
    const logDate = new Date(log.timestamp);
    if (timePeriod === 'custom') {
      if (customFrom) matchTime = matchTime && isAfter(logDate, new Date(customFrom));
      if (customTo) matchTime = matchTime && !isAfter(logDate, new Date(customTo + 'T23:59:59'));
    } else {
      matchTime = isAfter(logDate, getCutoff(timePeriod));
    }

    return matchSearch && matchDecision && matchTime;
  });

  const selectedTimeLabel = TIME_OPTIONS.find((o) => o.value === timePeriod)?.label ?? '24h';

  return (
    <div className="space-y-4">
      {/* Time period filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Clock className={clsx('w-4 h-4', t.muted)} />
        {TIME_OPTIONS.filter((o) => o.value !== 'custom').map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTimePeriod(opt.value)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              timePeriod === opt.value
                ? 'bg-brand-600 text-white'
                : clsx(t.btnSecondary)
            )}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => setTimePeriod('custom')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            timePeriod === 'custom'
              ? 'bg-brand-600 text-white'
              : clsx(t.btnSecondary)
          )}
        >
          <Calendar className="w-3 h-3" />
          Custom
        </button>
      </div>

      {/* Custom date range inputs */}
      {timePeriod === 'custom' && (
        <div className="flex items-center gap-3">
          <div>
            <label className={clsx('block text-xs mb-1', t.sub)}>From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className={clsx('border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
            />
          </div>
          <div>
            <label className={clsx('block text-xs mb-1', t.sub)}>To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className={clsx('border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
            />
          </div>
          {(customFrom || customTo) && (
            <button
              onClick={() => { setCustomFrom(''); setCustomTo(''); }}
              className={clsx('mt-5 text-xs transition-colors', t.muted, t.hoverText)}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Search / filter / export toolbar */}
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
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Export
            <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', exportOpen && 'rotate-180')} />
          </button>
          {exportOpen && (
            <div className={clsx('absolute right-0 top-full mt-1 z-20 border rounded-xl shadow-xl py-1 w-48', t.card)}>
              <button
                onClick={() => { exportCSV(filtered); setExportOpen(false); }}
                className={clsx('w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left', t.body, t.hoverRow)}
              >
                <FileSpreadsheet className="w-4 h-4 text-accent-400" />
                <div>
                  <p className={clsx('font-medium', t.heading)}>CSV</p>
                  <p className={clsx('text-xs', t.muted)}>Spreadsheet format</p>
                </div>
              </button>
              <button
                onClick={() => { exportPDF(filtered); setExportOpen(false); }}
                className={clsx('w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left', t.body, t.hoverRow)}
              >
                <FileText className="w-4 h-4 text-red-400" />
                <div>
                  <p className={clsx('font-medium', t.heading)}>PDF</p>
                  <p className={clsx('text-xs', t.muted)}>Print-ready document</p>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className={clsx('border rounded-xl overflow-hidden', t.card)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Timestamp', 'User', 'Model', 'Provider', 'Decision', 'PII', 'Tokens', 'Cost', 'Latency'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>{h}</th>
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
                    No logs found for {selectedTimeLabel.toLowerCase()}
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr key={log.logId} className={clsx('transition-colors', t.hoverRow)}>
                    <td className={clsx('px-4 py-3 whitespace-nowrap font-mono text-xs', t.sub)}>
                      {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.body)}>{log.userId}</td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap font-mono text-xs max-w-[160px] truncate', t.body)}>{log.modelId}</td>
                    <td className="px-4 py-3"><Badge label={log.provider} variant="neutral" /></td>
                    <td className="px-4 py-3"><Badge label={log.policyDecision} variant={log.policyDecision === 'block' ? 'block' : 'allow'} /></td>
                    <td className="px-4 py-3">
                      {log.piiDetected ? <Badge label="Detected" variant="warn" /> : <span className={clsx('text-xs', t.faint)}>—</span>}
                    </td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>{log.inputTokens + log.outputTokens}</td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>${log.estimatedCost.toFixed(4)}</td>
                    <td className={clsx('px-4 py-3 whitespace-nowrap', t.sub)}>{log.latencyMs}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={clsx('px-4 py-3 border-t text-xs flex items-center justify-between', t.border, t.muted)}>
          <span>Showing {filtered.length} of {logs.length} entries</span>
          <span>{selectedTimeLabel}</span>
        </div>
      </div>
    </div>
  );
}
