import { AuditLog } from '@ai-governance/types';

export type Outcome = 'stopped' | 'cleaned' | 'delivered';

/** Credentials removed from a delivered prompt (secrets check set to redact). */
export const secretsRedacted = (log: AuditLog): boolean => !!log.metadata?.secretsRedacted;

export function outcomeOf(log: AuditLog): Outcome {
  if (log.eventType === 'request_blocked') return 'stopped';
  return log.piiDetected || secretsRedacted(log) ? 'cleaned' : 'delivered';
}

/** A detector's kind (aws_access_key) as people write it (AWS access key). */
const ACRONYMS: Record<string, string> = { aws: 'AWS', gcp: 'GCP', api: 'API', jwt: 'JWT', ssh: 'SSH', pem: 'PEM', github: 'GitHub', gitlab: 'GitLab', openai: 'OpenAI', npm: 'npm', pypi: 'PyPI', url: 'URL' };
export function secretLabel(kind: string): string {
  return kind.split('_').map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase()).join(' ');
}
const withArticle = (s: string) => (s.includes(',') ? s : `${/^[aeiou]/i.test(s) || /^(AWS|API|SSH|npm)\b/.test(s) ? 'an' : 'a'} ${s}`);

/** The secrets step of a case file, from what the audit record says the check did. */
function secretsStep(log: AuditLog, stoppedBySecrets: boolean): EvidenceStep {
  const m = log.metadata ?? {};
  const kinds = (m.secretTypes ?? '').split(',').filter(Boolean).map(secretLabel).join(', ');
  if (stoppedBySecrets) return { label: 'Stopped: secret in the prompt', detail: `found ${kinds ? withArticle(kinds) : 'a credential'}. The secret itself was not recorded.`, kind: 'stopped' };
  if (m.secretsRedacted) return { label: 'Secrets removed', detail: `${m.secretsRedacted} found (${kinds}) and replaced before the prompt left the company.`, kind: 'cleaned' };
  if (m.secretsChecked) return { label: 'No secrets found', detail: 'no API keys, tokens, private keys or passwords.', kind: 'neutral' };
  if (log.eventType === 'request_blocked') return { label: 'Secrets', detail: 'not reached; the request was already stopped.', kind: 'skipped' };
  return { label: 'Secrets', detail: 'not checked for this request (the check was off, or the request predates it).', kind: 'skipped' };
}

/** The prompt-attack step (check 4, Beta), or nothing when the check didn't run. */
function promptAttackStep(log: AuditLog, stopped: boolean): EvidenceStep | null {
  const m = log.metadata ?? {};
  if (!m.promptAttackChecked) return null;
  const how = `checked with ${m.promptAttackChecked}`;
  if (stopped) return { label: 'Stopped: looks like a prompt attack', detail: `${m.promptAttackWhy ?? 'it tried to take over the AI'} (${how}).`, kind: 'stopped' };
  if (m.promptAttack === 'flagged') return { label: 'Flagged: possible prompt attack', detail: `${m.promptAttackWhy ?? 'it may try to take over the AI'}. Sent anyway, and recorded here for review (${how}).`, kind: 'skipped' };
  return { label: 'No prompt attack found', detail: `${how}.`, kind: 'neutral' };
}

/** Flagged as a possible prompt attack but sent. */
export const promptAttackFlagged = (l: AuditLog) => l.eventType !== 'request_blocked' && l.metadata?.promptAttack === 'flagged';

export interface EvidenceListItem {
  requestId: string;
  time: string;
  outcome: Outcome;
  app: string;
  user: string;
  model: string;
  reason?: string;
  /** An agent's tool call through an MCP server (model is then mcp:<server>/<tool>). */
  mcp?: { server: string; tool: string };
  /** Sent, but the AI provider or the API refused or failed, so nothing came back. */
  unanswered?: true;
  /** What was removed before sending, for cleaned requests. */
  removed?: { secrets?: true; personalData?: true };
  /** Sent, but flagged as a possible prompt attack (Beta). */
  flagged?: true;
}

/** True for an agent's MCP tool call rather than a prompt to a model. */
export const isMcpCall = (l: AuditLog) => l.metadata?.kind === 'mcp_tool_call';

/** Sent after the checks, but no answer came back (the provider or API refused or failed). */
export function unanswered(l: AuditLog): boolean {
  if (l.eventType === 'request_blocked') return false;
  if (isMcpCall(l)) return !!l.metadata?.backendError || Number(l.metadata?.backendStatus ?? 0) >= 400;
  return !!l.metadata?.providerError;
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
    ...(isMcpCall(l) ? { mcp: { server: l.metadata?.mcpServer ?? 'an MCP server', tool: l.metadata?.mcpTool ?? 'a tool' } } : {}),
    ...(unanswered(l) ? { unanswered: true as const } : {}),
    ...(outcomeOf(l) === 'cleaned' ? { removed: { ...(secretsRedacted(l) ? { secrets: true as const } : {}), ...(l.piiDetected ? { personalData: true as const } : {}) } } : {}),
    ...(promptAttackFlagged(l) ? { flagged: true as const } : {}),
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
    /** On legal hold: kept past keptUntil until the hold is released. */
    onHold?: boolean;
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
/** A tool call through one of the company's MCP servers, told as its own story. */
function buildMcpRecord(log: AuditLog, retentionDays: number, onHold = false): EvidenceRecord {
  const m = log.metadata ?? {};
  const outcome = outcomeOf(log);
  const server = m.mcpServer ?? 'an MCP server';
  const tool = m.mcpTool ?? 'a tool';
  const who = m.caller === 'test' ? `an admin testing in the dashboard (${log.userId})`
    : m.caller === 'person' ? `${m.callerEmail || log.userId}, signed in through ${log.appId || 'an agent'}`
    : `${log.appId || 'an agent'} with an API key`;
  const reason = outcome === 'stopped' ? m.policyReason || log.triggeredRules?.[log.triggeredRules.length - 1] || 'a company rule' : undefined;
  const steps: EvidenceStep[] = [{ label: 'Received', detail: `a call to ${tool} on ${server}, from ${who}.`, kind: 'neutral' }];
  if (outcome === 'stopped') {
    const label = m.check === 'secrets' ? 'Stopped: secret in the arguments' : m.check === 'approval' ? 'Refused by an approver' : 'Stopped by a policy rule';
    steps.push({ label, detail: `“${reason}”. The API was not called.`, kind: 'stopped' });
  } else {
    steps.push({ label: 'Arguments passed the checks', detail: 'company rules and the secrets check.', kind: 'neutral' });
    if (m.approvalBy) steps.push({ label: 'Approved', detail: `by ${m.approvalBy} (request ${m.approvalId}).`, kind: 'neutral' });
    if (m.connector) steps.push({ label: 'Through the connector', detail: `the call was made inside the company network by connector ${m.connector}.`, kind: 'neutral' });
    const status = Number(m.backendStatus ?? 0);
    steps.push(m.backendError
      ? { label: 'API not reached', detail: `${m.mcpApi ?? 'the API'} couldn't be reached (${m.backendError}).`, kind: 'skipped' }
      : { label: `Called ${m.mcpApi ?? 'the API'}`, detail: `it answered ${status} in ${log.latencyMs} ms.`, kind: status >= 400 ? 'skipped' : 'delivered' });
    if (log.piiDetected) steps.push({ label: 'Personal data removed', detail: 'from the result before the agent saw it.', kind: 'cleaned' });
    if (m.injectionFlag) steps.push({ label: 'Instructions in the result flagged', detail: 'the result had text aimed at the AI agent; the agent was told to treat it as data.', kind: 'skipped' });
    if (m.resultTruncated) steps.push({ label: 'Result cut', detail: 'it was larger than the server’s limit.', kind: 'neutral' });
  }
  return {
    requestId: log.requestId,
    outcome,
    headline: outcome === 'stopped' ? `A call to ${tool} on ${server} was stopped before reaching the API.`
      : m.caller === 'person' ? `${m.callerEmail || 'A person'}’s agent called ${tool} on ${server}.` : `An agent called ${tool} on ${server}.`,
    time: log.timestamp,
    app: log.appId || 'unknown',
    user: log.userId || 'anonymous',
    provider: 'MCP',
    model: `${server} / ${tool}`,
    ...(reason ? { reason } : {}),
    steps,
    proof: {
      promptFingerprint: log.promptHash,
      ...(log.responseHash ? { responseFingerprint: log.responseHash } : {}),
      recordedAt: log.timestamp,
      keptUntil: new Date(Date.parse(log.timestamp) + retentionDays * 86_400_000).toISOString(),
      ...(onHold ? { onHold: true } : {}),
      triggeredRules: log.triggeredRules ?? [],
    },
  };
}

export function buildEvidenceRecord(log: AuditLog, retentionDays: number, onHold = false): EvidenceRecord {
  if (log.metadata?.kind === 'mcp_tool_call') return buildMcpRecord(log, retentionDays, onHold);
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

  const bySecrets = outcome === 'stopped' && log.metadata?.check === 'secrets';
  const byAttack = outcome === 'stopped' && log.metadata?.check === 'prompt_attack';
  if (degraded.includes('policy_evaluation')) {
    steps.push({ label: 'Policy rules skipped', detail: 'the policy engine was unavailable and this company lets requests through when a check can’t run.', kind: 'skipped' });
  } else if (outcome === 'stopped' && !bySecrets && !byAttack) {
    steps.push({ label: 'Stopped by a policy rule', detail: `“${reason}”.`, kind: 'stopped' });
  } else if (rules.length > (byAttack ? 1 : 0)) {
    const n = rules.length - (byAttack ? 1 : 0);
    steps.push({ label: 'Policy rules passed', detail: `${n} ${n === 1 ? 'rule' : 'rules'} flagged it without stopping it.`, kind: 'neutral' });
  } else {
    steps.push({ label: 'Policy rules passed', detail: 'no rule matched.', kind: 'neutral' });
  }

  steps.push(secretsStep(log, bySecrets));

  if (byAttack) {
    steps.push(log.piiDetected
      ? { label: 'Personal data removed', detail: 'before the prompt-attack check saw the text.', kind: 'cleaned' }
      : { label: 'No personal data found', detail: 'the prompt was checked as written.', kind: 'neutral' });
    steps.push(promptAttackStep(log, true)!);
  }

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
    const attack = promptAttackStep(log, false);
    if (attack) steps.push(attack);
    steps.push(log.metadata?.providerError
      ? { label: `Sent to ${provider}, not answered`, detail: `${provider} refused or failed: ${log.metadata.providerError}`, kind: 'skipped' }
      : {
        label: `Delivered to ${provider}`,
        detail: `${log.modelId} answered in ${log.latencyMs} ms using ${log.inputTokens + log.outputTokens} tokens.`,
        kind: 'delivered',
      });
  }

  const headline =
    byAttack ? `A ${log.appId || 'request'} prompt looked like a prompt attack and never reached ${provider}.`
    : outcome === 'stopped' ? `A ${log.appId || 'request'} prompt was stopped and never reached ${provider}.`
    : outcome === 'cleaned' ? `A ${log.appId || 'request'} prompt was cleaned of ${log.piiDetected && secretsRedacted(log) ? 'secrets and personal data' : secretsRedacted(log) ? 'secrets' : 'personal data'}, then sent to ${provider}.`
    : `A ${log.appId || 'request'} prompt passed every check and was sent to ${provider}.`;
  const unanswered = log.metadata?.providerError ? ` ${provider} didn’t answer.` : '';

  return {
    requestId: log.requestId,
    outcome,
    headline: headline + unanswered,
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
      ...(onHold ? { onHold: true } : {}),
      triggeredRules: rules,
    },
    ...(outcome !== 'stopped'
      ? { usage: { inputTokens: log.inputTokens, outputTokens: log.outputTokens, estimatedCost: log.estimatedCost, latencyMs: log.latencyMs } }
      : {}),
  };
}
