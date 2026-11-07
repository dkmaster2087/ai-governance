import { INTERNAL_HEADER, internalKeyFromEnv, signInternal } from '@ai-governance/utils';

/**
 * Headers for a call to one of Probaline's internal services, on behalf of one company. The service
 * checks the signature and refuses anything about another company.
 */
export function signedFor(audience: 'policy-engine' | 'data-protection', tenantId: string, userId = 'gateway'): Record<string, string> {
  return { [INTERNAL_HEADER]: signInternal({ tenantId, userId: userId || 'gateway', role: 'gateway' }, internalKeyFromEnv(), audience) };
}
