import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { fetchMyLicense, formatDate, REPORTING_LABELS, ReportingConfig, setReporting } from '../lib/license-api';
import { errorMessage } from '../lib/rules-api';
import { Note, Panel, SectionLabel, Switch } from '../components/aegis/primitives';

/** A tenant's view of its own license. The key itself is shown only once, when the platform issues it. */
export function TenantLicensePage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: license, isLoading, isError, refetch } = useQuery({ queryKey: ['my-license', user?.tenantId], queryFn: fetchMyLicense });
  const save = useMutation({ mutationFn: setReporting, onSuccess: () => qc.invalidateQueries({ queryKey: ['my-license'] }) });

  if (isLoading) return <Panel className="px-6 py-5 max-w-[900px]"><p className="m-0 text-ink-muted">Loading…</p></Panel>;
  if (isError) return <Panel className="px-6 max-w-[900px]"><Note title="Couldn’t load your license."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>;
  if (!license) {
    return (
      <Panel className="px-6 max-w-[900px]">
        <Note title="No license has been issued for your company yet.">Your provider issues licenses. Ask them for one if you run Aegis in your own AWS account.</Note>
      </Panel>
    );
  }

  const toggle = (key: keyof ReportingConfig, value: boolean) => save.mutate({ ...license.reportingConfig, [key]: value });

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <Panel className="px-7 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-[24px] font-bold capitalize">{license.plan} plan</h2>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', license.status === 'active' ? 'bg-ink-tint text-ink' : 'bg-stop-soft text-stop-text')}>
            {license.status === 'active' ? 'Active' : license.status === 'expired' ? 'Expired' : 'Revoked'}
          </span>
        </div>
        <dl className="m-0 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div><dt className="text-xs text-ink-muted">Runs</dt><dd className="m-0 mt-0.5 font-semibold">{license.type === 'onprem' ? 'In your own AWS account' : 'Hosted'}</dd></div>
          <div><dt className="text-xs text-ink-muted">Users included</dt><dd className="m-0 mt-0.5 font-semibold">{license.maxUsers.toLocaleString()}</dd></div>
          <div><dt className="text-xs text-ink-muted">Issued</dt><dd className="m-0 mt-0.5 font-semibold">{formatDate(license.issuedAt)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Valid until</dt><dd className="m-0 mt-0.5 font-semibold">{formatDate(license.expiresAt)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Key</dt><dd className="m-0 mt-0.5 font-mono text-xs">{license.keyPrefix}</dd></div>
          <div><dt className="text-xs text-ink-muted">Last report</dt><dd className="m-0 mt-0.5 font-semibold">{formatDate(license.lastUsedAt)}</dd></div>
        </dl>
      </Panel>

      {license.type === 'onprem' && (
        <Panel className="px-7 py-6 flex flex-col gap-3">
          <SectionLabel>What your on-prem agent sends us</SectionLabel>
          <p className="m-0 text-ink-muted">Prompts never leave your account. Choose which summaries the reporting agent may send back.</p>
          {(Object.keys(REPORTING_LABELS) as Array<keyof ReportingConfig>).map((key) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2 border-b border-line-subtle last:border-b-0">
              <span className="font-medium">{REPORTING_LABELS[key]}</span>
              {isAdmin
                ? <Switch checked={license.reportingConfig[key]} label={REPORTING_LABELS[key]} disabled={save.isPending} onChange={(v) => toggle(key, v)} />
                : <span className="text-sm text-ink-muted">{license.reportingConfig[key] ? 'Sent' : 'Not sent'}</span>}
            </div>
          ))}
          {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
        </Panel>
      )}
    </div>
  );
}
