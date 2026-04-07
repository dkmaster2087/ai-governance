import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Activity, DollarSign, ShieldX, ScanEye, BadgeCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { StatCard } from '../components/ui/StatCard';
import { fetchSummary, fetchModelDistribution, fetchCostDailyBreakdown } from '../lib/api';
import { fetchComplianceStatus } from '../lib/compliance-api';
import { useTheme } from '../lib/theme';
import { mockSummary, mockModelDistribution } from '../lib/mock-data';
import { mockCompliancePacks } from '../lib/mock-compliance';
import { renderActiveShape } from '../components/ui/ActivePieShape';

const mockCostTrend = mockSummary.costTrend;

export function OverviewPage() {
  const { isDark } = useTheme();
  const tooltipStyle = isDark
    ? { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#64748b' : '#9ca3af';
  const gridStroke = isDark ? '#1e293b' : '#f3f4f6';
  const card = isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-gray-200';
  const cardInner = isDark ? 'bg-slate-800/50 hover:bg-slate-800' : 'bg-gray-100 hover:bg-gray-200';
  const heading = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-slate-400' : 'text-gray-500';
  const muted = isDark ? 'text-slate-600' : 'text-gray-400';

  const { data: summary = mockSummary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => fetchSummary(),
    placeholderData: mockSummary,
  });

  const { data: modelDist = { distribution: mockModelDistribution } } = useQuery({
    queryKey: ['model-distribution'],
    queryFn: fetchModelDistribution,
    placeholderData: { distribution: mockModelDistribution },
  });

  const { data: complianceData } = useQuery({
    queryKey: ['compliance-status'],
    queryFn: fetchComplianceStatus,
    placeholderData: mockCompliancePacks,
  });

  // Fetch live cost data from the cost endpoint
  const tenantId = (() => {
    try {
      const stored = localStorage.getItem('aegis_auth_user');
      if (stored) return JSON.parse(stored).tenantId || 'tenant_demo';
    } catch { /* empty */ }
    return 'tenant_demo';
  })();

  const { data: costBreakdownData } = useQuery({
    queryKey: ['overview-cost-breakdown', tenantId],
    queryFn: () => fetchCostDailyBreakdown(tenantId, '7d'),
  });

  // Use live cost data if available, otherwise fall back to mock
  const costTrend = costBreakdownData?.breakdown?.length
    ? costBreakdownData.breakdown.map((d: { date: string; cost: number }) => ({
        date: d.date.slice(5),
        cost: d.cost,
      }))
    : mockCostTrend;

  const compliancePacks = complianceData?.length ? complianceData : mockCompliancePacks;
  const enabledFrameworks = compliancePacks.filter((p: { status: string }) => p.status === 'enabled').length;

  const distribution = modelDist.distribution?.length ? modelDist.distribution : mockModelDistribution;
  const [activeModelIndex, setActiveModelIndex] = useState<number | undefined>(undefined);

  const blockRate = summary.totalRequests
    ? ((summary.blockedRequests / summary.totalRequests) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Requests"
          value={summary.totalRequests?.toLocaleString() ?? '—'}
          icon={Activity}
          color="brand"
          trend="up"
          trendValue="+12%"
          href="/audit-logs"
        />
        <StatCard
          label="Estimated Cost"
          value={`$${summary.totalCost?.toFixed(2) ?? '0.00'}`}
          icon={DollarSign}
          color="green"
          sub="This period"
          href="/cost"
        />
        <StatCard
          label="Blocked Requests"
          value={summary.blockedRequests?.toLocaleString() ?? '—'}
          icon={ShieldX}
          color="red"
          trendValue={`${blockRate}% rate`}
          trend="neutral"
          href="/audit-logs"
        />
        <StatCard
          label="PII Detections"
          value={summary.piiDetectionCount?.toLocaleString() ?? '—'}
          icon={ScanEye}
          color="yellow"
          sub="Masked before AI"
          href="/content-scanner"
        />
        <StatCard
          label="Compliance Frameworks"
          value={`${enabledFrameworks} / ${compliancePacks.length}`}
          icon={BadgeCheck}
          color="green"
          sub={enabledFrameworks > 0 ? 'Active' : 'None enabled'}
          href="/compliance"
        />
      </div>

      {/* Request volume chart */}
      <div className={clsx('border rounded-xl p-5', card)}>
        <h2 className={clsx('text-sm font-semibold mb-5', heading)}>Request Volume — Last 7 Days</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={summary.requestsTrend ?? mockSummary.requestsTrend}>
            <defs>
              <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="blockGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Area type="monotone" dataKey="requests" name="Requests" stroke="#6366f1" fill="url(#reqGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#f87171" fill="url(#blockGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Cost + Model distribution */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Cost trend */}
        <div className={clsx('border rounded-xl p-5', card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', heading)}>Daily Cost (USD)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={costTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']}
              />
              <Bar dataKey="cost" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Model distribution */}
        <div className={clsx('border rounded-xl p-5', card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', heading)}>Model Distribution</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  activeIndex={activeModelIndex}
                  activeShape={renderActiveShape}
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  dataKey="value"
                  paddingAngle={2}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth={2}
                  onMouseEnter={(_, index) => setActiveModelIndex(index)}
                  onMouseLeave={() => setActiveModelIndex(undefined)}
                >
                  {distribution.map((entry: { color: string }, i: number) => (
                    <Cell key={i} fill={entry.color} cursor="pointer" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {distribution.map((m: { name: string; value: number; color: string }) => (
                <li key={m.name} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                  <span className={clsx('flex-1 truncate', sub)}>{m.name}</span>
                  <span className={clsx('font-medium', heading)}>{m.value}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {/* Compliance status strip */}
      <div className={clsx('border rounded-xl p-5', card)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={clsx('text-sm font-semibold', heading)}>Compliance Frameworks</h2>
          <Link to="/compliance" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
            Manage →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {compliancePacks.map((pack: { framework: string; name: string; status: string; passedControls: number; totalControls: number }) => (
            <Link
              key={pack.framework}
              to="/compliance"
              className={clsx('flex flex-col items-center gap-2 p-3 rounded-lg transition-colors text-center', cardInner)}
            >
              <div className={`w-2 h-2 rounded-full ${
                pack.status === 'enabled' ? 'bg-accent-400' :
                pack.status === 'partial' ? 'bg-yellow-400' : 'bg-slate-600'
              }`} />
              <span className={clsx('text-xs font-medium leading-tight', isDark ? 'text-slate-300' : 'text-gray-700')}>{pack.name.split(' ')[0]}</span>
              <span className={clsx('text-xs', muted)}>
                {pack.passedControls}/{pack.totalControls}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
