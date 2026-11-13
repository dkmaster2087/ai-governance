import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Candidate, CandidateStatus, Category, ServiceData, addAdvisory, approveCandidate, classifyCandidate, discoverNow, fetchCandidates,
  fetchCatalogReview, publishCatalog, rejectCandidate, removeAdvisory, removeService, restoreCandidate, suggestDomain,
} from '../lib/catalog-review-api';
import { errorMessage } from '../lib/rules-api';
import { Button, ConfirmAction, Panel, SectionLabel, Segmented } from '../components/kit/primitives';

const CATEGORY_LABEL: Record<Category, string> = { chat: 'Chat app', model_api: 'Model API', coding: 'Coding assistant', cloud_ai: 'Cloud AI service', work_app: 'AI in a work app' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'service';
const input = 'min-h-[36px] px-3 rounded-lg border border-line-strong bg-white';

type Filter = 'review' | Exclude<CandidateStatus, 'new' | 'classified'>;

/** Approve as a new service (prefilled from the suggestion) or as more domains for one already in the catalog. */
function ApproveForm({ c, onDone }: { c: Candidate; onDone: () => void }) {
  const s = c.suggestion;
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [f, setF] = useState({
    id: slug(s?.name ?? c.domain.split('.')[0]), name: s?.name ?? '', vendor: s?.vendor ?? '', category: (s?.category ?? c.hint ?? 'chat') as Category,
    businessTerms: s?.businessTerms ?? 'unknown', domains: (s?.domains ?? [c.domain]).join(', '), url: s?.category === 'chat' ? `https://${c.domain}` : '', addTo: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const domains = f.domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const approve = useMutation({
    mutationFn: () => approveCandidate(c.domain, mode === 'existing'
      ? { addTo: f.addTo.trim(), domains }
      : { service: { id: f.id.trim(), name: f.name.trim(), vendor: f.vendor.trim(), category: f.category, businessTerms: f.businessTerms as ServiceData['businessTerms'], domains, ...(f.url.trim() ? { url: f.url.trim() } : {}) } }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); approve.mutate(); };
  const id = (k: string) => `approve-${c.domain}-${k}`;
  return (
    <form onSubmit={submit} className="mt-3 p-4 rounded-lg bg-canvas border border-line-subtle flex flex-col gap-3">
      <Segmented label="Approve as" value={mode} onChange={setMode} options={[{ value: 'new', label: 'New service' }, { value: 'existing', label: 'Add to a service in the catalog' }]} />
      {mode === 'new' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={id('name')} className="text-sm flex flex-col gap-1">Name<input id={id('name')} className={input} value={f.name} onChange={set('name')} required /></label>
          <label htmlFor={id('vendor')} className="text-sm flex flex-col gap-1">Vendor<input id={id('vendor')} className={input} value={f.vendor} onChange={set('vendor')} required /></label>
          <label htmlFor={id('id')} className="text-sm flex flex-col gap-1">Id<input id={id('id')} className={clsx(input, 'font-mono text-[13px]')} value={f.id} onChange={set('id')} required /></label>
          <label htmlFor={id('category')} className="text-sm flex flex-col gap-1">Kind
            <select id={id('category')} className={input} value={f.category} onChange={set('category')}>
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label htmlFor={id('terms')} className="text-sm flex flex-col gap-1">Business data terms
            <select id={id('terms')} className={input} value={f.businessTerms} onChange={set('businessTerms')}>
              <option value="unknown">Unknown</option><option value="offered">Offered (no training on customer data)</option>
            </select>
          </label>
          <label htmlFor={id('url')} className="text-sm flex flex-col gap-1">Where people open it (chat apps)<input id={id('url')} className={input} value={f.url} onChange={set('url')} placeholder="https://…" /></label>
        </div>
      ) : (
        <label htmlFor={id('addTo')} className="text-sm flex flex-col gap-1">Id of the service in the catalog<input id={id('addTo')} className={clsx(input, 'font-mono text-[13px]')} value={f.addTo} onChange={set('addTo')} placeholder="e.g. chatgpt" required /></label>
      )}
      <label htmlFor={id('domains')} className="text-sm flex flex-col gap-1">Domains (comma separated)<input id={id('domains')} className={clsx(input, 'font-mono text-[13px]')} value={f.domains} onChange={set('domains')} required /></label>
      <p className="m-0 text-xs text-ink-muted">Approved services are added to the next published catalog. Every install then watches them; companies that block unapproved tools, or subscribe their firewalls to this kind, block them.</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={approve.isPending}>Approve</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
      {approve.isError && <div role="alert" className="text-sm text-stop">{errorMessage(approve.error)}</div>}
    </form>
  );
}

function CandidateCard({ c, refresh }: { c: Candidate; refresh: () => void }) {
  const [approving, setApproving] = useState(false);
  const s = c.suggestion;
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: refresh });
  const reviewing = c.status === 'new' || c.status === 'classified';
  return (
    <article className="py-4 border-t border-line-subtle first:border-t-0" aria-label={c.domain}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={`https://${c.domain}`} target="_blank" rel="noreferrer noopener" className="font-semibold text-ink [overflow-wrap:anywhere]">{c.domain}</a>
          {s && (
            <span className={clsx('ml-2 text-xs font-semibold px-2 py-0.5 rounded-full', s.isAiService ? 'bg-ink text-white' : 'bg-ink-tint text-ink-muted')}>
              {s.isAiService ? `AI · ${CATEGORY_LABEL[s.category]}` : 'Not AI'} · {Math.round(s.confidence * 100)}%
            </span>
          )}
          <div className="text-xs text-ink-muted mt-0.5">
            Found {c.sources.map((x) => x.source === 'manual' ? 'by hand' : `on ${x.source}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')} · last seen {when(c.lastSeenAt)}
            {c.decidedBy && <> · {c.status} by {c.decidedBy}{c.note ? `: ${c.note}` : ''}</>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewing && !approving && <Button type="button" onClick={() => setApproving(true)}>Approve…</Button>}
          {reviewing && <ConfirmAction label="Reject" question={`Reject ${c.domain}? It won’t be suggested again.`} confirmLabel="Reject" onConfirm={() => act.mutate(() => rejectCandidate(c.domain))} />}
          {reviewing && <Button type="button" variant="ghost" onClick={() => act.mutate(() => classifyCandidate(c.domain))} disabled={act.isPending}>Classify again</Button>}
          {(c.status === 'dismissed' || c.status === 'rejected') && <Button type="button" variant="secondary" onClick={() => act.mutate(() => restoreCandidate(c.domain))}>Back to review</Button>}
        </div>
      </div>
      {s && (
        <div className="mt-2 text-[15px]">
          <div><span className="font-semibold">{s.name}</span> <span className="text-ink-muted">by {s.vendor} · business terms {s.businessTerms}</span></div>
          {s.summary && <div className="text-ink-soft">{s.summary}</div>}
          <div className="font-mono text-[12px] text-ink-muted [overflow-wrap:anywhere]">{s.domains.join(' · ')}</div>
        </div>
      )}
      {!s && c.classifyError && <div className="mt-2 text-sm text-stop">Couldn’t classify: {c.classifyError}</div>}
      {!s && !c.classifyError && reviewing && <div className="mt-2 text-sm text-ink-muted">Not classified yet.</div>}
      {c.sources.slice(0, 3).map((x, i) => x.title && (
        <div key={i} className="text-xs text-ink-muted mt-1">“{x.title}”{x.url && <> · <a href={x.url} target="_blank" rel="noreferrer noopener" className="text-ink-muted">source</a></>}</div>
      ))}
      {approving && <ApproveForm c={c} onDone={() => { setApproving(false); refresh(); }} />}
      {act.isError && <div role="alert" className="mt-2 text-sm text-stop">{errorMessage(act.error)}</div>}
    </article>
  );
}

/**
 * Platform admin: keep the AI service catalog current. Discovery finds candidate AI services, the classifier
 * suggests what each is, people decide, and Publish signs a new edition every install downloads within the hour.
 */
export function CatalogReviewPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('review');
  const [domain, setDomain] = useState('');
  const review = useQuery({ queryKey: ['catalog-review'], queryFn: fetchCatalogReview });
  const list = useQuery({ queryKey: ['catalog-candidates', filter], queryFn: () => fetchCandidates(filter) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['catalog-review'] }); qc.invalidateQueries({ queryKey: ['catalog-candidates'] }); };
  const publish = useMutation({ mutationFn: publishCatalog, onSuccess: refresh });
  const discover = useMutation({ mutationFn: discoverNow, onSuccess: refresh });
  const suggest = useMutation({ mutationFn: () => suggestDomain(domain), onSuccess: () => { setDomain(''); refresh(); } });
  const removeSvc = useMutation({ mutationFn: removeService, onSuccess: refresh });
  const removeAdv = useMutation({ mutationFn: removeAdvisory, onSuccess: refresh });
  const [adv, setAdv] = useState({ serviceId: '', severity: 'warning' as 'info' | 'warning' | 'critical', title: '', detail: '' });
  const addAdv = useMutation({ mutationFn: () => addAdvisory(adv), onSuccess: () => { setAdv({ ...adv, title: '', detail: '' }); refresh(); } });
  const r = review.data;
  const u = r?.unpublished;
  const waiting = r ? r.candidates.new + r.candidates.classified : 0;

  if (review.isError) return <Panel className="px-7 py-5"><p className="m-0 text-stop">{errorMessage(review.error)}</p></Panel>;
  return (
    <div className="flex flex-col gap-6 max-w-[1000px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
            {!r ? ' ' : waiting > 0 ? `${waiting} possible AI ${waiting === 1 ? 'service' : 'services'} to review.` : 'Nothing waiting for review.'}
          </p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            {r?.published ? `Installs use catalog ${r.published.version}: ${r.published.services} services, published ${when(r.published.publishedAt)} by ${r.published.by}.` : r ? 'No catalog published yet.' : ''}
          </p>
        </div>
        {r && (
          <div className="flex flex-col items-end gap-1">
            <Button type="button" onClick={() => publish.mutate()} disabled={!u?.any || publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish'}</Button>
            <span className="text-xs text-ink-muted">
              {u?.any ? [u.added.length && `${u.added.length} new`, u.changed.length && `${u.changed.length} changed`, u.removed.length && `${u.removed.length} removed`, u.advisories && 'advisories'].filter(Boolean).join(', ') + ' not published' : 'Everything is published'}
            </span>
          </div>
        )}
      </div>
      {publish.isError && <div role="alert" className="text-sm text-stop">{errorMessage(publish.error)}</div>}

      <Panel className="px-7 py-5" aria-label="Sources">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Where new services are found</SectionLabel>
          <Button type="button" variant="secondary" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending ? 'Looking…' : 'Look now'}</Button>
        </div>
        {r && !r.discovery && <p className="m-0 mt-2 text-sm text-ink-muted">Automatic discovery is off on this install (CATALOG_DISCOVERY=on turns it on). “Look now” still works.</p>}
        {r && !r.classifier && <p className="m-0 mt-2 text-sm text-ink-muted">The classifier is off, so candidates wait unclassified.</p>}
        <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-1.5 text-sm">
          {r?.sources.map((s) => (
            <li key={s.name} className="flex flex-wrap justify-between gap-2">
              <span>{s.label} <span className="text-ink-muted">· every {s.everyMinutes >= 60 ? `${s.everyMinutes / 60} h` : `${s.everyMinutes} min`}</span></span>
              <span className={s.lastResult === 'error' ? 'text-stop' : 'text-ink-muted'}>
                {s.lastRunAt ? (s.lastResult === 'error' ? `Failed ${when(s.lastRunAt)}: ${s.lastError}` : `Read ${when(s.lastRunAt)}: ${s.found} found, ${s.added} new`) : 'Not read yet'}
              </span>
            </li>
          ))}
        </ul>
        {discover.isError && <div role="alert" className="mt-2 text-sm text-stop">{errorMessage(discover.error)}</div>}
      </Panel>

      <Panel className="px-7 py-5" aria-label="Candidates">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <Segmented label="Show" value={filter} onChange={setFilter} options={[
            { value: 'review', label: `To review${r ? ` (${waiting})` : ''}` },
            { value: 'dismissed', label: `Not AI${r ? ` (${r.candidates.dismissed})` : ''}` },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]} />
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) suggest.mutate(); }}>
            <input id="catalog-suggest" aria-label="Domain to review" className={input} placeholder="Add a domain to review" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!domain.trim() || suggest.isPending}>Add</Button>
          </form>
        </div>
        {suggest.isError && <div role="alert" className="text-sm text-stop">{errorMessage(suggest.error)}</div>}
        {list.isLoading && <p className="m-0 py-3 text-ink-muted">Loading…</p>}
        {list.data?.length === 0 && <p className="m-0 py-3 text-ink-muted">{filter === 'review' ? 'Nothing to review. New candidates appear as the sources are read.' : 'None.'}</p>}
        {list.data?.map((c) => <CandidateCard key={c.domain} c={c} refresh={refresh} />)}
      </Panel>

      <Panel className="px-7 py-5" aria-label="Added here">
        <SectionLabel className="mb-1">Added or changed here</SectionLabel>
        <p className="m-0 py-1 text-sm text-ink-muted">On top of the list built into this version of Probaline. Removing one returns the catalog to the built-in entry, if there is one.</p>
        {r?.services.length === 0 && <p className="m-0 py-2 text-ink-muted">Nothing yet.</p>}
        <ul className="m-0 p-0 list-none">
          {r?.services.map(({ service: s, by, at }) => (
            <li key={s.id} className="py-2 border-t border-line-subtle first:border-t-0 flex flex-wrap justify-between gap-2">
              <span><span className="font-semibold">{s.name}</span> <span className="text-ink-muted">· {CATEGORY_LABEL[s.category]} · <span className="font-mono text-[12px]">{s.domains.join(' · ')}</span> · {by}, {when(at)}</span></span>
              <ConfirmAction label="Remove" question={`Remove ${s.name} from the next catalog?`} confirmLabel="Remove" onConfirm={() => removeSvc.mutate(s.id)} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="px-7 py-5" aria-label="Advisories">
        <SectionLabel className="mb-1">Advisories</SectionLabel>
        <p className="m-0 py-1 text-sm text-ink-muted">News about a service (its data terms changed, a breach). Shown to companies on Settings with the next published catalog.</p>
        <ul className="m-0 p-0 list-none">
          {r?.advisories.map(({ advisory: a }) => (
            <li key={a.id} className="py-2 border-t border-line-subtle first:border-t-0 flex flex-wrap justify-between gap-2">
              <span><span className={a.severity === 'critical' ? 'font-semibold text-stop' : 'font-semibold'}>{a.title}</span> <span className="text-ink-muted">· {a.serviceId} · {a.detail}</span></span>
              <ConfirmAction label="Remove" question="Remove this advisory?" confirmLabel="Remove" onConfirm={() => removeAdv.mutate(a.id)} />
            </li>
          ))}
        </ul>
        <form className="mt-3 grid gap-2 sm:grid-cols-[160px_130px_1fr]" onSubmit={(e) => { e.preventDefault(); addAdv.mutate(); }}>
          <input id="adv-service" aria-label="Service id" className={clsx(input, 'font-mono text-[13px]')} placeholder="Service id" value={adv.serviceId} onChange={(e) => setAdv({ ...adv, serviceId: e.target.value })} required />
          <select id="adv-severity" aria-label="Severity" className={input} value={adv.severity} onChange={(e) => setAdv({ ...adv, severity: e.target.value as typeof adv.severity })}>
            <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
          </select>
          <input id="adv-title" aria-label="Title" className={input} placeholder="Title" value={adv.title} onChange={(e) => setAdv({ ...adv, title: e.target.value })} required />
          <input id="adv-detail" aria-label="Detail" className={clsx(input, 'sm:col-span-2')} placeholder="What changed, and what companies should do" value={adv.detail} onChange={(e) => setAdv({ ...adv, detail: e.target.value })} required />
          <Button type="submit" variant="secondary" disabled={addAdv.isPending}>Add advisory</Button>
        </form>
        {addAdv.isError && <div role="alert" className="mt-2 text-sm text-stop">{errorMessage(addAdv.error)}</div>}
      </Panel>
    </div>
  );
}
