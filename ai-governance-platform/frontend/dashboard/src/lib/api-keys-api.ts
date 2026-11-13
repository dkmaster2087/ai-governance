import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type Scope = 'chat' | 'models' | 'shadow_ai:ingest' | 'mcp' | 'guardrails';

export interface ApiKeySummary {
  keyId: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdBy: string;
  /** Daily caps (UTC); absent means none. */
  dailyTokenLimit?: number;
  dailySpendLimitUsd?: number;
}

export interface KeyLimits { dailyTokenLimit?: number; dailySpendLimitUsd?: number }

export const listKeys = async () => (await gateway.get<ApiKeySummary[]>('/v1/api-keys')).data;
export const createKey = async (input: { name: string; scopes: Scope[]; expiresInDays?: number } & KeyLimits) =>
  (await gateway.post<{ keyId: string; key: string }>('/v1/api-keys', input)).data;
/** 0 removes a cap. */
export const setKeyLimits = async (keyId: string, limits: KeyLimits) => (await gateway.patch(`/v1/api-keys/${encodeURIComponent(keyId)}`, limits)).data;
export const revokeKey = async (keyId: string) => (await gateway.post(`/v1/api-keys/${encodeURIComponent(keyId)}/revoke`)).data;
export const rotateKey = async (keyId: string) =>
  (await gateway.post<{ newKeyId: string; key: string }>(`/v1/api-keys/${encodeURIComponent(keyId)}/rotate`)).data;
export const deleteKey = async (keyId: string) => (await gateway.delete(`/v1/api-keys/${encodeURIComponent(keyId)}`)).data;
