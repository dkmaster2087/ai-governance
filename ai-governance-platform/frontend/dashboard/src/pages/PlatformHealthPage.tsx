import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchHealth } from '../lib/platform-api';
import { Button, Panel, SectionLabel } from '../components/aegis/primitives';

const NAMES: Record<string, { label: string; role: string }> = {
  dynamodb: { label: 'Database (DynamoDB)', role: 'Tenants, keys, rules and evidence' },
  'policy-engine': { label: 'Policy engine', role: 'Checks every prompt against rules' },
  'data-protection': { label: 'Data protection', role: 'Removes personal data' },
};

const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} days`);

/** Whether the request path works right now, as the gateway itself sees it. */
export function PlatformHealthPage() {
  const health = useQuery({ queryKey: ['platform-health'], queryFn: fetchHealth, refetchInterval: 30_000, retry: false });
  const h = health.data;
  const failing = h?.dependencies.filter((d) => d.status !== 'healthy') ?? [];

  const headline = health.isError ? 'The gateway isn’t answering.'
    : !h ? ' '
    : failing.length === 0 ? 'Everything on the request path is working.'
    : `${failing.length === 1 ? NAMES[failing[0].name]?.label ?? failing[0].name : `${failing.length} services`} ${failing.length === 1 ? 'is' : 'are'} down.`;

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className={clsx('m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]', (health.isError || failing.length > 0) && 'text-stop-text')}>{headline}</p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            {health.isError ? 'Apps can’t reach AI through it. Check the gateway service and its load balancer.'
              : failing.length > 0 ? 'Tenants that fail closed are refusing requests; tenants that fail open are letting them through unchecked.'
              : h ? `Checked ${new Date(health.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Rechecks every 30 seconds.` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => health.refetch()} disabled={health.isFetching}>{health.isFetching ? 'Checking…' : 'Check now'}</Button>
      </div>

      {h && (
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-1">Request path</SectionLabel>
          <ul className="m-0 p-0 list-none">
            <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 border-b border-line-subtle">
              <div><div className="font-semibold">Gateway</div><div className="text-sm text-ink-muted">Version {h.version}, up {uptime(h.uptime)}</div></div>
              <span className="font-semibold">Working</span>
            </li>
            {h.dependencies.map((d) => {
              const ok = d.status === 'healthy';
              return (
                <li key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 border-b border-line-subtle last:border-b-0">
                  <div>
                    <div className="font-semibold">{NAMES[d.name]?.label ?? d.name}</div>
                    <div className="text-sm text-ink-muted">{ok ? NAMES[d.name]?.role : d.error ?? 'Not answering'}</div>
                  </div>
                  <span className={clsx('font-semibold text-right', !ok && 'text-stop-text')}>
                    {ok ? 'Working' : 'Down'}{ok && d.latencyMs !== undefined && <span className="block text-xs font-normal text-ink-muted font-mono">{d.latencyMs} ms</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
