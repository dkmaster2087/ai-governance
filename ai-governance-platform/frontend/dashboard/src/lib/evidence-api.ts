import { createApiClient } from './http';
import { RangeKey, rangeStart } from './gateway-api';

const gateway = createApiClient('/api');

export type Outcome = 'stopped' | 'cleaned' | 'delivered';

export interface EvidenceListItem {
  requestId: string;
  time: string;
  outcome: Outcome;
  app: string;
  user: string;
  model: string;
  reason?: string;
}

export interface EvidenceList {
  items: EvidenceListItem[];
  total: number;
  nextOffset: number | null;
  truncated: boolean;
}

/** Mirrors EvidenceRecord in services/gateway/src/services/evidence.ts. */
export interface EvidenceRecord {
  requestId: string;
  outcome: Outcome;
  headline: string;
  time: string;
  app: string;
  user: string;
  provider: string;
  model: string;
  reason?: string;
  excerpt?: { before: string; hit: string; after: string };
  steps: Array<{ label: string; detail: string; kind: 'neutral' | 'stopped' | 'cleaned' | 'skipped' | 'delivered' }>;
  proof: { promptFingerprint: string; responseFingerprint?: string; recordedAt: string; keptUntil: string; triggeredRules: string[] };
  usage?: { inputTokens: number; outputTokens: number; estimatedCost: number; latencyMs: number };
}

export async function fetchEvidence(range: RangeKey, outcome: Outcome | 'all', q: string, offset: number): Promise<EvidenceList> {
  const to = new Date();
  const { data } = await gateway.get<EvidenceList>('/v1/evidence', {
    params: { from: rangeStart(range, to).toISOString(), to: to.toISOString(), outcome, q: q || undefined, offset, limit: 50 },
  });
  return data;
}

export async function fetchEvidenceRecord(requestId: string): Promise<EvidenceRecord> {
  return (await gateway.get<EvidenceRecord>(`/v1/evidence/${encodeURIComponent(requestId)}`)).data;
}

/** Download the case file. Goes through the API client so the request carries the user's credentials. */
export async function downloadEvidence(requestId: string): Promise<void> {
  const res = await gateway.get<Blob>(`/v1/evidence/${encodeURIComponent(requestId)}/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aegis-evidence-${requestId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
