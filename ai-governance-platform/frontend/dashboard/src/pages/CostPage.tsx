import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DollarSign, TrendingUp, Calendar, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { StatCard } from '../components/ui/StatCard';
import { fetchCostSummary, fetchCostDailyBreakdown, fetchCostUsers } from '../lib/api';
import { renderActiveShape } from '../components/ui/ActivePieShape';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth } from '../lib/auth';

const PERIODS = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
] as const;

const PIE_COLORS = ['#6366f1', '#818cf8', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#94a3b8'];

// ── Mock fallback data ──────────────────────────────────────────────────────
const mockCostSummary = {
  totalCost: 127.45,
  dailyAverage: 4.25,
  projectedMonthly: 127.5,
  totalRequests: 8420,
  costByModel: [
    { modelId: 'anthropic.claude-3-haiku', cost: 42.1, requests: 4200 },
    { modelId: 'anthropic.claude-3-sonnet', cost: 58.3, requests: 2800 },
    { modelId: 'gpt-4o', cost: 27.05, requests: 1420 },
  ],
  costByUser: [
    { userId: 'user_1', cost: 38.2, requests: 2100 },
    { userId: 'user_2', cost: 31.5, requests: 1800 },
    { userId: 'user_3', cost: 24.8, requests: 1600 },
    { userId: 'user_4', cost: 18.6, requests: 1400 },
    { userId: 'user_5', cost: 14.35, requests: 1520 },
  ],
};

const mockBreakdown = {
  breakdown: Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return { date: d.toISOString().slice(0, 10), cost: +(Math.random() * 8 + 2).toFixed(2) };
  }),
};

const mockUsers = {
  users: mockCostSummary.costByUser.map((u) => ({
    ...u,
    inputTokens: Math.floor(Math.random() * 500000) + 50000,
    outputTokens: Math.floor(Math.random() * 200000) + 20000,
  })),
};

const BUDGET_DEFAULT = 500;
const ALERT_THRESHOLD_DEFAULT = 80;

export function CostPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user, isPlatformAdmin } = useAuth();
  const tenantId = user?.tenantId || 'tenant_demo';
  const [period, setPeriod] = useState<string>('30d');
  const [activeCostModelIndex, setActiveCostModelIndex] = useState<number | undefined>(undefined);

  const tooltipStyle = isDark
    ? { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#64748b' : '#9ca3af';
  const gridStroke = isDark ? '#1e293b' : '#f3f4f6';

  const { data: summary = mockCostSummary } = useQuery({
    queryKey: ['cost-summary', tenantId, period],
    queryFn: () => fetchCostSummary(tenantId, period),
    placeholderData: mockCostSummary,
  });

  const { data: breakdownData = mockBreakdown } = useQuery({
    queryKey: ['cost-breakdown', tenantId, period],
    queryFn: () => fetchCostDailyBreakdown(tenantId, period),
    placeholderData: mockBreakdown,
  });

  const { data: usersData = mockUsers } = useQuery({
    queryKey: ['cost-users', tenantId, period],
    queryFn: () => fetchCostUsers(tenantId, period),
    placeholderData: mockUsers,
  });

  const budgetUSD = BUDGET_DEFAULT;
  const alertThreshold = ALERT_THRESHOLD_DEFAULT;
  const budgetUsedPercent = Math.min(100, (summary.totalCost / budgetUSD) * 100);
  const budgetRemaining = Math.max(0, budgetUSD - summary.totalCost);
  const isOverAlert = budgetUsedPercent >= alertThreshold;

  const modelPieData = (summary.costByModel || []).map(
    (m: { modelId: string; cost: number }, i: number) => ({
      name: m.modelId.split('.').pop() || m.modelId,
      value: +m.cost.toFixed(2),
      color: PIE_COLORS[i % PIE_COLORS.length],
    })
  );

  const breakdown = breakdownData.breakdown || [];
  const users = usersData.users || [];

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center justify-between">
        <p className={clsx('text-sm', t.sub)}>Cost analytics for {user?.tenantName}</p>
        <div className={clsx('flex rounded-lg border overflow-hidden', t.border)}>
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                period === p.value
                  ? 'bg-brand-600 text-white'
                  : clsx(t.btnSecondary)
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Cost"
          value={`$${summary.totalCost?.toFixed(2) ?? '0.00'}`}
          icon={DollarSign}
          color="green"
          sub="This period"
        />
        <StatCard
          label="Daily Average"
          value={`$${summary.dailyAverage?.toFixed(2) ?? '0.00'}`}
          icon={Calendar}
          color="brand"
          sub="Per day"
        />
        <StatCard
          label="Projected Monthly"
          value={`$${summary.projectedMonthly?.toFixed(2) ?? '0.00'}`}
          icon={TrendingUp}
          color="yellow"
          sub="At current rate"
        />
        <StatCard
          label="Budget Remaining"
          value={`$${budgetRemaining.toFixed(2)}`}
          icon={AlertTriangle}
          color={isOverAlert ? 'red' : 'green'}
          sub={`${budgetUsedPercent.toFixed(0)}% of $${budgetUSD} used`}
        />
      </div>

      {/* Budget progress bar */}
      <div className={clsx('border rounded-xl p-5', t.card)}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={clsx('text-sm font-semibold', t.heading)}>Monthly Budget</h2>
          <span className={clsx('text-xs', t.sub)}>
            ${summary.totalCost?.toFixed(2)} / ${budgetUSD.toFixed(2)}
          </span>
        </div>
        <div className={clsx('w-full h-3 rounded-full overflow-hidden', t.track)}>
          <div className="relative h-full rounded-full">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-500',
                isOverAlert ? 'bg-red-500' : 'bg-accent-500'
              )}
              style={{ width: `${Math.min(100, budgetUsedPercent)}%` }}
            />
            {/* Alert threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-400"
              style={{ left: `${alertThreshold}%` }}
              title={`Alert at ${alertThreshold}%`}
            />
          </div>
        </div>
        <div className="flex justify-between mt-2">
          <span className={clsx('text-xs', t.muted)}>$0</span>
          <span className={clsx('text-xs', isOverAlert ? 'text-red-400' : t.muted)}>
            {isOverAlert ? `⚠ Over ${alertThreshold}% threshold` : `Alert at ${alertThreshold}%`}
          </span>
          <span className={clsx('text-xs', t.muted)}>${budgetUSD}</span>
        </div>
      </div>

      {/* Daily cost trend + Cost by model */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Daily cost bar chart */}
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Daily Cost Trend (USD)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={breakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="date"
                tick={{ fill: tickFill, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tick={{ fill: tickFill, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']}
              />
              <Bar dataKey="cost" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost by model pie chart */}
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Cost by Model</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  activeIndex={activeCostModelIndex}
                  activeShape={renderActiveShape}
                  data={modelPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  dataKey="value"
                  paddingAngle={2}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth={2}
                  onMouseEnter={(_, index) => setActiveCostModelIndex(index)}
                  onMouseLeave={() => setActiveCostModelIndex(undefined)}
                >
                  {modelPieData.map((entry: { color: string }, i: number) => (
                    <Cell key={i} fill={entry.color} cursor="pointer" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {modelPieData.map((m: { name: string; value: number; color: string }) => (
                <li key={m.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: m.color }}
                  />
                  <span className={clsx('flex-1 truncate', t.sub)}>{m.name}</span>
                  <span className={clsx('font-medium', t.heading)}>${m.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Cost by user table */}
      <div className={clsx('border rounded-xl p-5', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Top Users by Spend</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                <th className={clsx('text-left py-2 pr-4 font-medium', t.sub)}>Rank</th>
                <th className={clsx('text-left py-2 pr-4 font-medium', t.sub)}>User</th>
                <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Requests</th>
                <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Input Tokens</th>
                <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Output Tokens</th>
                <th className={clsx('text-right py-2 font-medium', t.sub)}>Cost</th>
              </tr>
            </thead>
            <tbody className={t.divider}>
              {users.map((u: { userId: string; cost: number; requests: number; inputTokens: number; outputTokens: number }, i: number) => (
                <tr key={u.userId} className={t.hoverRow}>
                  <td className={clsx('py-2.5 pr-4', t.muted)}>{i + 1}</td>
                  <td className={clsx('py-2.5 pr-4 font-medium', t.heading)}>{u.userId}</td>
                  <td className={clsx('py-2.5 pr-4 text-right', t.body)}>{u.requests.toLocaleString()}</td>
                  <td className={clsx('py-2.5 pr-4 text-right', t.body)}>{u.inputTokens.toLocaleString()}</td>
                  <td className={clsx('py-2.5 pr-4 text-right', t.body)}>{u.outputTokens.toLocaleString()}</td>
                  <td className={clsx('py-2.5 text-right font-medium', t.heading)}>${u.cost.toFixed(2)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className={clsx('py-8 text-center', t.muted)}>No usage data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Platform admin: tenant comparison */}
      {isPlatformAdmin && (
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>Tenant Cost Comparison</h2>
          <p className={clsx('text-xs mb-4', t.sub)}>Platform-wide view across all tenants</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={clsx('border-b', t.border)}>
                  <th className={clsx('text-left py-2 pr-4 font-medium', t.sub)}>Tenant</th>
                  <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Requests</th>
                  <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Cost</th>
                  <th className={clsx('text-right py-2 pr-4 font-medium', t.sub)}>Budget</th>
                  <th className={clsx('text-right py-2 font-medium', t.sub)}>Usage</th>
                </tr>
              </thead>
              <tbody className={t.divider}>
                {[
                  { name: 'Demo Corp', requests: 8420, cost: 127.45, budget: 500 },
                  { name: 'HealthCo Systems', requests: 3200, cost: 68.9, budget: 300 },
                  { name: 'FinTech Inc', requests: 12100, cost: 245.3, budget: 1000 },
                ].map((tenant) => (
                  <tr key={tenant.name} className={t.hoverRow}>
                    <td className={clsx('py-2.5 pr-4 font-medium', t.heading)}>{tenant.name}</td>
                    <td className={clsx('py-2.5 pr-4 text-right', t.body)}>{tenant.requests.toLocaleString()}</td>
                    <td className={clsx('py-2.5 pr-4 text-right font-medium', t.heading)}>${tenant.cost.toFixed(2)}</td>
                    <td className={clsx('py-2.5 pr-4 text-right', t.body)}>${tenant.budget}</td>
                    <td className="py-2.5 text-right">
                      <span className={clsx(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        (tenant.cost / tenant.budget) * 100 > 80
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-accent-500/20 text-accent-400'
                      )}>
                        {((tenant.cost / tenant.budget) * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
