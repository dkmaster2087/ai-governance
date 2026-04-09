import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Building2, Key, DollarSign, Users, Activity, Shield, Cpu, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { StatCard } from '../components/ui/StatCard';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { renderActiveShape } from '../components/ui/ActivePieShape';
import { useState } from 'react';

// Mock data for platform dashboard — in production this comes from aggregated tenant data
const mockPlatformData = {
  totalTenants: 12,
  activeLicenses: 10,
  totalUsers: 247,
  monthlyRevenue: 4820.50,
  totalRequests: 128400,
  tenantsByType: [
    { name: 'Cloud', value: 8, color: '#6366f1' },
    { name: 'On-Prem', value: 4, color: '#22d3ee' },
  ],
  tenantsByPlan: [
    { name: 'Enterprise', value: 3, color: '#6366f1' },
    { name: 'Professional', value: 5, color: '#818cf8' },
    { name: 'Starter', value: 4, color: '#22d3ee' },
  ],
  revenueByMonth: [
    { month: 'Jan', revenue: 3200 },
    { month: 'Feb', revenue: 3800 },
    { month: 'Mar', revenue: 4100 },
    { month: 'Apr', revenue: 4820 },
  ],
  topTenants: [
    { name: 'Demo Corp', type: 'cloud', plan: 'professional', users: 45, requests: 32400, cost: 890.50, status: 'active', models: 3, frameworks: 4 },
    { name: 'HealthCo Systems', type: 'onprem', plan: 'enterprise', users: 120, requests: 54200, cost: 1650.00, status: 'active', models: 2, frameworks: 6 },
    { name: 'FinTech Inc', type: 'cloud', plan: 'enterprise', users: 38, requests: 28100, cost: 1240.30, status: 'active', models: 4, frameworks: 3 },
    { name: 'LegalFirm LLP', type: 'cloud', plan: 'starter', users: 12, requests: 5400, cost: 180.20, status: 'active', models: 1, frameworks: 2 },
    { name: 'RetailMax', type: 'onprem', plan: 'professional', users: 32, requests: 8300, cost: 420.50, status: 'trial', models: 2, frameworks: 3 },
  ],
  licenseUsage: [
    { date: '03-24', active: 8 },
    { date: '03-25', active: 9 },
    { date: '03-26', active: 9 },
    { date: '03-27', active: 10 },
    { date: '03-28', active: 10 },
    { date: '03-29', active: 10 },
    { date: '03-30', active: 10 },
  ],
};

export function PlatformDashboardPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined);
  const [activePlanIndex, setActivePlanIndex] = useState<number | undefined>(undefined);

  const tooltipStyle = isDark
    ? { background: '#0c1021', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#475569' : '#9ca3af';
  const gridStroke = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6';

  const data = mockPlatformData;

  return (
    <div className="space-y-6 w-full">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Tenants" value={data.totalTenants} icon={Building2} color="brand" href="/tenants" />
        <StatCard label="Active Licenses" value={data.activeLicenses} icon={Key} color="green" href="/licenses" />
        <StatCard label="Total Users" value={data.totalUsers.toLocaleString()} icon={Users} color="yellow" />
        <StatCard label="Monthly Revenue" value={`$${data.monthlyRevenue.toLocaleString()}`} icon={DollarSign} color="green" href="/cost" />
        <StatCard label="Total Requests" value={data.totalRequests.toLocaleString()} icon={Activity} color="brand" trendValue="+18%" trend="up" />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Revenue trend */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Monthly Revenue</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="month" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tenants by type */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Tenants by Deployment</h2>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie activeIndex={activePieIndex} activeShape={renderActiveShape} data={data.tenantsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={55} dataKey="value" paddingAngle={3} stroke={isDark ? '#0c1021' : '#fff'} strokeWidth={2} onMouseEnter={(_, i) => setActivePieIndex(i)} onMouseLeave={() => setActivePieIndex(undefined)}>
                  {data.tenantsByType.map((e, i) => <Cell key={i} fill={e.color} cursor="pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {data.tenantsByType.map((m) => (
                <li key={m.name} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                  <span className={clsx('flex-1', t.sub)}>{m.name}</span>
                  <span className={clsx('font-semibold', t.heading)}>{m.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Tenants by plan */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Tenants by Plan</h2>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie activeIndex={activePlanIndex} activeShape={renderActiveShape} data={data.tenantsByPlan} cx="50%" cy="50%" innerRadius={40} outerRadius={55} dataKey="value" paddingAngle={3} stroke={isDark ? '#0c1021' : '#fff'} strokeWidth={2} onMouseEnter={(_, i) => setActivePlanIndex(i)} onMouseLeave={() => setActivePlanIndex(undefined)}>
                  {data.tenantsByPlan.map((e, i) => <Cell key={i} fill={e.color} cursor="pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {data.tenantsByPlan.map((m) => (
                <li key={m.name} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                  <span className={clsx('flex-1', t.sub)}>{m.name}</span>
                  <span className={clsx('font-semibold', t.heading)}>{m.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Tenant overview table */}
      <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
        <div className={clsx('px-5 py-4 border-b flex items-center justify-between', t.border)}>
          <div>
            <h2 className={clsx('text-sm font-semibold', t.heading)}>Tenant Overview</h2>
            <p className={clsx('text-xs mt-0.5', t.muted)}>All tenants across cloud and on-prem deployments</p>
          </div>
          <Link to="/tenants" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Tenant', 'Type', 'Plan', 'Users', 'Requests', 'Models', 'Frameworks', 'Cost', 'Status'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {data.topTenants.map((tenant) => (
                <tr key={tenant.name} className={clsx('transition-colors', t.hoverRow)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-brand-400 flex-shrink-0" />
                      <span className={clsx('font-medium', t.heading)}>{tenant.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                      tenant.type === 'cloud' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' : 'bg-accent-500/10 text-accent-400 ring-accent-500/20'
                    )}>{tenant.type === 'cloud' ? 'Cloud' : 'On-Prem'}</span>
                  </td>
                  <td className={clsx('px-4 py-3 text-xs font-medium capitalize', t.body)}>{tenant.plan}</td>
                  <td className={clsx('px-4 py-3', t.body)}>{tenant.users}</td>
                  <td className={clsx('px-4 py-3', t.body)}>{tenant.requests.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs flex items-center gap-1', t.body)}><Cpu className="w-3 h-3" />{tenant.models}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs flex items-center gap-1', t.body)}><Shield className="w-3 h-3" />{tenant.frameworks}</span>
                  </td>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>${tenant.cost.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                      tenant.status === 'active' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20'
                    )}>{tenant.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* License usage chart */}
      <div className={clsx('border rounded-2xl p-5', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Active Licenses — Last 7 Days</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.licenseUsage}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="active" fill="#22d3ee" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
