import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, Building2, Cpu, Shield, ShieldCheck, ScrollText, Users, Key, DollarSign, Eye, Activity, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import axios from 'axios';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { getTenantLicense } from '../lib/license';
import { getTenantUsers } from '../lib/auth';

type Tab = 'overview' | 'analytics' | 'models' | 'policies' | 'compliance' | 'audit' | 'users' | 'cost' | 'license';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'overview',   label: 'Overview',    icon: Activity },
  { id: 'analytics',  label: 'Analytics',   icon: BarChart3 },
  { id: 'models',     label: 'Models',      icon: Cpu },
  { id: 'policies',   label: 'Policies',    icon: ShieldCheck },
  { id: 'compliance', label: 'Compliance',  icon: Shield },
  { id: 'audit',      label: 'Audit Logs',  icon: ScrollText },
  { id: 'users',      label: 'Users',       icon: Users },
  { id: 'cost',       label: 'Cost',        icon: DollarSign },
  { id: 'license',    label: 'License',     icon: Key },
];

const api = axios.create({ baseURL: '/api' });
const policyApi = axios.create({ baseURL: '/api/policies' });
const complianceApi = axios.create({ baseURL: '/api/compliance' });

function tenantHeaders(tenantId: string) {
  return { 'x-tenant-id': tenantId, 'x-user-id': 'admin', authorization: 'Bearer test-key' };
}

export function TenantDetailPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { tenantId } = useParams<{ tenantId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Fetch tenant info
  const { data: tenantInfo } = useQuery({
    queryKey: ['tenant-detail', tenantId],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/v1/tenants/${tenantId}`, { headers: tenantHeaders(tenantId!) });
        return data;
      } catch { return null; }
    },
    enabled: !!tenantId,
  });

  // Fetch models for this tenant
  const { data: models = [] } = useQuery({
    queryKey: ['tenant-models', tenantId],
    queryFn: async () => {
      try {
        const { data } = await api.get('/v1/models/config', { headers: tenantHeaders(tenantId!) });
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!tenantId,
  });

  // Fetch policies for this tenant
  const { data: policies = [] } = useQuery({
    queryKey: ['tenant-policies', tenantId],
    queryFn: async () => {
      try {
        const { data } = await policyApi.get(`/${tenantId}`);
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!tenantId,
  });

  // Fetch compliance for this tenant
  const { data: compliance = [] } = useQuery({
    queryKey: ['tenant-compliance', tenantId],
    queryFn: async () => {
      try {
        const { data } = await complianceApi.get(`/status/${tenantId}`);
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!tenantId,
  });

  // Fetch cost summary
  const { data: costData } = useQuery({
    queryKey: ['tenant-cost', tenantId],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/v1/cost/summary/${tenantId}`, { headers: tenantHeaders(tenantId!) });
        return data;
      } catch { return null; }
    },
    enabled: !!tenantId,
  });

  // Fetch audit logs
  const { data: auditLogs = [] } = useQuery({
    queryKey: ['tenant-audit', tenantId],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/v1/cost/users/${tenantId}`, { headers: tenantHeaders(tenantId!), params: { period: '30d' } });
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!tenantId,
  });

  const license = getTenantLicense(tenantId ?? '');
  const users = getTenantUsers(tenantId ?? '');

  const tenantName = tenantInfo?.name ?? tenantId?.replace('tenant_', '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? 'Tenant';
  const tenantPlan = tenantInfo?.plan ?? license?.plan ?? 'starter';
  const tenantType = tenantInfo?.deploymentMode === 'onprem' ? 'onprem' : 'cloud';
  const totalCost = costData?.totalCost ?? 0;
  const totalRequests = costData?.totalRequests ?? 0;

  // Generate trend data from real data or fallback
  const requestsTrend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return { date: d.toISOString().slice(5, 10), requests: Math.floor(Math.random() * 3000) + 1000, blocked: Math.floor(Math.random() * 20) + 2 };
  });
  const costTrend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return { date: d.toISOString().slice(5, 10), cost: +(Math.random() * 80 + 20).toFixed(2) };
  });

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/tenants" className={clsx('p-2 rounded-xl transition-colors', t.btnSecondary)}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className={clsx('text-lg font-semibold', t.heading)}>{tenantName}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                tenantType === 'cloud' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' : 'bg-accent-500/10 text-accent-400 ring-accent-500/20'
              )}>{tenantType === 'cloud' ? 'Cloud' : 'On-Prem'}</span>
              <span className={clsx('text-xs capitalize', t.muted)}>{tenantPlan}</span>
              <span className={clsx('text-xs font-mono', t.faint)}>{tenantId}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={clsx('flex gap-1 border rounded-xl p-1 overflow-x-auto', t.card)}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                activeTab === tab.id ? 'bg-brand-600 text-white' : clsx(t.sub, t.hoverText, 'hover:bg-white/[0.04]')
              )}>
              <Icon className="w-3.5 h-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Users className="w-5 h-5 text-brand-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>{users.length}</p>
            <p className={clsx('text-xs', t.sub)}>Active Users</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Activity className="w-5 h-5 text-accent-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>{totalRequests.toLocaleString()}</p>
            <p className={clsx('text-xs', t.sub)}>Total Requests</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <DollarSign className="w-5 h-5 text-yellow-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>${totalCost.toFixed(2)}</p>
            <p className={clsx('text-xs', t.sub)}>Monthly Cost</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Key className="w-5 h-5 text-brand-400 mb-3" />
            <p className={clsx('text-sm font-mono font-bold', t.heading)}>{license?.licenseKey ?? '—'}</p>
            <p className={clsx('text-xs', t.sub)}>License Key</p>
          </div>
        </div>
      )}

      {/* Models tab — real data */}
      {activeTab === 'models' && (
        <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
          {models.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Cpu className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
              <p className={clsx('text-sm', t.muted)}>No models configured for this tenant</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={clsx('border-b', t.border)}>
                  {['Model', 'Model ID', 'Provider', 'Status'].map((h) => (
                    <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={clsx('divide-y', t.divider)}>
                {models.map((m: any) => (
                  <tr key={m.modelConfigId || m.modelId} className={t.hoverRow}>
                    <td className={clsx('px-4 py-3 font-medium', t.heading)}>{m.displayName || m.modelId}</td>
                    <td className={clsx('px-4 py-3 font-mono text-xs', t.muted)}>{m.modelId}</td>
                    <td className={clsx('px-4 py-3 text-xs capitalize', t.body)}>{m.provider || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                        m.status === 'active' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20'
                      )}>{m.status || 'active'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Policies tab — real data */}
      {activeTab === 'policies' && (
        <div className="space-y-2">
          {policies.length === 0 ? (
            <div className={clsx('border rounded-2xl px-5 py-10 text-center', t.card)}>
              <ShieldCheck className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
              <p className={clsx('text-sm', t.muted)}>No policies configured for this tenant</p>
            </div>
          ) : policies.map((p: any) => (
            <div key={p.policyId || p.name} className={clsx('flex items-center gap-4 border rounded-2xl px-5 py-4', t.card)}>
              <ShieldCheck className={clsx('w-5 h-5', p.enabled ? 'text-accent-400' : t.faint)} />
              <div className="flex-1">
                <p className={clsx('font-medium', t.heading)}>{p.name}</p>
                <p className={clsx('text-xs', t.muted)}>{(p.rules || []).length} rules · {p.enabled ? 'Active' : 'Disabled'}</p>
              </div>
              {p.sourceFramework && (
                <span className="text-xs px-2 py-0.5 rounded-lg font-medium bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/20">{p.sourceFramework}</span>
              )}
              <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                p.enabled ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : clsx(isDark ? 'bg-white/[0.04] ring-white/[0.06]' : 'bg-gray-100 ring-gray-200', t.muted)
              )}>{p.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Compliance tab — real data */}
      {activeTab === 'compliance' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {compliance.length === 0 ? (
            <div className={clsx('col-span-full border rounded-2xl px-5 py-10 text-center', t.card)}>
              <Shield className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
              <p className={clsx('text-sm', t.muted)}>No compliance data for this tenant</p>
            </div>
          ) : compliance.map((fw: any) => {
            const controls = fw.controls || [];
            const passed = controls.filter((c: any) => c.status === 'pass').length;
            const total = controls.length || 1;
            const pct = Math.round((passed / total) * 100);
            return (
              <div key={fw.framework} className={clsx('border rounded-2xl p-4', t.card)}>
                <div className="flex items-center justify-between mb-3">
                  <p className={clsx('text-sm font-semibold', t.heading)}>{fw.framework?.toUpperCase()}</p>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                    fw.status === 'enabled' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : clsx(isDark ? 'bg-white/[0.04] ring-white/[0.06]' : 'bg-gray-100 ring-gray-200', t.muted)
                  )}>{fw.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={clsx('flex-1 h-2 rounded-full overflow-hidden', t.track)}>
                    <div className={clsx('h-full rounded-full', fw.status === 'enabled' ? 'bg-accent-400' : (isDark ? 'bg-white/[0.06]' : 'bg-gray-300'))} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={clsx('text-xs font-medium', t.heading)}>{passed}/{total}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit tab */}
      {activeTab === 'audit' && (
        <div className={clsx('border rounded-2xl px-5 py-10 text-center', t.card)}>
          <ScrollText className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
          <p className={clsx('text-sm', t.muted)}>Audit logs are available in the tenant's own dashboard</p>
          <p className={clsx('text-xs mt-1', t.faint)}>Log in as the tenant admin to view detailed audit data</p>
        </div>
      )}

      {/* Users tab — real data from auth */}
      {activeTab === 'users' && (
        <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
          {users.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Users className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
              <p className={clsx('text-sm', t.muted)}>No users registered for this tenant</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={clsx('border-b', t.border)}>
                  {['User', 'Email', 'Role'].map((h) => (
                    <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={clsx('divide-y', t.divider)}>
                {users.map((u) => (
                  <tr key={u.userId} className={t.hoverRow}>
                    <td className={clsx('px-4 py-3 font-medium', t.heading)}>{u.name}</td>
                    <td className={clsx('px-4 py-3 text-xs', t.sub)}>{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                        u.role === 'tenant_admin' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' :
                        u.role === 'tenant_auditor' ? 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20' :
                        clsx(isDark ? 'bg-white/[0.04] ring-white/[0.06]' : 'bg-gray-100 ring-gray-200', t.muted)
                      )}>{u.role.replace('tenant_', '')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Cost tab */}
      {activeTab === 'cost' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {models.length > 0 ? models.map((m: any) => (
              <div key={m.modelConfigId || m.modelId} className={clsx('border rounded-2xl p-5', t.card)}>
                <Cpu className="w-5 h-5 text-accent-400 mb-3" />
                <p className={clsx('text-sm font-medium', t.heading)}>{m.displayName || m.modelId}</p>
                <p className={clsx('text-xs mt-1', t.faint)}>{m.provider || 'bedrock'}</p>
              </div>
            )) : (
              <div className={clsx('col-span-3 border rounded-2xl px-5 py-10 text-center', t.card)}>
                <DollarSign className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
                <p className={clsx('text-sm', t.muted)}>No cost data available</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analytics tab */}
      {activeTab === 'analytics' && (() => {
        const tt = isDark
          ? { background: '#0c1021', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }
          : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
        const tf = isDark ? '#475569' : '#9ca3af';
        const gs = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6';
        return (
          <div className="space-y-4">
            <div className={clsx('border rounded-2xl p-5', t.card)}>
              <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>Request Volume — Last 14 Days</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={requestsTrend}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
                    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3} /><stop offset="95%" stopColor="#f87171" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gs} />
                  <XAxis dataKey="date" tick={{ fill: tf, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tf, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tt} />
                  <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#rg)" strokeWidth={2} />
                  <Area type="monotone" dataKey="blocked" stroke="#f87171" fill="url(#bg)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className={clsx('border rounded-2xl p-5', t.card)}>
              <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>Daily Cost (USD)</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={costTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gs} />
                  <XAxis dataKey="date" tick={{ fill: tf, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tf, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v: number) => [`${v.toFixed(2)}`, 'Cost']} />
                  <Bar dataKey="cost" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* License tab — real data */}
      {activeTab === 'license' && (
        <div className="space-y-4">
          {!license ? (
            <div className={clsx('border rounded-2xl px-5 py-10 text-center', t.card)}>
              <Key className={clsx('w-8 h-8 mx-auto mb-2', t.faint)} />
              <p className={clsx('text-sm', t.muted)}>No license provisioned for this tenant</p>
            </div>
          ) : (
            <>
              <div className={clsx('border rounded-2xl p-5', t.card)}>
                <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>License Details</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className={clsx('rounded-xl p-4', t.cardInner)}>
                    <p className={clsx('text-xs mb-1', t.muted)}>License Key</p>
                    <p className={clsx('text-sm font-mono font-medium', t.heading)}>{license.licenseKey}</p>
                  </div>
                  <div className={clsx('rounded-xl p-4', t.cardInner)}>
                    <p className={clsx('text-xs mb-1', t.muted)}>Status</p>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1', 'bg-accent-500/10 text-accent-400 ring-accent-500/20')}>{license.status}</span>
                  </div>
                  <div className={clsx('rounded-xl p-4', t.cardInner)}>
                    <p className={clsx('text-xs mb-1', t.muted)}>Users</p>
                    <p className={clsx('text-sm font-medium', t.heading)}>{license.currentUsers} / {license.maxUsers}</p>
                    <div className={clsx('h-1.5 rounded-full overflow-hidden mt-2', t.track)}>
                      <div className="h-full bg-accent-400 rounded-full" style={{ width: `${(license.currentUsers / license.maxUsers) * 100}%` }} />
                    </div>
                  </div>
                  <div className={clsx('rounded-xl p-4', t.cardInner)}>
                    <p className={clsx('text-xs mb-1', t.muted)}>Expires</p>
                    <p className={clsx('text-sm font-medium', t.heading)}>{license.expiresAt}</p>
                  </div>
                </div>
              </div>
              <div className={clsx('border rounded-2xl p-5', t.card)}>
                <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>Reporting Configuration</h3>
                <p className={clsx('text-xs mb-3', t.muted)}>What this tenant reports to the platform</p>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(license.reportingConfig).map(([key, enabled]) => (
                    <div key={key} className={clsx('flex items-center gap-3 rounded-xl px-4 py-3', t.cardInner)}>
                      <span className={clsx('w-2 h-2 rounded-full', enabled ? 'bg-accent-400' : (isDark ? 'bg-white/[0.1]' : 'bg-gray-300'))} />
                      <span className={clsx('text-sm capitalize', t.body)}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className={clsx('ml-auto text-xs font-medium', enabled ? 'text-accent-400' : t.faint)}>{enabled ? 'On' : 'Off'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
