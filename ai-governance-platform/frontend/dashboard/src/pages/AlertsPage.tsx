import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertConfig, AlertEvent, AlertInput, AlertKind, AlertRule, alertDelivery, createAlert, Delivery, deleteAlert, KIND_LABEL, KINDS, listAlertEvents,
  listAlerts, sendTestEmail, testAlert, updateAlert,
} from '../lib/alerts-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Segmented, Switch } from '../components/kit/primitives';

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white w-full';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
const WINDOWS = [{ value: '15', label: '15 minutes' }, { value: '60', label: '1 hour' }, { value: '1440', label: '1 day' }];

function deliveryText(d: Delivery): string {
  const parts = [d.email && `email ${d.email}`, d.webhook && `webhook ${d.webhook}`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nowhere to send';
}

/** Shows a webhook signing secret once. */
function NewSecret({ value, onDone }: { value: string; onDone: () => void }) {
  return (
    <Panel aria-label="Signing secret" className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
      <p className="m-0 font-semibold">Copy the webhook’s signing secret now. It won’t be shown again.</p>
      <p className="m-0 text-sm text-ink-muted">Your endpoint can check the <code className="font-mono">x-probaline-signature</code> header with it: <code className="font-mono">t=&lt;time&gt;,v1=&lt;HMAC-SHA256 of “t.body”&gt;</code>. Slack, Teams and Google Chat ignore it and show the alert’s text.</p>
      <code className="block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere]">{value}</code>
      <div><Button variant="secondary" onClick={onDone}>I’ve saved it</Button></div>
    </Panel>
  );
}

export function AlertForm({ rule, onDone, onSecret }: { rule?: AlertRule; onDone: () => void; onSecret: (s: string) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AlertKind>(rule?.kind ?? 'stopped_spike');
  const [name, setName] = useState(rule?.name ?? KIND_LABEL['stopped_spike']);
  const [config, setConfig] = useState<AlertConfig>(rule?.config ?? KINDS[0].defaults);
  const [emails, setEmails] = useState((rule?.emails ?? []).join(', '));
  const [webhook, setWebhook] = useState('');
  const [removeWebhook, setRemoveWebhook] = useState(false);
  const pickKind = (k: AlertKind) => {
    setKind(k); setConfig(KINDS.find((x) => x.value === k)!.defaults);
    if (!rule) setName(KIND_LABEL[k]);
  };
  const num = (k: keyof AlertConfig, v: string) => setConfig((c) => ({ ...c, [k]: Math.max(0, Number(v) || 0) }));
  const emailList = emails.split(/[,\s;]+/).map((e) => e.trim()).filter(Boolean);
  const emailReady = useQuery({ queryKey: ['alerts', 'delivery'], queryFn: alertDelivery, staleTime: 300_000 }).data?.email;
  const hasWebhook = (webhook.trim() || (rule?.webhook && !removeWebhook));

  const save = useMutation({
    mutationFn: async () => {
      const body: AlertInput = { name: name.trim(), kind, config, emails: emailList };
      if (webhook.trim()) body.webhookUrl = webhook.trim();
      else if (removeWebhook) body.webhookUrl = null;
      if (rule) { const { kind: _k, ...change } = body; return updateAlert(rule.ruleId, change); }
      return createAlert(body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      if (saved.signingSecret) onSecret(saved.signingSecret);
      onDone();
    },
  });
  const canSave = name.trim() && (emailList.length > 0 || hasWebhook) && (kind !== 'spend' || (config.monthlyBudgetUSD ?? 0) > 0);

  return (
    <Panel aria-label={rule ? `Edit ${rule.name}` : 'New alert'} className="px-6 py-5">
      <SectionLabel className="mb-4">{rule ? `Edit ${rule.name}` : 'New alert'}</SectionLabel>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
        {!rule && (
          <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
            <legend className="text-sm font-semibold mb-1.5">Tell people when</legend>
            {KINDS.map((k) => (
              <label key={k.value} className={clsx('flex gap-3 items-start p-3 rounded-lg border cursor-pointer', kind === k.value ? 'border-ink bg-ink-tint' : 'border-line')}>
                <input type="radio" name="kind" value={k.value} aria-label={k.label} checked={kind === k.value} onChange={() => pickKind(k.value)} className="mt-1" />
                <span><span className="font-semibold">{k.label}</span><span className="block text-sm text-ink-muted">{k.hint}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex flex-col gap-1.5 max-w-[420px]"><span className="text-sm font-semibold">Name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        {kind === 'spend' ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Monthly AI budget ($)</span>
              <input className={input} type="number" min={1} value={config.monthlyBudgetUSD ?? ''} onChange={(e) => num('monthlyBudgetUSD', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Tell people at (% of budget)</span>
              <input className={input} type="number" min={1} max={1000} value={config.percent ?? ''} onChange={(e) => num('percent', e.target.value)} />
            </label>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">{kind === 'shadow_ai' ? 'Visits' : kind === 'answer_pii' ? 'Answers' : 'Stopped requests'}</span>
              <input className={input} type="number" min={1} value={config.count ?? ''} onChange={(e) => num('count', e.target.value)} />
            </label>
            <div className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Within</span>
              <div><Segmented label="Within" value={String(config.minutes ?? 60)} onChange={(v: string) => setConfig((c) => ({ ...c, minutes: Number(v) }))} options={WINDOWS} /></div>
            </div>
          </div>
        )}
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Email</span>
          <input className={input} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="security@yourcompany.com, …" />
          <span className="text-xs text-ink-muted">Up to 10 addresses, separated by commas.</span>
          {emailReady === false && (
            <span role="note" className="text-xs font-semibold text-stop-text">Email isn’t set up on this Probaline install yet, so alerts can’t be emailed. Use a webhook, or ask whoever runs Probaline to set up email.</span>
          )}
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Webhook (optional)</span>
          <input className={input} value={webhook} onChange={(e) => { setWebhook(e.target.value); setRemoveWebhook(false); }}
            placeholder={rule?.webhook && !removeWebhook ? `Blank keeps ${rule.webhook}` : 'https://hooks.slack.com/services/…'} />
          <span className="text-xs text-ink-muted">A Slack, Teams or Google Chat incoming webhook, or your own HTTPS endpoint. Signed with a secret shown once.</span>
        </label>
        {rule?.webhook && !webhook && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeWebhook} onChange={(e) => setRemoveWebhook(e.target.checked)} /> Stop sending to the webhook</label>
        )}
        {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSave || save.isPending}>{save.isPending ? 'Saving…' : rule ? 'Save' : 'Add alert'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

/** How alerts and license notices reach people by email, with a test send. */
function EmailDelivery() {
  const delivery = useQuery({ queryKey: ['alerts', 'delivery'], queryFn: alertDelivery, staleTime: 300_000 });
  const test = useMutation({ mutationFn: sendTestEmail });
  if (!delivery.data) return null;
  const how = delivery.data.via === 'smtp' ? 'through your own mail server' : delivery.data.via === 'ses' ? 'through Amazon SES' : null;
  return (
    <Panel aria-label="Email" className="px-7 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="m-0 flex-1 min-w-[240px]">
        {how
          ? <>Email is sent {how}: alerts, and license notices to admins.</>
          : <span className="text-stop-text font-semibold">Email isn’t set up on this Probaline install, so alerts and license notices can’t be emailed. Whoever runs Probaline can point it at your mail server (SMTP_HOST; see the install guide).</span>}
      </p>
      {how && <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send me a test email'}</Button>}
      {test.isSuccess && <p role="status" className="basis-full m-0 text-sm">Sent to {test.data.to}. If it doesn’t arrive, check spam, then your mail server’s log.</p>}
      {test.isError && <p role="alert" className="basis-full m-0 text-sm text-stop-text font-semibold">{errorMessage(test.error)}</p>}
    </Panel>
  );
}

function AlertRow({ rule, onEdit }: { rule: AlertRule; onEdit: () => void }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['alerts'] }); qc.invalidateQueries({ queryKey: ['alert-events'] }); };
  const toggle = useMutation({ mutationFn: (enabled: boolean) => updateAlert(rule.ruleId, { enabled }), onSuccess: refresh });
  const test = useMutation({ mutationFn: () => testAlert(rule.ruleId), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => deleteAlert(rule.ruleId), onSuccess: refresh });
  const to = [...rule.emails, ...(rule.webhook ? [rule.webhook] : [])];
  return (
    <li className="py-4 border-b border-line-subtle last:border-b-0 flex flex-col gap-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <Switch label={`${rule.name} on`} checked={rule.enabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
        <span className="font-semibold">{rule.name}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">{KIND_LABEL[rule.kind]}</span>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? 'Sending…' : 'Send a test'}</Button>
          <Button variant="ghost" onClick={onEdit}>Edit</Button>
          <Button variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove the alert “${rule.name}”?`)) remove.mutate(); }}>Remove</Button>
        </span>
      </div>
      <p className="m-0 text-sm">{rule.description}</p>
      <p className="m-0 text-sm text-ink-muted [overflow-wrap:anywhere]">To {to.join(', ')} · last sent {when(rule.lastFiredAt)}{rule.firedCount ? ` · ${rule.firedCount} in all` : ''}</p>
      {test.data && <p role="status" className={clsx('m-0 text-sm font-semibold', test.data.delivery.error ? 'text-stop-text' : 'text-ink')}>Test: {deliveryText(test.data.delivery)}{test.data.delivery.error ? ` (${test.data.delivery.error})` : ''}</p>}
      {(toggle.isError || test.isError || remove.isError) && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(toggle.error ?? test.error ?? remove.error)}</p>}
    </li>
  );
}

/** Dashboard → Alerts: who hears about what, by email or webhook, and what was sent. */
export function AlertsPage() {
  const rules = useQuery({ queryKey: ['alerts'], queryFn: listAlerts });
  const events = useQuery({ queryKey: ['alert-events'], queryFn: listAlertEvents });
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const on = rules.data?.filter((r) => r.enabled).length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div>
        <p className="m-0 text-[26px] leading-[1.2] font-bold tracking-[-0.02em]">
          {rules.isLoading ? 'Alerts' : on ? `${on} alert${on === 1 ? '' : 's'} on.` : 'No alerts on yet.'}
        </p>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Tell your team by email or webhook when requests are stopped, personal data shows up in AI answers, people use unapproved AI tools, or spend nears your budget.</p>
      </div>

      <EmailDelivery />
      {secret && <NewSecret value={secret} onDone={() => setSecret(null)} />}
      {editing ? (
        <AlertForm rule={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} onSecret={setSecret} />
      ) : (
        <div><Button onClick={() => setEditing('new')} disabled={(rules.data?.length ?? 0) >= 20}>New alert</Button></div>
      )}

      {rules.isError && <Panel className="px-6"><Note title="Couldn’t load your alerts."><button type="button" className="underline font-semibold" onClick={() => rules.refetch()}>Try again</button></Note></Panel>}
      {rules.data && rules.data.length > 0 && (
        <Panel aria-label="Your alerts" className="px-7 py-2">
          <ul className="m-0 p-0 list-none">{rules.data.map((r) => <AlertRow key={r.ruleId} rule={r} onEdit={() => setEditing(r)} />)}</ul>
        </Panel>
      )}

      <Panel aria-label="Recently sent" className="px-7 py-5">
        <SectionLabel className="mb-2">Recently sent</SectionLabel>
        {events.data?.length ? (
          <ul className="m-0 p-0 list-none">
            {events.data.map((e: AlertEvent) => (
              <li key={e.alertId} className="py-2.5 border-b border-line-subtle last:border-b-0 flex flex-col gap-0.5">
                <span><span className="font-semibold">{e.title}</span>{e.test && <span className="text-ink-muted"> (test)</span>}</span>
                <span className={clsx('text-sm', e.delivery.error ? 'text-stop-text' : 'text-ink-muted')}>
                  {when(e.firedAt)} · {e.name} · {deliveryText(e.delivery)}{e.delivery.error ? ` (${e.delivery.error})` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-ink-muted">{events.isLoading ? 'Loading…' : 'Nothing sent in the last 90 days.'}</p>}
      </Panel>
    </div>
  );
}
