import { format } from 'date-fns';

interface AuditLog {
  logId: string;
  requestId: string;
  userId: string;
  modelId: string;
  provider: string;
  policyDecision: string;
  piiDetected: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs: number;
  timestamp: string;
}

const HEADERS = ['Timestamp', 'User', 'Model', 'Provider', 'Decision', 'PII Detected', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Cost (USD)', 'Latency (ms)', 'Request ID'];

function formatRow(log: AuditLog): string[] {
  return [
    format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss'),
    log.userId,
    log.modelId,
    log.provider,
    log.policyDecision,
    log.piiDetected ? 'Yes' : 'No',
    String(log.inputTokens),
    String(log.outputTokens),
    String(log.inputTokens + log.outputTokens),
    `$${log.estimatedCost.toFixed(4)}`,
    String(log.latencyMs),
    log.requestId,
  ];
}

/** Export audit logs as CSV and trigger download */
export function exportCSV(logs: AuditLog[], filename = 'audit-logs') {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [HEADERS.map(escape).join(',')];
  for (const log of logs) {
    rows.push(formatRow(log).map(escape).join(','));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

/** Export audit logs as PDF (HTML-based print) */
export function exportPDF(logs: AuditLog[], filename = 'audit-logs') {
  const rows = logs.map(formatRow);
  const html = `<!DOCTYPE html>
<html><head>
<title>${filename}</title>
<style>
  body { font-family: -apple-system, sans-serif; font-size: 11px; margin: 20px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  p { color: #666; font-size: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
  tr:nth-child(even) { background: #fafafa; }
  .block { color: #ef4444; font-weight: 600; }
  .allow { color: #10b981; }
  .pii { color: #f59e0b; font-weight: 600; }
  @media print { body { margin: 0; } }
</style>
</head><body>
<h1>Audit Logs Export</h1>
<p>Generated ${format(new Date(), 'MMMM d, yyyy HH:mm')} · ${logs.length} entries</p>
<table>
<thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((r) => `<tr>${r.map((v, i) => {
    let cls = '';
    if (i === 4) cls = v === 'block' ? ' class="block"' : ' class="allow"';
    if (i === 5 && v === 'Yes') cls = ' class="pii"';
    return `<td${cls}>${v}</td>`;
  }).join('')}</tr>`).join('\n')}
</tbody>
</table>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
