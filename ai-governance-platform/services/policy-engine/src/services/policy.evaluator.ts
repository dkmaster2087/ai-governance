import { NormalizedAIRequest, PolicyEvaluationResult, PolicyRule } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { PolicyRepository } from '../repositories/policy.repository';
import { compileTenantPattern } from './pattern-safety';

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

    for (const policy of policies) {
      if (!policy.enabled) continue;

      // Sort rules by priority (lower = higher priority)
      const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

      for (const rule of sortedRules) {
        if (!rule.enabled) continue;
        const triggered = await this.evaluateRule(rule, request, promptText, originalText);

        if (triggered) {
          triggeredRules.push(rule.ruleId);
          riskScore += 25;

          if (rule.action === 'block') {
            blocked = true;
            blockReason = rule.description;
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
    };
  }

  private async evaluateRule(
    rule: PolicyRule,
    request: NormalizedAIRequest,
    promptText: string,
    originalText: string
  ): Promise<boolean> {
    switch (rule.type) {
      case 'keyword_block': {
        const keywords = (rule.config.keywords as string[]) || [];
        return keywords.some((kw) => promptText.includes(kw.toLowerCase()));
      }
      case 'model_restriction': {
        const allowedModels = (rule.config.allowedModels as string[]) || [];
        return allowedModels.length > 0 && !allowedModels.includes(request.modelId);
      }
      case 'data_classification': {
        const forbiddenPatterns = (rule.config.patterns as string[]) || [];
        return forbiddenPatterns.some((p) => {
          const re = compileTenantPattern(p);
          if (!re) {
            logger.warn('Skipping unsafe or invalid pattern', { ruleId: rule.ruleId, tenantId: request.tenantId });
            return false;
          }
          return re.test(originalText);
        });
      }
      case 'pii_detection': {
        // Detect PII patterns in prompt text
        const piiPatterns = [
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,          // email
          /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,                                // SSN
          /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/,  // phone
          /\b(?:\d{4}[-\s]?){3}\d{4}\b/,                                    // credit card
        ];
        const customPiiTypes = (rule.config.piiTypes as string[]) || [];
        // If specific PII types configured, only check those
        if (customPiiTypes.length > 0) {
          const typePatterns: Record<string, RegExp> = {
            EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i,
            SSN: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,
            PHONE: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/,
            CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
            NAME: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/,
            DATE_OF_BIRTH: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
            MEDICAL_RECORD_NUMBER: /\bMRN[:\s]*\d{6,}\b/i,
          };
          const patterns = customPiiTypes.map((t) => typePatterns[t]).filter(Boolean);
          return patterns.some((p) => p.test(originalText));
        }
        return piiPatterns.some((p) => p.test(originalText));
      }
      case 'rate_limit': {
        // Rate limiting is handled at the Fastify level — this is a pass-through
        return false;
      }
      default:
        return false;
    }
  }
}
