import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { createServer, listServers, McpServerSummary, ServerStatus } from '../lib/mcp-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, formatCount } from '../components/kit/primitives';

export const STATUS_LABEL: Record<ServerStatus, string> = { draft: 'Draft', published: 'Live', paused: 'Paused' };

export function StatusPill({ status }: { status: ServerStatus }) {
  return (
    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full',
      status === 'published' ? 'bg-ink text-white' : status === 'paused' ? 'bg-stop-soft text-stop-text' : 'bg-line-subtle text-ink-soft')}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ServerCard({ s }: { s: McpServerSummary }) {
  return (
    <Link to={`/mcp/${encodeURIComponent(s.serverId)}`} className="no-underline text-ink">
      <Panel as="article" className="px-[22px] py-[18px] flex flex-wrap items-center gap-x-8 gap-y-3 hover:border-ink">
        <div className="flex-[1_1_260px] min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="m-0 text-lg font-bold">{s.name}</h2>
            <StatusPill status={s.status} />
          </div>
          {s.description && <p className="m-0 mt-1 text-sm text-ink-muted">{s.description}</p>}
          <div className="font-mono text-xs text-ink-muted mt-1">{s.path}</div>
        </div>
        <dl className="m-0 flex gap-7 text-sm">
          <div><dt className="text-xs text-ink-muted">Tools on</dt><dd className="m-0 text-xl font-bold">{formatCount(s.tools)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Calls this week</dt><dd className="m-0 text-xl font-bold">{formatCount(s.week.calls)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Stopped</dt><dd className={clsx('m-0 text-xl font-bold', s.week.stopped > 0 && 'text-stop')}>{formatCount(s.week.stopped)}</dd></div>
        </dl>
      </Panel>
    </Link>
  );
}

export function McpServersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-servers', user?.tenantId], queryFn: listServers });
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: (s) => navigate(`/mcp/${encodeURIComponent(s.serverId)}`),
  });
  const canCreate = name.trim().length > 0 && !create.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">MCP servers</h1>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[680px]">
            Give AI agents your company’s APIs as tools. Every call is checked against your rules and kept as evidence. Agents only ever reach Probaline, never your APIs.
          </p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Create MCP server</Button>}
      </div>

      {creating && (
        <Panel aria-label="New MCP server" className="px-6 py-5">
          <SectionLabel className="mb-3">New MCP server</SectionLabel>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (canCreate) create.mutate({ name: name.trim(), description: description.trim() }); }}>
            <label className="flex flex-col gap-1.5 max-w-[420px]">
              <span className="text-sm font-semibold">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR self-service" maxLength={80} className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" />
            </label>
            <label className="flex flex-col gap-1.5 max-w-[640px]">
              <span className="text-sm font-semibold">What it’s for <span className="font-normal text-ink-muted">(agents see this)</span></span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Look up employees, teams and leave balances" maxLength={500} className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" />
            </label>
            <p className="m-0 text-sm text-ink-muted">It starts as a draft. Next you add APIs, choose tools and try them, then publish.</p>
            {create.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(create.error)}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={!canCreate}>{create.isPending ? 'Creating…' : 'Create'}</Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {isError && <Panel className="px-6"><Note title="Couldn’t load MCP servers."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && data.length === 0 && !creating && (
        <Panel className="px-6"><Note title="No MCP servers yet.">Create one, add an API with its OpenAPI description, and agents can use it within minutes.</Note></Panel>
      )}
      {data && data.length > 0 && (
        <div className="flex flex-col gap-3">
          {[...data].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <ServerCard key={s.serverId} s={s} />)}
        </div>
      )}
    </div>
  );
}
