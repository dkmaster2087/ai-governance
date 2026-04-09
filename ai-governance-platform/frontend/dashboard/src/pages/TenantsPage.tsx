import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Building2, Cloud, Server, CheckCircle,
  PauseCircle, Clock, Search, MoreVertical,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { fetchTenants, suspendTenant, activateTenant } from '../lib/tenant-api';
import { mockTenants } from '../lib/mock-tenants';
import { TenantModal } from '../components/tenants/TenantModal';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

type TenantStatus = 'active' | 'suspended' | 'trial';
type Plan = 'starter' | 'professional' | 'enterprise';

const statusConfig: Record<TenantStatus, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  active:    { icon: CheckCircle,  color: 'text-accent-400',  bg: 'bg-accent-500/20',  label: 'Active' },
  trial:     { icon: Clock,        color: 'text-yellow-400',  bg: 'bg-yellow-500/20',  label: 'Trial' },
  suspended: { icon: PauseCircle,  color: 'text-red-400',     bg: 'bg-red-500/20',     label: 'Suspended' },
};

const deploymentIcon = { saas: Cloud, onprem: Server };

export function TenantsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const planConfig: Record<Plan, { label: string; color: string }> = {
    starter:      { label: 'Starter',      color: isDark ? 'text-slate-400 bg-slate-700' : 'text-gray-500 bg-gray-200' },
    professional: { label: 'Professional', color: 'text-brand-400 bg-brand-600/20' },
    enterprise:   { label: 'Enterprise',   color: 'text-accent-400 bg-accent-500/20' },
  };

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<typeof mockTenants[0] | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['tenants', user?.tenantId],
    queryFn: () => fetchTenants(user?.tenantId),
    placeholderData: mockTenants,
  });

  const tenants: typeof mockTenants = Array.isArray(data) && data.length ? data : mockTenants;

  const suspendMutation = useMutation({
    mutationFn: (id: string) => suspendTenant(id, user?.tenantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateTenant(id, user?.tenantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  });

  const filtered = tenants.filter((tn) =>
    !search || tn.name.toLowerCase().includes(search.toLowerCase()) ||
    tn.adminEmail.toLowerCase().includes(search.toLowerCase())
  );

  const totalRequests = tenants.reduce((s, tn) => s + (tn.usageThisMonth?.requests ?? 0), 0);
  const totalCost = tenants.reduce((s, tn) => s + (tn.usageThisMonth?.cost ?? 0), 0);
  const activeCount = tenants.filter((tn) => tn.status === 'active').length;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Tenants', value: tenants.length, color: t.heading },
          { label: 'Active', value: activeCount, color: 'text-accent-400' },
          { label: 'Total Requests', value: totalRequests.toLocaleString(), color: t.heading },
          { label: 'Total Revenue Est.', value: `${totalCost.toFixed(2)}`, color: 'text-brand-400' },
        ].map((s) => (
          <div key={s.label} className={clsx('border rounded-xl p-4', t.card)}>
            <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className={clsx('text-xs mt-0.5', t.muted)}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className={clsx('absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4', t.muted)} />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={clsx('w-full border rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Onboard Tenant
        </button>
      </div>

      {/* Tenant table */}
      <div className={clsx('border rounded-xl overflow-hidden', t.card)}>
        <table className="w-full text-sm">
          <thead>
            <tr className={clsx('border-b', t.border)}>
              {['Tenant', 'Plan', 'Deployment', 'Status', 'Requests', 'Cost', 'Violations', 'Created', ''].map((h) => (
                <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={clsx('divide-y', t.divider)}>
            {filtered.map((tenant) => {
              const status = statusConfig[tenant.status as TenantStatus];
              const plan = planConfig[tenant.plan as Plan];
              const DeployIcon = deploymentIcon[tenant.deploymentMode as keyof typeof deploymentIcon];

              return (
                <tr key={tenant.tenantId} className={clsx('transition-colors cursor-pointer', t.hoverRow)} onClick={() => navigate(`/tenants/${tenant.tenantId}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-brand-400" />
                      </div>
                      <div>
                        <p className={clsx('font-medium', t.heading)}>{tenant.name}</p>
                        <p className={clsx('text-xs', t.muted)}>{tenant.adminEmail}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', plan.color)}>
                      {plan.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className={clsx('flex items-center gap-1.5 text-xs', t.sub)}>
                      <DeployIcon className="w-3.5 h-3.5" />
                      {tenant.deploymentMode === 'saas' ? 'SaaS' : 'On-Prem'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', status.bg)}>
                        <status.icon className={clsx('w-3.5 h-3.5', status.color)} />
                      </div>
                      <span className={clsx('text-xs font-medium', status.color)}>{status.label}</span>
                    </div>
                  </td>
                  <td className={clsx('px-4 py-3', t.body)}>
                    {(tenant.usageThisMonth?.requests ?? 0).toLocaleString()}
                  </td>
                  <td className={clsx('px-4 py-3', t.body)}>
                    ${(tenant.usageThisMonth?.cost ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-sm font-medium', (tenant.usageThisMonth?.violations ?? 0) > 0 ? 'text-red-400' : t.muted)}>
                      {tenant.usageThisMonth?.violations ?? 0}
                    </span>
                  </td>
                  <td className={clsx('px-4 py-3 text-xs whitespace-nowrap', t.muted)}>
                    {format(new Date(tenant.createdAt), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === tenant.tenantId ? null : tenant.tenantId)}
                        className={clsx('p-1.5 rounded-lg transition-colors', t.muted, t.hoverText, t.hoverRow)}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuOpen === tenant.tenantId && (
                        <div className={clsx('absolute right-0 top-8 z-10 border rounded-xl shadow-xl py-1 w-40', t.card)}>
                          <button
                            onClick={() => { setEditTarget(tenant as any); setModalOpen(true); setMenuOpen(null); }}
                            className={clsx('w-full text-left px-4 py-2 text-sm transition-colors', t.body, t.hoverText, t.hoverRow)}
                          >
                            Edit Settings
                          </button>
                          {tenant.status === 'active' || tenant.status === 'trial' ? (
                            <button
                              onClick={() => { suspendMutation.mutate(tenant.tenantId); setMenuOpen(null); }}
                              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              Suspend
                            </button>
                          ) : (
                            <button
                              onClick={() => { activateMutation.mutate(tenant.tenantId); setMenuOpen(null); }}
                              className="w-full text-left px-4 py-2 text-sm text-accent-400 hover:bg-accent-500/10 transition-colors"
                            >
                              Activate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <TenantModal
          tenant={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['tenants'] }); }}
        />
      )}
    </div>
  );
}
