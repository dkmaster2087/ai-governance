import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  listModels, MODEL_SUGGESTIONS, ModelConfig, ModelInput, ModelProvider, ModelTestResult,
  PROVIDER_LABEL, removeModel, saveModel, testModel,
} from '../lib/models-api';
import { errorMessage } from '../lib/rules-api';
import { listKeys } from '../lib/api-keys-api';
import { Button, Note, Panel, SectionLabel, Segmented, Switch } from '../components/kit/primitives';

const field = 'w-full min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';
// Providers quote prices per million tokens; they're stored per thousand (what Spend multiplies by).
const perMillion = (per1k: number) => Math.round(per1k * 1000 * 1e6) / 1e6;
const price = (per1k: number) => (per1k ? `$${perMillion(per1k)}` : '—');

/** The provider's error, in words that say what to do; the original is kept after it for support. */
function whyNoAnswer(provider: string, error?: string): string {
  const e = (error ?? '').toLowerCase();
  if (provider === 'bedrock' && (e.includes('not available for this account') || e.includes("don't have access") || e.includes('accessdenied')))
    return 'this model isn’t enabled for the AWS account. Turn it on in the Amazon Bedrock console (Model access), then test again.';
  if (provider === 'bedrock' && (e.includes('end of its life') || e.includes('end of life')))
    return 'Amazon has retired this model. Choose a current one.';
  if (e.includes('invalid model') || e.includes('model identifier is invalid') || e.includes('does not exist'))
    return 'the provider doesn’t recognise this model ID. Check it against the provider’s model list.';
  if (provider === 'openai' && (e.includes('incorrect api key') || e.includes('401')))
    return 'OpenAI refused the key. Paste a current API key.';
  return error ?? 'unknown error';
}

const blank: ModelInput = { name: '', provider: 'bedrock', modelId: '', status: 'active', apiKey: '', inputCostPer1kTokens: 0, outputCostPer1kTokens: 0, maxTokensPerRequest: 4096, allowedKeyIds: [] };

export function ModelForm({ model, onDone }: { model?: ModelConfig; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ModelInput>(model ? {
    name: model.name,
    provider: (model.provider === 'openai' ? 'openai' : 'bedrock'),
    modelId: model.modelId,
    status: model.status === 'active' ? 'active' : 'inactive',
    apiKey: '',
    inputCostPer1kTokens: model.inputCostPer1kTokens ?? 0,
    outputCostPer1kTokens: model.outputCostPer1kTokens ?? 0,
    maxTokensPerRequest: model.maxTokensPerRequest ?? 4096,
    allowedKeyIds: model.allowedKeyIds ?? [],
  } : blank);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: listKeys });
  const usable = (keys.data ?? []).filter((k) => k.status === 'active' && k.scopes.includes('chat'));
  const [limited, setLimited] = useState((model?.allowedKeyIds ?? []).length > 0);
  const toggleKey = (id: string, on: boolean) => set('allowedKeyIds', on ? [...form.allowedKeyIds, id] : form.allowedKeyIds.filter((k) => k !== id));
  const set = <K extends keyof ModelInput>(k: K, v: ModelInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const unsupported = model && !(model.provider in PROVIDER_LABEL);
  const needsKey = form.provider === 'openai';

  const save = useMutation({
    mutationFn: () => saveModel(form, model?.modelConfigId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-configs'] }); onDone(); },
  });
  const canSave = form.name.trim() && form.modelId.trim() && (!needsKey || form.apiKey || model?.apiKeyHint) && (!limited || form.allowedKeyIds.length > 0);

  return (
    <Panel aria-label={model ? `Edit ${model.name}` : 'Add a model'} className="px-6 py-5">
      <SectionLabel className="mb-4">{model ? `Edit ${model.name}` : 'Add a model'}</SectionLabel>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
        {unsupported && (
          <p className="m-0 text-stop-text font-semibold">This model was set up for {model!.provider}, which the gateway can’t call. Choose Amazon Bedrock or OpenAI.</p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Provider</span>
          <div><Segmented label="Provider" value={form.provider} onChange={(p: ModelProvider) => set('provider', p)}
            options={[{ value: 'bedrock', label: 'Amazon Bedrock' }, { value: 'openai', label: 'OpenAI' }]} /></div>
          <span className="text-xs text-ink-muted">
            {form.provider === 'bedrock' ? 'Called with the gateway’s AWS role, in its own region. No key needed.' : 'Your OpenAI key is kept in AWS Secrets Manager. Only its last four characters are shown here.'}
          </span>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Name</span>
            <input className={field} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Claude for support" />
          </label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Model ID</span>
            <input className={clsx(field, 'font-mono text-[13px]')} list="model-suggestions" value={form.modelId} onChange={(e) => set('modelId', e.target.value)}
              placeholder={MODEL_SUGGESTIONS[form.provider][0]} />
            <datalist id="model-suggestions">{MODEL_SUGGESTIONS[form.provider].map((m) => <option key={m} value={m} />)}</datalist>
            <span className="text-xs text-ink-muted">Apps send this as <code className="font-mono">model</code>.</span>
          </label>
          {needsKey && (
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">OpenAI key</span>
              <input className={clsx(field, 'font-mono text-[13px]')} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)}
                placeholder={model?.apiKeyHint ? `Blank keeps key ending ${model.apiKeyHint.slice(-4)}` : 'sk-…'} />
            </label>
          )}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Input price per million tokens ($)</span>
            <input className={field} type="number" min={0} step="any" value={perMillion(form.inputCostPer1kTokens)} onChange={(e) => set('inputCostPer1kTokens', Math.max(0, Number(e.target.value) || 0) / 1000)} />
          </label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Output price per million tokens ($)</span>
            <input className={field} type="number" min={0} step="any" value={perMillion(form.outputCostPer1kTokens)} onChange={(e) => set('outputCostPer1kTokens', Math.max(0, Number(e.target.value) || 0) / 1000)} />
          </label>
        </div>
        <p className="m-0 -mt-2 text-xs text-ink-muted">Prices are what your provider charges; Spend uses them to estimate cost.</p>
        <label className="flex flex-col gap-1.5 max-w-[320px]"><span className="text-sm font-semibold">Longest answer (tokens)</span>
          <input className={field} type="number" min={1} max={1000000} step={1} value={form.maxTokensPerRequest}
            onChange={(e) => set('maxTokensPerRequest', Math.min(1_000_000, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
          <span className="text-xs text-ink-muted">Apps that ask for a longer answer get this many tokens at most. Keeps one request from running up the bill.</span>
        </label>
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="text-sm font-semibold mb-1.5">Which API keys may use it</legend>
          <div><Segmented label="Which API keys may use it" value={limited ? 'some' : 'all'}
            onChange={(v: 'all' | 'some') => { setLimited(v === 'some'); if (v === 'all') set('allowedKeyIds', []); }}
            options={[{ value: 'all', label: 'Every key' }, { value: 'some', label: 'Only these keys' }]} /></div>
          {limited && (
            usable.length ? (
              <div className="flex flex-col gap-1.5 pl-1">
                {usable.map((k) => (
                  <label key={k.keyId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.allowedKeyIds.includes(k.keyId)} onChange={(e) => toggleKey(k.keyId, e.target.checked)} />
                    <span>{k.name}</span><span className="font-mono text-xs text-ink-muted">{k.keyPrefix}…</span>
                  </label>
                ))}
              </div>
            ) : <p className="m-0 text-sm text-ink-muted">{keys.isLoading ? 'Loading keys…' : 'No active keys with chat access yet. Create one under API keys.'}</p>
          )}
          {limited && !form.allowedKeyIds.length && usable.length > 0 && <span className="text-xs text-stop-text font-semibold">Choose at least one key, or pick Every key.</span>}
          <span className="text-xs text-ink-muted">Other keys are refused with a clear message, and the refusal is recorded in Evidence.</span>
        </fieldset>
        <div className="flex items-center gap-3">
          <Switch label="Listed for apps" checked={form.status === 'active'} onChange={(on) => set('status', on ? 'active' : 'inactive')} />
          <span className="text-sm">Listed for apps <span className="text-ink-muted">(shown in the gateway’s model list)</span></span>
        </div>
        {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSave || save.isPending}>{save.isPending ? 'Saving…' : model ? 'Save' : 'Add model'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function ModelRow({ m, onEdit }: { m: ModelConfig; onEdit: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const test = useMutation({ mutationFn: () => testModel(m.modelConfigId), onSuccess: setResult, onSettled: () => qc.invalidateQueries({ queryKey: ['model-configs'] }) });
  const remove = useMutation({ mutationFn: () => removeModel(m.modelConfigId), onSuccess: () => qc.invalidateQueries({ queryKey: ['model-configs'] }) });
  const listed = m.status === 'active';

  const testLine = test.isError ? { ok: false, text: `Test failed: ${errorMessage(test.error)}` }
    : result ? (result.success ? { ok: true, text: `Answered in ${result.latencyMs} ms` } : { ok: false, text: `Didn’t answer: ${whyNoAnswer(m.provider, result.error)}` })
    : m.lastTestStatus ? { ok: m.lastTestStatus === 'pass', text: m.lastTestStatus === 'pass' ? 'Last test passed' : 'Last test failed' }
    : null;

  return (
    <li className="grid gap-x-6 gap-y-2 px-6 py-4 border-b border-line-subtle last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{m.name}</span>
          {!listed && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">Not listed</span>}
        </div>
        <div className="font-mono text-[13px] text-ink-muted truncate">{m.modelId}</div>
      </div>
      <div className="text-sm min-w-0">
        <div>{PROVIDER_LABEL[m.provider] ?? <span className="text-stop-text font-semibold">{m.provider} (not supported)</span>}{m.apiKeyHint && <span className="font-mono text-ink-muted"> · key {m.apiKeyHint}</span>}</div>
        <div className="text-ink-muted">{m.inputCostPer1kTokens || m.outputCostPer1kTokens ? `In ${price(m.inputCostPer1kTokens)} · out ${price(m.outputCostPer1kTokens)} per million tokens` : 'No prices set'}</div>
        <div className="text-ink-muted">Answers up to {(m.maxTokensPerRequest ?? 4096).toLocaleString()} tokens · {m.allowedKeyIds?.length ? `${m.allowedKeyIds.length} key${m.allowedKeyIds.length === 1 ? '' : 's'} only` : 'every key'}</div>
        {testLine && <div className={clsx('font-semibold', testLine.ok ? 'text-ink' : 'text-stop-text')}>{testLine.text}</div>}
      </div>
      <div className="flex gap-2 flex-wrap md:justify-end">
        {confirming ? (
          <>
            <span className="self-center text-sm">Remove {m.name}?</span>
            <Button variant="secondary" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => { setResult(null); test.mutate(); }} disabled={test.isPending}>{test.isPending ? 'Testing…' : 'Test'}</Button>
            <Button variant="secondary" onClick={onEdit}>Edit</Button>
            <Button variant="ghost" onClick={() => setConfirming(true)}>Remove</Button>
          </>
        )}
      </div>
    </li>
  );
}

/** The models apps can reach through the gateway, and the provider keys behind them. */
export function ModelsPage() {
  const [editing, setEditing] = useState<ModelConfig | 'new' | null>(null);
  const { data: models, isLoading, isError, refetch } = useQuery({ queryKey: ['model-configs'], queryFn: listModels });
  const listed = models?.filter((m) => m.status === 'active').length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
            {models ? (models.length === 0 ? 'No models set up yet.' : `${listed} ${listed === 1 ? 'model' : 'models'} listed for apps.`) : ' '}
          </p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            To stop apps using anything else, add an <Link to="/rules" className="font-semibold text-ink">Approved models</Link> rule.
          </p>
        </div>
        {editing === null && <Button onClick={() => setEditing('new')}>Add a model</Button>}
      </div>

      {editing !== null && <ModelForm key={editing === 'new' ? 'new' : editing.modelConfigId} model={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}

      {isError && <Panel className="px-6"><Note title="Couldn’t load models."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {models && models.length === 0 && editing === null && (
        <Panel className="px-6"><Note title="Add the models your apps use.">Each one needs its provider and, for OpenAI, a key. Prices are optional and feed Spend.</Note></Panel>
      )}
      {models && models.length > 0 && (
        <Panel>
          <ul className="m-0 p-0 list-none">
            {models.map((m) => <ModelRow key={m.modelConfigId} m={m} onEdit={() => setEditing(m)} />)}
          </ul>
        </Panel>
      )}
    </div>
  );
}
