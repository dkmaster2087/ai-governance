import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, Eye, ShieldX, TrendingUp, Globe, User, Clock, RefreshCw, Building2, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import axios from 'axios';
import { mockShadowAIData } from '../lib/mock-shadow-ai';
import { StatCard } from '../components/ui/StatCard';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth } from '../lib/auth';

type TimePeriod = '1h' | '3h' | '24h' | '3d' | '7d' | '30d';

const TIME_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: '1h',  label: '1 hour' },
  { value: '3h',  label: '3 hours' },
  { value: '24h', label: '24 hours' },
  { value: '3d',  label: '3 days' },
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
];

function getGatewayUrl() {
  return window.location.origin.replace('5174', '3000');
}

async function fetchShadowAIData(tenantId: string) {
  const { data } = await axios.get(`${getGatewayUrl()}/v1/shadow-ai/data/${tenantId}`);
  return data;
}

async function fetchAllTenants() {
  try {
    const { data } = await axios.get(`${getGatewayUrl()}/v1/tenants`, {
      headers: { 'x-tenant-id': 'tenant_platform', authorization: 'Bearer test-key' },
    });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export function ShadowAIPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user, isPlatformAdmin } = useAuth();
  const [selectedTenant, setSelectedTenant] = useState(user?.tenantId || 'tenant_platform');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('7d');
  const tooltipStyle = isDark
    ? { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' };
  const tickFill = isDark ? '#64748b' : '#9ca3af';
  const gridStroke = isDark ? '#1e293b' : '#f3f4f6';

  // Platform admin can switch tenants
  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants-list'],
    queryFn: fetchAllTenants,
    enabled: isPlatformAdmin,
  });

  const activeTenantId = isPlatformAdmin ? selectedTenant : (user?.tenantId || 'tenant_platform');

  const { data = mockShadowAIData, refetch, isLoading } = useQuery({
    queryKey: ['shadow-ai', activeTenantId],
    queryFn: () => fetchShadowAIData(activeTenantId),
    placeholderData: mockShadowAIData,
    refetchInterval: 30000,
  });

  // Client-side time filtering on the events
  const filterByTime = <T extends { timestamp?: string; date?: string }>(items: T[]): T[] => {
    const now = Date.now();
    const ms: Record<TimePeriod, number> = { '1h': 3600000, '3h': 10800000, '24h': 86400000, '3d': 259200000, '7d': 604800000, '30d': 2592000000 };
    const cutoff = now - ms[timePeriod];
    return items.filter((item) => {
      const ts = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      return ts > cutoff;
    });
  };

  const filteredEvents = filterByTime(data.recentEvents || []);
  const filteredUsers = filterByTime(data.topBypassUsers?.map((u: any) => ({ ...u, timestamp: u.lastSeen })) || []);

  const hasRealData = data.summary.totalBypassAttempts > 0 && data !== mockShadowAIData;
  const riskColor = data.summary.riskScore >= 75 ? 'text-red-400' : data.summary.riskScore >= 50 ? 'text-orange-400' : data.summary.riskScore >= 25 ? 'text-yellow-400' : 'text-accent-400';

  return (
    <div className="space-y-6">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Tenant filter — platform admin only */}
        {isPlatformAdmin && (
          <div className="flex items-center gap-2">
            <Building2 className={clsx('w-4 h-4', t.muted)} />
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              className={clsx('border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
            >
              <option value="tenant_platform">All Tenants (Platform)</option>
              {tenants.map((tn: any) => (
                <option key={tn.tenantId} value={tn.tenantId}>{tn.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Time period filter */}
        <div className="flex items-center gap-2">
          <Clock className={clsx('w-4 h-4', t.muted)} />
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTimePeriod(opt.value)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                timePeriod === opt.value ? 'bg-brand-600 text-white' : t.btnSecondary
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <p className={clsx('text-xs', t.muted)}>
            {hasRealData ? 'Live data' : 'Sample data'}
          </p>
          <button onClick={() => refetch()} className={clsx('flex items-center gap-1.5 text-xs transition-colors', t.muted, t.hoverText)}>
            <RefreshCw className={clsx('w-3 h-3', isLoading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {data.summary.riskScore >= 50 && (
        <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-5 py-4">
          <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-orange-300 font-semibold text-sm">Shadow AI activity detected</p>
            <p className="text-orange-400/70 text-xs mt-0.5">{data.summary.uniqueUsers} employees are attempting to use unapproved AI tools. Consider enforcing VPN/proxy controls.</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Bypass Attempts" value={data.summary.totalBypassAttempts} icon={AlertTriangle} color="red" trendValue={data.summary.trend} trend="up" />
        <StatCard label="Unique Users" value={data.summary.uniqueUsers} icon={User} color="yellow" />
        <StatCard label="Blocked Endpoints" value={data.summary.blockedEndpoints.length} icon={ShieldX} color="brand" />
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mb-4"><TrendingUp className="w-4 h-4 text-red-400" /></div>
          <p className={clsx('text-2xl font-bold', riskColor)}>{data.summary.riskScore}</p>
          <p className={clsx('text-sm', t.sub)}>Risk Score</p>
          <div className={clsx('mt-2 h-1.5 rounded-full overflow-hidden', t.track)}>
            <div className={clsx('h-full rounded-full', data.summary.riskScore >= 75 ? 'bg-red-400' : data.summary.riskScore >= 50 ? 'bg-orange-400' : 'bg-yellow-400')} style={{ width: `${data.summary.riskScore}%` }} />
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Bypass Attempts — Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.bypassAttempts}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="attempts" radius={[4, 4, 0, 0]}>
                {data.bypassAttempts.map((entry, i) => (<Cell key={i} fill={entry.attempts > 8 ? '#f87171' : '#f59e0b'} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={clsx('border rounded-xl p-5', t.card)}>
          <h2 className={clsx('text-sm font-semibold mb-5', t.heading)}>Targeted Endpoints</h2>
          <div className="space-y-3">
            {data.endpointBreakdown.map((ep) => (
              <div key={ep.endpoint}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Globe className={clsx('w-3.5 h-3.5', t.muted)} />
                    <span className={clsx('text-sm font-mono', t.body)}>{ep.endpoint}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-xs', t.muted)}>{ep.attempts} attempts</span>
                    <span className="text-xs text-orange-400 font-medium">{ep.percentage}%</span>
                  </div>
                </div>
                <div className={clsx('h-1.5 rounded-full overflow-hidden', t.track)}>
                  <div className="h-full bg-orange-400 rounded-full" style={{ width: `${ep.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={clsx('border rounded-xl overflow-hidden', t.card)}>
        <div className={clsx('px-5 py-4 border-b', t.border)}>
          <h2 className={clsx('text-sm font-semibold', t.heading)}>Top Users by Bypass Attempts</h2>
          <p className={clsx('text-xs mt-0.5', t.muted)}>Users attempting to access unapproved AI tools outside the gateway</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className={clsx('border-b', t.border)}>
              {['User', 'Department', 'Attempts', 'Endpoints Used', 'Last Seen'].map((h) => (
                <th key={h} className={clsx('text-left px-5 py-3 text-xs font-medium uppercase tracking-wider', t.muted)}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className={clsx('divide-y', t.divider)}>
            {data.topBypassUsers.length === 0 ? (
              <tr><td colSpan={5} className={clsx('px-5 py-8 text-center', t.muted)}>No bypass attempts detected</td></tr>
            ) : data.topBypassUsers.map((user, i) => (
              <tr key={user.userId} className={clsx('transition-colors', t.hoverRow)}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold', i === 0 ? 'bg-red-500/20 text-red-400' : (isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-200 text-gray-500'))}>{user.userId.split('_')[1]?.[0]?.toUpperCase()}</div>
                    <span className={clsx('font-mono text-xs', t.body)}>{user.userId}</span>
                  </div>
                </td>
                <td className={clsx('px-5 py-3 text-xs', t.sub)}>{user.department}</td>
                <td className="px-5 py-3"><span className={clsx('font-bold text-sm', user.attempts >= 10 ? 'text-red-400' : user.attempts >= 5 ? 'text-orange-400' : 'text-yellow-400')}>{user.attempts}</span></td>
                <td className="px-5 py-3"><div className="flex flex-wrap gap-1">{user.endpoints.map((ep) => (<span key={ep} className={clsx('text-xs px-2 py-0.5 rounded-full font-mono', t.chipMuted)}>{ep}</span>))}</div></td>
                <td className={clsx('px-5 py-3 text-xs', t.muted)}>{format(new Date(user.lastSeen), 'MMM d, HH:mm')}</td>
              </tr>
            ))}
          </tbody>
      </div>
      <div className={clsx('border rounded-xl overflow-hidden', t.card)}>
        <div className={clsx('px-5 py-4 border-b', t.border)}>
          <h2 className={clsx('text-sm font-semibold', t.heading)}>Recent Events</h2>
        </div>
        <div className={clsx('divide-y', t.divider)}>
          {data.recentEvents.map((evt) => (
            <div key={evt.id} className={clsx('flex items-center gap-4 px-5 py-3 transition-colors', t.hoverRow)}>
              <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', evt.blocked ? 'bg-red-500/20' : 'bg-yellow-500/20')}>
                {evt.blocked ? <ShieldX className="w-3.5 h-3.5 text-red-400" /> : <Eye className="w-3.5 h-3.5 text-yellow-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={clsx('text-sm', t.body)}>
                  <span className={clsx('font-mono text-xs', t.sub)}>{evt.userId}</span>{' '}attempted to access{' '}
                  <span className="font-mono text-xs text-orange-400">{evt.endpoint}</span>{' '}via <span className={clsx('text-xs', t.muted)}>{evt.method.replace('_', ' ')}</span>
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', evt.blocked ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400')}>{evt.blocked ? 'Blocked' : 'Detected'}</span>
                <span className={clsx('text-xs flex items-center gap-1', t.faint)}><Clock className="w-3 h-3" />{format(new Date(evt.timestamp), 'MMM d, HH:mm')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
