import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Play, CheckCircle, XCircle,
  Clock, Star, StarOff, AlertTriangle, Cpu,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { fetchModelConfigs, deleteModelConfig, testModelConfig } from '../lib/api';
import { mockModelConfigs } from '../lib/mock-data';
import { Badge } from '../components/ui/Badge';
import { ModelConfigModal } from '../components/models/ModelConfigModal';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

type ModelStatus = 'active' | 'inactive' | 'testing';
type TestStatus = 'pass' | 'fail' | undefined;

const providerMeta: Record<string, { label: string; color: string; bg: string }> = {
  bedrock:       { label: 'Amazon Bedrock',  color: 'text-orange-400', bg: 'bg-orange-500/20' },
  openai:        { label: 'OpenAI',          color: 'text-green-400',  bg: 'bg-green-500/20'  },
  anthropic:     { label: 'Anthropic',       color: 'text-purple-400', bg: 'bg-purple-500/20' },
  'azure-openai':{ label: 'Azure OpenAI',    color: 'text-blue-400',   bg: 'bg-blue-500/20'   },
  'google-vertex':{ label: 'Google Vertex',  color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
};

export function ModelsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const providerCustom = { label: 'Custom', color: isDark ? 'text-slate-400' : 'text-gray-500', bg: isDark ? 'bg-slate-700' : 'bg-gray-200' };

  const statusBadge: Record<ModelStatus, { label: string; color: string }> = {
    active:   { label: 'Active',   color: 'text-accent-400 bg-accent-500/20' },
    inactive: { label: 'Inactive', color: clsx(isDark ? 'text-slate-400 bg-slate-700' : 'text-gray-500 bg-gray-200') },
    testing:  { label: 'Testing',  color: 'text-yellow-400 bg-yellow-500/20' },
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<typeof mockModelConfigs[0] | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['model-configs'],
    queryFn: fetchModelConfigs,
    placeholderData: mockModelConfigs,
  });

  const models: typeof mockModelConfigs = Array.isArray(data) && data.length ? data : mockModelConfigs;

  const deleteMutation = useMutation({
    mutationFn: deleteModelConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['model-configs'] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testModelConfig(id),
    onSettled: () => {
      setTestingId(null);
      queryClient.invalidateQueries({ queryKey: ['model-configs'] });
    },
  });

  const handleTest = (id: string) => {
    setTestingId(id);
    testMutation.mutate(id);
  };

  const activeCount = models.filter((m) => m.status === 'active').length;
  const totalCostEstimate = models
    .filter((m) => m.status === 'active')
    .reduce((sum, m) => sum + m.inputCostPer1kTokens + m.outputCostPer1kTokens, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={clsx('border rounded-xl px-4 py-2.5 text-center', t.card)}>
            <p className={clsx('text-lg font-bold', t.heading)}>{models.length}</p>
            <p className={clsx('text-xs', t.muted)}>Configured</p>
          </div>
          <div className={clsx('border rounded-xl px-4 py-2.5 text-center', t.card)}>
            <p className="text-lg font-bold text-accent-400">{activeCount}</p>
            <p className={clsx('text-xs', t.muted)}>Active</p>
          </div>
          <div className={clsx('border rounded-xl px-4 py-2.5 text-center', t.card)}>
            <p className={clsx('text-lg font-bold', t.heading)}>${totalCostEstimate.toFixed(4)}</p>
            <p className={clsx('text-xs', t.muted)}>Avg cost/1k tokens</p>
          </div>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Model
        </button>
      </div>

      <div className={clsx('flex items-start gap-2.5 border rounded-xl px-4 py-3 text-xs', t.card, t.muted)}>
        <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <span>
          Model configurations are stored in <span className={clsx('font-mono', t.body)}>DynamoDB / ai-gov-models</span>.
          API keys are stored in <span className={clsx('font-mono', t.body)}>AWS Secrets Manager</span> — only the last 4 characters are shown here.
        </span>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {models.map((model) => {
          const provider = providerMeta[model.provider] ?? providerCustom;
          const status = statusBadge[model.status as ModelStatus];
          const isTesting = testingId === model.modelConfigId;

          return (
            <div
              key={model.modelConfigId}
              className={clsx(
                'border rounded-2xl p-5 flex flex-col gap-4 transition-colors',
                t.card,
                model.isDefault && 'border-brand-500/40'
              )}
            >
              <div className="flex items-start gap-3">
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', provider.bg)}>
                  <Cpu className={clsx('w-5 h-5', provider.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <h3 className={clsx('font-semibold text-sm truncate', t.heading)}>{model.name}</h3>
                    {model.isDefault && (
                      <Star className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" title="Default model" />
                    )}
                  </div>
                  <p className={clsx('text-xs font-mono truncate', t.muted)}>{model.modelId}</p>
                </div>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', status.color)}>
                  {status.label}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', provider.bg, provider.color)}>
                  {provider.label}
                </span>
                {model.region && (
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full', t.muted, isDark ? 'bg-slate-800' : 'bg-gray-100')}>
                    {model.region}
                  </span>
                )}
                {model.apiKeyHint && (
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-mono', t.muted, isDark ? 'bg-slate-800' : 'bg-gray-100')}>
                    key {model.apiKeyHint}
                  </span>
                )}
                {model.requiresApproval && (
                  <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                    Approval required
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={clsx('mb-0.5', t.muted)}>Input cost</p>
                  <p className={clsx('font-medium', t.heading)}>${model.inputCostPer1kTokens}/1k tokens</p>
                </div>
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={clsx('mb-0.5', t.muted)}>Output cost</p>
                  <p className={clsx('font-medium', t.heading)}>${model.outputCostPer1kTokens}/1k tokens</p>
                </div>
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={clsx('mb-0.5', t.muted)}>Max tokens/req</p>
                  <p className={clsx('font-medium', t.heading)}>{model.maxTokensPerRequest.toLocaleString()}</p>
                </div>
                <div className={clsx('rounded-lg px-3 py-2', t.cardInner)}>
                  <p className={clsx('mb-0.5', t.muted)}>Context window</p>
                  <p className={clsx('font-medium', t.heading)}>{(model.maxContextTokens / 1000).toFixed(0)}k</p>
                </div>
              </div>

              {(model.allowedForRoles.length > 0 || model.tags.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {model.allowedForRoles.map((r) => (
                    <span key={r} className="text-xs bg-brand-600/20 text-brand-400 px-2 py-0.5 rounded-full">{r}</span>
                  ))}
                  {model.tags.map((tg) => (
                    <span key={tg} className={clsx('text-xs px-2 py-0.5 rounded-full', isDark ? 'bg-slate-800' : 'bg-gray-100', t.muted)}>{tg}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs">
                {model.lastTestStatus === 'pass' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-accent-400" />
                ) : model.lastTestStatus === 'fail' ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <Clock className={clsx('w-3.5 h-3.5', t.faint)} />
                )}
                <span className={clsx(
                  model.lastTestStatus === 'pass' ? 'text-accent-400' :
                  model.lastTestStatus === 'fail' ? 'text-red-400' : t.faint
                )}>
                  {model.lastTestStatus === 'pass' ? 'Connection verified' :
                   model.lastTestStatus === 'fail' ? 'Last test failed' : 'Not tested'}
                </span>
                {model.lastTestedAt && (
                  <span className={clsx('ml-auto', t.faint)}>
                    {format(new Date(model.lastTestedAt), 'MMM d, HH:mm')}
                  </span>
                )}
              </div>

              <div className={clsx('flex items-center gap-2 pt-1 border-t', t.border)}>
                <button
                  onClick={() => handleTest(model.modelConfigId)}
                  disabled={isTesting}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50', t.btnSecondary)}
                >
                  <Play className={clsx('w-3 h-3', isTesting && 'animate-pulse')} />
                  {isTesting ? 'Testing...' : 'Test'}
                </button>
                <button
                  onClick={() => { setEditTarget(model as any); setModalOpen(true); }}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors', t.btnSecondary)}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => deleteMutation.mutate(model.modelConfigId)}
                  disabled={model.isDefault}
                  className={clsx('ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-red-400 hover:bg-red-500/10 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed', t.faint)}
                  title={model.isDefault ? 'Cannot delete the default model' : 'Delete'}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <ModelConfigModal
          model={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['model-configs'] });
          }}
        />
      )}
    </div>
  );
}
