import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { generateRequestId, createLogger } from '@ai-governance/utils';
import { NormalizedAIRequest } from '@ai-governance/types';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { AuditService } from '../services/audit.service';

const logger = createLogger('gateway:proxy');
const policyClient = new PolicyEngineClient();
const auditService = new AuditService();

/** Known AI provider targets — maps a slug to the real base URL */
const PROVIDER_TARGETS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  cohere: 'https://api.cohere.ai',
  mistral: 'https://api.mistral.ai',
};

/** Try to extract messages/prompt from various AI provider request formats */
function extractMessages(body: any): { role: 'user' | 'assistant' | 'system'; content: string }[] {
  // OpenAI / standard format
  if (body?.messages && Array.isArray(body.messages)) {
    return body.messages.map((m: any) => ({ role: (m.role || 'user') as 'user' | 'assistant' | 'system', content: String(m.content || '') }));
  }
  // Anthropic format
  if (body?.prompt) {
    return [{ role: 'user' as const, content: String(body.prompt) }];
  }
  // Single content field
  if (body?.content) {
    return [{ role: 'user' as const, content: String(body.content) }];
  }
  // Cohere format
  if (body?.message) {
    return [{ role: 'user' as const, content: String(body.message) }];
  }
  return [];
}

function extractModel(body: any): string {
  return body?.model || body?.model_id || 'unknown';
}

export async function proxyRoutes(app: FastifyInstance) {

  /**
   * Transparent proxy endpoint.
   * 
   * Usage: POST /v1/proxy/:provider/*
   * Example: POST /v1/proxy/openai/v1/chat/completions
   * 
   * The client sends the exact same request they'd send to the AI provider,
   * but through Aegis. Aegis inspects, governs, logs, and forwards.
   * The client's own Authorization header is forwarded to the provider.
   */
  app.all('/proxy/:provider/*', async (request, reply) => {
    const provider = (request.params as any).provider as string;
    const path = (request.params as any)['*'] as string;
    const targetBase = PROVIDER_TARGETS[provider.toLowerCase()];

    if (!targetBase) {
      return reply.status(400).send({
        error: 'Unknown provider',
        code: 'UNKNOWN_PROVIDER',
        supported: Object.keys(PROVIDER_TARGETS),
      });
    }

    const requestId = generateRequestId();
    const tenantId = request.tenantId;
    const userId = request.userId;
    const body = request.body as any;
    const targetUrl = `${targetBase}/${path}`;

    logger.info('Proxy request', { requestId, tenantId, provider, path: '/' + path, model: extractModel(body) });

    // --- 1. Extract prompt for policy evaluation ---
    const messages = extractMessages(body);
    const modelId = extractModel(body);

    if (messages.length > 0) {
      const normalizedRequest: NormalizedAIRequest = {
        requestId,
        tenantId,
        userId,
        appId: request.appId || 'proxy',
        provider: provider as any,
        modelId,
        messages,
        metadata: { proxyMode: 'true' },
        timestamp: new Date().toISOString(),
      };

      // --- 2. Policy evaluation ---
      const policyResult = await policyClient.evaluate(normalizedRequest);

      if (!policyResult.allowed) {
        logger.info('Proxy request blocked by policy', { requestId, tenantId, reason: policyResult.reason });
        await auditService.log(normalizedRequest, null, policyResult, 0);
        return reply.status(403).send({
          error: policyResult.reason || 'Request blocked by policy',
          code: 'POLICY_VIOLATION',
          requestId,
          triggeredRules: policyResult.triggeredRules,
        });
      }
    }

    // --- 3. Forward to real provider ---
    // Pass through the client's original headers (including their auth)
    const forwardHeaders: Record<string, string> = {};
    const passthroughHeaders = ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta'];
    for (const h of passthroughHeaders) {
      const val = request.headers[h];
      if (val) forwardHeaders[h] = Array.isArray(val) ? val[0] : val;
    }

    const startTime = Date.now();
    try {
      const providerResponse = await axios({
        method: request.method as any,
        url: targetUrl,
        data: body,
        headers: forwardHeaders,
        timeout: 120000,
        validateStatus: () => true, // Don't throw on 4xx/5xx — forward as-is
      });

      const latencyMs = Date.now() - startTime;

      // --- 4. Log to audit ---
      if (messages.length > 0) {
        const inputTokens = providerResponse.data?.usage?.prompt_tokens || 0;
        const outputTokens = providerResponse.data?.usage?.completion_tokens || 0;
        const auditReq: NormalizedAIRequest = {
          requestId, tenantId, userId, appId: request.appId || 'proxy',
          provider: provider as any, modelId, messages,
          metadata: { proxyMode: 'true' }, timestamp: new Date().toISOString(),
        };
        await auditService.log(
          auditReq,
          { requestId, content: '[proxy passthrough]', inputTokens, outputTokens, latencyMs, provider: provider as any, modelId, finishReason: 'stop', timestamp: new Date().toISOString() },
          { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 },
          latencyMs,
        );
      }

      logger.info('Proxy response', { requestId, tenantId, status: providerResponse.status, latencyMs });

      // --- 5. Return provider response to client ---
      return reply
        .status(providerResponse.status)
        .headers({ 'x-aegis-request-id': requestId, 'x-aegis-latency-ms': String(Date.now() - startTime) })
        .send(providerResponse.data);

    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Proxy forward failed', { requestId, tenantId, error: err.message, latencyMs });
      return reply.status(502).send({
        error: 'Failed to reach AI provider',
        code: 'PROXY_ERROR',
        requestId,
        detail: err.message,
      });
    }
  });

  /** List supported proxy providers */
  app.get('/proxy/providers', async () => ({
    providers: Object.keys(PROVIDER_TARGETS),
    usage: 'POST /v1/proxy/:provider/<original-api-path>',
    example: 'POST /v1/proxy/openai/v1/chat/completions',
  }));
}
