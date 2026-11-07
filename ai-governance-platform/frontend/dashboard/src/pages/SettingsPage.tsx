import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { fetchMyTenant, LegalHold, setLegalHold } from '../lib/tenant-api';
import { Button, Panel, SectionLabel } from '../components/kit/primitives';
import { errorMessage } from '../lib/rules-api';

const gatewayUrl = import.meta.env.VITE_GATEWAY_PUBLIC_URL || `${window.location.origin}/api`;

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-line-subtle last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <code className="font-mono text-[13px] text-ink-soft [overflow-wrap:anywhere]">{value}</code>
        {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
      </div>
      <button type="button" className="min-h-[36px] px-3 rounded-lg border border-line-strong bg-white text-sm"
        onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* unavailable */ } }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

/** A legal hold stops evidence being deleted, for a matter or investigation. Company admins set it. */
function LegalHoldRow({ tenantId, hold, canChange }: { tenantId: string; hold?: LegalHold; canChange: boolean }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const change = useMutation({
    mutationFn: (on: boolean) => setLegalHold(tenantId, on, on ? reason.trim() : undefined),
    onSuccess: () => { setAsking(false); setReason(''); qc.invalidateQueries({ queryKey: ['tenant', tenantId] }); },
  });
  const on = hold?.on === true;
  return (
    <div className="py-3 border-t border-line-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Legal hold</div>
          {on
            ? <div>On since {longDate(hold!.since)}, by {hold!.by}: {hold!.reason}. <span className="text-ink-muted">No evidence is deleted until it’s released.</span></div>
            : <div className="text-ink-muted">Off. Evidence is deleted when its period ends.</div>}
        </div>
        {canChange && !asking && (
          <Button type="button" variant="secondary" onClick={() => (on ? change.mutate(false) : setAsking(true))} disabled={change.isPending}>
            {on ? 'Release hold' : 'Place hold'}
          </Button>
        )}
      </div>
      {asking && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) change.mutate(true); }}>
          <input className="flex-1 min-w-[220px] min-h-[36px] px-3 rounded-lg border border-line-strong" placeholder="Why (the matter or case)"
            aria-label="Reason for the legal hold" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
          <Button type="submit" disabled={!reason.trim() || change.isPending}>Place hold</Button>
          <Button type="button" variant="secondary" onClick={() => setAsking(false)}>Cancel</Button>
        </form>
      )}
      {change.isError && <div className="mt-2 text-sm text-stop">{errorMessage(change.error)}</div>}
    </div>
  );
}

/** What's true about this company's setup, and the values people need to connect things. */
export function SettingsPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { data: tenant } = useQuery({ queryKey: ['tenant', tenantId], queryFn: () => fetchMyTenant(tenantId), enabled: !!tenantId && user?.role !== 'platform_admin' });
  const retention = tenant?.settings?.auditLogRetentionDays;

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <Panel className="px-7 py-5">
        <SectionLabel className="mb-1">Company</SectionLabel>
        <div className="py-3 border-b border-line-subtle"><div className="text-sm font-semibold">Name</div><div>{tenant?.name ?? user?.tenantName}</div></div>
        <CopyRow label="Tenant ID" value={tenantId} />
        <CopyRow label="Gateway address" value={gatewayUrl} hint="Point apps here with an API key. See the docs for IDEs." />
        {retention !== undefined && (
          <div className="py-3"><div className="text-sm font-semibold">Evidence kept for</div><div>{retention} days <span className="text-ink-muted">· set by your plan, then deleted</span></div></div>
        )}
        {tenant && <LegalHoldRow tenantId={tenantId} hold={tenant.settings?.legalHold} canChange={user?.role === 'tenant_admin'} />}
      </Panel>

      <Panel className="px-7 py-5">
        <SectionLabel className="mb-1">When a check can’t run</SectionLabel>
        <p className="m-0 py-2 text-ink-muted">Choose whether requests are blocked or let through (and flagged) on the <Link to="/rules" className="font-semibold text-ink">Rules</Link> page.</p>
      </Panel>

      <Panel className="px-7 py-5">
        <SectionLabel className="mb-1">Browser extension</SectionLabel>
        <p className="m-0 py-2 text-ink-muted">Push these through Chrome policy (Google Admin, Intune or Jamf), with an API key that has only the browser extension permission from <Link to="/keys" className="font-semibold text-ink">API keys</Link>.</p>
        <CopyRow label="tenantId" value={tenantId} />
        <CopyRow label="gatewayUrl" value={gatewayUrl} />
        <CopyRow label="platformUrl" value={window.location.origin} hint="Blocked tools send people to this site’s “not approved” page." />
      </Panel>
    </div>
  );
}
