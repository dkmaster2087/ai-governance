import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type Category = 'chat' | 'model_api' | 'coding' | 'cloud_ai' | 'work_app';
export type CandidateStatus = 'new' | 'classified' | 'dismissed' | 'approved' | 'rejected';

/** Mirrors services/gateway/src/catalog/discovery/catalog-work.ts. */
export interface Suggestion {
  isAiService: boolean; confidence: number; name: string; vendor: string; category: Category;
  businessTerms: 'offered' | 'unknown'; domains: string[]; summary: string; pageTitle?: string; model: string; at: string;
}
export interface Candidate {
  domain: string; status: CandidateStatus; hint?: 'model_api' | 'chat';
  sources: Array<{ source: string; title?: string; url?: string; at: string }>;
  firstSeenAt: string; lastSeenAt: string; suggestion?: Suggestion; classifyError?: string;
  decidedBy?: string; decidedAt?: string; note?: string; serviceId?: string;
}
export interface ServiceData {
  id: string; name: string; vendor: string; category: Category; businessTerms: 'offered' | 'unknown'; domains: string[];
  appNames?: string[]; url?: string; patterns?: string[]; subdomainsOf?: string[]; aliases?: string[];
}
export interface Advisory { id: string; serviceId: string; severity: 'info' | 'warning' | 'critical'; title: string; detail: string; publishedAt: string; url?: string }

export interface CatalogReview {
  published: { version: string; sequence: number; publishedAt: string; services: number; by: string } | null;
  unpublished: { added: string[]; changed: string[]; removed: string[]; advisories: boolean; any: boolean };
  services: Array<{ service: ServiceData; by: string; at: string; fromDomain?: string }>;
  advisories: Array<{ advisory: Advisory; by: string; at: string }>;
  candidates: Record<CandidateStatus, number>;
  discovery: boolean;
  classifier: boolean;
  sources: Array<{ name: string; label: string; everyMinutes: number; lastRunAt?: string; lastResult?: 'ok' | 'error'; found?: number; added?: number; lastError?: string }>;
}

const base = '/v1/platform/catalog';
export const fetchCatalogReview = async () => (await gateway.get<CatalogReview>(base)).data;
export const fetchCandidates = async (status: 'review' | CandidateStatus) => (await gateway.get<Candidate[]>(`${base}/candidates`, { params: { status } })).data;
export const suggestDomain = async (domain: string, note?: string) => (await gateway.post<Candidate>(`${base}/candidates`, { domain, ...(note ? { note } : {}) })).data;
const enc = encodeURIComponent;
export const classifyCandidate = async (domain: string) => (await gateway.post<Candidate>(`${base}/candidates/${enc(domain)}/classify`, {})).data;
export const approveCandidate = async (domain: string, body: { service: ServiceData } | { addTo: string; domains: string[] }) =>
  (await gateway.post<{ candidate: Candidate; service: ServiceData }>(`${base}/candidates/${enc(domain)}/approve`, body)).data;
export const rejectCandidate = async (domain: string, note?: string) => (await gateway.post<Candidate>(`${base}/candidates/${enc(domain)}/reject`, note ? { note } : {})).data;
export const restoreCandidate = async (domain: string) => (await gateway.post<Candidate>(`${base}/candidates/${enc(domain)}/restore`, {})).data;
export const removeService = async (id: string) => (await gateway.delete(`${base}/services/${enc(id)}`)).data;
export const addAdvisory = async (a: Omit<Advisory, 'id' | 'publishedAt'>) => (await gateway.post<Advisory>(`${base}/advisories`, a)).data;
export const removeAdvisory = async (id: string) => (await gateway.delete(`${base}/advisories/${enc(id)}`)).data;
export const discoverNow = async () => (await gateway.post(`${base}/discover`, {})).data;
export const publishCatalog = async () => (await gateway.post<{ version: string; services: number }>(`${base}/publish`, {})).data;
