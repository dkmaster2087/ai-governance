import { NormalizedAIRequest, PolicyEvaluationResult, PolicyEvidence, PolicyRule } from '@ai-governance/types';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { PolicyRepository } from '../repositories/policy.repository';
import { compileTenantPattern } from './pattern-safety';
import { buildEvidence, RuleMatch } from './evidence';
import { findPhi, findPii } from './detectors';

const logger = createLogger('policy-engine:evaluator');

/** Rule types this engine checks on every request. Others are recorded only (the platform or people cover them). */
export const ENFORCED_TYPES = ['keyword_block', 'model_restriction', 'data_classification', 'pii_detection', 'rate_limit'] as const;

export class PolicyEvaluator {
  private repo = new PolicyRepository();
  private modelCache = new Map<string, { models: Set<string>; until: number }>();

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const policies = await this.repo.getPoliciesForTenant(request.tenantId);
    const triggeredRules: string[] = [];
    let riskScore = 0;
    let evidence: PolicyEvidence | undefined;

    // Original-case text for pattern rules (e.g. names need capitals); lower-case copy for keyword matching.
    const originalText = request.messages.map((m) => m.content).join(' ');
    const promptText = originalText.toLowerCase();

    // Every switched-on rule of every switched-on policy, in priority order (lower first) across policies.
    const rules = policies
      .filter((p) => p.enabled)
      .flatMap((p, policyIndex) => p.rules.filter((r) => r.enabled).map((r, ruleIndex) => ({ r, policyIndex, ruleIndex })))
      .sort((a, b) => a.r.priority - b.r.priority || a.policyIndex - b.policyIndex || a.ruleIndex - b.ruleIndex)
      .map((x) => x.r);

    for (const rule of rules) {
      const match = await this.evaluateRule(rule, request, promptText, originalText);
      if (!match) continue;
      triggeredRules.push(rule.ruleId);
      riskScore += 25;
      if (rule.action === 'block') {
        evidence = buildEvidence(rule.ruleId, rule.type, originalText, match);
        logger.info('Request blocked by rule', { ruleId: rule.ruleId, tenantId: request.tenantId, requestId: request.requestId });
        return {
          allowed: false, action: 'block', triggeredRules, riskScore: Math.min(riskScore, 100), reason: rule.description, evidence,
        };
      }
    }

    return { allowed: true, action: 'allow', triggeredRules, riskScore: Math.min(riskScore, 100) };
  }

  /** The models a company has added (Models page), for "only approved models" rules. */
  private async configuredModels(tenantId: string): Promise<Set<string>> {
    const hit = this.modelCache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.models;
    const page = await collection<{ modelId: string; status?: string }>('models').query({ partition: tenantId, limit: 500 });
    const models = new Set(page.items.filter((m) => m.status !== 'inactive').map((m) => m.modelId));
    this.modelCache.set(tenantId, { models, until: Date.now() + 60_000 });
    return models;
  }

  /** Count this request against the company's per-minute and per-day limits; shared by every engine instance. */
  private async overLimit(rule: PolicyRule, tenantId: string): Promise<RuleMatch | null> {
    const perMinute = Number(rule.config.requestsPerMinute) || 0;
    const perDay = Number(rule.config.requestsPerDay) || 0;
    if (!perMinute && !perDay) return null;
    const now = new Date();
    const counters = collection<{ tenantId: string; period: string; count?: number }>('metrics');
    const bump = async (period: string, ttlSeconds: number) => (await counters.update({ tenantId, period }, {
      increment: { count: 1 }, set: { ttl: Math.floor(now.getTime() / 1000) + ttlSeconds },
    }))?.count ?? 0;
    try {
      const [minute, day] = await Promise.all([
        perMinute ? bump(`ratelimit#${rule.ruleId}#m#${now.toISOString().slice(0, 16)}`, 180) : 0,
        perDay ? bump(`ratelimit#${rule.ruleId}#d#${now.toISOString().slice(0, 10)}`, 2 * 86_400) : 0,
      ]);
      if (perMinute && minute > perMinute) return { kind: 'field', field: 'requests this minute', value: `${minute} (limit ${perMinute})` };
      if (perDay && day > perDay) return { kind: 'field', field: 'requests today', value: `${day} (limit ${perDay})` };
    } catch (err) {
      // A counter that can't be read never stops traffic on its own.
      logger.warn('Rate limit counters unavailable', { tenantId, error: (err as Error).message });
    }
    return null;
  }

  /** Where the rule matched, or null if it didn't. */
  private async evaluateRule(rule: PolicyRule, request: NormalizedAIRequest, promptText: string, originalText: string): Promise<RuleMatch | null> {
    const isToolCall = request.metadata?.kind === 'mcp_tool_call';
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
        // Tool calls through MCP servers aren't model traffic: model rules don't apply to them.
        if (isToolCall) return null;
        if (rule.config.onlyConfiguredModels) {
          const models = await this.configuredModels(request.tenantId);
          // A company that hasn't added any model yet can't be judged against an empty list.
          return models.size > 0 && !models.has(request.modelId) ? { kind: 'field', field: 'model', value: request.modelId } : null;
        }
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
          const m = new RegExp(re.source, re.flags).exec(originalText);
          if (m) return { kind: 'text', index: m.index, length: m[0].length };
        }
        return null;
      }
      case 'pii_detection':
        return rule.config.phi ? findPhi(originalText) : findPii(originalText, (rule.config.piiTypes as string[]) || []);
      case 'rate_limit':
        return this.overLimit(rule, request.tenantId);
      default:
        return null;
    }
  }
}
