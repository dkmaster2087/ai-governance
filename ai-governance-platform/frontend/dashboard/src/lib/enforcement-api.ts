import { createApiClient } from './http';

const gateway = createApiClient('/api');

/** Mirrors services/gateway/src/routes/enforcement.routes.ts. */
export type FeedCategory = 'model_api' | 'chat' | 'coding' | 'cloud_ai' | 'work_app';
export type FeedFormat = 'domains' | 'zscaler' | 'netskope' | 'rpz' | 'hosts';

export interface Feed {
  feedId: string;
  name: string;
  categories: FeedCategory[];
  tokenHint: string;
  domains: number;
  createdAt: string;
  updatedAt: string;
  lastFetchedAt?: string;
  lastFetchedFrom?: string;
  lastFetchedFormat?: string;
  lastFetchedAgent?: string;
  fetchCount: number;
}

export interface FormatGuide { id: FeedFormat; label: string; products: string; rule: string }

export interface AwsSettings { gatewayRoleArn: string; breakGlassRoleArn?: string; targetIds?: string[]; sagemaker?: boolean }

export interface Enforcement {
  catalogVersion: string;
  egressIps: string[];
  categories: Array<{ id: FeedCategory; label: string; hint: string }>;
  defaultCategories: FeedCategory[];
  formats: FormatGuide[];
  feeds: Feed[];
  maxFeeds: number;
  approvedTools: string[];
  aws: AwsSettings;
}

export interface Blocked { who: string; services: string[]; count: number; identityKnown?: boolean }

export interface FeedPreview {
  domains: number;
  sample: string[];
  findingsTo?: string;
  wouldBeBlocked?: { services: Array<{ id: string; name: string; people: number; machines: number; count: number }>; apps: Blocked[] };
}

export interface AwsLock {
  serviceControlPolicy: object;
  vpcEndpointPolicy: object;
  cloudFormation: object;
  problems: string[];
  notes: string[];
  wouldBeBlocked?: Blocked[];
  findingsTo?: string;
}

export type NewFeedUrls = { feedId: string; urls: Record<FeedFormat, string> };

/** A collector findings file, as read in the browser. It's sent with previews and never stored. */
export type Findings = Record<string, unknown> & { to?: string };

export async function getEnforcement(): Promise<Enforcement> {
  return (await gateway.get<Enforcement>('/v1/enforcement')).data;
}

export async function createFeed(body: { name: string; categories: FeedCategory[] }): Promise<NewFeedUrls & { feed: Feed }> {
  return (await gateway.post('/v1/enforcement/feeds', body)).data;
}

export async function updateFeed(feedId: string, body: { name?: string; categories?: FeedCategory[] }): Promise<{ feed: Feed }> {
  return (await gateway.patch(`/v1/enforcement/feeds/${feedId}`, body)).data;
}

export async function rotateFeed(feedId: string): Promise<NewFeedUrls & { feed: Feed }> {
  return (await gateway.post(`/v1/enforcement/feeds/${feedId}/rotate`)).data;
}

export async function revokeFeed(feedId: string): Promise<void> {
  await gateway.delete(`/v1/enforcement/feeds/${feedId}`);
}

export async function feedContent(feedId: string, format: FeedFormat): Promise<string> {
  return (await gateway.get<string>(`/v1/enforcement/feeds/${feedId}/content/${format}`, { responseType: 'text', transformResponse: (d) => d })).data;
}

export async function previewFeed(categories: FeedCategory[], findings?: Findings): Promise<FeedPreview> {
  return (await gateway.post('/v1/enforcement/feeds/preview', { categories, ...(findings ? { findings } : {}) })).data;
}

export async function saveAws(settings: AwsSettings): Promise<void> {
  await gateway.put('/v1/enforcement/aws', settings);
}

export async function generateAws(settings: AwsSettings, findings?: Findings): Promise<AwsLock> {
  return (await gateway.post('/v1/enforcement/aws/generate', { ...settings, ...(findings ? { findings } : {}) })).data;
}

/** Only the fields previews read, so a large findings file stays a small request. */
export function slimFindings(raw: unknown): Findings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This isn’t a findings file.');
  const f = raw as Record<string, any>;
  if (!Array.isArray(f.services) || typeof f.to !== 'string') throw new Error('This isn’t a collector findings file (reports/findings-<day>.json).');
  const caller = (c: any) => ({ who: String(c.who), services: (c.services ?? []).map(String), count: Number(c.count) || 0 });
  return {
    to: f.to,
    catalogVersion: typeof f.catalogVersion === 'string' ? f.catalogVersion : undefined,
    services: f.services.map((s: any) => ({ id: String(s.id), name: String(s.name), category: String(s.category), people: Number(s.people) || 0, machines: Number(s.machines) || 0, count: Number(s.count) || 0 })),
    ...(Array.isArray(f.cloudAi) ? { cloudAi: f.cloudAi.map(caller) } : {}),
    ...(Array.isArray(f.directApi) ? { directApi: f.directApi.map(caller) } : {}),
    ...(Array.isArray(f.paths) ? { paths: f.paths.map((p: any) => ({ id: String(p.id), stillDirect: (p.stillDirect ?? []).map(caller) })) } : {}),
  };
}
