import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import {
  addRule, changeRule, deleteRule, EditableType, errorMessage, fetchRules, isEditableType, RuleView, ruleValues, setFailMode,
} from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Segmented, Switch, formatCount } from '../components/aegis/primitives';

const FRAMEWORK_LABEL: Record<string, string> = { soc2: 'SOC 2', hipaa: 'HIPAA', 'eu-ai-act': 'EU AI Act' };

const PII_LABEL: Record<string, string> = {
  EMAIL: 'emails', PHONE: 'phone numbers', SSN: 'Social Security numbers', CREDIT_CARD: 'card numbers',
  NAME: 'people’s names', DATE_OF_BIRTH: 'dates of birth', MEDICAL_RECORD_NUMBER: 'medical record numbers',
};

const TYPE_OPTIONS: Array<{ type: EditableType; label: string; lead: string; hint: string }> = [
  { type: 'keyword_block', label: 'Words or phrases', lead: 'Stop prompts that mention', hint: 'Comma-separated, e.g. confidential, internal only' },
  { type: 'data_classification', label: 'A pattern', lead: 'Stop prompts matching', hint: 'Regular expressions, comma-separated, e.g. project\\s+(phoenix|atlas)' },
  { type: 'model_restriction', label: 'Approved models', lead: 'Only allow these models:', hint: 'Model IDs, comma-separated, e.g. gpt-4o, anthropic.claude-3-haiku-20240307-v1:0' },
  { type: 'pii_detection', label: 'Personal data', lead: 'Stop prompts containing', hint: '' },
];

function list(values: string[]): string {
  if (values.length <= 1) return values.join('');
  return values.slice(0, -1).join(', ') + ' or ' + values[values.length - 1];
}

/** The rule as a plain sentence: a lead, the terms, and an optional ending. */
function sentence(rule: RuleView): { lead: string; terms: string; tail: string } {
  const v = ruleValues(rule);
  const flag = rule.effect === 'flags';
  switch (rule.type) {
    case 'keyword_block':
      return { lead: flag ? 'Flag prompts that mention' : 'Stop prompts that mention', terms: v.join(', '), tail: '.' };
    case 'data_classification':
      return { lead: flag ? 'Flag prompts matching' : 'Stop prompts matching', terms: v.join(', '), tail: '.' };
    case 'model_restriction':
      return { lead: flag ? 'Flag models other than' : 'Only allow these models:', terms: v.join(', '), tail: '.' };
    case 'pii_detection':
      return {
        lead: flag ? 'Flag prompts containing' : 'Stop prompts containing',
        terms: v.length ? list(v.map((t) => PII_LABEL[t] ?? t)) : 'emails, phone numbers, SSNs or card numbers',
        tail: '.',
      };
    default:
      return { lead: rule.description, terms: '', tail: '' };
  }
}

function RuleForm({
  initial, piiTypes, onSave, onCancel, saving, error,
}: {
  initial?: RuleView;
  piiTypes: string[];
  onSave: (input: { type: EditableType; description: string; values: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
}) {
  const [type, setType] = useState<EditableType>(initial && isEditableType(initial.type) ? initial.type : 'keyword_block');
  const [text, setText] = useState(initial ? ruleValues(initial).join(', ') : '');
  const [pii, setPii] = useState<string[]>(initial && initial.type === 'pii_detection' ? ruleValues(initial) : ['SSN']);
  const [description, setDescription] = useState(initial?.description ?? '');
  const option = TYPE_OPTIONS.find((o) => o.type === type)!;
  const values = type === 'pii_detection' ? pii : text.split(',').map((s) => s.trim()).filter(Boolean);
  const canSave = values.length > 0 && description.trim().length > 0 && !saving;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => { e.preventDefault(); if (canSave) onSave({ type, description: description.trim(), values }); }}
    >
      {!initial && (
        <fieldset className="m-0 p-0 border-0 flex flex-wrap gap-2">
          <legend className="text-xs text-ink-muted mb-1.5">What should the rule look for?</legend>
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.type}
              type="button"
              aria-pressed={type === o.type}
              onClick={() => setType(o.type)}
              className={clsx('min-h-[36px] px-3 rounded-full border', type === o.type ? 'bg-ink text-white border-ink font-semibold' : 'bg-white border-line-strong')}
            >
              {o.label}
            </button>
          ))}
        </fieldset>
      )}
      {type === 'pii_detection' ? (
        <fieldset className="m-0 p-0 border-0">
          <legend className="text-sm font-semibold mb-2">{option.lead}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {piiTypes.map((t) => (
              <label key={t} className="flex items-center gap-2 min-h-[32px]">
                <input type="checkbox" checked={pii.includes(t)} onChange={(e) => setPii(e.target.checked ? [...pii, t] : pii.filter((x) => x !== t))} />
                {PII_LABEL[t] ?? t}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{option.lead}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={option.hint}
            className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white font-mono text-[13px]" />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Name shown when it stops a request</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Stop unreleased project codenames"
          className="min-h-[42px] px-3 border border-line-strong rounded-lg bg-white" />
      </label>
      {error && <p role="alert" className="m-0 text-stop-text font-semibold">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSave}>{saving ? 'Saving…' : initial ? 'Save' : 'Add rule'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function RuleCard({ rule, canEdit, piiTypes }: { rule: RuleView; canEdit: boolean; piiTypes: string[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rules'] });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => changeRule(rule, { enabled }), onSuccess: refresh });
  const edit = useMutation({
    mutationFn: (input: { description: string; values: string[] }) => changeRule(rule, input),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  const remove = useMutation({ mutationFn: () => deleteRule(rule), onSuccess: refresh });
  const s = sentence(rule);
  const framework = rule.framework ? FRAMEWORK_LABEL[rule.framework] ?? rule.framework : undefined;

  return (
    <Panel as="article" className={clsx('px-[18px] py-4 flex flex-col gap-3', !rule.enabled && 'opacity-75')}>
      {editing ? (
        <RuleForm initial={rule} piiTypes={piiTypes} saving={edit.isPending} error={edit.isError ? errorMessage(edit.error) : undefined}
          onSave={({ description, values }) => edit.mutate({ description, values })} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="m-0 text-base leading-[1.4] font-semibold">
                {s.lead}{s.terms && <> <span className="font-mono text-[13px] font-medium bg-ink-tint rounded px-1.5 py-px [overflow-wrap:anywhere]">{s.terms}</span></>}{s.tail}
              </p>
              {rule.type !== 'audit_logging' && s.terms && <p className="m-0 mt-1 text-xs text-ink-muted">{rule.description}</p>}
            </div>
            {canEdit ? (
              <Switch checked={rule.enabled} label={`${rule.description}: ${rule.enabled ? 'on' : 'off'}`} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
            ) : (
              <span className="text-xs font-semibold text-ink-muted">{rule.enabled ? 'On' : 'Off'}</span>
            )}
          </div>
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <span className={clsx('font-bold', rule.enabled && rule.effect === 'stops' && rule.stopped > 0 ? 'text-stop' : 'text-ink-muted')}>
              {!rule.enabled ? 'Off'
                : rule.effect === 'stops' ? (rule.stopped > 0 ? `${formatCount(rule.stopped)} stopped this week` : 'Nothing stopped this week')
                : `Flagged ${formatCount(rule.flagged)} times this week · doesn’t stop requests`}
            </span>
            <span className="flex items-center gap-2">
              {framework && <span className="text-xs px-2 py-0.5 border border-line-strong rounded-full text-ink-soft">{framework}</span>}
              {canEdit && isEditableType(rule.type) && (
                <button type="button" onClick={() => setEditing(true)} className="min-h-[32px] px-2 font-semibold hover:text-stop">Edit</button>
              )}
              {canEdit && !rule.framework && (
                <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="min-h-[32px] px-2 text-ink-muted hover:text-stop">Delete</button>
              )}
            </span>
          </div>
          {(toggle.isError || remove.isError) && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(toggle.error ?? remove.error)}</p>}
        </>
      )}
    </Panel>
  );
}

function CheckHeader({ n, name, summary, active = true }: { n: number; name: string; summary: string; active?: boolean }) {
  return (
    <div className={clsx('rounded-xl px-[18px] py-3.5 flex justify-between items-baseline gap-3', active ? 'bg-ink text-white' : 'bg-white text-ink border-2 border-dashed border-line-strong')}>
      <span>
        <span className={clsx('font-mono text-xs', active ? 'text-ink-on-dark-muted' : 'text-ink-muted')}>check {n}</span>
        <br />
        <span className="text-[19px] font-bold">{name}</span>
      </span>
      <span className={clsx('text-[13px]', active ? 'text-ink-on-dark' : 'text-ink-muted')}>{summary}</span>
    </div>
  );
}

export function RulesPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['rules', user?.tenantId], queryFn: fetchRules });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rules'] });
  const add = useMutation({ mutationFn: addRule, onSuccess: () => { setAdding(false); refresh(); } });
  const failMode = useMutation({ mutationFn: setFailMode, onSuccess: refresh });

  const checked = data?.rules.filter((r) => r.effect !== 'not_enforced') ?? [];
  const notEnforced = data?.rules.filter((r) => r.effect === 'not_enforced') ?? [];
  const activeStops = checked.filter((r) => r.enabled && r.effect === 'stops').length;
  const stoppedTotal = checked.reduce((sum, r) => sum + r.stopped, 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap justify-between items-end gap-5">
        <div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.025em]">
            {data ? `Every request is checked against ${activeStops} ${activeStops === 1 ? 'rule' : 'rules'} that can stop it.` : 'Rules'}
          </h1>
          <p className="m-0 mt-2 text-ink-muted text-base">Checks run in order, left to right. Counts are for the last 7 days.</p>
        </div>
        {data && (
          <div className="flex gap-4 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">If a check can’t run</span>
              {isAdmin ? (
                <Segmented
                  label="If a check can't run"
                  value={data.failMode}
                  onChange={(m) => failMode.mutate(m)}
                  options={[{ value: 'closed', label: 'Block the request' }, { value: 'open', label: 'Let it through, flagged' }]}
                />
              ) : (
                <span className="font-semibold">{data.failMode === 'closed' ? 'Block the request' : 'Let it through, flagged'}</span>
              )}
            </div>
            {isAdmin && !adding && <Button onClick={() => setAdding(true)}>Add a rule</Button>}
          </div>
        )}
      </div>

      {failMode.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(failMode.error)}</p>}
      {isError && <Panel className="px-6"><Note title="Couldn’t load rules."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {adding && data && (
        <Panel aria-label="New rule" className="px-6 py-5 max-w-[760px]">
          <SectionLabel className="mb-3">New rule · check 1</SectionLabel>
          <RuleForm piiTypes={data.piiTypes} saving={add.isPending} error={add.isError ? errorMessage(add.error) : undefined}
            onSave={(input) => add.mutate(input)} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      {data && (
        <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section aria-label="Check 1, policy rules" className="flex flex-col gap-3">
            <CheckHeader n={1} name="Policy rules" summary={`${formatCount(stoppedTotal)} stopped`} />
            {checked.length === 0
              ? <Panel className="px-5"><Note title="No rules yet.">{isAdmin ? 'Add a rule to start stopping risky prompts.' : ''}</Note></Panel>
              : checked.map((r) => <RuleCard key={`${r.policyId}:${r.ruleId}`} rule={r} canEdit={isAdmin} piiTypes={data.piiTypes} />)}
          </section>

          <section aria-label="Check 2, secrets" className="flex flex-col gap-3">
            <CheckHeader n={2} name="Secrets" summary="not active yet" active={false} />
            <Panel className="px-5">
              <Note title="Secrets detection is coming soon.">It will stop API keys, tokens and private keys pasted into prompts.</Note>
            </Panel>
          </section>

          <section aria-label="Check 3, personal data" className="flex flex-col gap-3">
            <CheckHeader n={3} name="Personal data" summary={`${formatCount(data.cleaned)} cleaned`} />
            <Panel as="article" className="px-[18px] py-4 flex flex-col gap-3">
              <p className="m-0 text-base leading-[1.4] font-semibold">
                Remove <span className="font-mono text-[13px] font-medium bg-ink-tint rounded px-1.5 py-px">emails, phone numbers, SSNs and card numbers</span>, then send.
              </p>
              <div className="flex justify-between items-center gap-3">
                <span className="font-bold">{formatCount(data.cleaned)} cleaned this week</span>
                <span className="text-xs font-semibold text-ink-muted">Always on</span>
              </div>
            </Panel>
          </section>
        </div>
      )}

      {notEnforced.length > 0 && (
        <details className="max-w-[900px]">
          <summary className="cursor-pointer min-h-[40px] flex items-center font-semibold">
            {notEnforced.length} compliance {notEnforced.length === 1 ? 'control isn’t' : 'controls aren’t'} checked by the gateway
          </summary>
          <p className="m-0 mb-3 text-ink-muted">These come from your compliance frameworks. They’re recorded for assessments but don’t stop or change requests.</p>
          <div className="flex flex-col gap-2">
            {notEnforced.map((r) => (
              <div key={`${r.policyId}:${r.ruleId}`} className="flex justify-between gap-3 py-2 border-b border-line-subtle">
                <span>{r.description}</span>
                {r.framework && <span className="text-xs text-ink-muted">{FRAMEWORK_LABEL[r.framework] ?? r.framework}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
