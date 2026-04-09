import { Activity, Server, Database, Shield, CheckCircle, XCircle, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

const services = [
  { name: 'Gateway', port: 3000, status: 'healthy', uptime: '28d 4h', latency: '12ms', icon: Shield },
  { name: 'Policy Engine', port: 3001, status: 'healthy', uptime: '28d 4h', latency: '8ms', icon: Shield },
  { name: 'Data Protection', port: 3002, status: 'healthy', uptime: '28d 4h', latency: '15ms', icon: Shield },
  { name: 'Analytics', port: 3003, status: 'healthy', uptime: '28d 4h', latency: '22ms', icon: Activity },
  { name: 'Content Scanner', port: 3004, status: 'healthy', uptime: '28d 4h', latency: '45ms', icon: Server },
  { name: 'LocalStack (AWS)', port: 4566, status: 'healthy', uptime: '28d 4h', latency: '5ms', icon: Database },
];

const onpremAgents = [
  { tenant: 'HealthCo Systems', lastSeen: '2 min ago', status: 'connected', version: '1.0.0' },
  { tenant: 'RetailMax', lastSeen: '5 min ago', status: 'connected', version: '1.0.0' },
];

export function PlatformHealthPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  return (
    <div className="space-y-6 w-full">
      <p className={clsx('text-sm', t.sub)}>Platform infrastructure status</p>

      {/* Services grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((svc) => {
          const Icon = svc.icon;
          const isHealthy = svc.status === 'healthy';
          return (
            <div key={svc.name} className={clsx('border rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5', t.card, isDark ? 'shadow-card-dark hover:shadow-card-dark-hover' : 'shadow-card hover:shadow-card-hover')}>
              <div className="flex items-center gap-3 mb-4">
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br', isHealthy ? 'from-accent-500/20 to-accent-600/10' : 'from-red-500/20 to-red-600/10')}>
                  <Icon className={clsx('w-5 h-5', isHealthy ? 'text-accent-400' : 'text-red-400')} />
                </div>
                <div>
                  <p className={clsx('font-semibold text-sm', t.heading)}>{svc.name}</p>
                  <p className={clsx('text-xs', t.muted)}>Port {svc.port}</p>
                </div>
                {isHealthy ? <CheckCircle className="w-4 h-4 text-accent-400 ml-auto" /> : <XCircle className="w-4 h-4 text-red-400 ml-auto" />}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={t.muted}>Uptime</p>
                  <p className={clsx('font-medium', t.heading)}>{svc.uptime}</p>
                </div>
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={t.muted}>Latency</p>
                  <p className={clsx('font-medium', t.heading)}>{svc.latency}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* On-prem agents */}
      <div className={clsx('border rounded-2xl p-5', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-4', t.heading)}>On-Prem Reporting Agents</h2>
        <div className="space-y-3">
          {onpremAgents.map((agent) => (
            <div key={agent.tenant} className={clsx('flex items-center gap-4 rounded-xl px-4 py-3', t.cardInner)}>
              <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulse-soft" />
              <div className="flex-1">
                <p className={clsx('text-sm font-medium', t.heading)}>{agent.tenant}</p>
                <p className={clsx('text-xs', t.muted)}>v{agent.version}</p>
              </div>
              <span className={clsx('text-xs flex items-center gap-1', t.sub)}><Clock className="w-3 h-3" />{agent.lastSeen}</span>
              <span className="text-xs px-2 py-0.5 rounded-lg font-medium bg-accent-500/10 text-accent-400 ring-1 ring-accent-500/20">{agent.status}</span>
            </div>
          ))}
          {onpremAgents.length === 0 && (
            <p className={clsx('text-sm text-center py-6', t.muted)}>No on-prem agents connected</p>
          )}
        </div>
      </div>
    </div>
  );
}
