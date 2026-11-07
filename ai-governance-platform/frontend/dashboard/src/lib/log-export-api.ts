import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type DestinationKind = 'webhook' | 'splunk_hec' | 'otlp_http';
export type RecordChoice = 'decisions' | 'admin_activity' | 'sign_ins';

export interface Destination {
  destinationId: string;
  name: string;
  kind: DestinationKind;
  recordTypes: RecordChoice[];
  enabled: boolean;
  urlHint: string;
  secretHint?: string;
  headerNames?: string[];
  splunkIndex?: string;
  createdAt: string;
  updatedAt: string;
  deliveredCount: number;
  deadLetterCount: number;
  lastDeliveredAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  retrying?: { count: number; attempts: number; nextAttemptAt: string };
}

export interface DeadLetterSummary {
  entryId: string;
  destinationId: string;
  destinationName: string;
  count: number;
  error: string;
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  keptUntil: string;
  firstRecordAt?: string;
  lastRecordAt?: string;
  types: string[];
}

export interface TestResult { ok: boolean; status?: number; ms: number; message: string }

export interface DestinationInput {
  kind?: DestinationKind;
  name?: string;
  url?: string;
  recordTypes?: RecordChoice[];
  enabled?: boolean;
  token?: string;
  headers?: Array<{ name: string; value: string }>;
  splunkIndex?: string;
}

const id = encodeURIComponent;

export const getLogExport = async () =>
  (await gateway.get<{ destinations: Destination[]; deadLetters: number; maxDestinations: number }>('/v1/log-export')).data;
export const createDestination = async (input: DestinationInput) =>
  (await gateway.post<{ destination: Destination; signingSecret?: string }>('/v1/log-export/destinations', input)).data;
export const updateDestination = async (destinationId: string, input: DestinationInput) =>
  (await gateway.patch<{ destination: Destination }>(`/v1/log-export/destinations/${id(destinationId)}`, input)).data;
export const deleteDestination = async (destinationId: string) => (await gateway.delete(`/v1/log-export/destinations/${id(destinationId)}`)).data;
export const testDestination = async (destinationId: string) =>
  (await gateway.post<TestResult>(`/v1/log-export/destinations/${id(destinationId)}/test`)).data;
export const rotateSecret = async (destinationId: string) =>
  (await gateway.post<{ destination: Destination; signingSecret: string }>(`/v1/log-export/destinations/${id(destinationId)}/rotate-secret`)).data;
export const listDeadLetters = async () => (await gateway.get<{ items: DeadLetterSummary[] }>('/v1/log-export/dead-letters')).data.items;
export const getDeadLetter = async (entryId: string) => (await gateway.get<Record<string, unknown>>(`/v1/log-export/dead-letters/${id(entryId)}`)).data;
export const retryDeadLetter = async (entryId: string) => (await gateway.post<TestResult>(`/v1/log-export/dead-letters/${id(entryId)}/retry`)).data;
export const discardDeadLetter = async (entryId: string) => (await gateway.delete(`/v1/log-export/dead-letters/${id(entryId)}`)).data;

// ── Activity ──────────────────────────────────────────────────────────────────────────────────────

export interface ActivityItem {
  eventId: string;
  time: string;
  category: 'admin' | 'sign_in';
  action: string;
  outcome: 'success' | 'denied' | 'failure';
  actor: { type: string; id: string; email?: string; role?: string; keyId?: string };
  target?: Record<string, string>;
  requestId?: string;
  sourceIp?: string;
  userAgent?: string;
  detail?: Record<string, string | number | boolean>;
  hash: string;
}

export const listActivity = async (q: { category?: string; outcome?: string; after?: string; limit?: number }) => {
  const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));
  return (await gateway.get<{ items: ActivityItem[]; next?: string; retentionDays: number }>('/v1/activity', { params })).data;
};
