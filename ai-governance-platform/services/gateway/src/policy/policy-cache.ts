import { Policy } from '@ai-governance/types';
import { HotCache, hotCacheTtlMs } from '../services/hot-cache';

/**
 * Each gateway copy's cached rules for the request path (read by the evaluator), so every AI request doesn't read
 * them again. Changes made on this copy clear it at once; one made on another copy is seen within HOT_CACHE_TTL_MS.
 */
export const policiesForRequests = new HotCache<Policy[]>(hotCacheTtlMs());

/** Forget a company's cached rules (after a change), or everyone's. */
export const forgetCachedPolicies = (tenantId?: string) => (tenantId ? policiesForRequests.forget(tenantId) : policiesForRequests.clear());
