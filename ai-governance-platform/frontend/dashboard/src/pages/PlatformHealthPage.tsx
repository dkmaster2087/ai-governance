import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchHealth } from '../lib/platform-api';
import { Button, Panel, SectionLabel } from '../components/kit/primitives';

const NAMES: Record<string, { label: string; role: string }> = {
  dynamodb: { label: 'Database (DynamoDB)', role: 'Tenants, keys, rules and evidence' },
  postgres: { label: 'Database (PostgreSQL)', role: 'Tenants, keys, rules and evidence' },
  analytics: { label: 'Analytics', role: 'Builds reports, spend, evidence search and the platform view' },
};

const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} days`);

/** Whether the request path works right now, as the gateway itself sees it. */
export function PlatformHealthPage() {
  const health = useQuery({ queryKey: ['platform-health'], queryFn: fetchHealth, refetchInterval: 30_000, retry: false });
  const h = health.data;
  // Analytics is off the request path: when it's down, reports are unavailable but AI traffic is unaffected.
  const isReporting = (name: string) => name === 'analytics';
  const failing = h?.dependencies.filter((d) => d.status !== 'healthy' && !isReporting(d.name)) ?? [];
  const reportsDown = !!h?.dependencies.some((d) => isReporting(d.name) && d.status !== 'healthy');

  const headline = health.isError ? 'The gateway isn’t answering.'
    : !h ? ' '
    : failing.length === 0 && reportsDown ? 'AI traffic is working. Reports are unavailable.'
    : failing.length === 0 ? 'Everything is working.'
    : `${failing.length === 1 ? NAMES[failing[0].name]?.label ?? failing[0].name : `${failing.length} services`} ${failing.length === 1 ? 'is' : 'are'} down.`;

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className={clsx('m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]', (health.isError || failing.length > 0) && 'text-stop-text')}>{headline}</p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            {health.isError ? 'Apps can’t reach AI through it. Check the gateway service and its load balancer.'
              : failing.length > 0 ? 'Tenants that fail closed are refusing requests; tenants that fail open are letting them through unchecked.'
              : reportsDown ? 'Dashboards, spend and evidence search can’t load until analytics is back. Prompts are still checked and recorded.'
              : h ? `Checked ${new Date(health.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Rechecks every 30 seconds.` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => health.refetch()} disabled={health.isFetching}>{health.isFetching ? 'Checking…' : 'Check now'}</Button>
      </div>

      {h && (
        <>
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-1">Request path</SectionLabel>
          <ul className="m-0 p-0 list-none">
            <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 border-b border-line-subtle">
              <div>
                <div className="font-semibold">Gateway</div>
                <div className="text-sm text-ink-muted">Checks every prompt: rules, secrets, personal data and prompt attacks. Version {h.version}, up {uptime(h.uptime)}</div>
              </div>
              <span className="font-semibold">Working</span>
            </li>
            {h.dependencies.filter((d) => !isReporting(d.name)).map((d) => <Dependency key={d.name} d={d} />)}
          </ul>
        </Panel>
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-1">Reports</SectionLabel>
          <p className="m-0 text-sm text-ink-muted">Not on the request path: prompts never wait on it.</p>
          <ul className="m-0 p-0 list-none">
            {h.dependencies.filter((d) => isReporting(d.name)).map((d) => <Dependency key={d.name} d={d} />)}
          </ul>
        </Panel>
        </>
      )}
    </div>
  );
}

function Dependency({ d }: { d: { name: string; status: string; latencyMs?: number; error?: string } }) {
  const ok = d.status === 'healthy';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 border-b border-line-subtle last:border-b-0">
      <div>
        <div className="font-semibold">{NAMES[d.name]?.label ?? d.name}</div>
        <div className="text-sm text-ink-muted">{ok ? NAMES[d.name]?.role : d.error ?? 'Not answering'}</div>
      </div>
      <span className={clsx('font-semibold text-right', !ok && 'text-stop-text')}>
        {ok ? 'Working' : 'Down'}{ok && d.latencyMs !== undefined && <span className="block text-xs font-normal text-ink-muted font-mono">{d.latencyMs} ms</span>}
      </span>
    </li>
  );
}
