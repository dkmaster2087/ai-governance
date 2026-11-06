import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Connector, createConnector, deleteConnector, listConnectors, splitList } from '../lib/mcp-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/kit/primitives';
import { McpTabs } from './McpServersPage';

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

/** Where the connector should connect: the gateway's public address. */
const gatewayAddress = () => ((import.meta.env.VITE_GATEWAY_PUBLIC_URL as string | undefined) || `${window.location.origin}/api`).replace(/\/$/, '');

function NewToken({ c, onDone }: { c: Connector & { token: string }; onDone: () => void }) {
  const cmd = `docker run -d --name probaline-connector --restart unless-stopped \\\n  -e PROBALINE_URL=${gatewayAddress()} \\\n  -e PROBALINE_CONNECTOR_TOKEN=${c.token} \\\n  probaline/connector:0.1.0`;
  return (
    <Panel aria-label="Connector token" className="px-6 py-5 flex flex-col gap-3 border-ink">
      <SectionLabel>Run {c.name} in your network</SectionLabel>
      <p className="m-0 text-sm">This token is shown once. Copy the command now; it connects out to Probaline over HTTPS, so no inbound firewall change is needed.</p>
      <pre className="m-0 bg-ink text-[#E7ECF5] rounded-[10px] p-4 overflow-x-auto font-mono text-[13px] leading-relaxed">{cmd}</pre>
      <div className="flex gap-2 flex-wrap">
        <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(cmd).catch(() => undefined)}>Copy command</Button>
        <Button type="button" onClick={onDone}>Done</Button>
      </div>
    </Panel>
  );
}

export function McpConnectorsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-connectors'], queryFn: listConnectors, refetchInterval: 15_000 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [made, setMade] = useState<(Connector & { token: string }) | null>(null);
  const create = useMutation({
    mutationFn: () => createConnector({ name: name.trim(), allowedHosts: splitList(hosts) }),
    onSuccess: (c) => { setMade(c); setCreating(false); setName(''); setHosts(''); qc.invalidateQueries({ queryKey: ['mcp-connectors'] }); },
  });
  const remove = useMutation({ mutationFn: deleteConnector, onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-connectors'] }) });

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Connectors</h1>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[680px]">
            Reach APIs inside your network. A connector is a small container you run there; it calls out to Probaline, collects tool calls and makes them, only to the hosts you allow.
          </p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Add a connector</Button>}
      </div>
      <McpTabs />
      {made && <NewToken c={made} onDone={() => setMade(null)} />}
      {creating && (
        <Panel aria-label="New connector" className="px-6 py-5">
          <SectionLabel className="mb-3">New connector</SectionLabel>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && hosts.trim()) create.mutate(); }}>
            <label className="flex flex-col gap-1.5 max-w-[420px]"><span className="text-sm font-semibold">Name</span>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Frankfurt data centre" maxLength={80} /></label>
            <label className="flex flex-col gap-1.5 max-w-[640px]"><span className="text-sm font-semibold">Hosts it may call <span className="font-normal text-ink-muted">(one per line or comma-separated: hr.corp.example, pay.corp.example:8443, *.svc.corp.example)</span></span>
              <textarea className="min-h-[90px] p-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]" value={hosts} onChange={(e) => setHosts(e.target.value)} /></label>
            {create.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(create.error)}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={!name.trim() || !hosts.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}
      {isError && <Panel className="px-6"><Note title="Couldn’t load connectors."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && data.length === 0 && !creating && <Panel className="px-6"><Note title="No connectors yet.">You only need one for APIs Probaline can’t reach from the internet.</Note></Panel>}
      {remove.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(remove.error)}</p>}
      {(data ?? []).map((c) => (
        <Panel key={c.connectorId} as="article" aria-label={c.name} className="px-6 py-5 flex flex-wrap justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="m-0 text-lg font-bold">{c.name}</h2>
              <span className={c.online ? 'text-xs font-semibold px-2 py-0.5 rounded-full bg-ink text-white' : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-stop-soft text-stop-text'}>{c.online ? 'Online' : 'Offline'}</span>
            </div>
            <p className="m-0 mt-1 text-sm text-ink-muted [overflow-wrap:anywhere]">
              Calls {c.allowedHosts.join(', ')} · used by {c.apis} {c.apis === 1 ? 'API' : 'APIs'} · token {c.tokenHint}
              {c.lastSeenAt ? ` · last seen ${new Date(c.lastSeenAt).toLocaleString()}` : ' · never connected'}{c.agentVersion ? ` · version ${c.agentVersion}` : ''}
            </p>
          </div>
          <Button variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${c.name}? Its token stops working.`)) remove.mutate(c.connectorId); }}>Delete</Button>
        </Panel>
      ))}
    </div>
  );
}
