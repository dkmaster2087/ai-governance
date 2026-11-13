import { allPages, collection } from '@ai-governance/storage';
import { AiServiceData, Category, CatalogAdvisory } from '@ai-governance/catalog';

/**
 * The catalog's upkeep in Cloud: what discovery found, what people decided, and the edition published to installs.
 * One partition (`_catalog`) in the catalog table; nothing here belongs to a customer.
 */

const PARTITION = '_catalog';
const table = () => collection<Record<string, any>>('catalog');

export type CandidateStatus = 'new' | 'classified' | 'dismissed' | 'approved' | 'rejected';

/** What the AI classifier thinks a candidate is. A suggestion only: a person decides. */
export interface Suggestion {
  isAiService: boolean;
  confidence: number;
  name: string;
  vendor: string;
  category: Category;
  businessTerms: 'offered' | 'unknown';
  domains: string[];
  summary: string;
  pageTitle?: string;
  model: string;
  at: string;
}

export interface Candidate {
  domain: string;
  status: CandidateStatus;
  sources: Array<{ source: string; title?: string; url?: string; at: string }>;
  hint?: 'model_api' | 'chat';
  firstSeenAt: string;
  lastSeenAt: string;
  suggestion?: Suggestion;
  classifyError?: string;
  classifyTriedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  /** For an approved candidate: the catalog service it became or was added to. */
  serviceId?: string;
}

export interface ReviewedService { service: AiServiceData; by: string; at: string; fromDomain?: string }
export interface AdvisoryRecord { advisory: CatalogAdvisory; by: string; at: string }
export interface Published { document: string; sequence: number; version: string; publishedAt: string; services: number; by: string }
export interface SourceRun { name: string; lastRunAt: string; lastResult: 'ok' | 'error'; found: number; added: number; lastError?: string }

const strip = <T>(r: Record<string, any> | null): T | null => {
  if (!r) return null;
  const { tenantId: _t, recordKey: _k, ...rest } = r;
  return rest as T;
};
const list = async <T>(prefix: string): Promise<T[]> =>
  (await allPages((after) => table().query({ partition: PARTITION, range: { beginsWith: prefix }, after }))).map((r) => strip<T>(r)!);

export const work = {
  candidate: async (domain: string) => strip<Candidate>(await table().get({ tenantId: PARTITION, recordKey: `cand#${domain}` })),
  putCandidate: (c: Candidate) => table().put({ tenantId: PARTITION, recordKey: `cand#${c.domain}`, ...c }),
  candidates: () => list<Candidate>('cand#'),

  services: () => list<ReviewedService>('svc#'),
  putService: (s: ReviewedService) => table().put({ tenantId: PARTITION, recordKey: `svc#${s.service.id}`, ...s }),
  deleteService: (id: string) => table().delete({ tenantId: PARTITION, recordKey: `svc#${id}` }),

  advisories: () => list<AdvisoryRecord>('adv#'),
  putAdvisory: (a: AdvisoryRecord) => table().put({ tenantId: PARTITION, recordKey: `adv#${a.advisory.id}`, ...a }),
  deleteAdvisory: (id: string) => table().delete({ tenantId: PARTITION, recordKey: `adv#${id}` }),

  published: async () => strip<Published>(await table().get({ tenantId: PARTITION, recordKey: 'published' })),
  putPublished: (p: Published) => table().put({ tenantId: PARTITION, recordKey: 'published', ...p }),

  runs: () => list<SourceRun>('source#'),
  run: async (name: string) => strip<SourceRun>(await table().get({ tenantId: PARTITION, recordKey: `source#${name}` })),
  putRun: (r: SourceRun) => table().put({ tenantId: PARTITION, recordKey: `source#${r.name}`, ...r }),
};
