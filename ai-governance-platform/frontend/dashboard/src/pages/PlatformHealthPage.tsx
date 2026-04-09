import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Server, Shield, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import axios from 'axios';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

interface ServiceHealth {
  name: string;
  port: number;
  icon: typeof Shield;
  status: 'healthy' | 'unhealthy' | 'checking';
  latencyMs: number | null;
  service?: string;
  error?: string;
}

const SERVICE_DEFS = [
  { name: 'Gateway',         port: 3000, icon: Shield,   proxyPath: '/health/gateway' },
  { name: 'Policy Engine',   port: 3001, icon: Shield,   proxyPath: '/health/policy-engine' },
  { name: 'Analytics',       port: 3003, icon: Activity,  proxyPath: '/health/analytics' },
  { name: 'Content Scanner', port: 3004, icon: Server,   proxyPath: '/health/content-scanner' },
];

async function checkAllServices(): Promise<ServiceHealth[]> {
  return Promise.all(
    SERVICE_DEFS.map(async (svc) => {
      const start = performance.now();
      try {
        const { data } = await axios.get(svc.proxyPath, { timeout: 5000 });
        return { name: svc.name, port: svc.port, icon: svc.icon, status: 'healthy' as const, latencyMs: Math.round(performance.now() - start), service: data?.service };
      } catch (err: any) {
        return { name: svc.name, port: svc.port, icon: svc.icon, status: 'unhealthy' as const, latencyMs: Math.round(performance.now() - start), error: err.message || 'Unreachable' };
      }
    })
  );
}

export function PlatformHealthPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const { data: services = [], refetch, isFetching } = useQuery({
    queryKey: ['platform-health'],
    queryFn: checkAllServices,
    refetchInterval: 30000,
  });

  const healthyCount = services.filter((s) => s.status === 'healthy').length;
  const totalCount = SERVICE_DEFS.length;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <p className={clsx('text-sm', t.sub)}>
            {services.length > 0
              ? `${healthyCount}/${totalCount} services healthy`
              : 'Checking services...'}
          </p>
        </div>
        <button onClick={() => refetch()} className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}>
          <RefreshCw className={clsx('w-4 h-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Services grid */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        {(services.length > 0 ? services : SERVICE_DEFS.map((s) => ({ ...s, status: 'checking' as const, latencyMs: null, error: undefined }))).map((svc) => {
          const Icon = svc.icon;
          const isHealthy = svc.status === 'healthy';
          const isChecking = svc.status === 'checking';
          return (
            <div key={svc.name} className={clsx('border rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5', t.card)}>
              <div className="flex items-center gap-3 mb-4">
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br',
                  isChecking ? 'from-yellow-500/20 to-yellow-600/10' : isHealthy ? 'from-accent-500/20 to-accent-600/10' : 'from-red-500/20 to-red-600/10'
                )}>
                  <Icon className={clsx('w-5 h-5', isChecking ? 'text-yellow-400 animate-pulse' : isHealthy ? 'text-accent-400' : 'text-red-400')} />
                </div>
                <div className="flex-1">
                  <p className={clsx('font-semibold text-sm', t.heading)}>{svc.name}</p>
                  <p className={clsx('text-xs', t.muted)}>Port {svc.port}</p>
                </div>
                {isChecking
                  ? <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />
                  : isHealthy
                    ? <CheckCircle className="w-4 h-4 text-accent-400" />
                    : <XCircle className="w-4 h-4 text-red-400" />
                }
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={t.muted}>Status</p>
                  <p className={clsx('font-medium', isChecking ? 'text-yellow-400' : isHealthy ? 'text-accent-400' : 'text-red-400')}>
                    {isChecking ? 'Checking...' : isHealthy ? 'Healthy' : 'Unhealthy'}
                  </p>
                </div>
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={t.muted}>Latency</p>
                  <p className={clsx('font-medium', t.heading)}>
                    {svc.latencyMs != null ? svc.latencyMs + 'ms' : '—'}
                  </p>
                </div>
              </div>
              {svc.error && (
                <p className={clsx('text-xs mt-3 px-3 py-2 rounded-lg', isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600')}>
                  {svc.error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-refresh note */}
      <p className={clsx('text-xs text-center', t.faint)}>Auto-refreshes every 30 seconds</p>
    </div>
  );
}
