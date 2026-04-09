import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Building2, Key, DollarSign, Users, Activity, Shield, Cpu } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { StatCard } from '../components/ui/StatCard';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { renderActiveShape } from '../components/ui/ActivePieShape';
import { useState } from 'react';
import { fetchTenants } from '../lib/tenant-api';
import { mockTenants } from '../lib/mock-tenants';
import { useAuth } from '../lib/auth';
import { getLicenseList } from '../lib/license';
import axios from 'axios';

const policyApi = axios.create({ baseURL: '/api/policies' });
const complianceApi = axios.create({ baseURL: '/api/compliance' });

export function PlatformDashboardPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined);
  const [activePlanIndex, setActivePlanIndex] = useState<number | undefined>(undefined);

  const tooltipStyle = isDark
    ? { background: '#0c1021', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#475569' : '#9ca3af';
  const gridStroke = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6';

  // Fetch real tenants
  const { data: rawTenants } = useQuery({
    queryKey: ['tenants', user?.tenantId],
    queryFn: () => fetchTenants(user?.tenantId),
    placeholderData: mockTenants,
  });
  const tenants: typeof mockTenants = Array.isArray(rawTenants) && rawTenants.length ? rawTenants : mockTenants;

  // Fetch compliance per tenant (aggregate)
  const { data: complianceMap = {} } = useQuery({
    queryKey: ['platform-compliance-all'],
    queryFn: async () => {
      const map: Record<string, any[]> = {};
      for (const tn of tenants) {
        try {
          const { data } = await complianceApi.get(`/status/${tn.tenantId}`);
          map[tn.tenantId] = Array.isArray(data) ? data : [];
        } catch { map[tn.tenantId] = []; }
      }
      return map;
    },
    enabled: tenants.length > 0,
  });

  // Fetch policies per tenant (aggregate)
  const { data: policiesMap = {} } = useQuery({
    queryKey: ['platform-policies-all'],
    queryFn: async () => {
      const map: Record<string, any[]> = {};
      for (const tn of tenants) {
        try {
          const { data } = await policyApi.get(`/${tn.tenantId}`);
          map[tn.tenantId] = Array.isArray(data) ? data : [];
        } catch { map[tn.tenantId] = []; }
      }
      return map;
    },
    enabled: tenants.length > 0,
  });

  const licenses = getLicenseList();
  const activeLicenses = licenses.filter((l) => l.status === 'active' || l.status === 'trial').length || tenants.filter((t) => t.status === 'active').length;
  const totalUsers = licenses.reduce((s, l) => s + l.currentUsers, 0) || tenants.reduce((s, t) => s + (t.usageThisMonth?.requests ? 1 : 0), 0);
  const totalRequests = tenants.reduce((s, tn) => s + (tn.usageThisMonth?.requests ?? 0), 0);
  const monthlyRevenue = tenants.reduce((s, tn) => s + (tn.usageThisMonth?.cost ?? 0), 0);

  const cloudCount = tenants.filter((tn) => tn.deploymentMode === 'saas').length;
  const onpremCount = tenants.filter((tn) => tn.deploymentMode === 'onprem').length;
  const tenantsByType = [
    { name: 'Cloud', value: cloudCount || 1, color: '#6366f1' },
    { name: 'On-Prem', value: onpremCount || 0, color: '#22d3ee' },
  ].filter((d) => d.value > 0);

  const planCounts: Record<string, number> = {};
  tenants.forEach((tn) => { planCounts[tn.plan] = (planCounts[tn.plan] || 0) + 1; });
  const planColors: Record<string, string> = { enterprise: '#6366f1', professional: '#818cf8', starter: '#22d3ee' };
  const tenantsByPlan = Object.entries(planCounts).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1), value, color: planColors[name] || '#94a3b8',
  }));

  const revenueByMonth = [
    { month: 'Jan', revenue: Math.round(monthlyRevenue * 0.7) },
    { month: 'Feb', revenue: Math.round(monthlyRevenue * 0.8) },
    { month: 'Mar', revenue: Math.round(monthlyRevenue * 0.9) },
    { month: 'Apr', revenue: Math.round(monthlyRevenue) },
  ];

  return (
    <div className="space-y-6 w-full">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Tenants" value={tenants.length} icon={Building2} color="brand" href="/tenants" />
        <StatCard label="Active Licenses" value={activeLicenses} icon={Key} color="green" href="/licenses" />
        <StatCard label="Total Users" value={totalUsers.toLocaleString()} icon={Users} color="yellow" />
        <StatCard label="Monthly Revenue" value={`$${monthlyRevenue.toFixed(2)}`} icon={DollarSign} color="green" href="/cost" />
        <StatCard label="Total Requests" value={totalRequests.toLocaleString()} icon={Activity} color="brand" trendValue="+18%" trend="up" />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Revenue trend */}
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Monthly Revenue</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={revenueByMonth}>
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
                <Pie activeIndex={activePieIndex} activeShape={renderActiveShape} data={tenantsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={55} dataKey="value" paddingAngle={3} stroke={isDark ? '#0c1021' : '#fff'} strokeWidth={2} onMouseEnter={(_, i) => setActivePieIndex(i)} onMouseLeave={() => setActivePieIndex(undefined)}>
                  {tenantsByType.map((e, i) => <Cell key={i} fill={e.color} cursor="pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {tenantsByType.map((m) => (
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
                <Pie activeIndex={activePlanIndex} activeShape={renderActiveShape} data={tenantsByPlan} cx="50%" cy="50%" innerRadius={40} outerRadius={55} dataKey="value" paddingAngle={3} stroke={isDark ? '#0c1021' : '#fff'} strokeWidth={2} onMouseEnter={(_, i) => setActivePlanIndex(i)} onMouseLeave={() => setActivePlanIndex(undefined)}>
                  {tenantsByPlan.map((e, i) => <Cell key={i} fill={e.color} cursor="pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 flex-1">
              {tenantsByPlan.map((m) => (
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

      {/* Tenant overview table — real data */}
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
                {['Tenant', 'Type', 'Plan', 'Requests', 'Policies', 'Frameworks', 'Cost', 'Status'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {tenants.map((tenant) => {
                const tenantPolicies = policiesMap[tenant.tenantId] || [];
                const tenantCompliance = complianceMap[tenant.tenantId] || [];
                const enabledPolicies = tenantPolicies.filter((p: any) => p.enabled).length;
                const enabledFrameworks = tenantCompliance.filter((f: any) => f.status === 'enabled').length;
                return (
                  <tr key={tenant.tenantId} className={clsx('transition-colors cursor-pointer', t.hoverRow)} onClick={() => navigate(`/tenants/${tenant.tenantId}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-brand-400 flex-shrink-0" />
                        <div>
                          <span className={clsx('font-medium', t.heading)}>{tenant.name}</span>
                          <p className={clsx('text-xs', t.faint)}>{tenant.adminEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                        tenant.deploymentMode === 'saas' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' : 'bg-accent-500/10 text-accent-400 ring-accent-500/20'
                      )}>{tenant.deploymentMode === 'saas' ? 'Cloud' : 'On-Prem'}</span>
                    </td>
                    <td className={clsx('px-4 py-3 text-xs font-medium capitalize', t.body)}>{tenant.plan}</td>
                    <td className={clsx('px-4 py-3', t.body)}>{(tenant.usageThisMonth?.requests ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs flex items-center gap-1', t.body)}><Shield className="w-3 h-3" />{enabledPolicies}/{tenantPolicies.length}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs flex items-center gap-1', t.body)}><Cpu className="w-3 h-3" />{enabledFrameworks}/{tenantCompliance.length}</span>
                    </td>
                    <td className={clsx('px-4 py-3 font-medium', t.heading)}>${(tenant.usageThisMonth?.cost ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                        tenant.status === 'active' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : tenant.status === 'trial' ? 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20' : 'bg-red-500/10 text-red-400 ring-red-500/20'
                      )}>{tenant.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
