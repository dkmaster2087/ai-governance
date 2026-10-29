import { AuditLog } from '@ai-governance/types';

export type Outcome = 'stopped' | 'cleaned' | 'delivered';

export function outcomeOf(log: AuditLog): Outcome {
  if (log.eventType === 'request_blocked') return 'stopped';
  return log.piiDetected ? 'cleaned' : 'delivered';
}

export interface EvidenceListItem {
  requestId: string;
  time: string;
  outcome: Outcome;
  app: string;
  user: string;
  model: string;
  reason?: string;
}

function toItem(l: AuditLog): EvidenceListItem {
  return {
    requestId: l.requestId,
    time: l.timestamp,
    outcome: outcomeOf(l),
    app: l.appId || 'unknown',
    user: l.userId || 'anonymous',
    model: l.modelId,
    ...(l.eventType === 'request_blocked' ? { reason: l.metadata?.policyReason || l.triggeredRules?.[l.triggeredRules.length - 1] || 'Blocked by policy' } : {}),
  };
}

/** Filter, search and page through audit records (already newest first). */
export function listEvidence(
  logs: AuditLog[],
  opts: { outcome?: Outcome | 'all'; q?: string; offset?: number; limit?: number }
): { items: EvidenceListItem[]; total: number; nextOffset: number | null } {
  const q = opts.q?.trim().toLowerCase();
  const matched = logs
    .map(toItem)
    .filter((i) => !opts.outcome || opts.outcome === 'all' || i.outcome === opts.outcome)
    .filter((i) => !q || [i.requestId, i.app, i.user, i.model, i.reason ?? ''].some((f) => f.toLowerCase().includes(q)));
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  const items = matched.slice(offset, offset + limit);
  return { items, total: matched.length, nextOffset: offset + limit < matched.length ? offset + limit : null };
}

export interface EvidenceStep {
  label: string;
  detail: string;
  kind: 'neutral' | 'stopped' | 'cleaned' | 'skipped' | 'delivered';
}

export interface EvidenceRecord {
  requestId: string;
  outcome: Outcome;
  headline: string;
  time: string;
  app: string;
  user: string;
  provider: string;
  model: string;
  reason?: string;
  excerpt?: { before: string; hit: string; after: string };
  steps: EvidenceStep[];
  proof: {
    promptFingerprint: string;
    responseFingerprint?: string;
    recordedAt: string;
    keptUntil: string;
    triggeredRules: string[];
  };
  usage?: { inputTokens: number; outputTokens: number; estimatedCost: number; latencyMs: number };
}

const PROVIDER_NAMES: Record<string, string> = {
  bedrock: 'Amazon Bedrock', openai: 'OpenAI', anthropic: 'Anthropic', 'azure-openai': 'Azure OpenAI', 'google-vertex': 'Google Vertex',
};

/**
 * One request as a case file: what happened at each check, in order, built only from what the audit
 * log actually recorded.
 */
export function buildEvidenceRecord(log: AuditLog, retentionDays: number): EvidenceRecord {
  const outcome = outcomeOf(log);
  const provider = PROVIDER_NAMES[log.provider] ?? log.provider;
  const rules = log.triggeredRules ?? [];
  const reason = outcome === 'stopped' ? log.metadata?.policyReason || rules[rules.length - 1] || 'Blocked by policy' : undefined;
  const degraded = (log.metadata?.governanceDegraded ?? '').split(',').filter(Boolean);
  const excerpt = log.metadata?.evidenceHit
    ? { before: log.metadata.evidenceBefore ?? '', hit: log.metadata.evidenceHit, after: log.metadata.evidenceAfter ?? '' }
    : undefined;

  const steps: EvidenceStep[] = [
    { label: 'Received', detail: `from ${log.appId || 'an unknown app'} for ${log.userId || 'an anonymous user'}, going to ${provider} · ${log.modelId}.`, kind: 'neutral' },
  ];

  if (degraded.includes('policy_evaluation')) {
    steps.push({ label: 'Policy rules skipped', detail: 'the policy engine was unavailable and this company lets requests through when a check can’t run.', kind: 'skipped' });
  } else if (outcome === 'stopped') {
    steps.push({ label: 'Stopped by a policy rule', detail: `“${reason}”.`, kind: 'stopped' });
  } else if (rules.length > 0) {
    steps.push({ label: 'Policy rules passed', detail: `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} flagged it without stopping it.`, kind: 'neutral' });
  } else {
    steps.push({ label: 'Policy rules passed', detail: 'no rule matched.', kind: 'neutral' });
  }

  steps.push({ label: 'Secrets', detail: 'not checked; secrets detection isn’t active yet.', kind: 'skipped' });

  if (outcome === 'stopped') {
    steps.push({ label: 'Not sent', detail: `the app was told the request was blocked by company policy. Nothing reached ${provider}.`, kind: 'stopped' });
  } else {
    if (degraded.includes('pii_masking')) {
      steps.push({ label: 'Personal data not checked', detail: 'the data protection service was unavailable and this company lets requests through when a check can’t run.', kind: 'skipped' });
    } else {
      steps.push(log.piiDetected
        ? { label: 'Personal data removed', detail: 'before the prompt left the company.', kind: 'cleaned' }
        : { label: 'No personal data found', detail: 'the prompt was sent as written.', kind: 'neutral' });
    }
    steps.push({
      label: `Delivered to ${provider}`,
      detail: `${log.modelId} answered in ${log.latencyMs} ms using ${log.inputTokens + log.outputTokens} tokens.`,
      kind: 'delivered',
    });
  }

  const headline =
    outcome === 'stopped' ? `A ${log.appId || 'request'} prompt was stopped and never reached ${provider}.`
    : outcome === 'cleaned' ? `A ${log.appId || 'request'} prompt was cleaned of personal data, then sent to ${provider}.`
    : `A ${log.appId || 'request'} prompt passed every check and was sent to ${provider}.`;

  return {
    requestId: log.requestId,
    outcome,
    headline,
    time: log.timestamp,
    app: log.appId || 'unknown',
    user: log.userId || 'anonymous',
    provider,
    model: log.modelId,
    ...(reason ? { reason } : {}),
    ...(excerpt ? { excerpt } : {}),
    steps,
    proof: {
      promptFingerprint: log.promptHash,
      ...(log.responseHash ? { responseFingerprint: log.responseHash } : {}),
      recordedAt: log.timestamp,
      keptUntil: new Date(Date.parse(log.timestamp) + retentionDays * 86_400_000).toISOString(),
      triggeredRules: rules,
    },
    ...(outcome !== 'stopped'
      ? { usage: { inputTokens: log.inputTokens, outputTokens: log.outputTokens, estimatedCost: log.estimatedCost, latencyMs: log.latencyMs } }
      : {}),
  };
}
