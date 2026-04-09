import { useState } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Building2, Cpu, Shield, Activity, ShieldX, ScanEye, DollarSign } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { StatCard } from '../components/ui/StatCard';

const PERIODS = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
] as const;

const TENANTS = [
  { id: 'all', name: 'All Tenants' },
  { id: 'demo_corp', name: 'Demo Corp' },
  { id: 'healthco', name: 'HealthCo Systems' },
  { id: 'fintech', name: 'FinTech Inc' },
  { id: 'legalfirm', name: 'LegalFirm LLP' },
  { id: 'retailmax', name: 'RetailMax' },
];

const tenantData: Record<string, any> = {
  all: {
    totalRequests: 128400, blockedRequests: 452, piiDetections: 509, totalCost: 4820.50,
    requestsTrend: Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return { date: d.toISOString().slice(5, 10), requests: Math.floor(Math.random() * 8000) + 4000, blocked: Math.floor(Math.random() * 40) + 5 }; }),
    modelUsage: [
      { model: 'Claude 3 Haiku', requests: 48200, cost: 1240 },
      { model: 'Claude 3 Sonnet', requests: 32100, cost: 1680 },
      { model: 'GPT-4o', requests: 28400, cost: 1420 },
      { model: 'Titan Express', requests: 12300, cost: 320 },
      { model: 'Llama 3 70B', requests: 7400, cost: 160 },
    ],
    topUsers: [
      { user: 'sarah_k@democorp.com', tenant: 'Demo Corp', requests: 8200, cost: 245.30 },
      { user: 'dr_chen@healthco.com', tenant: 'HealthCo', requests: 7100, cost: 312.40 },
      { user: 'james_t@fintech.io', tenant: 'FinTech', requests: 6400, cost: 198.50 },
      { user: 'priya_m@democorp.com', tenant: 'Demo Corp', requests: 5800, cost: 172.80 },
      { user: 'nurse_j@healthco.com', tenant: 'HealthCo', requests: 5200, cost: 156.20 },
    ],
  },
  demo_corp: {
    totalRequests: 32400, blockedRequests: 234, piiDetections: 89, totalCost: 890.50,
    requestsTrend: Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return { date: d.toISOString().slice(5, 10), requests: Math.floor(Math.random() * 3000) + 1000, blocked: Math.floor(Math.random() * 20) + 2 }; }),
    modelUsage: [
      { model: 'Claude 3 Haiku', requests: 18200, cost: 320.10 },
      { model: 'Claude 3 Sonnet', requests: 9800, cost: 410.20 },
      { model: 'GPT-4o', requests: 4400, cost: 160.20 },
    ],
    topUsers: [
      { user: 'sarah_k', tenant: 'Demo Corp', requests: 8200, cost: 245.30 },
      { user: 'priya_m', tenant: 'Demo Corp', requests: 5800, cost: 172.80 },
      { user: 'carlos_r', tenant: 'Demo Corp', requests: 4200, cost: 128.50 },
    ],
  },
  healthco: {
    totalRequests: 54200, blockedRequests: 12, piiDetections: 340, totalCost: 1650.00,
    requestsTrend: Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return { date: d.toISOString().slice(5, 10), requests: Math.floor(Math.random() * 5000) + 2000, blocked: Math.floor(Math.random() * 5) }; }),
    modelUsage: [
      { model: 'Claude 3 Haiku', requests: 42000, cost: 1200 },
      { model: 'Claude 3 Sonnet', requests: 12200, cost: 450 },
    ],
    topUsers: [
      { user: 'dr_chen', tenant: 'HealthCo', requests: 7100, cost: 312.40 },
      { user: 'nurse_j', tenant: 'HealthCo', requests: 5200, cost: 156.20 },
    ],
  },
};

// Fill remaining tenants with demo_corp-like data
['fintech', 'legalfirm', 'retailmax'].forEach((id) => {
  if (!tenantData[id]) tenantData[id] = { ...tenantData.demo_corp, totalRequests: Math.floor(Math.random() * 30000) + 5000 };
});

export function AnalyticsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [period, setPeriod] = useState('30d');
  const [selectedTenant, setSelectedTenant] = useState('all');

  const tooltipStyle = isDark
    ? { background: '#0c1021', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#475569' : '#9ca3af';
  const gridStroke = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6';

  const data = tenantData[selectedTenant] || tenantData.all;
  const tenantLabel = TENANTS.find((t) => t.id === selectedTenant)?.name || 'All Tenants';

  return (
    <div className="space-y-6 w-full">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Building2 className={clsx('w-4 h-4', t.muted)} />
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className={clsx('border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
          >
            {TENANTS.map((tn) => (
              <option key={tn.id} value={tn.id}>{tn.name}</option>
            ))}
          </select>
        </div>
        <div className={clsx('flex rounded-xl border overflow-hidden', t.border)}>
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)} className={clsx('px-3 py-1.5 text-xs font-medium transition-colors', period === p.value ? 'bg-brand-600 text-white' : t.btnSecondary)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className={clsx('ml-auto text-xs', t.muted)}>Showing data for {tenantLabel}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Requests" value={data.totalRequests?.toLocaleString()} icon={Activity} color="brand" />
        <StatCard label="Blocked Requests" value={data.blockedRequests?.toLocaleString()} icon={ShieldX} color="red" />
        <StatCard label="PII Detections" value={data.piiDetections?.toLocaleString()} icon={ScanEye} color="yellow" />
        <StatCard label="Total Cost" value={`$${data.totalCost?.toFixed(2)}`} icon={DollarSign} color="green" />
      </div>

      {/* Request volume chart */}
      <div className={clsx('border rounded-2xl p-5', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Request Volume — {tenantLabel}</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.requestsTrend}>
            <defs>
              <linearGradient id="reqGradA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="blockGradA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            <Area type="monotone" dataKey="requests" name="Requests" stroke="#6366f1" fill="url(#reqGradA)" strokeWidth={2} />
            <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#f87171" fill="url(#blockGradA)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Model usage */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Model Usage</h2>
          <div className="space-y-3">
            {(data.modelUsage || []).map((row: any) => {
              const max = Math.max(...(data.modelUsage || []).map((r: any) => r.requests));
              return (
                <div key={row.model}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={clsx('text-sm font-medium flex items-center gap-2', t.heading)}>
                      <Cpu className="w-3.5 h-3.5 text-accent-400" />{row.model}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={clsx('text-xs', t.sub)}>{row.requests.toLocaleString()}</span>
                      <span className={clsx('text-xs font-medium', t.heading)}>${row.cost?.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className={clsx('h-2 rounded-full overflow-hidden', t.track)}>
                    <div className="h-full bg-accent-500 rounded-full" style={{ width: `${(row.requests / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top users */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Top Users by Usage</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={clsx('border-b', t.border)}>
                  {['User', selectedTenant === 'all' ? 'Tenant' : null, 'Requests', 'Cost'].filter(Boolean).map((h) => (
                    <th key={h!} className={clsx('text-left py-2 pr-3 text-xs font-medium', t.muted)}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={clsx('divide-y', t.divider)}>
                {(data.topUsers || []).map((u: any) => (
                  <tr key={u.user} className={t.hoverRow}>
                    <td className={clsx('py-2.5 pr-3 font-medium', t.heading)}>{u.user}</td>
                    {selectedTenant === 'all' && <td className={clsx('py-2.5 pr-3 text-xs', t.sub)}>{u.tenant}</td>}
                    <td className={clsx('py-2.5 pr-3', t.body)}>{u.requests.toLocaleString()}</td>
                    <td className={clsx('py-2.5 font-medium', t.heading)}>${u.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
