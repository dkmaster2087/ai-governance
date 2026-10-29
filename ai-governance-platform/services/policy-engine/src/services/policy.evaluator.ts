import { NormalizedAIRequest, PolicyEvaluationResult, PolicyEvidence, PolicyRule } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { PolicyRepository } from '../repositories/policy.repository';
import { compileTenantPattern } from './pattern-safety';
import { buildEvidence, RuleMatch } from './evidence';

const logger = createLogger('policy-engine:evaluator');

export class PolicyEvaluator {
  private repo = new PolicyRepository();

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const policies = await this.repo.getPoliciesForTenant(request.tenantId);
    const triggeredRules: string[] = [];
    let riskScore = 0;
    let blocked = false;
    let blockReason = '';

    // Original-case text for pattern rules (e.g. names need capitals); lower-case copy for keyword matching.
    const originalText = request.messages.map((m) => m.content).join(' ');
    const promptText = originalText.toLowerCase();

    let evidence: PolicyEvidence | undefined;

    for (const policy of policies) {
      if (!policy.enabled) continue;

      // Sort rules by priority (lower = higher priority)
      const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

      for (const rule of sortedRules) {
        if (!rule.enabled) continue;
        const match = this.evaluateRule(rule, request, promptText, originalText);

        if (match) {
          triggeredRules.push(rule.ruleId);
          riskScore += 25;

          if (rule.action === 'block') {
            blocked = true;
            blockReason = rule.description;
            evidence = buildEvidence(rule.ruleId, rule.type, originalText, match);
            logger.info('Request blocked by rule', {
              ruleId: rule.ruleId,
              tenantId: request.tenantId,
              requestId: request.requestId,
            });
            break;
          }
        }
      }
      if (blocked) break;
    }

    return {
      allowed: !blocked,
      action: blocked ? 'block' : 'allow',
      triggeredRules,
      riskScore: Math.min(riskScore, 100),
      reason: blocked ? blockReason : undefined,
      ...(evidence ? { evidence } : {}),
    };
  }

  /** Where the rule matched, or null if it didn't. */
  private evaluateRule(
    rule: PolicyRule,
    request: NormalizedAIRequest,
    promptText: string,
    originalText: string
  ): RuleMatch | null {
    const firstMatch = (re: RegExp, label?: string): RuleMatch | null => {
      const m = re.exec(originalText);
      return m ? { kind: 'text', index: m.index, length: m[0].length, label } : null;
    };

    switch (rule.type) {
      case 'keyword_block': {
        const keywords = (rule.config.keywords as string[]) || [];
        for (const kw of keywords) {
          const index = promptText.indexOf(kw.toLowerCase());
          if (kw && index >= 0) return { kind: 'text', index, length: kw.length };
        }
        return null;
      }
      case 'model_restriction': {
        const allowedModels = (rule.config.allowedModels as string[]) || [];
        return allowedModels.length > 0 && !allowedModels.includes(request.modelId)
          ? { kind: 'field', field: 'model', value: request.modelId }
          : null;
      }
      case 'data_classification': {
        const forbiddenPatterns = (rule.config.patterns as string[]) || [];
        for (const p of forbiddenPatterns) {
          const re = compileTenantPattern(p);
          if (!re) {
            logger.warn('Skipping unsafe or invalid pattern', { ruleId: rule.ruleId, tenantId: request.tenantId });
            continue;
          }
          const match = firstMatch(new RegExp(re.source, re.flags));
          if (match) return match;
        }
        return null;
      }
      case 'pii_detection': {
        const typePatterns: Record<string, RegExp> = {
          EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
          SSN: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,
          PHONE: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/,
          CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
          NAME: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/,
          DATE_OF_BIRTH: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
          MEDICAL_RECORD_NUMBER: /\bMRN[:\s]*\d{6,}\b/i,
        };
        const configured = (rule.config.piiTypes as string[]) || [];
        // Default set when no specific types are configured
        const types = configured.length > 0 ? configured : ['EMAIL', 'SSN', 'PHONE', 'CREDIT_CARD'];
        for (const t of types) {
          const re = typePatterns[t];
          const match = re ? firstMatch(re, t.replace(/_/g, ' ')) : null;
          if (match) return match;
        }
        return null;
      }
      case 'rate_limit': {
        // Rate limiting is handled at the Fastify level — this is a pass-through
        return null;
      }
      default:
        return null;
    }
  }
}
