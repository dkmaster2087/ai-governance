import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Approval, decideApproval, listApprovals } from '../lib/mcp-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/kit/primitives';
import { McpTabs } from './McpServersPage';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const STATUS: Record<Approval['status'], string> = { pending: 'Waiting', approved: 'Approved, not run yet', refused: 'Refused', expired: 'Expired', used: 'Approved and run' };

function args(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

function Pending({ a }: { a: Approval }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'refuse') => decideApproval(a.approvalId, d, reason.trim() || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-approvals'] }),
  });
  return (
    <Panel as="article" aria-label={`${a.toolTitle || a.tool} on ${a.serverName}`} className="px-6 py-5 flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-lg font-bold">{a.caller.label} wants to run {a.toolTitle || a.tool}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">
          on {a.serverName} · <span className="font-mono text-[12px] bg-ink-tint rounded px-1.5 py-px">{a.method}</span> <span className="font-mono text-[12px]">{a.path}</span> ({a.apiName})
          · asked {when(a.createdAt)} · open until {when(a.expiresAt)}
        </p>
      </div>
      <div>
        <SectionLabel className="mb-1.5">What it will send</SectionLabel>
        <pre className="m-0 bg-canvas border border-line-subtle rounded-lg p-3 max-h-[260px] overflow-auto font-mono text-[12px] whitespace-pre-wrap [overflow-wrap:anywhere]">{args(a.arguments)}</pre>
      </div>
      {a.canDecide ? (
        <>
          <label className="flex flex-col gap-1.5 max-w-[560px]"><span className="text-sm font-semibold">Reason <span className="font-normal text-ink-muted">(optional; the agent sees it if you refuse)</span></span>
            <input className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
          {decide.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(decide.error)}</p>}
          <div className="flex gap-2 flex-wrap">
            <Button disabled={decide.isPending} onClick={() => decide.mutate('approve')}>Approve</Button>
            <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate('refuse')}>Refuse</Button>
          </div>
          <p className="m-0 text-sm text-ink-muted">Approving lets this exact call run once. The agent runs it when it asks again.</p>
        </>
      ) : (
        <p className="m-0 text-sm text-ink-muted">Waiting for one of this server’s approvers. Nobody can approve their own request.</p>
      )}
    </Panel>
  );
}

export function McpApprovalsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-approvals'], queryFn: listApprovals, refetchInterval: 10_000 });
  const pending = (data ?? []).filter((a) => a.status === 'pending');
  const decided = (data ?? []).filter((a) => a.status !== 'pending').slice(0, 50);
  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div>
        <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Approvals</h1>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[680px]">Agents asking to run tools that change data. Each request is for one exact call; nothing runs until a person approves it.</p>
      </div>
      <McpTabs />
      {isError && <Panel className="px-6"><Note title="Couldn’t load approvals."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && pending.length === 0 && <Panel className="px-6"><Note title="Nothing waiting.">When an agent asks to run a tool that needs approval, it appears here.</Note></Panel>}
      {pending.map((a) => <Pending key={a.approvalId} a={a} />)}
      {decided.length > 0 && (
        <Panel aria-label="Decided" className="px-6 py-5">
          <SectionLabel className="mb-2">Decided</SectionLabel>
          <ul className="m-0 p-0 list-none">
            {decided.map((a) => (
              <li key={a.approvalId} className="py-2.5 border-b border-line-subtle last:border-b-0 flex flex-wrap gap-x-3 gap-y-0.5 justify-between">
                <span><span className="font-semibold">{a.toolTitle || a.tool}</span> on {a.serverName} <span className="text-ink-muted">· {a.caller.label}</span></span>
                <span className={clsx('text-sm', a.status === 'refused' ? 'text-stop-text font-semibold' : 'text-ink-muted')}>
                  {STATUS[a.status]}{a.decidedBy ? ` by ${a.decidedBy}` : ''}{a.reason ? ` · “${a.reason}”` : ''} · {when(a.decidedAt ?? a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
