import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogOutcome, CatalogState, checkCatalog, fetchCatalog, uploadCatalog } from '../lib/catalog-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Panel, SectionLabel } from './kit/primitives';

/** A chosen file's text (FileReader works in every browser the dashboard supports). */
const readText = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(r.error);
  r.readAsText(f);
});

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const SOURCE: Record<CatalogState['source'], string> = {
  'built-in': 'built into this version of Probaline',
  feed: 'downloaded from Probaline',
  upload: 'uploaded from a file',
};

/**
 * Which AI service catalog this install uses: the list that names AI tools on Shadow AI, in reports and in the
 * firewall feeds. `canManage`: may check now and upload a file (the platform admin in Cloud, admins on a
 * customer-run install; the gateway enforces the same).
 */
export function CatalogPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<CatalogOutcome | null>(null);
  const { data: c, isLoading, isError } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const done = (o: CatalogOutcome) => { setOutcome(o); qc.setQueryData(['catalog'], o.catalog); };
  const check = useMutation({ mutationFn: checkCatalog, onSuccess: done });
  const upload = useMutation({ mutationFn: uploadCatalog, onSuccess: done });
  const failed = check.error ?? upload.error;

  return (
    <Panel className="px-7 py-5" aria-label="AI service catalog">
      <SectionLabel className="mb-1">AI service catalog</SectionLabel>
      <p className="m-0 py-2 text-ink-muted">The list of AI services Probaline recognises on Shadow AI, in reports and in firewall feeds. New services start as watched, never blocked, unless you block unapproved tools.</p>
      {isLoading && <div className="py-3 text-ink-muted">Loading…</div>}
      {isError && <div className="py-3 text-stop">The catalog’s status couldn’t be loaded.</div>}
      {c && (
        <>
          <div className="py-3 border-t border-line-subtle">
            <div className="text-sm font-semibold">In use</div>
            <div>Catalog {c.version} · {c.services} services · {SOURCE[c.source]}</div>
          </div>
          <div className="py-3 border-t border-line-subtle">
            <div className="text-sm font-semibold">Updates</div>
            {c.updates === 'off'
              ? <div className="text-ink-muted">Off on this install. Upload a catalog file to update it.</div>
              : <div>Checked every hour at <code className="font-mono text-[13px] [overflow-wrap:anywhere]">{c.url}</code>. <span className="text-ink-muted">Only the file is downloaded; nothing about this install is sent.</span></div>}
            {c.lastCheckedAt && (
              <div className={c.lastResult === 'error' ? 'text-stop mt-1' : 'text-ink-muted mt-1'}>
                Last checked {when(c.lastCheckedAt)}{c.lastResult === 'error' && c.lastError ? `: ${c.lastError}` : '.'}
              </div>
            )}
          </div>
          {c.advisories.length > 0 && (
            <div className="py-3 border-t border-line-subtle">
              <div className="text-sm font-semibold">Advisories</div>
              <ul className="m-0 mt-1 pl-5 flex flex-col gap-1">
                {c.advisories.map((a) => (
                  <li key={a.id}><span className={a.severity === 'critical' ? 'font-semibold text-stop' : 'font-semibold'}>{a.title}</span> <span className="text-ink-muted">{a.detail}</span></li>
                ))}
              </ul>
            </div>
          )}
          {canManage && (
            <div className="py-3 border-t border-line-subtle flex flex-wrap items-center gap-2">
              {c.updates === 'auto' && <Button type="button" variant="secondary" onClick={() => check.mutate()} disabled={check.isPending}>{check.isPending ? 'Checking…' : 'Check now'}</Button>}
              <Button type="button" variant="secondary" onClick={() => file.current?.click()} disabled={upload.isPending}>Upload catalog file</Button>
              <input ref={file} id="catalog-file" type="file" accept=".json,application/json" className="hidden" aria-label="Catalog file"
                onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(await readText(f)); }} />
            </div>
          )}
          {outcome && <div role="status" className={outcome.result === 'error' ? 'text-sm text-stop' : 'text-sm text-ink-muted'}>{outcome.message}</div>}
          {failed && <div role="alert" className="text-sm text-stop">{errorMessage(failed)}</div>}
        </>
      )}
    </Panel>
  );
}
