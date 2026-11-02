import { ChatMessage, PolicyEvaluationResult } from '@ai-governance/types';
import { describeSecrets, findSecrets, redactSecrets, scanTexts, SecretsAction } from './secret-detector';

/** The outcome of check 2, shared by the app endpoint and proxy mode. */
export type SecretsCheck =
  | { outcome: 'off' | 'clean'; metadata: Record<string, string> }
  | { outcome: 'blocked'; metadata: Record<string, string>; result: PolicyEvaluationResult; message: string }
  | { outcome: 'redacted'; metadata: Record<string, string>; messages: ChatMessage[] };

/** Rule name recorded in triggeredRules when this check stops a request. */
export const SECRETS_RULE = 'Secrets detection';

export function checkSecrets<M extends { role: string; content: string }>(messages: M[], action: SecretsAction): SecretsCheck {
  if (action === 'off') return { outcome: 'off', metadata: {} };
  const scan = scanTexts(messages.map((m) => m.content));
  if (scan.count === 0) return { outcome: 'clean', metadata: { secretsChecked: 'true' } };

  const metadata = { secretsChecked: 'true', secretTypes: scan.types.join(',') };
  const what = describeSecrets(scan.labels);
  if (action === 'block') {
    const reason = `Contains ${what}`;
    return {
      outcome: 'blocked',
      metadata: { ...metadata, check: 'secrets' },
      message: `Request blocked: the prompt contains ${what}. Remove it and try again.`,
      result: {
        allowed: false, action: 'block', triggeredRules: [SECRETS_RULE], riskScore: 100, reason,
        ...(scan.evidence ? { evidence: { ruleType: 'secrets', ...scan.evidence } } : {}),
      } as PolicyEvaluationResult,
    };
  }
  return {
    outcome: 'redacted',
    metadata: { ...metadata, secretsRedacted: String(scan.count) },
    messages: messages.map((m) => {
      const findings = findSecrets(m.content);
      return findings.length ? { ...m, content: redactSecrets(m.content, findings) } : m;
    }) as unknown as ChatMessage[],
  };
}
