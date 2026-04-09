import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Building2, Cpu, Shield, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

const PERIODS = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
] as const;

const mockAnalytics = {
  requestsByTenant: [
    { tenant: 'Demo Corp', requests: 32400, blocked: 234, pii: 89 },
    { tenant: 'HealthCo', requests: 54200, blocked: 12, pii: 340 },
    { tenant: 'FinTech', requests: 28100, blocked: 156, pii: 45 },
    { tenant: 'LegalFirm', requests: 5400, blocked: 8, pii: 12 },
    { tenant: 'RetailMax', requests: 8300, blocked: 42, pii: 23 },
  ],
  modelUsage: [
    { model: 'Claude 3 Haiku', requests: 48200, tenants: 8 },
    { model: 'Claude 3 Sonnet', requests: 32100, tenants: 6 },
    { model: 'GPT-4o', requests: 28400, tenants: 5 },
    { model: 'Titan Express', requests: 12300, tenants: 3 },
    { model: 'Llama 3 70B', requests: 7400, tenants: 2 },
  ],
  complianceOverview: [
    { tenant: 'Demo Corp', frameworks: ['NIST', 'SOC2', 'GDPR'], enabled: 3, total: 6 },
    { tenant: 'HealthCo', frameworks: ['HIPAA', 'SOC2', 'NIST', 'GDPR', 'ISO42001', 'PIPEDA'], enabled: 6, total: 6 },
    { tenant: 'FinTech', frameworks: ['SOC2', 'GDPR', 'PIPEDA'], enabled: 3, total: 6 },
    { tenant: 'LegalFirm', frameworks: ['GDPR', 'PIPEDA'], enabled: 2, total: 6 },
    { tenant: 'RetailMax', frameworks: ['NIST', 'SOC2', 'GDPR'], enabled: 3, total: 6 },
  ],
  dailyRequests: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return { date: d.toISOString().slice(5, 10), requests: Math.floor(Math.random() * 8000) + 4000 };
  }),
};

export function AnalyticsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [period, setPeriod] = useState('30d');

  const tooltipStyle = isDark
    ? { background: '#0c1021', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#475569' : '#9ca3af';
  const gridStroke = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6';

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <p className={clsx('text-sm', t.sub)}>Cross-tenant usage analytics</p>
        <div className={clsx('flex rounded-xl border overflow-hidden', t.border)}>
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)} className={clsx('px-3 py-1.5 text-xs font-medium transition-colors', period === p.value ? 'bg-brand-600 text-white' : t.btnSecondary)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daily requests chart */}
      <div className={clsx('border rounded-2xl p-5', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Platform-wide Requests</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={mockAnalytics.dailyRequests}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'Requests']} />
            <Bar dataKey="requests" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Requests by tenant */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Requests by Tenant</h2>
          <div className="space-y-3">
            {mockAnalytics.requestsByTenant.map((row) => {
              const max = Math.max(...mockAnalytics.requestsByTenant.map((r) => r.requests));
              return (
                <div key={row.tenant}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={clsx('text-sm font-medium flex items-center gap-2', t.heading)}>
                      <Building2 className="w-3.5 h-3.5 text-brand-400" />{row.tenant}
                    </span>
                    <span className={clsx('text-xs', t.sub)}>{row.requests.toLocaleString()}</span>
                  </div>
                  <div className={clsx('h-2 rounded-full overflow-hidden', t.track)}>
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(row.requests / max) * 100}%` }} />
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-[10px] text-red-400">{row.blocked} blocked</span>
                    <span className="text-[10px] text-yellow-400">{row.pii} PII</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Model usage */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Model Usage Across Tenants</h2>
          <div className="space-y-3">
            {mockAnalytics.modelUsage.map((row) => {
              const max = Math.max(...mockAnalytics.modelUsage.map((r) => r.requests));
              return (
                <div key={row.model}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={clsx('text-sm font-medium flex items-center gap-2', t.heading)}>
                      <Cpu className="w-3.5 h-3.5 text-accent-400" />{row.model}
                    </span>
                    <span className={clsx('text-xs', t.sub)}>{row.requests.toLocaleString()} · {row.tenants} tenants</span>
                  </div>
                  <div className={clsx('h-2 rounded-full overflow-hidden', t.track)}>
                    <div className="h-full bg-accent-500 rounded-full" style={{ width: `${(row.requests / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Compliance overview */}
      <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
        <div className={clsx('px-5 py-4 border-b', t.border)}>
          <h2 className={clsx('text-sm font-semibold', t.heading)}>Compliance Framework Adoption</h2>
          <p className={clsx('text-xs mt-0.5', t.muted)}>Which frameworks each tenant has enabled</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                <th className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>Tenant</th>
                <th className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>Frameworks</th>
                <th className={clsx('text-right px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>Coverage</th>
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {mockAnalytics.complianceOverview.map((row) => (
                <tr key={row.tenant} className={t.hoverRow}>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>{row.tenant}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.frameworks.map((fw) => (
                        <span key={fw} className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium ring-1', 'bg-brand-500/10 text-brand-400 ring-brand-500/20')}>{fw}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className={clsx('w-16 h-1.5 rounded-full overflow-hidden', t.track)}>
                        <div className="h-full bg-accent-400 rounded-full" style={{ width: `${(row.enabled / row.total) * 100}%` }} />
                      </div>
                      <span className={clsx('text-xs font-medium', t.heading)}>{row.enabled}/{row.total}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
