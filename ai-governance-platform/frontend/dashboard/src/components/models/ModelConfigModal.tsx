import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Eye, EyeOff, Info } from 'lucide-react';
import clsx from 'clsx';
import { createModelConfig, updateModelConfig } from '../../lib/api';
import { Toggle } from '../ui/Toggle';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

type Provider = 'bedrock' | 'openai' | 'anthropic' | 'azure-openai' | 'google-vertex' | 'custom';

interface ModelForm {
  name: string;
  provider: Provider;
  modelId: string;
  status: 'active' | 'inactive' | 'testing';
  isDefault: boolean;
  region: string;
  endpoint: string;
  apiKey: string;
  deploymentName: string;
  maxTokensPerRequest: number;
  maxContextTokens: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  allowedForRoles: string;
  allowedForApps: string;
  requiresApproval: boolean;
  tags: string;
}

interface Props {
  model?: Partial<ModelForm & { modelConfigId: string; apiKeyHint?: string }> | null;
  onClose: () => void;
  onSaved: () => void;
}

const PROVIDER_OPTIONS: { value: Provider; label: string; needsApiKey: boolean; needsRegion: boolean; needsEndpoint: boolean; needsDeployment: boolean }[] = [
  { value: 'bedrock',        label: 'Amazon Bedrock',   needsApiKey: false, needsRegion: true,  needsEndpoint: false, needsDeployment: false },
  { value: 'openai',         label: 'OpenAI',           needsApiKey: true,  needsRegion: false, needsEndpoint: false, needsDeployment: false },
  { value: 'anthropic',      label: 'Anthropic',        needsApiKey: true,  needsRegion: false, needsEndpoint: false, needsDeployment: false },
  { value: 'azure-openai',   label: 'Azure OpenAI',     needsApiKey: true,  needsRegion: false, needsEndpoint: true,  needsDeployment: true  },
  { value: 'google-vertex',  label: 'Google Vertex AI', needsApiKey: true,  needsRegion: true,  needsEndpoint: false, needsDeployment: false },
  { value: 'custom',         label: 'Custom Endpoint',  needsApiKey: true,  needsRegion: false, needsEndpoint: true,  needsDeployment: false },
];

const BEDROCK_MODELS = [
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
  'anthropic.claude-3-opus-20240229-v1:0',
  'amazon.titan-text-express-v1',
  'amazon.titan-text-lite-v1',
  'meta.llama3-70b-instruct-v1:0',
  'meta.llama3-8b-instruct-v1:0',
  'mistral.mistral-large-2402-v1:0',
];

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
const ANTHROPIC_MODELS = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];

const AWS_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'ca-central-1'];

export function ModelConfigModal({ model, onClose, onSaved }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const isEdit = !!model?.modelConfigId;
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<'connection' | 'limits' | 'governance'>('connection');

  const [form, setForm] = useState<ModelForm>({
    name: model?.name ?? '',
    provider: (model?.provider as Provider) ?? 'bedrock',
    modelId: model?.modelId ?? '',
    status: (model?.status as ModelForm['status']) ?? 'active',
    isDefault: model?.isDefault ?? false,
    region: model?.region ?? 'us-east-1',
    endpoint: model?.endpoint ?? '',
    apiKey: '',
    deploymentName: model?.deploymentName ?? '',
    maxTokensPerRequest: model?.maxTokensPerRequest ?? 4096,
    maxContextTokens: model?.maxContextTokens ?? 8192,
    inputCostPer1kTokens: model?.inputCostPer1kTokens ?? 0,
    outputCostPer1kTokens: model?.outputCostPer1kTokens ?? 0,
    allowedForRoles: (model?.allowedForRoles as unknown as string[])?.join(', ') ?? '',
    allowedForApps: (model?.allowedForApps as unknown as string[])?.join(', ') ?? '',
    requiresApproval: model?.requiresApproval ?? false,
    tags: (model?.tags as unknown as string[])?.join(', ') ?? '',
  });

  const set = (key: keyof ModelForm, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));

  const providerConfig = PROVIDER_OPTIONS.find((p) => p.value === form.provider)!;

  const modelOptions =
    form.provider === 'bedrock' ? BEDROCK_MODELS :
    form.provider === 'openai' ? OPENAI_MODELS :
    form.provider === 'anthropic' ? ANTHROPIC_MODELS : [];

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        allowedForRoles: form.allowedForRoles.split(',').map((s) => s.trim()).filter(Boolean),
        allowedForApps: form.allowedForApps.split(',').map((s) => s.trim()).filter(Boolean),
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
        apiKey: form.apiKey || undefined,
      };
      return isEdit
        ? updateModelConfig(model!.modelConfigId!, payload)
        : createModelConfig(payload);
    },
    onSuccess: onSaved,
  });

  const tabs = [
    { id: 'connection', label: 'Connection' },
    { id: 'limits', label: 'Limits & Cost' },
    { id: 'governance', label: 'Governance' },
  ] as const;

  const Input = ({ label, id, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) => (
    <div>
      <label className={clsx('block text-xs mb-1.5', t.sub)} htmlFor={id}>{label}</label>
      <input
        id={id}
        {...props}
        className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors', t.input)}
      />
    </div>
  );

  const Select = ({ label, id, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) => (
    <div>
      <label className={clsx('block text-xs mb-1.5', t.sub)} htmlFor={id}>{label}</label>
      <select
        id={id}
        {...props}
        className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
      >
        {children}
      </select>
    </div>
  );

  const FieldToggle = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0 mr-4">
        <p className={clsx('text-sm', t.body)}>{label}</p>
        {hint && <p className={clsx('text-xs mt-0.5', t.faint)}>{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={clsx('relative border rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl', t.overlay)}>
        {/* Header */}
        <div className={clsx('flex items-center justify-between px-6 py-5 border-b', t.border)}>
          <div>
            <h2 className={clsx('text-lg font-semibold', t.heading)}>{isEdit ? 'Edit Model' : 'Add Model Configuration'}</h2>
            <p className={clsx('text-xs mt-0.5', t.muted)}>Stored in DynamoDB · API keys in Secrets Manager</p>
          </div>
          <button onClick={onClose} className={clsx(t.muted, t.hoverText)} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={clsx('flex border-b px-6', t.border)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx('px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-400'
                  : clsx('border-transparent', t.muted, t.hoverText)
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          {activeTab === 'connection' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Input label="Display name" id="m-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Our Claude Instance" />
                </div>

                {/* Provider selector */}
                <div className="col-span-2">
                  <label className={clsx('block text-xs mb-2', t.sub)}>Provider</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PROVIDER_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => { set('provider', p.value); set('modelId', ''); }}
                        className={clsx('px-3 py-2 rounded-lg border text-xs font-medium transition-colors',
                          form.provider === p.value
                            ? 'border-brand-500 bg-brand-600/20 text-brand-300'
                            : clsx(t.border, isDark ? 'bg-slate-800 text-slate-400 hover:border-white/20' : 'bg-gray-100 text-gray-500 hover:border-gray-300')
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model ID */}
                <div className="col-span-2">
                  {modelOptions.length > 0 ? (
                    <Select label="Model ID" id="m-model" value={form.modelId} onChange={(e) => set('modelId', e.target.value)}>
                      <option value="">Select a model...</option>
                      {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select>
                  ) : (
                    <Input label="Model ID" id="m-model" value={form.modelId} onChange={(e) => set('modelId', e.target.value)} placeholder="e.g. my-custom-model-v1" />
                  )}
                </div>

                {/* Region (Bedrock / Vertex) */}
                {providerConfig.needsRegion && (
                  <div className="col-span-2">
                    <Select label="AWS Region" id="m-region" value={form.region} onChange={(e) => set('region', e.target.value)}>
                      {AWS_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </div>
                )}

                {/* Endpoint (Azure, Custom) */}
                {providerConfig.needsEndpoint && (
                  <div className="col-span-2">
                    <Input label="Endpoint URL" id="m-endpoint" type="url" value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="https://your-resource.openai.azure.com" />
                  </div>
                )}

                {/* Deployment name (Azure) */}
                {providerConfig.needsDeployment && (
                  <div className="col-span-2">
                    <Input label="Deployment Name" id="m-deployment" value={form.deploymentName} onChange={(e) => set('deploymentName', e.target.value)} placeholder="gpt-4o-deployment" />
                  </div>
                )}

                {/* API Key */}
                {providerConfig.needsApiKey && (
                  <div className="col-span-2">
                    <label className={clsx('block text-xs mb-1.5', t.sub)} htmlFor="m-apikey">
                      API Key
                      {isEdit && model?.apiKeyHint && (
                        <span className={clsx('ml-2 font-mono', t.faint)}>current: {model.apiKeyHint}</span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        id="m-apikey"
                        type={showApiKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(e) => set('apiKey', e.target.value)}
                        placeholder={isEdit ? 'Leave blank to keep existing key' : 'sk-...'}
                        className={clsx('w-full border rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:border-brand-500 font-mono', t.input)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className={clsx('absolute right-3 top-1/2 -translate-y-1/2', t.muted, t.hoverText)}
                        aria-label={showApiKey ? 'Hide key' : 'Show key'}
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className={clsx('text-xs mt-1 flex items-center gap-1', t.faint)}>
                      <Info className="w-3 h-3" />
                      Stored encrypted in AWS Secrets Manager — never in plain text
                    </p>
                  </div>
                )}

                <Select label="Status" id="m-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="testing">Testing</option>
                  <option value="inactive">Inactive</option>
                </Select>

                <div className="flex items-center gap-3 pt-5">
                  <Toggle checked={form.isDefault} onChange={(v) => set('isDefault', v)} />
                  <label className={clsx('text-sm', t.body)}>Set as default model</label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'limits' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="Max tokens per request" id="m-maxtokens" type="number" value={form.maxTokensPerRequest} onChange={(e) => set('maxTokensPerRequest', +e.target.value)} />
                <Input label="Context window (tokens)" id="m-context" type="number" value={form.maxContextTokens} onChange={(e) => set('maxContextTokens', +e.target.value)} />
                <div>
                  <Input label="Input cost per 1k tokens ($)" id="m-incost" type="number" step="0.00001" value={form.inputCostPer1kTokens} onChange={(e) => set('inputCostPer1kTokens', +e.target.value)} />
                  <p className={clsx('text-xs mt-1', t.faint)}>Used for cost tracking in analytics</p>
                </div>
                <div>
                  <Input label="Output cost per 1k tokens ($)" id="m-outcost" type="number" step="0.00001" value={form.outputCostPer1kTokens} onChange={(e) => set('outputCostPer1kTokens', +e.target.value)} />
                </div>
              </div>

              {/* Cost preview */}
              <div className={clsx('border rounded-xl p-4', t.cardInner, t.border)}>
                <p className={clsx('text-xs mb-2', t.muted)}>Estimated cost for 1M tokens (50% input / 50% output)</p>
                <p className={clsx('text-xl font-bold', t.heading)}>
                  ${((form.inputCostPer1kTokens * 500) + (form.outputCostPer1kTokens * 500)).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'governance' && (
            <div className="space-y-4">
              <div>
                <Input
                  label="Allowed roles (comma-separated, empty = all roles)"
                  id="m-roles"
                  value={form.allowedForRoles}
                  onChange={(e) => set('allowedForRoles', e.target.value)}
                  placeholder="admin, developer, analyst"
                />
                <p className={clsx('text-xs mt-1', t.faint)}>Leave empty to allow all roles</p>
              </div>
              <div>
                <Input
                  label="Allowed app IDs (comma-separated, empty = all apps)"
                  id="m-apps"
                  value={form.allowedForApps}
                  onChange={(e) => set('allowedForApps', e.target.value)}
                  placeholder="app_crm, app_support"
                />
              </div>
              <div>
                <Input
                  label="Tags (comma-separated)"
                  id="m-tags"
                  value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="fast, cost-effective, vision"
                />
              </div>
              <div className={clsx('border-t pt-4 space-y-1', t.border)}>
                <FieldToggle
                  label="Require approval for each request"
                  checked={form.requiresApproval}
                  onChange={(v) => set('requiresApproval', v)}
                  hint="High-risk models — each request is flagged for human review"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={clsx('px-6 py-4 border-t flex gap-3', t.border)}>
          <button onClick={onClose} className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.modelId || mutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Model'}
          </button>
        </div>
      </div>
    </div>
  );
}
