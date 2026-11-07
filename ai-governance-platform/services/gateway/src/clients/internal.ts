import { INTERNAL_HEADER, internalHttpsAgent, signInternal, signingKeyFromEnv } from '@ai-governance/utils';

/** Presents the gateway's certificate on internal calls (mutual TLS), when configured. */
export { internalHttpsAgent };

/**
 * Headers for a call to one of Probaline's internal services, on behalf of one company. The service
 * checks the signature and refuses anything about another company.
 */
export function signedFor(audience: 'policy-engine' | 'data-protection', tenantId: string, userId = 'gateway'): Record<string, string> {
  return { [INTERNAL_HEADER]: signInternal({ tenantId, userId: userId || 'gateway', role: 'gateway' }, signingKeyFromEnv(), audience) };
}
