import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import {
  activateLicense, fetchLicenseOverview, formatDate, License, removeLicense, statusMessage,
} from '../lib/license-api';
import { errorMessage } from '../lib/rules-api';
import { Button, ConfirmAction, Note, Panel, SectionLabel } from '../components/kit/primitives';

/** What a company sees of its own licenses: an ended license is "Expired", whatever ended it. */
const companyLabel = (l: License) => (l.status === 'active' ? 'Active' : l.status === 'removed' ? 'Removed' : 'Expired');

function EnterKey({ onDone, file }: { onDone: () => void; file: boolean }) {
  const [key, setKey] = useState('');
  const enter = useMutation({ mutationFn: () => activateLicense(key.trim()), onSuccess: () => { setKey(''); onDone(); } });
  const input = 'flex-1 min-w-[240px] min-h-[42px] px-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]';
  return (
    <Panel aria-label="Enter a license key" className="px-7 py-6 flex flex-col gap-3">
      <SectionLabel>{file ? 'Enter a license file' : 'Enter a license key'}</SectionLabel>
      <p className="m-0 text-ink-muted">
        {file
          ? 'Paste the license file Probaline sent (it starts with PBL1). This gateway checks it by itself; nothing is sent to Probaline. It takes effect at once and replaces the current one.'
          : 'Paste the key your provider sent. It takes effect at once.'}
      </p>
      <form className="flex flex-wrap gap-2 items-start" onSubmit={(e) => { e.preventDefault(); if (key.trim()) enter.mutate(); }}>
        {file ? (
          <textarea aria-label="License file" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} rows={4}
            placeholder="PBL1.…" className={`${input} py-2 w-full`} />
        ) : (
          <input aria-label="License key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="pbl_…" className={input} />
        )}
        <Button type="submit" disabled={!key.trim() || enter.isPending}>{enter.isPending ? 'Checking…' : 'Add license'}</Button>
      </form>
      {enter.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(enter.error)}</p>}
      {enter.isSuccess && <p role="status" className="m-0 font-semibold">License added: {enter.data.license.plan.charAt(0).toUpperCase() + enter.data.license.plan.slice(1)} plan, valid until {formatDate(enter.data.license.expiresAt)}.</p>}
    </Panel>
  );
}

function LicenseCard({ l, canRemove, onRemoved }: { l: License; canRemove: boolean; onRemoved: () => void }) {
  const remove = useMutation({ mutationFn: () => removeLicense(l.licenseId), onSuccess: onRemoved });
  return (
    <Panel as="article" aria-label={`${l.plan} license`} className="px-7 py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[22px] font-bold capitalize">{l.plan} plan</h2>
        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', l.status === 'active' ? 'bg-ink-tint text-ink' : 'bg-stop-soft text-stop-text')}>{companyLabel(l)}</span>
        {canRemove && l.status === 'active' && !l.addresses && (
          <span className="ml-auto">
            <ConfirmAction label="Remove" variant="ghost" disabled={remove.isPending} onConfirm={() => remove.mutate()}
              question="Remove this license from your company? Without another license, AI requests stop after the grace period." />
          </span>
        )}
      </div>
      <dl className="m-0 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div><dt className="text-xs text-ink-muted">Runs</dt><dd className="m-0 mt-0.5 font-semibold">{l.addresses ? 'On your own infrastructure' : 'Hosted'}</dd></div>
        {l.addresses && <div><dt className="text-xs text-ink-muted">Gateway address</dt><dd className="m-0 mt-0.5 font-mono text-[13px] [overflow-wrap:anywhere]">{l.addresses.join(', ')}</dd></div>}
        <div><dt className="text-xs text-ink-muted">Users included</dt><dd className="m-0 mt-0.5 font-semibold">{l.maxUsers.toLocaleString()}</dd></div>
        <div><dt className="text-xs text-ink-muted">Added</dt><dd className="m-0 mt-0.5 font-semibold">{formatDate(l.activatedAt ?? l.issuedAt)}</dd></div>
        <div><dt className="text-xs text-ink-muted">{l.status === 'active' ? 'Valid until' : 'Ended'}</dt>
          <dd className="m-0 mt-0.5 font-semibold">{formatDate(l.status === 'active' ? l.expiresAt : l.revokedAt ?? l.removedAt ?? l.expiresAt)}</dd></div>
        <div><dt className="text-xs text-ink-muted">{l.addresses ? 'License' : 'Key'}</dt><dd className="m-0 mt-0.5 font-mono text-xs">{l.keyPrefix}</dd></div>
      </dl>
      {remove.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(remove.error)}</p>}
    </Panel>
  );
}

/** A company's licenses, and where to enter a new key. Keys themselves are never shown again. */
export function TenantLicensePage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['license-overview', user?.tenantId], queryFn: fetchLicenseOverview });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['license-overview'] }); qc.invalidateQueries({ queryKey: ['license-status'] }); };

  if (isLoading) return <Panel className="px-6 py-5 max-w-[900px]"><p className="m-0 text-ink-muted">Loading…</p></Panel>;
  if (isError || !data) return <Panel className="px-6 max-w-[900px]"><Note title="Couldn’t load your license."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>;

  const message = statusMessage(data.status, isAdmin);
  const active = data.licenses.filter((l) => l.status === 'active');
  const ended = data.licenses.filter((l) => l.status !== 'active');

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div>
        <p className={clsx('m-0 text-[26px] leading-[1.2] font-bold tracking-[-0.02em]', message?.tone === 'stop' && 'text-stop-text')}>
          {message ? message.title : `Your license is active${data.status.endsAt ? ` until ${formatDate(data.status.endsAt)}` : ''}.`}
        </p>
        {message && <p className="m-0 mt-1.5 text-ink-muted text-[15px]">{message.detail}</p>}
      </div>

      {isAdmin && <EnterKey onDone={refresh} file={!!data.offline} />}
      {!isAdmin && data.status.state !== 'active' && <Panel className="px-6"><Note title="Only an administrator can enter a license key." /></Panel>}

      {active.map((l) => <LicenseCard key={l.licenseId} l={l} canRemove={isAdmin} onRemoved={refresh} />)}

      {data.users && data.users.included > 0 && active.length > 0 && (
        <Panel aria-label="Users" className="px-7 py-5 flex flex-col gap-2">
          <SectionLabel>Users</SectionLabel>
          <p className={clsx('m-0 text-[20px] font-bold', data.users.over && 'text-stop-text')}>
            {data.users.counted.toLocaleString()} of {data.users.included.toLocaleString()} included
          </p>
          <p className="m-0 text-ink-muted text-sm">
            Everyone with a dashboard account ({data.users.accounts.toLocaleString()}), plus people who used AI through Probaline in the last 30 days
            {data.users.usedAi === null ? ' (couldn’t be read just now, so not counted)' : ` (${data.users.usedAi.toLocaleString()})`}. Each person counts once.
            {data.users.partial && data.users.usedAi !== null && ' Very busy companies may be undercounted.'}
          </p>
          {data.users.over && (
            <Note title="You’re above the users your license includes.">
              Nothing is cut off. Talk to your Probaline contact to add users at renewal or sooner.
            </Note>
          )}
        </Panel>
      )}

      {ended.length > 0 && (
        <Panel aria-label="Earlier licenses" className="px-7 py-5">
          <SectionLabel className="mb-2">Earlier licenses</SectionLabel>
          <ul className="m-0 p-0 list-none">
            {ended.map((l) => (
              <li key={l.licenseId} className="py-2.5 border-b border-line-subtle last:border-b-0 flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                <span><span className="font-semibold capitalize">{l.plan} plan</span> <span className="font-mono text-xs text-ink-muted">{l.keyPrefix}</span></span>
                <span className="text-sm text-ink-muted">{companyLabel(l)} · ended {formatDate(l.revokedAt ?? l.removedAt ?? l.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
