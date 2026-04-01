import { NormalizedAIRequest, PolicyEvaluationResult, PolicyRule } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { PolicyRepository } from '../repositories/policy.repository';

const logger = createLogger('policy-engine:evaluator');

export class PolicyEvaluator {
  private repo = new PolicyRepository();

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const policies = await this.repo.getPoliciesForTenant(request.tenantId);
    const triggeredRules: string[] = [];
    let riskScore = 0;
    let blocked = false;
    let blockReason = '';

    const promptText = request.messages.map((m) => m.content).join(' ').toLowerCase();

    for (const policy of policies) {
      if (!policy.enabled) continue;

      // Sort rules by priority (lower = higher priority)
      const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

      for (const rule of sortedRules) {
        if (!rule.enabled) continue;
        const triggered = await this.evaluateRule(rule, request, promptText);

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
    promptText: string
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
        return forbiddenPatterns.some((p) => new RegExp(p, 'i').test(promptText));
      }
      default:
        return false;
    }
  }
}
