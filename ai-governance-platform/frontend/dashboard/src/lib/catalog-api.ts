import { createApiClient } from './http';

const gateway = createApiClient('/api');

/** Mirrors CatalogState in services/gateway/src/catalog/catalog-updater.ts. */
export interface CatalogState {
  sequence: number;
  version: string;
  publishedAt: string;
  source: 'built-in' | 'feed' | 'upload';
  services: number;
  advisories: Array<{ id: string; serviceId: string; severity: 'info' | 'warning' | 'critical'; title: string; detail: string; publishedAt: string; url?: string }>;
  updates: 'auto' | 'off';
  url: string;
  lastCheckedAt?: string;
  lastResult?: 'updated' | 'unchanged' | 'not-newer' | 'error';
  lastError?: string;
  lastSuccessAt?: string;
}

export interface CatalogOutcome {
  result: 'updated' | 'unchanged' | 'not-newer' | 'error';
  message: string;
  catalog: CatalogState;
}

export const fetchCatalog = async () => (await gateway.get<CatalogState>('/v1/catalog')).data;
export const checkCatalog = async () => (await gateway.post<CatalogOutcome>('/v1/catalog/check', {})).data;
export const uploadCatalog = async (document: string) => (await gateway.post<CatalogOutcome>('/v1/catalog/upload', { document })).data;
