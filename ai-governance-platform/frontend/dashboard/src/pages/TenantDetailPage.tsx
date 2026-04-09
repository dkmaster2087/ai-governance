import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Building2, Cpu, Shield, ShieldCheck, ScrollText, Users, Key, DollarSign, Eye, Activity } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

type Tab = 'overview' | 'models' | 'policies' | 'compliance' | 'audit' | 'users' | 'cost';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'overview',   label: 'Overview',    icon: Activity },
  { id: 'models',     label: 'Models',      icon: Cpu },
  { id: 'policies',   label: 'Policies',    icon: ShieldCheck },
  { id: 'compliance', label: 'Compliance',  icon: Shield },
  { id: 'audit',      label: 'Audit Logs',  icon: ScrollText },
  { id: 'users',      label: 'Users',       icon: Users },
  { id: 'cost',       label: 'Cost',        icon: DollarSign },
];

// Mock tenant detail data
const mockTenantDetail = {
  name: 'Demo Corp',
  tenantId: 'tenant_demo',
  plan: 'professional',
  type: 'cloud',
  status: 'active',
  users: 45,
  requests: 32400,
  cost: 890.50,
  license: 'AEGIS-DEMO-XXXX-XXXX',
  models: [
    { name: 'Claude 3 Haiku', modelId: 'anthropic.claude-3-haiku', status: 'active', requests: 18200, cost: 320.10 },
    { name: 'Claude 3 Sonnet', modelId: 'anthropic.claude-3-sonnet', status: 'active', requests: 9800, cost: 410.20 },
    { name: 'GPT-4o', modelId: 'gpt-4o', status: 'testing', requests: 4400, cost: 160.20 },
  ],
  policies: [
    { name: 'PII Protection', enabled: true, rules: 3, sourceFramework: null },
    { name: 'GDPR — Required Controls', enabled: true, rules: 4, sourceFramework: 'gdpr' },
    { name: 'SOC 2 — Required Controls', enabled: true, rules: 2, sourceFramework: 'soc2' },
    { name: 'Keyword Block', enabled: true, rules: 1, sourceFramework: null },
  ],
  compliance: [
    { framework: 'NIST AI RMF', status: 'enabled', passed: 3, total: 6 },
    { framework: 'SOC 2', status: 'enabled', passed: 4, total: 6 },
    { framework: 'GDPR', status: 'enabled', passed: 4, total: 6 },
    { framework: 'HIPAA', status: 'disabled', passed: 0, total: 6 },
    { framework: 'ISO 42001', status: 'disabled', passed: 0, total: 5 },
    { framework: 'PIPEDA', status: 'disabled', passed: 0, total: 5 },
  ],
  recentAudit: [
    { time: '14:22', user: 'user_1', model: 'claude-3-haiku', decision: 'allow', tokens: 842 },
    { time: '14:18', user: 'user_3', model: 'gpt-4o', decision: 'block', tokens: 0 },
    { time: '14:15', user: 'user_1', model: 'claude-3-sonnet', decision: 'allow', tokens: 1240 },
    { time: '14:10', user: 'user_2', model: 'claude-3-haiku', decision: 'allow', tokens: 560 },
    { time: '14:05', user: 'user_4', model: 'claude-3-haiku', decision: 'allow', tokens: 920 },
  ],
  topUsers: [
    { userId: 'user_1', name: 'Sarah K.', requests: 8200, cost: 245.30 },
    { userId: 'user_2', name: 'James T.', requests: 6100, cost: 182.40 },
    { userId: 'user_3', name: 'Priya M.', requests: 5400, cost: 156.80 },
    { userId: 'user_4', name: 'Carlos R.', requests: 4200, cost: 128.50 },
  ],
};

export function TenantDetailPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { tenantId } = useParams<{ tenantId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tenant = mockTenantDetail; // In production, fetch by tenantId

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
            <h1 className={clsx('text-lg font-semibold', t.heading)}>{tenant.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                tenant.type === 'cloud' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' : 'bg-accent-500/10 text-accent-400 ring-accent-500/20'
              )}>{tenant.type === 'cloud' ? 'Cloud' : 'On-Prem'}</span>
              <span className={clsx('text-xs capitalize', t.muted)}>{tenant.plan}</span>
              <span className={clsx('text-xs font-mono', t.faint)}>{tenant.tenantId}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={clsx('flex gap-1 border rounded-xl p-1 overflow-x-auto', t.card)}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                activeTab === tab.id ? 'bg-brand-600 text-white' : clsx(t.sub, t.hoverText, 'hover:bg-white/[0.04]')
              )}
            >
              <Icon className="w-3.5 h-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Users className="w-5 h-5 text-brand-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>{tenant.users}</p>
            <p className={clsx('text-xs', t.sub)}>Active Users</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Activity className="w-5 h-5 text-accent-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>{tenant.requests.toLocaleString()}</p>
            <p className={clsx('text-xs', t.sub)}>Total Requests</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <DollarSign className="w-5 h-5 text-yellow-400 mb-3" />
            <p className={clsx('text-2xl font-bold', t.heading)}>${tenant.cost.toFixed(2)}</p>
            <p className={clsx('text-xs', t.sub)}>Monthly Cost</p>
          </div>
          <div className={clsx('border rounded-2xl p-5', t.card)}>
            <Key className="w-5 h-5 text-brand-400 mb-3" />
            <p className={clsx('text-sm font-mono font-bold', t.heading)}>{tenant.license}</p>
            <p className={clsx('text-xs', t.sub)}>License Key</p>
          </div>
        </div>
      )}

      {activeTab === 'models' && (
        <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Model', 'Model ID', 'Status', 'Requests', 'Cost'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {tenant.models.map((m) => (
                <tr key={m.modelId} className={t.hoverRow}>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>{m.name}</td>
                  <td className={clsx('px-4 py-3 font-mono text-xs', t.muted)}>{m.modelId}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                      m.status === 'active' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20'
                    )}>{m.status}</span>
                  </td>
                  <td className={clsx('px-4 py-3', t.body)}>{m.requests.toLocaleString()}</td>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>${m.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-2">
          {tenant.policies.map((p) => (
            <div key={p.name} className={clsx('flex items-center gap-4 border rounded-2xl px-5 py-4', t.card)}>
              <ShieldCheck className={clsx('w-5 h-5', p.enabled ? 'text-accent-400' : t.faint)} />
              <div className="flex-1">
                <p className={clsx('font-medium', t.heading)}>{p.name}</p>
                <p className={clsx('text-xs', t.muted)}>{p.rules} rules · {p.enabled ? 'Active' : 'Disabled'}</p>
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

      {activeTab === 'compliance' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {tenant.compliance.map((fw) => {
            const pct = fw.total > 0 ? Math.round((fw.passed / fw.total) * 100) : 0;
            return (
              <div key={fw.framework} className={clsx('border rounded-2xl p-4', t.card)}>
                <div className="flex items-center justify-between mb-3">
                  <p className={clsx('text-sm font-semibold', t.heading)}>{fw.framework}</p>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                    fw.status === 'enabled' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : clsx(isDark ? 'bg-white/[0.04] ring-white/[0.06]' : 'bg-gray-100 ring-gray-200', t.muted)
                  )}>{fw.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={clsx('flex-1 h-2 rounded-full overflow-hidden', t.track)}>
                    <div className={clsx('h-full rounded-full', fw.status === 'enabled' ? 'bg-accent-400' : (isDark ? 'bg-white/[0.06]' : 'bg-gray-300'))} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={clsx('text-xs font-medium', t.heading)}>{fw.passed}/{fw.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'audit' && (
        <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Time', 'User', 'Model', 'Decision', 'Tokens'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {tenant.recentAudit.map((log, i) => (
                <tr key={i} className={t.hoverRow}>
                  <td className={clsx('px-4 py-3 font-mono text-xs', t.sub)}>{log.time}</td>
                  <td className={clsx('px-4 py-3', t.body)}>{log.user}</td>
                  <td className={clsx('px-4 py-3 font-mono text-xs', t.body)}>{log.model}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                      log.decision === 'allow' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' : 'bg-red-500/10 text-red-400 ring-red-500/20'
                    )}>{log.decision}</span>
                  </td>
                  <td className={clsx('px-4 py-3', t.body)}>{log.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'users' && (
        <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['User', 'Name', 'Requests', 'Cost'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {tenant.topUsers.map((u) => (
                <tr key={u.userId} className={t.hoverRow}>
                  <td className={clsx('px-4 py-3 font-mono text-xs', t.sub)}>{u.userId}</td>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>{u.name}</td>
                  <td className={clsx('px-4 py-3', t.body)}>{u.requests.toLocaleString()}</td>
                  <td className={clsx('px-4 py-3 font-medium', t.heading)}>${u.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'cost' && (
        <div className="grid grid-cols-3 gap-4">
          {tenant.models.map((m) => (
            <div key={m.modelId} className={clsx('border rounded-2xl p-5', t.card)}>
              <Cpu className="w-5 h-5 text-accent-400 mb-3" />
              <p className={clsx('text-xl font-bold', t.heading)}>${m.cost.toFixed(2)}</p>
              <p className={clsx('text-xs', t.sub)}>{m.name}</p>
              <p className={clsx('text-xs mt-1', t.faint)}>{m.requests.toLocaleString()} requests</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
