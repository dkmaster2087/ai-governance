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

/** `hosted`: the customer is on Probaline's cloud, so no gateway runs in their AWS and none is exempt. */
export interface AwsSettings { mode?: 'gateway' | 'hosted'; gatewayRoleArn?: string; breakGlassRoleArn?: string; targetIds?: string[]; sagemaker?: boolean }

export type PathState = 'open' | 'previewing' | 'locked';
export interface Caller { who: string; services: string[]; count: number; fix?: string }

export interface PathStatus {
  id: string;
  direction: 'out' | 'in';
  title: string;
  lock: string;
  anchor?: 'feed' | 'aws';
  coming?: boolean;
  measuredElsewhere?: string;
  state: PathState;
  stateUpdatedAt?: string;
  measured?: { to: string; share: number | null; through: number; direct: number; gatewaySeen: boolean; measuredBy?: string; stillDirectCount: number; stillDirect: Caller[] };
  trend: Array<{ to: string; share: number }>;
  laptops?: LaptopScan & { to: string };
  warning?: string;
}

export interface LaptopScan {
  scannedDevices: number;
  devicesWithServers: number;
  people: number;
  servers: Array<{ what: string; kind: 'local' | 'remote'; devices: number; people: number; withCredentials: number; company: boolean; clients: string[] }>;
}

export interface LockKitApis {
  issuer: string;
  jwksUrl: string;
  header: string;
  tokenLifetimeSeconds: number;
  egressIps: string[];
  apis: Array<{ apiId: string; name: string; serverId: string; serverName: string; audience: string; connector?: string }>;
}

/** The API list for the collector (hosts and base paths, the gateway's addresses), to match access logs. */
export async function exportApiList(): Promise<string> {
  return JSON.stringify((await gateway.get('/v1/enforcement/apis/export')).data, null, 2);
}

export async function getLockKitApis(): Promise<LockKitApis> {
  return (await gateway.get<LockKitApis>('/v1/enforcement/apis')).data;
}

export interface StoredFindings {
  findingsId: string;
  from?: string;
  to: string;
  catalogVersion?: string;
  uploadedAt: string;
  uploadedBy?: string;
  fileName?: string;
  services: number;
}

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
  paths: PathStatus[];
  findings: StoredFindings[];
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

/** Previews use the latest stored findings file. */
export async function previewFeed(categories: FeedCategory[]): Promise<FeedPreview> {
  return (await gateway.post('/v1/enforcement/feeds/preview', { categories })).data;
}

export async function setPathState(pathId: string, state: PathState): Promise<{ path: PathStatus }> {
  return (await gateway.put(`/v1/enforcement/paths/${pathId}`, { state })).data;
}

export async function uploadFindings(findings: Findings, fileName?: string): Promise<{ findingsId: string }> {
  return (await gateway.post('/v1/enforcement/findings', { findings, ...(fileName ? { fileName } : {}) })).data;
}

export async function deleteFindings(findingsId: string): Promise<void> {
  await gateway.delete(`/v1/enforcement/findings/${findingsId}`);
}

export async function saveAws(settings: AwsSettings): Promise<void> {
  await gateway.put('/v1/enforcement/aws', settings);
}

export async function generateAws(settings: AwsSettings): Promise<AwsLock> {
  return (await gateway.post('/v1/enforcement/aws/generate', settings)).data;
}

/** Only the fields the page and previews use, capped, so a large findings file stays a small request. */
export function slimFindings(raw: unknown): Findings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This isn’t a findings file.');
  const f = raw as Record<string, any>;
  if (!Array.isArray(f.services) || typeof f.to !== 'string') throw new Error('This isn’t a collector findings file (reports/findings-<day>.json).');
  const caller = (c: any) => ({ who: String(c.who), services: (c.services ?? []).map(String), count: Number(c.count) || 0, ...(typeof c.fix === 'string' ? { fix: c.fix } : {}) });
  return {
    to: f.to,
    ...(typeof f.from === 'string' ? { from: f.from } : {}),
    catalogVersion: typeof f.catalogVersion === 'string' ? f.catalogVersion : undefined,
    services: f.services.map((s: any) => ({ id: String(s.id), name: String(s.name), category: String(s.category), people: Number(s.people) || 0, machines: Number(s.machines) || 0, count: Number(s.count) || 0 })),
    ...(Array.isArray(f.cloudAi) ? { cloudAi: f.cloudAi.slice(0, 200).map(caller) } : {}),
    ...(Array.isArray(f.directApi) ? { directApi: f.directApi.slice(0, 200).map(caller) } : {}),
    ...(f.laptopMcp && typeof f.laptopMcp === 'object' ? { laptopMcp: { ...f.laptopMcp, servers: (f.laptopMcp.servers ?? []).slice(0, 100) } } : {}),
    ...(Array.isArray(f.paths) ? {
      paths: f.paths.map((p: any) => ({
        id: String(p.id), share: typeof p.share === 'number' ? p.share : null, through: Number(p.through) || 0, direct: Number(p.direct) || 0,
        gatewaySeen: p.gatewaySeen === true, ...(typeof p.measuredBy === 'string' ? { measuredBy: p.measuredBy } : {}),
        stillDirectCount: Number(p.stillDirectCount) || 0, stillDirect: (p.stillDirect ?? []).slice(0, 50).map(caller),
      })),
    } : {}),
  };
}
