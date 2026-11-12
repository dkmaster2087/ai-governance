import { ModelConfig } from '@ai-governance/types';
import { HotCache, hotCacheTtlMs } from '../services/hot-cache';

/**
 * Each gateway copy's cached model settings for the request path (which keys may use a model, its answer limit,
 * provider and prices), read three times per AI request without it. Changes made on this copy clear it at once;
 * one made on another copy is seen within HOT_CACHE_TTL_MS. An empty list isn't kept, since a failed read looks
 * the same.
 */
export const modelsForRequests = new HotCache<ModelConfig[]>(hotCacheTtlMs(), 10_000, (list) => list.length > 0);

export const forgetCachedModels = (tenantId?: string) => (tenantId ? modelsForRequests.forget(tenantId) : modelsForRequests.clear());
