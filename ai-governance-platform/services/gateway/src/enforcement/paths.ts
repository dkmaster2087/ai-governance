import { randomBytes } from 'crypto';
import { collection } from '@ai-governance/storage';

/**
 * The paths AI traffic can take around Probaline, each with what the admin says (open, previewing, locked)
 * next to what the collector's findings show (the share through Probaline and who still goes direct). Both are
 * shown side by side, so a lock that wasn't applied, or was undone, is visible.
 */

export type PathId = 'out_model_api' | 'out_cloud_ai' | 'out_browser' | 'in_agents' | 'in_laptop_mcp';
export type PathState = 'open' | 'previewing' | 'locked';
export const PATH_STATES: PathState[] = ['open', 'previewing', 'locked'];

export interface PathDef {
  id: PathId;
  direction: 'out' | 'in';
  title: string;
  /** How it's locked, and where on the page. */
  lock: string;
  anchor?: 'feed' | 'aws' | 'apis' | 'laptops';
  /** Which findings path measures it; absent when the collector doesn't measure it (yet). */
  findingsPath?: 'model_api' | 'cloud_ai';
  /** Said instead of a share when the collector doesn't measure it. */
  measuredElsewhere?: string;
  /** Not built yet: the row says so, and its state can't be set. */
  coming?: boolean;
  /** Measured by the laptop MCP scan in the findings, not a share. */
  laptops?: boolean;
}

export const PATHS: PathDef[] = [
  { id: 'out_model_api', direction: 'out', title: 'Apps calling model APIs over the internet', lock: 'AI-domain feed in your firewall, web gateway or DNS', anchor: 'feed', findingsPath: 'model_api' },
  { id: 'out_cloud_ai', direction: 'out', title: 'Apps in AWS calling Bedrock or SageMaker', lock: 'Service control policy in your AWS organization', anchor: 'aws', findingsPath: 'cloud_ai' },
  { id: 'out_browser', direction: 'out', title: 'People using AI tools in a browser', lock: 'Browser extension blocks unapproved tools', measuredElsewhere: 'Measured by the browser extension on the Shadow AI page.' },
  { id: 'in_agents', direction: 'in', title: 'Agents calling your APIs directly', lock: 'Your APIs accept only calls signed by Probaline', anchor: 'apis',
    measuredElsewhere: 'Measured from your APIs’ access logs: coming next. Until then, the verifier’s report-only log shows calls that didn’t come through Probaline.' },
  { id: 'in_laptop_mcp', direction: 'in', title: 'MCP servers on laptops using people’s own credentials', lock: 'Found by a device-management scan; offered as Probaline MCP servers, local copies removed', anchor: 'laptops', laptops: true },
];

// ── Stored findings files ────────────────────────────────────────────────────────────────────────────────────

export interface StoredCaller { who: string; services: string[]; count: number; fix?: string }
export interface StoredLaptopMcp {
  scannedDevices: number;
  devicesWithServers: number;
  people: number;
  servers: Array<{ what: string; kind: 'local' | 'remote'; devices: number; people: number; withCredentials: number; company: boolean; clients: string[] }>;
}

export interface StoredPath {
  id: string;
  share: number | null;
  through: number;
  direct: number;
  gatewaySeen: boolean;
  measuredBy?: string;
  stillDirectCount: number;
  stillDirect: StoredCaller[];
}
export interface StoredFindings {
  tenantId: string;
  recordKey: string; // findings#<to>#<id>
  findingsId: string;
  from?: string;
  to: string;
  catalogVersion?: string;
  uploadedAt: string;
  uploadedBy?: string;
  fileName?: string;
  services: Array<{ id: string; name: string; category: string; people: number; machines: number; count: number }>;
  cloudAi?: StoredCaller[];
  directApi?: StoredCaller[];
  paths?: StoredPath[];
  laptopMcp?: StoredLaptopMcp;
}

export const FINDINGS_KEEP_DAYS = 400;
export const FINDINGS_MAX = 100;
/** DynamoDB items are at most 400 KB; leave room for keys and attribute names. */
export const FINDINGS_MAX_BYTES = 350_000;

export class FindingsError extends Error {}

const findingsRecords = () => collection<Record<string, any>>('enforcement');

export class FindingsStore {
  /** Newest first (by the day the findings run to, then upload). */
  async list(tenantId: string, limit = FINDINGS_MAX): Promise<StoredFindings[]> {
    const page = await findingsRecords().query({ partition: tenantId, range: { beginsWith: 'findings#' }, order: 'desc', limit });
    return page.items as StoredFindings[];
  }

  async latest(tenantId: string): Promise<StoredFindings | null> {
    return (await this.list(tenantId, 1))[0] ?? null;
  }

  async save(f: Omit<StoredFindings, 'recordKey' | 'findingsId' | 'uploadedAt'>, now = new Date()): Promise<StoredFindings> {
    const findingsId = `fi${now.getTime().toString(36)}${randomBytes(4).toString('hex')}`;
    const item: StoredFindings = { ...f, findingsId, recordKey: `findings#${f.to}#${findingsId}`, uploadedAt: now.toISOString() };
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > FINDINGS_MAX_BYTES) throw new FindingsError(`This findings file is too large to keep (${Math.round(size / 1000)} KB after trimming; the limit is ${FINDINGS_MAX_BYTES / 1000} KB).`);
    await findingsRecords().put(item as unknown as Record<string, any>);
    await this.prune(f.tenantId, now);
    return item;
  }

  async remove(tenantId: string, findingsId: string): Promise<boolean> {
    const found = (await this.list(tenantId)).find((f) => f.findingsId === findingsId);
    if (!found) return false;
    await findingsRecords().delete({ tenantId, recordKey: found.recordKey });
    return true;
  }

  /** Keep 400 days and at most 100 files. */
  private async prune(tenantId: string, now: Date) {
    const all = await this.list(tenantId, FINDINGS_MAX + 20);
    const cutoff = now.getTime() - FINDINGS_KEEP_DAYS * 86_400_000;
    const drop = all.filter((f, i) => i >= FINDINGS_MAX || Date.parse(f.uploadedAt) < cutoff);
    for (const f of drop) await findingsRecords().delete({ tenantId, recordKey: f.recordKey });
  }
}

let shared: FindingsStore | null = null;
export const findingsStore = () => (shared ??= new FindingsStore());

// ── Status per path ──────────────────────────────────────────────────────────────────────────────────────────

export interface PathStateRecord { state: PathState; updatedAt: string; updatedBy?: string }

export interface PathStatus {
  id: PathId;
  direction: 'out' | 'in';
  title: string;
  lock: string;
  anchor?: string;
  coming?: boolean;
  measuredElsewhere?: string;
  state: PathState;
  stateUpdatedAt?: string;
  /** From the latest findings file that measured this path. */
  measured?: {
    to: string;
    share: number | null;
    through: number;
    direct: number;
    gatewaySeen: boolean;
    measuredBy?: string;
    stillDirectCount: number;
    stillDirect: StoredCaller[];
  };
  /** For the laptop path: what the latest scan in the findings found. */
  laptops?: StoredLaptopMcp & { to: string };
  /** Oldest first, from stored findings files that saw the gateway on this path. */
  trend: Array<{ to: string; share: number }>;
  /**
   * What the admin says and what the logs show disagree: marked locked but traffic still goes direct in
   * findings newer than the lock, or locked with no findings since.
   */
  warning?: string;
}

export const TREND_POINTS = 12;

export function pathStatus(states: Partial<Record<PathId, PathStateRecord>>, findings: StoredFindings[]): PathStatus[] {
  return PATHS.map((def) => {
    const st = states[def.id];
    const state: PathState = def.coming ? 'open' : st?.state ?? 'open';
    const row: PathStatus = {
      id: def.id, direction: def.direction, title: def.title, lock: def.lock,
      ...(def.anchor ? { anchor: def.anchor } : {}),
      ...(def.coming ? { coming: true } : {}),
      ...(def.measuredElsewhere ? { measuredElsewhere: def.measuredElsewhere } : {}),
      state, ...(st && !def.coming ? { stateUpdatedAt: st.updatedAt } : {}),
      trend: [],
    };
    if (def.laptops) {
      const latest = findings.find((f) => f.laptopMcp);
      if (latest) row.laptops = { ...latest.laptopMcp!, servers: latest.laptopMcp!.servers.slice(0, 10), to: latest.to };
      if (state === 'locked' && st) {
        const after = findings.filter((f) => f.laptopMcp && f.to >= st.updatedAt.slice(0, 10));
        if (after.length === 0) row.warning = 'Marked locked, but no laptop scan since. Upload findings that include a scan to confirm it holds.';
        else if (after[0].laptopMcp!.devicesWithServers > 0) {
          const n = after[0].laptopMcp!.devicesWithServers;
          row.warning = `Marked locked, but ${n} ${n === 1 ? 'laptop still has' : 'laptops still have'} MCP servers set up by hand in the scan to ${after[0].to}.`;
        }
      }
      return row;
    }
    if (!def.findingsPath) return row;

    const withPath = findings
      .map((f) => ({ f, p: f.paths?.find((p) => p.id === def.findingsPath) }))
      .filter((x): x is { f: StoredFindings; p: StoredPath } => !!x.p);
    const latest = withPath[0];
    if (latest) {
      row.measured = {
        to: latest.f.to, share: latest.p.share, through: latest.p.through, direct: latest.p.direct, gatewaySeen: latest.p.gatewaySeen,
        measuredBy: latest.p.measuredBy, stillDirectCount: latest.p.stillDirectCount, stillDirect: latest.p.stillDirect.slice(0, 10),
      };
    }
    // One point per day the findings run to: the latest upload for that day wins.
    const byDay = new Map<string, number>();
    for (const { f, p } of withPath) if (p.gatewaySeen && typeof p.share === 'number' && !byDay.has(f.to)) byDay.set(f.to, p.share);
    row.trend = [...byDay.entries()].map(([to, share]) => ({ to, share })).sort((a, b) => a.to.localeCompare(b.to)).slice(-TREND_POINTS);

    if (state === 'locked' && st) {
      const lockedDay = st.updatedAt.slice(0, 10);
      const after = withPath.filter(({ f }) => f.to >= lockedDay);
      if (after.length === 0) row.warning = 'Marked locked, but no findings since. Upload a newer findings file to confirm the lock holds.';
      else if (after[0].p.stillDirectCount > 0) {
        const n = after[0].p.stillDirectCount;
        row.warning = `Marked locked, but ${n} ${n === 1 ? 'caller still goes' : 'callers still go'} direct in findings to ${after[0].f.to}. The lock may not be applied everywhere.`;
      }
    }
    return row;
  });
}

// ── Trimming an uploaded findings file to what's kept ────────────────────────────────────────────────────────

const caller = (c: any, withFix = false): StoredCaller => ({
  who: String(c.who).slice(0, 220),
  services: (Array.isArray(c.services) ? c.services : []).slice(0, 20).map((s: unknown) => String(s).slice(0, 120)),
  count: Number(c.count) || 0,
  ...(withFix && typeof c.fix === 'string' ? { fix: c.fix.slice(0, 300) } : {}),
});

/** Only the fields the page and previews use, capped, so one findings file stays one record. */
export function trimFindings(raw: any): Omit<StoredFindings, 'tenantId' | 'recordKey' | 'findingsId' | 'uploadedAt' | 'uploadedBy' | 'fileName'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.to) || !Array.isArray(raw.services)) {
    throw new FindingsError('This isn’t a collector findings file (reports/findings-<day>.json).');
  }
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    to: raw.to,
    ...(day(raw.from) ? { from: day(raw.from) } : {}),
    ...(typeof raw.catalogVersion === 'string' ? { catalogVersion: raw.catalogVersion.slice(0, 20) } : {}),
    services: raw.services.slice(0, 1000).map((s: any) => ({
      id: String(s.id).slice(0, 80), name: String(s.name).slice(0, 120), category: String(s.category).slice(0, 20),
      people: Number(s.people) || 0, machines: Number(s.machines) || 0, count: Number(s.count) || 0,
    })),
    ...(Array.isArray(raw.cloudAi) ? { cloudAi: raw.cloudAi.slice(0, 200).map((c: any) => caller(c)) } : {}),
    ...(Array.isArray(raw.directApi) ? { directApi: raw.directApi.slice(0, 200).map((c: any) => caller(c)) } : {}),
    ...(Array.isArray(raw.paths) ? {
      paths: raw.paths.slice(0, 10).filter((p: any) => p && typeof p.id === 'string').map((p: any): StoredPath => ({
        id: p.id.slice(0, 20),
        share: typeof p.share === 'number' && p.share >= 0 && p.share <= 1 ? p.share : null,
        through: Number(p.through) || 0,
        direct: Number(p.direct) || 0,
        gatewaySeen: p.gatewaySeen === true,
        ...(typeof p.measuredBy === 'string' ? { measuredBy: p.measuredBy.slice(0, 120) } : {}),
        stillDirectCount: Number(p.stillDirectCount) || (Array.isArray(p.stillDirect) ? p.stillDirect.length : 0),
        stillDirect: (Array.isArray(p.stillDirect) ? p.stillDirect : []).slice(0, 50).map((c: any) => caller(c, true)),
      })),
    } : {}),
    ...(raw.laptopMcp && typeof raw.laptopMcp === 'object' ? {
      laptopMcp: {
        scannedDevices: Number(raw.laptopMcp.scannedDevices) || 0,
        devicesWithServers: Number(raw.laptopMcp.devicesWithServers) || 0,
        people: Number(raw.laptopMcp.people) || 0,
        servers: (Array.isArray(raw.laptopMcp.servers) ? raw.laptopMcp.servers : []).slice(0, 100).map((m: any) => ({
          what: String(m.what).slice(0, 255), kind: m.kind === 'remote' ? 'remote' as const : 'local' as const,
          devices: Number(m.devices) || 0, people: Number(m.people) || 0, withCredentials: Number(m.withCredentials) || 0,
          company: m.company === true, clients: (Array.isArray(m.clients) ? m.clients : []).slice(0, 10).map((c: unknown) => String(c).slice(0, 30)),
        })),
      },
    } : {}),
  };
}
