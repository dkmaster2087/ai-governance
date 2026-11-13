import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { ApiKeySummary, createKey, deleteKey, listKeys, revokeKey, rotateKey, Scope, setKeyLimits } from '../lib/api-keys-api';
import { errorMessage } from '../lib/rules-api';
import { Button, ConfirmAction, Note, Panel, SectionLabel, Segmented } from '../components/kit/primitives';
import { CATEGORIES, CategoryBadge, CategoryGlyph, categoriesOf, categoryStyle, KeyCategory } from '../lib/key-categories';

const SCOPES: Array<{ value: Scope; label: string; hint: string; category: KeyCategory }> = [
  { value: 'chat', label: 'Send AI requests', hint: 'For apps and the IDE proxy', category: 'apps' },
  { value: 'models', label: 'List models', hint: 'Lets an app see which models it may use', category: 'apps' },
  { value: 'guardrails', label: 'Checks for another gateway', hint: 'LiteLLM, Portkey or Kong call Probaline’s checks before and after the model', category: 'apps' },
  { value: 'mcp', label: 'Connect AI agents (MCP)', hint: 'Use the tools on your MCP servers', category: 'agents' },
  { value: 'shadow_ai:ingest', label: 'Browser extension', hint: 'Report visits and read extension settings only', category: 'extension' },
];
const SCOPE_LABEL: Record<string, string> = { chat: 'Send AI requests', models: 'List models', 'shadow_ai:ingest': 'Browser extension', 'reporting:ingest': 'License', mcp: 'Connect AI agents (MCP)', guardrails: 'Checks for another gateway' };

type Status = 'active' | 'ended';
const isActive = (k: ApiKeySummary) => k.status === 'active' && !(k.expiresAt && new Date(k.expiresAt) < new Date());

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

/** "100,000 tokens · $25", or "None". */
function capText(k: ApiKeySummary) {
  const parts = [k.dailyTokenLimit ? `${k.dailyTokenLimit.toLocaleString('en-US')} tokens` : '', k.dailySpendLimitUsd ? `$${k.dailySpendLimitUsd.toLocaleString('en-US')}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'None';
}

function KeyRow({ k, onNewKey }: { k: ApiKeySummary; onNewKey: (key: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const revoke = useMutation({ mutationFn: () => revokeKey(k.keyId), onSuccess: refresh });
  const rotate = useMutation({ mutationFn: () => rotateKey(k.keyId), onSuccess: (r) => { onNewKey(r.key); refresh(); } });
  const remove = useMutation({ mutationFn: () => deleteKey(k.keyId), onSuccess: refresh });
  const [editing, setEditing] = useState(false);
  const [tokens, setTokens] = useState(k.dailyTokenLimit ? String(k.dailyTokenLimit) : '');
  const [spend, setSpend] = useState(k.dailySpendLimitUsd ? String(k.dailySpendLimitUsd) : '');
  const limits = useMutation({
    mutationFn: () => setKeyLimits(k.keyId, { dailyTokenLimit: Number(tokens) || 0, dailySpendLimitUsd: Number(spend) || 0 }),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  const expired = k.status === 'active' && k.expiresAt && new Date(k.expiresAt) < new Date();
  const status = k.status === 'revoked' ? 'Revoked' : expired ? 'Expired' : 'Active';
  const error = revoke.error ?? rotate.error ?? remove.error ?? limits.error;
  const categories = categoriesOf(k);

  return (
    <Panel as="article" aria-label={k.name} className={clsx('relative overflow-hidden pl-[26px] pr-[22px] py-[18px] flex flex-wrap items-center gap-x-7 gap-y-3', status !== 'Active' && 'opacity-75')}>
      {/* The colour bar says what the key is for at a glance; split when it's for several things. */}
      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[5px] flex flex-col">
        {(categories.length ? categories : ['apps' as KeyCategory]).map((c) => <span key={c} className={clsx('flex-1', categoryStyle(c).bar)} />)}
      </span>
      <div className="flex-[1_1_240px] min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="m-0 text-lg font-bold">{k.name}</h2>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', status === 'Active' ? 'bg-ink-tint text-ink' : 'bg-line-subtle text-ink-soft')}>{status}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">{categories.map((c) => <CategoryBadge key={c} category={c} />)}</div>
        <div className="font-mono text-xs text-ink-muted mt-1.5">{k.keyPrefix}</div>
        <div className="text-xs text-ink-muted mt-0.5">Can: {k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(' · ')}</div>
      </div>
      <dl className="m-0 flex gap-6 text-sm">
        <div><dt className="text-xs text-ink-muted">Last used</dt><dd className="m-0">{date(k.lastUsedAt)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Expires</dt><dd className="m-0">{k.expiresAt ? date(k.expiresAt) : 'Never'}</dd></div>
        <div><dt className="text-xs text-ink-muted">Daily limit</dt><dd className="m-0">{capText(k)}</dd></div>
      </dl>
      <div className="flex gap-2 flex-wrap">
        {status === 'Active' && <Button type="button" variant="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Daily limit'}</Button>}
        {status === 'Active' && <ConfirmAction label="Replace" question={<>Replace {k.name}? The current key stops working now; you’ll see the new one once.</>} onConfirm={() => rotate.mutate()} disabled={rotate.isPending} />}
        {status === 'Active' && <ConfirmAction label="Revoke" question={<>Revoke {k.name}? Anything using it is refused from now on.</>} onConfirm={() => revoke.mutate()} disabled={revoke.isPending} />}
        {status !== 'Active' && <ConfirmAction label="Delete" variant="ghost" question={<>Delete {k.name} from the list?</>} onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </div>
      {editing && (
        <form aria-label={`${k.name} daily limit`} className="basis-full flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); limits.mutate(); }}>
          <label className="flex flex-col gap-1 w-[200px]"><span className="text-sm font-semibold">Tokens a day</span>
            <input type="number" min={0} value={tokens} placeholder="No limit" onChange={(e) => setTokens(e.target.value)} className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" /></label>
          <label className="flex flex-col gap-1 w-[200px]"><span className="text-sm font-semibold">Spend a day (USD)</span>
            <input type="number" min={0} step="0.01" value={spend} placeholder="No limit" onChange={(e) => setSpend(e.target.value)} className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" /></label>
          <Button type="submit" disabled={limits.isPending}>{limits.isPending ? 'Saving…' : 'Save'}</Button>
          <p className="basis-full m-0 text-xs text-ink-muted">AI requests from this key are refused once either is reached, until midnight UTC. Spend is estimated from the prices on the Models page.</p>
        </form>
      )}
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

  // Filters live in the address, so a filtered view can be shared or bookmarked.
  const [params, setParams] = useSearchParams();
  const category = (CATEGORIES.some((c) => c.id === params.get('category')) ? params.get('category') : 'all') as KeyCategory | 'all';
  const status = (params.get('status') === 'ended' ? 'ended' : params.get('status') === 'all' ? 'all' : 'active') as Status | 'all';
  const sort = (['used', 'name'].includes(params.get('sort') ?? '') ? params.get('sort') : 'newest') as 'newest' | 'used' | 'name';
  const q = params.get('q') ?? '';
  const setParam = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  const keys = data ?? [];
  const counts = useMemo(() => {
    const byStatus = keys.filter((k) => status === 'all' || (status === 'active' ? isActive(k) : !isActive(k)));
    return {
      all: byStatus.length,
      ...Object.fromEntries(CATEGORIES.map((c) => [c.id, byStatus.filter((k) => categoriesOf(k).includes(c.id)).length])),
      active: keys.filter(isActive).length,
      ended: keys.filter((k) => !isActive(k)).length,
    } as Record<KeyCategory | 'all' | 'active' | 'ended', number>;
  }, [keys, status]);
  const shownKeys = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return keys
      .filter((k) => status === 'all' || (status === 'active' ? isActive(k) : !isActive(k)))
      .filter((k) => category === 'all' || categoriesOf(k).includes(category))
      .filter((k) => !needle || k.name.toLowerCase().includes(needle) || k.keyPrefix.toLowerCase().includes(needle) || k.createdBy?.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'used' ? (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
        : b.createdAt.localeCompare(a.createdAt));
  }, [keys, status, category, q, sort]);
  const filtered = category !== 'all' || status !== 'active' || !!q;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">API keys</h1>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Keys let your apps and IDEs, AI agents and the browser extension use Probaline. Give each one only what it needs.</p>
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
              {CATEGORIES.map((c) => (
                <div key={c.id} className="flex flex-col gap-1">
                  <CategoryBadge category={c.id} className="self-start" />
                  {SCOPES.filter((s) => s.category === c.id).map((s) => (
                    <label key={s.value} className="flex items-start gap-2.5 min-h-[32px] pl-1">
                      <input type="checkbox" className="mt-1" checked={scopes.includes(s.value)}
                        onChange={(e) => setScopes(e.target.checked ? [...scopes, s.value] : scopes.filter((x) => x !== s.value))} />
                      <span><span className="font-medium">{s.label}</span> <span className="text-ink-muted">· {s.hint}</span></span>
                    </label>
                  ))}
                </div>
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
        <>
          {/* What the keys are for: each card is also a filter. */}
          <div role="group" aria-label="Keys by what they're for" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([{ id: 'all', label: 'All keys', hint: 'Everything' }, ...CATEGORIES] as Array<{ id: KeyCategory | 'all'; label: string; hint: string }>).map((c) => {
              const on = category === c.id;
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => setParam('category', c.id, 'all')}
                  className={clsx('text-left rounded-xl border bg-white px-4 py-3 flex flex-col gap-1 transition-colors',
                    on ? 'border-ink shadow-[inset_0_0_0_1px_#14213D]' : 'border-line hover:border-line-strong')}>
                  <span className={clsx('flex items-center gap-1.5 text-sm font-semibold', c.id === 'all' ? 'text-ink' : categoryStyle(c.id).dot)}>
                    {c.id !== 'all' && <CategoryGlyph category={c.id} />}{c.label}
                  </span>
                  <span className="text-2xl font-bold text-ink leading-none">{counts[c.id]}</span>
                  <span className="text-xs text-ink-muted">{status === 'active' ? 'active' : status === 'ended' ? 'revoked or expired' : 'in all'}<span className="hidden sm:inline"> · {c.hint}</span></span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input type="search" aria-label="Search keys" value={q} onChange={(e) => setParam('q', e.target.value, '')}
              placeholder="Search by name, key start or creator" className="flex-1 min-w-[220px] min-h-[40px] px-3 border border-line-strong rounded-lg bg-white" />
            <Segmented<Status | 'all'> label="Status" value={status} onChange={(v) => setParam('status', v, 'active')}
              options={[{ value: 'active', label: `Active (${counts.active})` }, { value: 'ended', label: `Revoked or expired (${counts.ended})` }, { value: 'all', label: 'All' }]} />
            <label className="flex items-center gap-2 text-sm text-ink-muted">Sort
              <select aria-label="Sort keys" value={sort} onChange={(e) => setParam('sort', e.target.value, 'newest')} className="min-h-[38px] px-2 border border-line-strong rounded-lg bg-white text-ink">
                <option value="newest">Newest</option><option value="used">Last used</option><option value="name">Name</option>
              </select>
            </label>
          </div>

          <p className="m-0 text-sm text-ink-muted" aria-live="polite">
            Showing {shownKeys.length} of {keys.length} {keys.length === 1 ? 'key' : 'keys'}
            {filtered && <> · <button type="button" className="underline text-ink" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button></>}
          </p>
          {shownKeys.length === 0
            ? <Panel className="px-6"><Note title="No keys match.">Try another category or status, or clear the search.</Note></Panel>
            : <div className="flex flex-col gap-3">{shownKeys.map((k) => <KeyRow key={k.keyId} k={k} onNewKey={setShown} />)}</div>}
        </>
      )}
    </div>
  );
}
