import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ActivityItem, listActivity } from '../lib/log-export-api';
import { useAuth } from '../lib/auth';
import { Button, Note, Panel, Segmented } from '../components/kit/primitives';

/** Plain words for each action. Unknown ones fall back to the action name. */
const ACTION_LABEL: Record<string, string> = {
  'rule.created': 'Added a rule', 'rule.updated': 'Changed a rule', 'rule.deleted': 'Deleted a rule',
  'gateway_settings.updated': 'Changed gateway settings', 'policy.created': 'Added a policy', 'policy.updated': 'Changed a policy', 'policy.deleted': 'Deleted a policy',
  'api_key.created': 'Created an API key', 'api_key.revoked': 'Revoked an API key', 'api_key.rotated': 'Replaced an API key', 'api_key.deleted': 'Deleted an API key',
  'model.added': 'Added a model', 'model.updated': 'Changed a model', 'model.deleted': 'Removed a model', 'model.tested': 'Tested a model',
  'alert_rule.created': 'Added an alert', 'alert.tested': 'Sent a test alert', 'shadow_ai_policy.updated': 'Changed the shadow AI policy',
  'compliance.enabled': 'Turned on a framework', 'compliance.disabled': 'Turned off a framework', 'compliance.assessed': 'Ran a compliance check',
  'tenant.created': 'Created the company', 'tenant.updated': 'Changed company settings', 'tenant.suspended': 'Suspended the company', 'tenant.activated': 'Reactivated the company',
  'license.issued': 'Issued a license', 'license.revoked': 'Revoked a license', 'reporting_license.updated': 'Changed reporting settings',
  'mcp_server.created': 'Created an MCP server', 'mcp_server.updated': 'Changed an MCP server', 'mcp_server.deleted': 'Deleted an MCP server',
  'mcp_server.published': 'Published an MCP server', 'mcp_server.paused': 'Paused an MCP server', 'mcp_server.resumed': 'Resumed an MCP server',
  'mcp_server.version_restored': 'Restored an MCP server version', 'mcp_server.tested': 'Tested an MCP tool', 'mcp_api.added': 'Added an API to an MCP server',
  'mcp_api.removed': 'Removed an API from an MCP server', 'mcp_tool.updated': 'Changed an MCP tool', 'approval.approved': 'Approved a tool call', 'approval.refused': 'Refused a tool call',
  'connector.created': 'Added a connector', 'connector.updated': 'Changed a connector', 'connector.deleted': 'Removed a connector',
  'mcp_sign_in.configured': 'Set up sign-in for people', 'mcp_sign_in.checked': 'Checked sign-in for people', 'mcp_sign_in.removed': 'Removed sign-in for people',
  'log_export.created': 'Added a log destination', 'log_export.updated': 'Changed a log destination', 'log_export.deleted': 'Removed a log destination',
  'log_export.tested': 'Tested a log destination', 'log_export.secret_rotated': 'Replaced a signing secret', 'log_export.dead_letter_retried': 'Resent undelivered records',
  'log_export.dead_letter_discarded': 'Discarded undelivered records',
  'sign_in.dashboard': 'Signed in to the dashboard', 'sign_in.api_key': 'API key refused', 'sign_in.mcp': 'Signed in for MCP servers',
  'sign_in.mcp_agent_allowed': 'Allowed an agent', 'sign_in.mcp_agent_refused': 'Refused an agent', 'sign_in.mcp_refresh_reused': 'Reused sign-in token (sign-in ended)',
  'sign_in.mcp_refresh': 'Company sign-in refused a renewal', 'sign_in.mcp_signed_out': 'Agent signed out',
};

const KEY_REASON: Record<string, string> = { KEY_REVOKED: 'the key was revoked', KEY_EXPIRED: 'the key has expired', TENANT_MISMATCH: 'the key belongs to another company' };

function who(a: ActivityItem['actor']) {
  if (a.type === 'api_key') return `API key ${a.keyId ?? a.id}`;
  return a.email ?? a.id;
}

function when(iso: string) {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function OutcomePill({ o }: { o: ActivityItem['outcome'] }) {
  return (
    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', o === 'success' ? 'bg-ink-tint text-ink' : 'bg-stop-soft text-stop-text')}>
      {o === 'success' ? 'Done' : o === 'denied' ? 'Refused' : 'Failed'}
    </span>
  );
}

function Row({ a }: { a: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const reason = a.detail?.reason ? String(a.detail.reason) : undefined;
  const targets = Object.entries(a.target ?? {});
  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-canvas min-h-[52px]">
        <span className="w-[150px] flex-none text-sm text-ink-muted tabular-nums">{when(a.time)}</span>
        <span className="flex-[1_1_220px] min-w-0">
          <span className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
          {a.action === 'sign_in.api_key' && reason && <span className="text-ink-muted">: {KEY_REASON[reason] ?? reason}</span>}
          <span className="block text-sm text-ink-muted [overflow-wrap:anywhere]">{who(a.actor)}{a.actor.role ? ` · ${a.actor.role.replace('tenant_', '').replace('_', ' ')}` : ''}</span>
        </span>
        <OutcomePill o={a.outcome} />
      </button>
      {open && (
        <dl className="m-0 px-5 pb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Action</dt><dd className="m-0 font-mono text-[13px]">{a.action}</dd>
          {targets.map(([k, v]) => <Fragment key={`t${k}`}><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{v}</dd></Fragment>)}
          {Object.entries(a.detail ?? {}).map(([k, v]) => <Fragment key={`d${k}`}><dt className="text-ink-muted">{k}</dt><dd className="m-0 [overflow-wrap:anywhere]">{String(v)}</dd></Fragment>)}
          {a.sourceIp && <><dt className="text-ink-muted">From</dt><dd className="m-0">{a.sourceIp}</dd></>}
          {a.userAgent && <><dt className="text-ink-muted">Browser or client</dt><dd className="m-0 [overflow-wrap:anywhere]">{a.userAgent}</dd></>}
          {a.requestId && <><dt className="text-ink-muted">Request</dt><dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{a.requestId}</dd></>}
          <dt className="text-ink-muted">Fingerprint</dt><dd className="m-0 font-mono text-[12px] text-ink-muted [overflow-wrap:anywhere]">{a.hash}</dd>
        </dl>
      )}
    </li>
  );
}

/** Who changed what, and who signed in: the company's own admin trail. */
export function ActivityPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<'all' | 'admin' | 'sign_in'>('all');
  const [refused, setRefused] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['activity', user?.tenantId, category, refused],
    queryFn: ({ pageParam }) => listActivity({ category: category === 'all' ? undefined : category, outcome: refused ? 'denied' : undefined, after: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const retention = q.data?.pages[0]?.retentionDays;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div>
        <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Activity</h1>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
          Every change made in Probaline and every sign-in, with who did it and from where.
          {retention ? ` Kept for ${retention} days.` : ''} Send it to your SIEM from <Link to="/log-export" className="font-semibold text-ink">Log export</Link>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Show" value={category} onChange={setCategory}
          options={[{ value: 'all', label: 'Everything' }, { value: 'admin', label: 'Changes' }, { value: 'sign_in', label: 'Sign-ins' }]} />
        <label className="inline-flex items-center gap-2 min-h-[38px] text-sm">
          <input type="checkbox" checked={refused} onChange={(e) => setRefused(e.target.checked)} /> Only refused
        </label>
      </div>
      <Panel>
        {q.isLoading && <p className="m-0 px-5 py-4 text-ink-muted">Loading…</p>}
        {q.isError && <div className="px-5"><Note title="Couldn’t load activity."><button type="button" className="underline font-semibold" onClick={() => q.refetch()}>Try again</button></Note></div>}
        {q.data && items.length === 0 && <div className="px-5"><Note title="Nothing yet.">Changes and sign-ins appear here as they happen.</Note></div>}
        {items.length > 0 && <ul className="m-0 p-0 list-none">{items.map((a) => <Row key={a.eventId} a={a} />)}</ul>}
      </Panel>
      {q.hasNextPage && (
        <div><Button variant="secondary" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Show older'}</Button></div>
      )}
      <p className="m-0 text-sm text-ink-muted">
        Failed dashboard passwords are checked by your sign-in provider, not Probaline: for AWS Cognito they are in CloudTrail. Requests from unknown API keys aren’t listed because they can’t be tied to your company.
      </p>
    </div>
  );
}
