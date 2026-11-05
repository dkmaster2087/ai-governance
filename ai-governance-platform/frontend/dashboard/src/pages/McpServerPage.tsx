import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  addApi, ApiAuthInput, changeServer, changeTool, deleteServer, getServer, McpServerDetail, McpTool, pauseServer,
  publishServer, removeApi, serverUrl, testTool, TestResult,
} from '../lib/mcp-api';
import { listKeys } from '../lib/api-keys-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Segmented, Switch } from '../components/kit/primitives';
import { StatusPill } from './McpServersPage';

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

type Client = 'claude-code' | 'cursor' | 'vscode' | 'other';

function setupFor(client: Client, id: string, url: string): string {
  if (client === 'claude-code') return `claude mcp add --transport http ${id} ${url} \\\n  --header "Authorization: Bearer <your Probaline key>"`;
  if (client === 'cursor') return JSON.stringify({ mcpServers: { [id]: { url, headers: { Authorization: 'Bearer <your Probaline key>' } } } }, null, 2);
  if (client === 'vscode') {
    return JSON.stringify({
      inputs: [{ type: 'promptString', id: 'probaline-key', description: 'Probaline API key', password: true }],
      servers: { [id]: { type: 'http', url, headers: { Authorization: 'Bearer ${input:probaline-key}' } } },
    }, null, 2);
  }
  return `MCP address (Streamable HTTP): ${url}\nHeader: Authorization: Bearer <your Probaline key>`;
}

function Connect({ server }: { server: McpServerDetail }) {
  const [client, setClient] = useState<Client>('claude-code');
  const url = serverUrl(server.path);
  const snippet = setupFor(client, server.serverId, url);
  return (
    <Panel aria-label="Connect an agent" className="px-6 py-5 flex flex-col gap-3">
      <SectionLabel>Connect an agent</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-[240px] bg-canvas border border-line-subtle rounded-lg px-3.5 py-2.5 font-mono text-[13px] [overflow-wrap:anywhere]">{url}</code>
        <Copy text={url} label="Copy address" />
      </div>
      <p className="m-0 text-sm text-ink-muted">
        Agents need a Probaline API key with the <strong>Connect AI agents (MCP)</strong> permission: create one on <Link to="/keys" className="underline text-ink">API keys</Link>.
        Claude Desktop and ChatGPT, which sign people in instead of using a key, come with sign-in through your identity provider.
      </p>
      <Segmented<Client> label="Client" value={client} onChange={setClient}
        options={[{ value: 'claude-code', label: 'Claude Code' }, { value: 'cursor', label: 'Cursor' }, { value: 'vscode', label: 'VS Code' }, { value: 'other', label: 'Other' }]} />
      <div className="relative">
        <pre className="m-0 bg-ink text-[#E7ECF5] rounded-[10px] p-4 overflow-x-auto font-mono text-[13px] leading-relaxed">{snippet}</pre>
      </div>
      <div><Copy text={snippet} label="Copy setup" /></div>
      {server.status !== 'published' && <p className="m-0 text-sm font-semibold">Agents can connect once the server is published.</p>}
    </Panel>
  );
}

function AddApi({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [openapi, setOpenapi] = useState('');
  const [authType, setAuthType] = useState<ApiAuthInput['type']>('bearer');
  const [header, setHeader] = useState('X-API-Key');
  const [secret, setSecret] = useState('');
  const add = useMutation({
    mutationFn: () => addApi(serverId, {
      name: name.trim(), baseUrl: baseUrl.trim(), openapi,
      auth: authType === 'none' ? { type: 'none' } : authType === 'bearer' ? { type: 'bearer', secret } : { type: 'header', header, secret },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }); onDone(); },
  });
  const ready = name.trim() && baseUrl.trim() && openapi.trim() && (authType === 'none' || secret) && !add.isPending;

  return (
    <Panel aria-label="Add an API" className="px-6 py-5">
      <SectionLabel className="mb-3">Add an API</SectionLabel>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. People API" maxLength={80} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Base URL</span>
            <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://people.internal.acme.com/v1" /></label>
        </div>
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className="text-sm font-semibold mb-1">How Probaline signs in to it</legend>
          <Segmented<ApiAuthInput['type']> label="Credential" value={authType} onChange={setAuthType}
            options={[{ value: 'bearer', label: 'Bearer token' }, { value: 'header', label: 'API key header' }, { value: 'none', label: 'None' }]} />
          {authType !== 'none' && (
            <div className="flex flex-wrap gap-3 mt-1">
              {authType === 'header' && <input className={clsx(input, 'w-[200px]')} aria-label="Header name" value={header} onChange={(e) => setHeader(e.target.value)} />}
              <input className={clsx(input, 'flex-1 min-w-[240px]')} aria-label="Secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Kept in your secret store; agents never see it" />
            </div>
          )}
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">OpenAPI description <span className="font-normal text-ink-muted">(JSON or YAML, OpenAPI 3)</span></span>
          <textarea className="min-h-[160px] p-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]" value={openapi} onChange={(e) => setOpenapi(e.target.value)} placeholder="openapi: 3.0.3 …" />
        </label>
        <label className="text-sm">
          <span className="font-semibold">Or upload a file: </span>
          <input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setOpenapi(await f.text()); }} />
        </label>
        {add.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(add.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!ready}>{add.isPending ? 'Reading the API…' : 'Add API'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function ToolRow({ serverId, tool }: { serverId: string; tool: McpTool }) {
  const qc = useQueryClient();
  const toggle = useMutation({ mutationFn: (enabled: boolean) => changeTool(serverId, tool.name, { enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }) });
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-line-subtle last:border-b-0">
      <div className="min-w-0">
        <p className="m-0 font-semibold">{tool.title}</p>
        <p className="m-0 mt-0.5 text-sm text-ink-muted"><span className="font-mono text-[12px] bg-ink-tint rounded px-1.5 py-px mr-1.5">{tool.method}</span><span className="font-mono text-[12px]">{tool.path}</span> · <span className="font-mono text-[12px]">{tool.name}</span></p>
        {toggle.isError && <p role="alert" className="m-0 mt-1 text-sm text-stop-text font-semibold">{errorMessage(toggle.error)}</p>}
      </div>
      {tool.write
        ? <span className="text-xs font-semibold text-ink-muted whitespace-nowrap pt-1">Changes data · comes next</span>
        : <Switch checked={tool.enabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} label={`${tool.name}: ${tool.enabled ? 'on' : 'off'}`} />}
    </div>
  );
}

function AccessAndLimits({ server }: { server: McpServerDetail }) {
  const qc = useQueryClient();
  const { data: keys } = useQuery({ queryKey: ['api-keys'], queryFn: listKeys });
  const mcpKeys = (keys ?? []).filter((k) => k.status === 'active' && k.scopes.includes('mcp' as never));
  const [allKeys, setAllKeys] = useState(server.access.allKeys);
  const [keyIds, setKeyIds] = useState<string[]>(server.access.keyIds);
  const [perMinute, setPerMinute] = useState(String(server.limits.callsPerMinute));
  const [maxKb, setMaxKb] = useState(String(Math.round(server.limits.maxResultBytes / 1000)));
  const [personal, setPersonal] = useState(!!server.returnPersonalData);
  const save = useMutation({
    mutationFn: () => changeServer(server.serverId, {
      access: { allKeys, keyIds }, returnPersonalData: personal,
      limits: { callsPerMinute: Number(perMinute) || 60, maxResultBytes: (Number(maxKb) || 100) * 1000 },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-server', server.serverId] }),
  });
  return (
    <Panel aria-label="Access and limits" className="px-6 py-5 flex flex-col gap-4">
      <SectionLabel>Access and limits</SectionLabel>
      <Segmented<'all' | 'some'> label="Which keys may connect" value={allKeys ? 'all' : 'some'} onChange={(v) => setAllKeys(v === 'all')}
        options={[{ value: 'all', label: 'Every key with MCP permission' }, { value: 'some', label: 'Only these keys' }]} />
      {!allKeys && (
        <div className="flex flex-col gap-1.5">
          {mcpKeys.length === 0 && <p className="m-0 text-sm text-ink-muted">No active keys have the MCP permission yet.</p>}
          {mcpKeys.map((k) => (
            <label key={k.keyId} className="flex items-center gap-2.5 min-h-[32px]">
              <input type="checkbox" checked={keyIds.includes(k.keyId)} onChange={(e) => setKeyIds(e.target.checked ? [...keyIds, k.keyId] : keyIds.filter((x) => x !== k.keyId))} />
              <span className="font-medium">{k.name}</span> <span className="font-mono text-xs text-ink-muted">{k.keyPrefix}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 w-[200px]"><span className="text-sm font-semibold">Calls per minute, per key</span>
          <input className={input} type="number" min={1} max={10000} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 w-[200px]"><span className="text-sm font-semibold">Largest result (KB)</span>
          <input className={input} type="number" min={1} max={1000} value={maxKb} onChange={(e) => setMaxKb(e.target.value)} /></label>
      </div>
      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={!personal} onChange={(e) => setPersonal(!e.target.checked)} />
        <span><span className="font-medium">Remove personal data from results</span> <span className="text-ink-muted">· emails, phone numbers, SSNs and card numbers</span></span>
      </label>
      {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
      <div><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved' : save.isPending ? 'Saving…' : 'Save'}</Button></div>
    </Panel>
  );
}

/** Example arguments from a tool's schema, so the console starts with something to edit. */
function skeleton(tool?: McpTool): string {
  if (!tool) return '{}';
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(tool.inputSchema.properties ?? {})) {
    if (!(tool.inputSchema.required ?? []).includes(k)) continue;
    out[k] = p.type === 'integer' || p.type === 'number' ? 0 : p.type === 'boolean' ? false : p.type === 'object' ? {} : p.type === 'array' ? [] : '';
  }
  return JSON.stringify(out, null, 2);
}

function TestConsole({ server }: { server: McpServerDetail }) {
  const reads = server.tools.filter((t) => !t.write);
  const [name, setName] = useState(reads[0]?.name ?? '');
  const tool = reads.find((t) => t.name === name);
  const [args, setArgs] = useState(skeleton(tool));
  const [parseError, setParseError] = useState('');
  useEffect(() => { setArgs(skeleton(tool)); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation<TestResult, unknown, Record<string, unknown>>({ mutationFn: (a) => testTool(server.serverId, name, a) });
  if (reads.length === 0) return null;
  return (
    <Panel aria-label="Try a tool" className="px-6 py-5 flex flex-col gap-3">
      <SectionLabel>Try a tool</SectionLabel>
      <p className="m-0 text-sm text-ink-muted">Runs through every check and calls the API for real, as you. Works before publishing.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1.5 w-full max-w-[460px] min-w-0"><span className="text-sm font-semibold">Tool</span>
          <select className={clsx(input, 'w-full min-w-0')} value={name} onChange={(e) => setName(e.target.value)}>
            {reads.map((t) => <option key={t.name} value={t.name}>{t.title} ({t.name})</option>)}
          </select></label>
      </div>
      <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Arguments (JSON)</span>
        <textarea className="min-h-[110px] p-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]" value={args} onChange={(e) => setArgs(e.target.value)} /></label>
      {parseError && <p role="alert" className="m-0 text-stop-text font-semibold">{parseError}</p>}
      <div>
        <Button type="button" disabled={run.isPending} onClick={() => {
          try { const a = JSON.parse(args || '{}'); setParseError(''); run.mutate(a); } catch { setParseError('The arguments aren’t valid JSON.'); }
        }}>{run.isPending ? 'Calling…' : 'Run'}</Button>
      </div>
      {run.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(run.error)}</p>}
      {run.data && (
        <div className="flex flex-col gap-2" aria-label="Test result">
          <p className={clsx('m-0 font-bold', run.data.outcome === 'delivered' ? 'text-ink' : 'text-stop')}>
            {run.data.outcome === 'delivered' ? 'Delivered' : run.data.outcome === 'stopped' ? 'Stopped' : run.data.outcome === 'invalid' ? 'Arguments don’t fit' : 'The API had a problem'}
            <span className="font-mono text-xs font-normal text-ink-muted ml-2">{run.data.requestId}</span>
          </p>
          <ul className="m-0 pl-5 text-sm text-ink-muted">{run.data.checks.map((c) => <li key={c}>{c}</li>)}</ul>
          <pre className="m-0 bg-canvas border border-line-subtle rounded-lg p-3 max-h-[320px] overflow-auto font-mono text-[12px] whitespace-pre-wrap [overflow-wrap:anywhere]">{run.data.text}</pre>
        </div>
      )}
    </Panel>
  );
}

export function McpServerPage() {
  const { serverId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: server, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-server', serverId], queryFn: () => getServer(serverId) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }); qc.invalidateQueries({ queryKey: ['mcp-servers'] }); };
  const publish = useMutation({ mutationFn: () => publishServer(serverId), onSuccess: refresh });
  const pause = useMutation({ mutationFn: () => pauseServer(serverId), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => deleteServer(serverId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-servers'] }); navigate('/mcp'); } });
  const dropApi = useMutation({ mutationFn: (apiId: string) => removeApi(serverId, apiId), onSuccess: refresh });
  const byApi = useMemo(() => {
    const m = new Map<string, McpTool[]>();
    for (const t of server?.tools ?? []) m.set(t.apiId, [...(m.get(t.apiId) ?? []), t]);
    return m;
  }, [server]);

  if (isLoading) return <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>;
  if (isError || !server) return <Panel className="px-6"><Note title="Couldn’t load this MCP server."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>;
  const on = server.tools.filter((t) => t.enabled).length;
  const actionError = publish.error ?? pause.error ?? remove.error ?? dropApi.error;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <Link to="/mcp" className="text-sm text-ink-muted no-underline hover:text-ink">← MCP servers</Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">{server.name}</h1>
            <StatusPill status={server.status} />
          </div>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">{server.description || 'No description yet.'} · {on} {on === 1 ? 'tool' : 'tools'} on</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {server.status !== 'published' && <Button disabled={publish.isPending} onClick={() => publish.mutate()}>{server.status === 'paused' ? 'Resume' : 'Publish'}</Button>}
          {server.status === 'published' && <Button variant="secondary" disabled={pause.isPending} onClick={() => pause.mutate()}>Pause</Button>}
          <Button variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${server.name}? Agents lose access at once. Its case files are kept.`)) remove.mutate(); }}>Delete</Button>
        </div>
      </div>
      {actionError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(actionError)}</p>}

      <Connect server={server} />

      <section aria-label="APIs and tools" className="flex flex-col gap-3">
        <div className="flex justify-between items-end gap-3 flex-wrap">
          <div>
            <h2 className="m-0 text-xl font-bold">APIs and tools</h2>
            <p className="m-0 mt-1 text-sm text-ink-muted">Tools that read are on when an API is added. Tools that change data come next, with approval where needed.</p>
          </div>
          {!adding && <Button variant="secondary" onClick={() => setAdding(true)}>Add an API</Button>}
        </div>
        {adding && <AddApi serverId={serverId} onDone={() => setAdding(false)} />}
        {server.apis.length === 0 && !adding && <Panel className="px-6"><Note title="No APIs yet.">Add one with its OpenAPI description; its operations become tools.</Note></Panel>}
        {server.apis.map((a) => (
          <Panel key={a.apiId} as="article" aria-label={a.name} className="px-6 py-5">
            <div className="flex justify-between items-start gap-3 flex-wrap mb-2">
              <div>
                <h3 className="m-0 text-lg font-bold">{a.name}</h3>
                <p className="m-0 text-sm text-ink-muted"><span className="font-mono text-[12px]">{a.baseUrl}</span> · {a.auth.type === 'none' ? 'no credential' : `${a.auth.type === 'bearer' ? 'bearer token' : `${a.auth.header} header`} ${a.auth.hint ?? ''}`} · {a.openapi.title} {a.openapi.version}</p>
              </div>
              <Button variant="ghost" disabled={dropApi.isPending} onClick={() => { if (window.confirm(`Remove ${a.name} and its tools?`)) dropApi.mutate(a.apiId); }}>Remove</Button>
            </div>
            {a.openapi.skipped.length > 0 && (
              <details className="mb-2 text-sm"><summary className="cursor-pointer text-ink-muted">{a.openapi.skipped.length} operations couldn’t become tools</summary>
                <ul className="m-0 mt-1 pl-5 text-ink-muted">{a.openapi.skipped.map((s) => <li key={s}>{s}</li>)}</ul></details>
            )}
            <div>{(byApi.get(a.apiId) ?? []).sort((x, y) => Number(x.write) - Number(y.write) || x.path.localeCompare(y.path)).map((t) => <ToolRow key={t.name} serverId={serverId} tool={t} />)}</div>
          </Panel>
        ))}
      </section>

      <TestConsole key={server.tools.map((t) => t.name).join(',')} server={server} />
      <AccessAndLimits key={server.updatedAt} server={server} />
    </div>
  );
}
