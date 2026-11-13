import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  addApi, addUpstream, refreshUpstream, ApiAuthInput, changeServer, changeTool, deleteServer, getServer, getSignIn, listConnectors, listVersions, McpServerDetail, McpTool,
  pauseServer, publishServer, removeApi, restoreVersion, resumeServer, serverUrl, splitList, testTool, TestResult,
} from '../lib/mcp-api';
import { listKeys } from '../lib/api-keys-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Segmented, Switch } from '../components/kit/primitives';
import { StatusPill } from './McpServersPage';

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

type Client = 'claude-code' | 'claude-app' | 'cursor' | 'vscode' | 'other';
type Way = 'person' | 'key';

function setupFor(client: Client, way: Way, id: string, url: string): string {
  const key = way === 'key';
  if (client === 'claude-app') return key
    ? 'Claude and ChatGPT apps connect as a signed-in person. Choose "People sign in" above.'
    : `In Claude or ChatGPT: Settings → Connectors → Add custom connector.\nName: ${id}\nURL: ${url}\nYou'll be sent to your company sign-in, then asked to allow the agent.`;
  if (client === 'claude-code') return `claude mcp add --transport http ${id} ${url}${key ? ' \\\n  --header "Authorization: Bearer <your Probaline key>"' : '\n# then run /mcp in Claude Code and choose Authenticate'}`;
  if (client === 'cursor') return JSON.stringify({ mcpServers: { [id]: { url, ...(key ? { headers: { Authorization: 'Bearer <your Probaline key>' } } : {}) } } }, null, 2);
  if (client === 'vscode') {
    return JSON.stringify(key ? {
      inputs: [{ type: 'promptString', id: 'probaline-key', description: 'Probaline API key', password: true }],
      servers: { [id]: { type: 'http', url, headers: { Authorization: 'Bearer ${input:probaline-key}' } } },
    } : { servers: { [id]: { type: 'http', url } } }, null, 2);
  }
  return key ? `MCP address (Streamable HTTP): ${url}\nHeader: Authorization: Bearer <your Probaline key>` : `MCP address (Streamable HTTP): ${url}\nSign-in: OAuth (the client discovers it from the address)`;
}

function Connect({ server }: { server: McpServerDetail }) {
  const { data: signIn } = useQuery({ queryKey: ['mcp-sign-in'], queryFn: getSignIn });
  const [way, setWay] = useState<Way>(server.access.people !== 'none' ? 'person' : 'key');
  const [client, setClient] = useState<Client>('claude-code');
  const url = serverUrl(server.path);
  const snippet = setupFor(client, way, server.serverId, url);
  return (
    <Panel aria-label="Connect an agent" className="px-6 py-5 flex flex-col gap-3">
      <SectionLabel>Connect an agent</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-[240px] bg-canvas border border-line-subtle rounded-lg px-3.5 py-2.5 font-mono text-[13px] [overflow-wrap:anywhere]">{url}</code>
        <Copy text={url} label="Copy address" />
      </div>
      <Segmented<Way> label="How agents connect" value={way} onChange={setWay} options={[{ value: 'person', label: 'People sign in' }, { value: 'key', label: 'With an API key' }]} />
      {way === 'person' ? (
        <p className="m-0 text-sm text-ink-muted">
          People sign in with your company account and get the tools their groups allow.{' '}
          {signIn && !signIn.configured && <><strong className="text-ink">Sign-in isn’t set up yet:</strong> <Link to="/mcp/sign-in" className="underline text-ink">set it up</Link>. </>}
          {server.access.people === 'none' && <><strong className="text-ink">This server doesn’t allow people yet:</strong> choose who under Access below.</>}
        </p>
      ) : (
        <p className="m-0 text-sm text-ink-muted">For your own agents and automations: a Probaline API key with the <strong>Connect AI agents (MCP)</strong> permission, from <Link to="/keys" className="underline text-ink">API keys</Link>.</p>
      )}
      <Segmented<Client> label="Client" value={client} onChange={setClient}
        options={[{ value: 'claude-code', label: 'Claude Code' }, { value: 'claude-app', label: 'Claude / ChatGPT apps' }, { value: 'cursor', label: 'Cursor' }, { value: 'vscode', label: 'VS Code' }, { value: 'other', label: 'Other' }]} />
      <pre className="m-0 bg-ink text-[#E7ECF5] rounded-[10px] p-4 overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">{snippet}</pre>
      <div><Copy text={snippet} label="Copy setup" /></div>
      {server.status === 'draft' && <p className="m-0 text-sm font-semibold">Agents can connect once the server is published.</p>}
    </Panel>
  );
}

/** Add an API from its OpenAPI description, or (kind `mcp`) a company's existing MCP server. */
function AddApi({ serverId, onDone, kind = 'openapi' }: { serverId: string; onDone: () => void; kind?: 'openapi' | 'mcp' }) {
  const mcp = kind === 'mcp';
  const qc = useQueryClient();
  const { data: connectors } = useQuery({ queryKey: ['mcp-connectors'], queryFn: listConnectors });
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [openapi, setOpenapi] = useState('');
  const [via, setVia] = useState('');
  const [authType, setAuthType] = useState<ApiAuthInput['type']>('bearer');
  const [header, setHeader] = useState('X-API-Key');
  const [secret, setSecret] = useState('');
  const add = useMutation({
    mutationFn: () => {
      const auth: ApiAuthInput = authType === 'none' ? { type: 'none' } : authType === 'bearer' ? { type: 'bearer', secret } : { type: 'header', header, secret };
      return mcp
        ? addUpstream(serverId, { name: name.trim(), url: baseUrl.trim(), auth, ...(via ? { connectorId: via } : {}) })
        : addApi(serverId, { name: name.trim(), baseUrl: baseUrl.trim(), openapi, auth, ...(via ? { connectorId: via } : {}) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }); onDone(); },
  });
  const ready = name.trim() && baseUrl.trim() && (mcp || openapi.trim()) && (authType === 'none' || secret) && !add.isPending;

  return (
    <Panel aria-label={mcp ? 'Add an MCP server' : 'Add an API'} className="px-6 py-5">
      <SectionLabel className="mb-3">{mcp ? 'Add a company MCP server' : 'Add an API'}</SectionLabel>
      {mcp && <p className="m-0 mb-3 text-sm text-ink-muted max-w-[760px]">An MCP server your company already runs. Agents connect to this Probaline server instead; Probaline calls yours with its own credential, after every check. Lock yours to Probaline so agents can’t go around it: accept only calls with Probaline’s credential, or check the signed X-Probaline-Identity header.</p>}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={mcp ? 'e.g. HR assistant tools' : 'e.g. People API'} maxLength={80} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">{mcp ? 'Address (Streamable HTTP)' : 'Base URL'}</span>
            <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={mcp ? 'https://hr-mcp.internal.acme.com/mcp' : 'https://people.internal.acme.com/v1'} /></label>
          <label className="flex flex-col gap-1.5 min-w-0"><span className="text-sm font-semibold">How Probaline reaches it</span>
            <select className={clsx(input, 'w-full min-w-0')} value={via} onChange={(e) => setVia(e.target.value)}>
              <option value="">Directly, over the internet</option>
              {(connectors ?? []).map((c) => <option key={c.connectorId} value={c.connectorId}>Through connector: {c.name}{c.online ? '' : ' (offline)'}</option>)}
            </select></label>
        </div>
        {via && <p className="m-0 -mt-2 text-sm text-ink-muted">The address only needs to work inside your network, and its host must be one the connector may call.</p>}
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
        {!mcp && <>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">OpenAPI description <span className="font-normal text-ink-muted">(JSON or YAML, OpenAPI 3)</span></span>
          <textarea className="min-h-[160px] p-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]" value={openapi} onChange={(e) => setOpenapi(e.target.value)} placeholder="openapi: 3.0.3 …" />
        </label>
        <label className="text-sm">
          <span className="font-semibold">Or upload a file: </span>
          <input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setOpenapi(await f.text()); }} />
        </label>
        </>}
        {add.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(add.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!ready}>{add.isPending ? (mcp ? 'Connecting…' : 'Reading the API…') : (mcp ? 'Connect and read its tools' : 'Add API')}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function ToolRow({ serverId, tool }: { serverId: string; tool: McpTool }) {
  const qc = useQueryClient();
  const [editingGroups, setEditingGroups] = useState(false);
  const [groups, setGroups] = useState((tool.groups ?? []).join(', '));
  const [limit, setLimit] = useState(tool.callsPerMinute ? String(tool.callsPerMinute) : '');
  const change = useMutation({
    mutationFn: (c: Parameters<typeof changeTool>[2]) => changeTool(serverId, tool.name, c),
    onSuccess: () => { setEditingGroups(false); qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }); },
  });
  return (
    <div className="py-3 border-b border-line-subtle last:border-b-0 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 font-semibold">{tool.title}{tool.write && <span className="ml-2 text-xs font-semibold text-ink-soft align-middle">Changes data</span>}</p>
          <p className="m-0 mt-0.5 text-sm text-ink-muted">
            {tool.upstreamName
              ? <><span className="font-mono text-[12px] bg-ink-tint rounded px-1.5 py-px mr-1.5">MCP</span><span className="font-mono text-[12px]">{tool.upstreamName}</span></>
              : <><span className="font-mono text-[12px] bg-ink-tint rounded px-1.5 py-px mr-1.5">{tool.method}</span><span className="font-mono text-[12px]">{tool.path}</span> · <span className="font-mono text-[12px]">{tool.name}</span></>}
          </p>
          <p className="m-0 mt-0.5 text-sm text-ink-muted">
            {tool.groups?.length ? <>Only for {tool.groups.join(', ')}</> : 'For everyone who can connect'}
            {tool.callsPerMinute ? <> · at most {tool.callsPerMinute} calls a minute each</> : null} ·{' '}
            <button type="button" className="underline" onClick={() => setEditingGroups(!editingGroups)}>{editingGroups ? 'cancel' : 'change'}</button>
          </p>
        </div>
        <Switch checked={tool.enabled} disabled={change.isPending} onChange={(v) => change.mutate({ enabled: v })} label={`${tool.name}: ${tool.enabled ? 'on' : 'off'}`} />
      </div>
      {tool.write && tool.enabled && (
        <Segmented<'required' | 'none'> label={`${tool.name} approval`} value={tool.approval ?? 'required'} onChange={(v) => change.mutate({ approval: v })}
          options={[{ value: 'required', label: 'A person approves each call' }, { value: 'none', label: 'Runs without approval' }]} />
      )}
      {editingGroups && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); change.mutate({ groups: splitList(groups), callsPerMinute: Number(limit) > 0 ? Number(limit) : null }); }}>
          <label className="flex flex-col gap-1 flex-1 min-w-[min(240px,100%)]"><span className="text-sm font-semibold">Only for these groups <span className="font-normal text-ink-muted">(empty: everyone; API keys don’t get group-limited tools)</span></span>
            <input className={input} value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="e.g. Payroll, HR leads" /></label>
          <label className="flex flex-col gap-1 w-[200px]"><span className="text-sm font-semibold">Calls a minute, each</span>
            <input className={input} type="number" min={1} max={10000} value={limit} placeholder="Server’s limit" onChange={(e) => setLimit(e.target.value)} /></label>
          <Button type="submit" variant="secondary" disabled={change.isPending}>Save</Button>
        </form>
      )}
      {change.isError && <p role="alert" className="m-0 text-sm text-stop-text font-semibold">{errorMessage(change.error)}</p>}
    </div>
  );
}

function Access({ server }: { server: McpServerDetail }) {
  const qc = useQueryClient();
  const { data: keys } = useQuery({ queryKey: ['api-keys'], queryFn: listKeys });
  const mcpKeys = (keys ?? []).filter((k) => k.status === 'active' && k.scopes.includes('mcp' as never));
  const [people, setPeople] = useState(server.access.people);
  const [groups, setGroups] = useState(server.access.groups.join(', '));
  const [allKeys, setAllKeys] = useState(server.access.allKeys);
  const [keyIds, setKeyIds] = useState<string[]>(server.access.keyIds);
  const [perMinute, setPerMinute] = useState(String(server.limits.callsPerMinute));
  const [maxKb, setMaxKb] = useState(String(Math.round(server.limits.maxResultBytes / 1000)));
  const [perDay, setPerDay] = useState(server.limits.callsPerDay ? String(server.limits.callsPerDay) : '');
  const [personal, setPersonal] = useState(!!server.returnPersonalData);
  const [attacks, setAttacks] = useState<'block' | 'flag' | 'off'>(server.argumentChecks ?? 'block');
  const save = useMutation({
    mutationFn: () => changeServer(server.serverId, {
      access: { allKeys, keyIds, people, groups: splitList(groups) }, returnPersonalData: personal, argumentChecks: attacks,
      limits: { callsPerMinute: Number(perMinute) || 60, maxResultBytes: (Number(maxKb) || 100) * 1000, callsPerDay: Number(perDay) || 0 },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-server', server.serverId] }),
  });
  return (
    <Panel aria-label="Access and limits" className="px-6 py-5 flex flex-col gap-4">
      <SectionLabel>Access and limits</SectionLabel>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">People who sign in</span>
        <Segmented<'none' | 'all' | 'groups'> label="Which people may connect" value={people} onChange={setPeople}
          options={[{ value: 'none', label: 'Nobody' }, { value: 'all', label: 'Everyone in the company' }, { value: 'groups', label: 'Only these groups' }]} />
        {people === 'groups' && <input className={clsx(input, 'max-w-[560px]')} aria-label="Groups" value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="e.g. HR, People partners (names or IDs, as your identity provider sends them)" />}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Agents with an API key</span>
        <Segmented<'all' | 'some'> label="Which keys may connect" value={allKeys ? 'all' : 'some'} onChange={(v) => setAllKeys(v === 'all')}
          options={[{ value: 'all', label: 'Every key with MCP permission' }, { value: 'some', label: 'Only these keys' }]} />
        {!allKeys && (
          <div className="flex flex-col gap-1.5">
            {mcpKeys.length === 0 && <p className="m-0 text-sm text-ink-muted">No active keys have the MCP permission. Choosing none means no key can connect.</p>}
            {mcpKeys.map((k) => (
              <label key={k.keyId} className="flex items-center gap-2.5 min-h-[32px]">
                <input type="checkbox" checked={keyIds.includes(k.keyId)} onChange={(e) => setKeyIds(e.target.checked ? [...keyIds, k.keyId] : keyIds.filter((x) => x !== k.keyId))} />
                <span className="font-medium">{k.name}</span> <span className="font-mono text-xs text-ink-muted">{k.keyPrefix}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 w-[220px]"><span className="text-sm font-semibold">Calls per minute, per person or key</span>
          <input className={input} type="number" min={1} max={10000} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 w-[220px]"><span className="text-sm font-semibold">Tool calls per day, per person or key</span>
          <input className={input} type="number" min={0} max={1000000} value={perDay} placeholder="No daily limit" onChange={(e) => setPerDay(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 w-[220px]"><span className="text-sm font-semibold">Largest result (KB)</span>
          <input className={input} type="number" min={1} max={1000} value={maxKb} onChange={(e) => setMaxKb(e.target.value)} /></label>
      </div>
      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={!personal} onChange={(e) => setPersonal(!e.target.checked)} />
        <span><span className="font-medium">Remove personal data from results</span> <span className="text-ink-muted">· emails, phone numbers, SSNs and card numbers</span></span>
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Attacks in tool arguments <span className="font-normal text-ink-muted">· SQL injection, system commands, paths like ../, database operators, requests to cloud metadata</span></span>
        <Segmented<'block' | 'flag' | 'off'> label="Attacks in tool arguments" value={attacks} onChange={setAttacks}
          options={[{ value: 'block', label: 'Stop the call' }, { value: 'flag', label: 'Record only' }, { value: 'off', label: 'Off' }]} />
      </div>
      {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
      <div><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved' : save.isPending ? 'Saving…' : 'Save'}</Button></div>
    </Panel>
  );
}

function ApprovalSettings({ server }: { server: McpServerDetail }) {
  const qc = useQueryClient();
  const a = server.approvals;
  const [approvers, setApprovers] = useState(a.approvers.join(', '));
  const [wait, setWait] = useState(String(a.waitSeconds));
  const [hours, setHours] = useState(String(Math.round(a.expiresMinutes / 60) || 1));
  const [webhook, setWebhook] = useState(a.webhookUrl ?? '');
  const save = useMutation({
    mutationFn: () => changeServer(server.serverId, { approvals: { approvers: splitList(approvers), waitSeconds: Math.min(110, Math.max(0, Number(wait) || 0)), expiresMinutes: Math.max(1, Number(hours) || 24) * 60, webhookUrl: webhook.trim() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-server', server.serverId] }),
  });
  if (!server.tools.some((t) => t.write)) return null;
  return (
    <Panel aria-label="Approvals" className="px-6 py-5 flex flex-col gap-4">
      <SectionLabel>Approvals</SectionLabel>
      <p className="m-0 text-sm text-ink-muted">For tools that change data and need approval. The agent’s call waits a little for a decision; after that it’s told to ask again once approved. Approvals are on the <Link to="/mcp/approvals" className="underline text-ink">Approvals</Link> page.</p>
      <label className="flex flex-col gap-1.5 max-w-[640px]"><span className="text-sm font-semibold">Approvers <span className="font-normal text-ink-muted">(email addresses of dashboard users; empty: any admin)</span></span>
        <input className={input} value={approvers} onChange={(e) => setApprovers(e.target.value)} placeholder="e.g. hr-lead@acme.com, cfo@acme.com" /></label>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 w-[220px]"><span className="text-sm font-semibold">Agent waits (seconds)</span>
          <input className={input} type="number" min={0} max={110} value={wait} onChange={(e) => setWait(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 w-[220px]"><span className="text-sm font-semibold">Request stays open (hours)</span>
          <input className={input} type="number" min={1} max={168} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      </div>
      <label className="flex flex-col gap-1.5 max-w-[640px]"><span className="text-sm font-semibold">Tell approvers through a webhook <span className="font-normal text-ink-muted">(optional: Slack, Teams or any incoming webhook; only a summary is sent)</span></span>
        <input className={input} value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/…" /></label>
      {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
      <div><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved' : save.isPending ? 'Saving…' : 'Save'}</Button></div>
    </Panel>
  );
}

function Versions({ server }: { server: McpServerDetail }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['mcp-versions', server.serverId, server.publishedVersion], queryFn: () => listVersions(server.serverId), enabled: !!server.publishedVersion });
  const restore = useMutation({ mutationFn: (n: number) => restoreVersion(server.serverId, n), onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-server', server.serverId] }) });
  if (!data?.length) return null;
  return (
    <Panel aria-label="Versions" className="px-6 py-5">
      <SectionLabel className="mb-2">Versions</SectionLabel>
      <ul className="m-0 p-0 list-none">
        {data.map((v) => (
          <li key={v.version} className="py-2.5 border-b border-line-subtle last:border-b-0 flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="font-semibold">Version {v.version}</span>{v.live && <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-ink text-white">Live</span>}
              <span className="text-ink-muted"> · {when(v.publishedAt)} · {v.tools} tools{v.note ? ` · “${v.note}”` : ''}</span>
            </span>
            {!v.live && <Button variant="ghost" disabled={restore.isPending} onClick={() => { if (window.confirm(`Make version ${v.version} the draft? Your unpublished changes are replaced. Agents keep the live version until you publish.`)) restore.mutate(v.version); }}>Restore as draft</Button>}
          </li>
        ))}
      </ul>
      {restore.isError && <p role="alert" className="m-0 mt-2 text-stop-text font-semibold">{errorMessage(restore.error)}</p>}
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

const OUTCOME: Record<string, string> = { delivered: 'Delivered', stopped: 'Stopped', invalid: 'Arguments don’t fit', backend_error: 'The API had a problem', pending_approval: 'Waiting for approval' };

function TestConsole({ server }: { server: McpServerDetail }) {
  const tools = [...server.tools].sort((a, b) => Number(a.write) - Number(b.write));
  const [name, setName] = useState(tools[0]?.name ?? '');
  const tool = tools.find((t) => t.name === name);
  const [args, setArgs] = useState(skeleton(tool));
  const [parseError, setParseError] = useState('');
  useEffect(() => { setArgs(skeleton(tool)); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation<TestResult, unknown, Record<string, unknown>>({ mutationFn: (a) => testTool(server.serverId, name, a) });
  if (tools.length === 0) return null;
  return (
    <Panel aria-label="Try a tool" className="px-6 py-5 flex flex-col gap-3">
      <SectionLabel>Try a tool</SectionLabel>
      <p className="m-0 text-sm text-ink-muted">Runs through every check and calls the API for real, as you. Works on the draft. Tools that change data need approval here too, from someone else.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1.5 w-full max-w-[460px] min-w-0"><span className="text-sm font-semibold">Tool</span>
          <select className={clsx(input, 'w-full min-w-0')} value={name} onChange={(e) => setName(e.target.value)}>
            {tools.map((t) => <option key={t.name} value={t.name}>{t.title} ({t.name}){t.write ? ' · changes data' : ''}</option>)}
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
            {OUTCOME[run.data.outcome] ?? run.data.outcome}
            <span className="font-mono text-xs font-normal text-ink-muted ml-2">{run.data.requestId}</span>
          </p>
          {run.data.outcome === 'pending_approval' && <p className="m-0 text-sm">Someone else approves it on the <Link to="/mcp/approvals" className="underline">Approvals</Link> page; then run it again with the same arguments.</p>}
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
  const [adding, setAdding] = useState<false | 'openapi' | 'mcp'>(false);
  const [note, setNote] = useState('');
  const { data: server, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-server', serverId], queryFn: () => getServer(serverId) });
  const { data: connectors } = useQuery({ queryKey: ['mcp-connectors'], queryFn: listConnectors });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mcp-server', serverId] }); qc.invalidateQueries({ queryKey: ['mcp-servers'] }); qc.invalidateQueries({ queryKey: ['mcp-versions', serverId] }); };
  const publish = useMutation({ mutationFn: () => publishServer(serverId, note.trim()), onSuccess: () => { setNote(''); refresh(); } });
  const pause = useMutation({ mutationFn: () => pauseServer(serverId), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => resumeServer(serverId), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => deleteServer(serverId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-servers'] }); navigate('/mcp'); } });
  const dropApi = useMutation({ mutationFn: (apiId: string) => removeApi(serverId, apiId), onSuccess: refresh });
  const refresh_ = useMutation({ mutationFn: (apiId: string) => refreshUpstream(serverId, apiId), onSuccess: refresh });
  const byApi = useMemo(() => {
    const m = new Map<string, McpTool[]>();
    for (const t of server?.tools ?? []) m.set(t.apiId, [...(m.get(t.apiId) ?? []), t]);
    return m;
  }, [server]);

  if (isLoading) return <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>;
  if (isError || !server) return <Panel className="px-6"><Note title="Couldn’t load this MCP server."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>;
  const on = server.tools.filter((t) => t.enabled).length;
  const actionError = publish.error ?? pause.error ?? resume.error ?? remove.error ?? dropApi.error;
  const connectorName = (id?: string) => connectors?.find((c) => c.connectorId === id)?.name ?? 'a connector';

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <Link to="/mcp" className="text-sm text-ink-muted no-underline hover:text-ink">← MCP servers</Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">{server.name}</h1>
            <StatusPill status={server.status} />
            {server.publishedVersion && <span className="text-sm text-ink-muted">version {server.publishedVersion} live</span>}
          </div>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">{server.description || 'No description yet.'} · {on} {on === 1 ? 'tool' : 'tools'} on</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {server.status === 'draft' && <Button disabled={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
          {server.status === 'published' && <Button variant="secondary" disabled={pause.isPending} onClick={() => pause.mutate()}>Pause</Button>}
          {server.status === 'paused' && <Button disabled={resume.isPending} onClick={() => resume.mutate()}>Resume</Button>}
          <Button variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${server.name}? Agents lose access at once. Its case files are kept.`)) remove.mutate(); }}>Delete</Button>
        </div>
      </div>
      {actionError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(actionError)}</p>}

      {server.hasChanges && server.status !== 'draft' && (
        <Panel aria-label="Unpublished changes" className="px-6 py-4 flex flex-wrap items-end gap-3 border-ink">
          <div className="flex-1 min-w-[240px]">
            <p className="m-0 font-semibold">You have changes agents don’t see yet.</p>
            <label className="flex flex-col gap-1 mt-2"><span className="text-sm text-ink-muted">What changed (optional)</span>
              <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Added leave balances" /></label>
          </div>
          <Button disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish changes'}</Button>
        </Panel>
      )}

      <Connect server={server} />

      <section aria-label="APIs and tools" className="flex flex-col gap-3">
        <div className="flex justify-between items-end gap-3 flex-wrap">
          <div>
            <h2 className="m-0 text-xl font-bold">APIs and tools</h2>
            <p className="m-0 mt-1 text-sm text-ink-muted">Tools that read are on when an API is added. Tools that change data are off until you turn them on, and then need a person’s approval unless you say otherwise.</p>
          </div>
          {!adding && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" onClick={() => setAdding('openapi')}>Add an API</Button>
              <Button variant="secondary" onClick={() => setAdding('mcp')}>Add an MCP server</Button>
            </div>
          )}
        </div>
        {adding && <AddApi key={adding} kind={adding} serverId={serverId} onDone={() => setAdding(false)} />}
        {server.apis.length === 0 && !adding && <Panel className="px-6"><Note title="No APIs yet.">Add one with its OpenAPI description, so its operations become tools, or put an MCP server your company already runs behind this one.</Note></Panel>}
        {server.apis.map((a) => (
          <Panel key={a.apiId} as="article" aria-label={a.name} className="px-6 py-5">
            <div className="flex justify-between items-start gap-3 flex-wrap mb-2">
              <div className="min-w-0">
                <h3 className="m-0 text-lg font-bold">{a.name}</h3>
                <p className="m-0 text-sm text-ink-muted [overflow-wrap:anywhere]">
                  {a.kind === 'mcp' && <span className="font-semibold text-ink-soft">MCP server · </span>}<span className="font-mono text-[12px]">{a.baseUrl}</span>{a.connectorId && <> · through {connectorName(a.connectorId)}</>} · {a.auth.type === 'none' ? 'no credential' : `${a.auth.type === 'bearer' ? 'bearer token' : `${a.auth.header} header`} ${a.auth.hint ?? ''}`}{a.kind !== 'mcp' && <> · {a.openapi.title} {a.openapi.version}</>}
                </p>
              </div>
              <div className="flex gap-2">
                {a.kind === 'mcp' && <Button variant="secondary" disabled={refresh_.isPending} onClick={() => refresh_.mutate(a.apiId)}>{refresh_.isPending && refresh_.variables === a.apiId ? 'Reading…' : 'Read tools again'}</Button>}
                <Button variant="ghost" disabled={dropApi.isPending} onClick={() => { if (window.confirm(`Remove ${a.name} and its tools?`)) dropApi.mutate(a.apiId); }}>Remove</Button>
              </div>
            </div>
            {refresh_.isSuccess && refresh_.variables === a.apiId && <p role="status" className="m-0 mb-2 text-sm text-ink-muted">{refresh_.data.tools} tools: {refresh_.data.added} new, {refresh_.data.removed} removed. New tools that change data are off.</p>}
            {refresh_.isError && refresh_.variables === a.apiId && <p role="alert" className="m-0 mb-2 text-sm text-stop-text font-semibold">{errorMessage(refresh_.error)}</p>}
            {a.openapi.skipped.length > 0 && (
              <details className="mb-2 text-sm"><summary className="cursor-pointer text-ink-muted">{a.openapi.skipped.length} operations couldn’t become tools</summary>
                <ul className="m-0 mt-1 pl-5 text-ink-muted">{a.openapi.skipped.map((s) => <li key={s}>{s}</li>)}</ul></details>
            )}
            <div>{(byApi.get(a.apiId) ?? []).sort((x, y) => Number(x.write) - Number(y.write) || x.path.localeCompare(y.path)).map((t) => <ToolRow key={`${t.name}:${t.enabled}:${t.approval}:${(t.groups ?? []).join()}`} serverId={serverId} tool={t} />)}</div>
          </Panel>
        ))}
      </section>

      <TestConsole key={server.tools.map((t) => t.name).join(',')} server={server} />
      <Access key={`access-${server.updatedAt}`} server={server} />
      <ApprovalSettings key={`approvals-${server.updatedAt}`} server={server} />
      <Versions server={server} />
    </div>
  );
}
