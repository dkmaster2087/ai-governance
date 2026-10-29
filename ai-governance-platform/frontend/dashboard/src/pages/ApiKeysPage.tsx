import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { ApiKeySummary, createKey, deleteKey, listKeys, revokeKey, rotateKey, Scope } from '../lib/api-keys-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/aegis/primitives';

const SCOPES: Array<{ value: Scope; label: string; hint: string }> = [
  { value: 'chat', label: 'Send AI requests', hint: 'For apps and the IDE proxy' },
  { value: 'models', label: 'List models', hint: 'Lets an app see which models it may use' },
  { value: 'shadow_ai:ingest', label: 'Browser extension', hint: 'Report visits and read extension settings only' },
];
const SCOPE_LABEL: Record<string, string> = { chat: 'Send AI requests', models: 'List models', 'shadow_ai:ingest': 'Browser extension', 'reporting:ingest': 'On-prem license' };

function date(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/** Shows a new key once, with a copy button. */
function NewKey({ value, onDone }: { value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Panel aria-label="New key" className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
      <p className="m-0 font-semibold">Copy this key now. It won’t be shown again.</p>
      <code className="block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere]">{value}</code>
      <div className="flex gap-2">
        <Button onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* clipboard unavailable */ } }}>{copied ? 'Copied' : 'Copy key'}</Button>
        <Button variant="secondary" onClick={onDone}>I’ve saved it</Button>
      </div>
    </Panel>
  );
}

function KeyRow({ k, onNewKey }: { k: ApiKeySummary; onNewKey: (key: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const revoke = useMutation({ mutationFn: () => revokeKey(k.keyId), onSuccess: refresh });
  const rotate = useMutation({ mutationFn: () => rotateKey(k.keyId), onSuccess: (r) => { onNewKey(r.key); refresh(); } });
  const remove = useMutation({ mutationFn: () => deleteKey(k.keyId), onSuccess: refresh });
  const expired = k.status === 'active' && k.expiresAt && new Date(k.expiresAt) < new Date();
  const status = k.status === 'revoked' ? 'Revoked' : expired ? 'Expired' : 'Active';
  const error = revoke.error ?? rotate.error ?? remove.error;

  return (
    <Panel as="article" className={clsx('px-[22px] py-[18px] flex flex-wrap items-center gap-x-7 gap-y-3', status !== 'Active' && 'opacity-75')}>
      <div className="flex-[1_1_240px] min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="m-0 text-lg font-bold">{k.name}</h2>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', status === 'Active' ? 'bg-ink-tint text-ink' : 'bg-line-subtle text-ink-soft')}>{status}</span>
        </div>
        <div className="font-mono text-xs text-ink-muted mt-0.5">{k.keyPrefix}</div>
        <div className="text-xs text-ink-muted mt-1">{k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(' · ')}</div>
      </div>
      <dl className="m-0 flex gap-6 text-sm">
        <div><dt className="text-xs text-ink-muted">Last used</dt><dd className="m-0">{date(k.lastUsedAt)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Expires</dt><dd className="m-0">{k.expiresAt ? date(k.expiresAt) : 'Never'}</dd></div>
      </dl>
      <div className="flex gap-2 flex-wrap">
        {status === 'Active' && <Button variant="secondary" disabled={rotate.isPending} onClick={() => rotate.mutate()}>Replace</Button>}
        {status === 'Active' && <Button variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button>}
        {status !== 'Active' && <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
      </div>
      {error && <p role="alert" className="basis-full m-0 text-stop-text font-semibold">{errorMessage(error)}</p>}
    </Panel>
  );
}

export function ApiKeysPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['chat', 'models']);
  const [expiry, setExpiry] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['api-keys', user?.tenantId], queryFn: listKeys });
  const create = useMutation({
    mutationFn: createKey,
    onSuccess: (r) => { setShown(r.key); setCreating(false); setName(''); setExpiry(''); qc.invalidateQueries({ queryKey: ['api-keys'] }); },
  });
  const canCreate = name.trim().length > 0 && scopes.length > 0 && !create.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">API keys</h1>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Keys let your apps, IDE proxy and browser extension use the gateway. Give each one only what it needs.</p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Create a key</Button>}
      </div>

      {shown && <NewKey value={shown} onDone={() => setShown(null)} />}

      {creating && (
        <Panel aria-label="New API key" className="px-6 py-5">
          <SectionLabel className="mb-3">New key</SectionLabel>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (canCreate) create.mutate({ name: name.trim(), scopes, ...(expiry ? { expiresInDays: Number(expiry) } : {}) }); }}>
            <label className="flex flex-col gap-1.5 max-w-[420px]">
              <span className="text-sm font-semibold">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. support-bot" className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" />
            </label>
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
              <legend className="text-sm font-semibold mb-1">What it can do</legend>
              {SCOPES.map((s) => (
                <label key={s.value} className="flex items-start gap-2.5 min-h-[32px]">
                  <input type="checkbox" className="mt-1" checked={scopes.includes(s.value)}
                    onChange={(e) => setScopes(e.target.checked ? [...scopes, s.value] : scopes.filter((x) => x !== s.value))} />
                  <span><span className="font-medium">{s.label}</span> <span className="text-ink-muted">· {s.hint}</span></span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1.5 max-w-[240px]">
              <span className="text-sm font-semibold">Expires</span>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white">
                <option value="">Never</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In a year</option>
              </select>
            </label>
            {create.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(create.error)}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={!canCreate}>{create.isPending ? 'Creating…' : 'Create key'}</Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {isError && <Panel className="px-6"><Note title="Couldn’t load API keys."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && data.length === 0 && <Panel className="px-6"><Note title="No API keys yet.">Create one to connect your first app.</Note></Panel>}
      {data && data.length > 0 && (
        <div className="flex flex-col gap-3">
          {[...data].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))
            .map((k) => <KeyRow key={k.keyId} k={k} onNewKey={setShown} />)}
        </div>
      )}
    </div>
  );
}
