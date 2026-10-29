import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { assessFramework, disableFramework, enableFramework, fetchComplianceStatus } from '../lib/compliance-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, Switch } from '../components/aegis/primitives';

interface Control { controlId: string; title: string; severity: string; automatable: boolean }
interface Pack {
  framework: string; name: string; version: string; description: string;
  status: 'enabled' | 'partial' | 'disabled'; passedControls: number; totalControls: number; controls: Control[];
}

const listJoin = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "HIPAA (Health Insurance …)" → "HIPAA", for sentences. */
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

function headline(packs: Pack[]) {
  const on = packs.filter((p) => p.status !== 'disabled').map((p) => shortName(p.name));
  if (on.length === 0) return 'No compliance frameworks are on.';
  if (on.length === packs.length) return `${listJoin(on)} ${on.length === 1 ? 'is' : 'are all'} on.`;
  return `${listJoin(on)} ${on.length === 1 ? 'is' : 'are'} on.`;
}

function FrameworkPanel({ pack }: { pack: Pack }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['compliance-status'] }); qc.invalidateQueries({ queryKey: ['rules'] }); };
  const enable = useMutation({ mutationFn: () => enableFramework(pack.framework), onSuccess: refresh });
  const disable = useMutation({ mutationFn: () => disableFramework(pack.framework), onSuccess: () => { setConfirmOff(false); refresh(); } });
  const assess = useMutation({ mutationFn: () => assessFramework(pack.framework), onSuccess: refresh });

  const on = pack.status !== 'disabled';
  const busy = enable.isPending || disable.isPending;
  const pct = pack.totalControls ? Math.round((pack.passedControls / pack.totalControls) * 100) : 0;
  const manual = pack.controls.filter((c) => !c.automatable).length;
  const failure = enable.error ?? disable.error ?? assess.error;

  return (
    <Panel aria-label={pack.name} className="px-6 py-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-bold">{pack.name} <span className="text-sm font-normal text-ink-muted">v{pack.version}</span></h2>
          <p className="m-0 mt-0.5 text-ink-muted">{pack.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className="text-sm font-semibold">{on ? 'On' : 'Off'}</span>
          <Switch label={`${pack.name} ${on ? 'on' : 'off'}`} checked={on} disabled={busy}
            onChange={(next) => (next ? enable.mutate() : setConfirmOff(true))} />
        </div>
      </div>

      {confirmOff && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-canvas px-4 py-3">
          <span className="text-sm">Turn off {shortName(pack.name)}? Its rules on the Rules page are turned off too.</span>
          <Button variant="secondary" onClick={() => disable.mutate()} disabled={disable.isPending}>{disable.isPending ? 'Turning off…' : 'Turn off'}</Button>
          <Button variant="ghost" onClick={() => setConfirmOff(false)}>Keep on</Button>
        </div>
      )}

      {on && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span><strong>{pack.passedControls} of {pack.totalControls}</strong> controls in place{pack.status === 'partial' ? ' so far' : ''}</span>
            <button type="button" className="text-ink-muted hover:text-ink underline disabled:opacity-50" disabled={assess.isPending} onClick={() => assess.mutate()}>
              {assess.isPending ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <div className="h-1.5 bg-line-subtle rounded-full"><div className="h-1.5 bg-ink rounded-full" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {failure && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(failure)}</p>}

      <div>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-[36px] font-semibold text-ink hover:text-stop">
          {open ? 'Hide controls' : `Show ${pack.controls.length} controls`}{manual > 0 && !open ? <span className="font-normal text-ink-muted"> · {manual} need a manual review</span> : null}
        </button>
        {open && (
          <ul className="m-0 mt-2 p-0 list-none border-t border-line-subtle">
            {pack.controls.map((c) => (
              <li key={c.controlId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2.5 border-b border-line-subtle last:border-b-0">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-ink-muted mr-2">{c.controlId}</span>
                  <span>{c.title}</span>
                </div>
                <div className="text-right text-xs">
                  <div className={clsx('font-semibold capitalize', c.severity === 'critical' ? 'text-stop-text' : 'text-ink')}>{c.severity}</div>
                  <div className="text-ink-muted">{c.automatable ? 'Checked on each request' : 'Manual review'}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** Compliance frameworks: turning one on adds its rules; controls show what's covered and what needs people. */
export function CompliancePage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['compliance-status'], queryFn: fetchComplianceStatus });
  const packs = (Array.isArray(data) ? data : []) as Pack[];

  return (
    <div className="flex flex-col gap-6 max-w-[1000px]">
      <div>
        <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">{data ? headline(packs) : ' '}</p>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
          Turning a framework on adds its rules to <Link to="/rules" className="font-semibold text-ink">Rules</Link>. Controls marked manual review need evidence from your team.
        </p>
      </div>
      {isError && <Panel className="px-6"><Note title="Couldn’t load compliance frameworks."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && packs.length === 0 && <Panel className="px-6"><Note title="No frameworks available." /></Panel>}
      {packs.map((p) => <FrameworkPanel key={p.framework} pack={p} />)}
    </div>
  );
}
