import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { RangeKey, RANGE_LABELS } from '../lib/gateway-api';
import { fetchShadowSummary, ShadowAiSummary, updateShadowPolicy } from '../lib/shadow-api';
import { Button, Note, Panel, SectionLabel, Segmented, formatCount } from '../components/aegis/primitives';

const RANGE_OPTIONS = (Object.keys(RANGE_LABELS) as RangeKey[]).map((value) => ({ value, label: RANGE_LABELS[value].button }));
const MODE_OPTIONS = [
  { value: 'monitor' as const, label: 'Watch only' },
  { value: 'block' as const, label: 'Block' },
];

type Tool = ShadowAiSummary['tools'][number];

const DECISION_CHIP: Record<Tool['decision'], { label: string; className: string }> = {
  undecided: { label: 'Undecided', className: 'bg-line-subtle text-ink-soft' },
  blocked: { label: 'Blocked', className: 'bg-stop-soft text-stop-text' },
  allowed: { label: 'Allowed', className: 'bg-ink-tint text-ink' },
};

function Trend({ tool }: { tool: Tool }) {
  if (tool.previousVisits === null) return <span className="text-ink-muted">—</span>;
  const diff = tool.visits - tool.previousVisits;
  return (
    <span className={clsx(diff > 0 ? 'text-stop' : diff < 0 ? 'text-ink' : 'text-ink-muted')}>
      {diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : '0'}
    </span>
  );
}

function ToolRow({
  tool, canDecide, busy, decide,
}: { tool: Tool; canDecide: boolean; busy: boolean; decide: (decision: 'blocked' | 'allowed' | null) => void }) {
  const chip = DECISION_CHIP[tool.decision];
  return (
    <Panel as="article" className="px-[22px] py-[18px] flex flex-wrap items-center gap-x-7 gap-y-4">
      <div className="flex-[1_1_220px] min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="m-0 text-xl font-bold">{tool.name}</h2>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', chip.className)}>{chip.label}</span>
        </div>
        <div className="font-mono text-xs text-ink-muted mt-0.5">{tool.domains.join(', ')}</div>
      </div>
      <dl className="m-0 flex gap-7">
        <div><dd className="m-0 text-[26px] font-extrabold tracking-[-0.02em] leading-none">{formatCount(tool.visits)}</dd><dt className="text-xs text-ink-muted mt-1">visits</dt></div>
        <div><dd className="m-0 text-[26px] font-extrabold tracking-[-0.02em] leading-none">{formatCount(tool.people)}</dd><dt className="text-xs text-ink-muted mt-1">people</dt></div>
        <div><dd className="m-0 text-[26px] font-extrabold tracking-[-0.02em] leading-none"><Trend tool={tool} /></dd><dt className="text-xs text-ink-muted mt-1">vs previous</dt></div>
      </dl>
      {canDecide && (
        <div className="flex gap-2 flex-wrap">
          {tool.decision === 'undecided' && (
            <>
              <Button disabled={busy} onClick={() => decide('blocked')}>Block</Button>
              <Button disabled={busy} variant="secondary" onClick={() => decide('allowed')}>Allow</Button>
            </>
          )}
          {tool.decision === 'blocked' && <Button disabled={busy} variant="secondary" onClick={() => decide(null)}>Unblock</Button>}
          {tool.decision === 'allowed' && <Button disabled={busy} variant="secondary" onClick={() => decide(null)}>Remove approval</Button>}
        </div>
      )}
    </Panel>
  );
}

export function ShadowAiPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>('week');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shadow-summary', user?.tenantId, range],
    queryFn: () => fetchShadowSummary(range),
    refetchInterval: 60_000,
  });
  const change = useMutation({
    mutationFn: updateShadowPolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shadow-summary'] }),
  });

  const inline = RANGE_LABELS[range].inline;
  const people = data?.totals.people ?? 0;

  return (
    <div className="flex flex-col gap-7 max-w-[1280px]">
      <div className="flex flex-wrap justify-between items-end gap-6">
        <div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.025em] max-w-[960px]">
            {!data ? 'Shadow AI' : people === 0 ? `Nobody went around the gateway ${inline}.` : (
              <>{formatCount(people)} {people === 1 ? 'person' : 'people'} used AI tools that go <span className="text-stop">around</span> the gateway {inline}.</>
            )}
          </h1>
          <p className="m-0 mt-2 text-ink-muted text-base">Nothing typed into these tools was checked by Aegis. Decide tool by tool.</p>
        </div>
        <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
      </div>

      {data && (
        <Panel aria-label="Undecided tools" className="px-[22px] py-[18px] flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="m-0 font-semibold">When someone opens an AI tool you haven’t decided on</p>
            <p className="m-0 text-ink-muted">
              {data.mode === 'block' ? 'The browser extension blocks it and records the attempt.' : 'The browser extension records the visit but doesn’t stop it.'}
            </p>
          </div>
          {isAdmin ? (
            <Segmented
              label="For undecided tools"
              options={MODE_OPTIONS}
              value={data.mode}
              onChange={(mode) => change.mutate({ mode })}
            />
          ) : (
            <span className="font-semibold">{data.mode === 'block' ? 'Block' : 'Watch only'}</span>
          )}
        </Panel>
      )}

      {change.isError && <p role="alert" className="m-0 text-stop-text font-semibold">That change wasn’t saved. Try again.</p>}
      {isError && (
        <Panel className="px-6"><Note title="Couldn’t load shadow AI activity."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>
      )}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {data && data.tools.length === 0 && (
        <Panel className="px-6">
          <Note title={`No visits to AI tools outside the gateway ${inline}.`}>
            Visits appear here once the Aegis browser extension is installed and reporting from your company’s browsers.
          </Note>
        </Panel>
      )}

      {data && data.tools.length > 0 && (
        <div className="flex flex-wrap gap-6 items-start">
          <section aria-label="Tools" className="flex-[999_1_600px] min-w-0 flex flex-col gap-3">
            {data.tools.map((t) => (
              <ToolRow
                key={t.id}
                tool={t}
                canDecide={isAdmin}
                busy={change.isPending}
                decide={(decision) => change.mutate({ decisions: { [t.id]: decision } })}
              />
            ))}
          </section>

          <Panel as="aside" aria-label="Most frequent" className="flex-[1_1_300px] min-w-0 px-[22px] py-[18px] flex flex-col">
            <SectionLabel className="mb-2">Most frequent</SectionLabel>
            {data.people.map((p) => (
              <div key={p.user} className="flex justify-between items-center gap-3 py-2.5 border-b border-line-subtle last:border-b-0">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.user}</div>
                  <div className="text-xs text-ink-muted">{p.tools.join(', ')}</div>
                </div>
                <span className="font-mono">{formatCount(p.visits)}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {data && (
        <p className="m-0 text-xs text-ink-muted">
          Only browsers with the Aegis extension are counted. Visits are kept for {data.retentionDays} days, so trends need the previous period to fall inside that.
        </p>
      )}
    </div>
  );
}
