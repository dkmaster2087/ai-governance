import { allPages, collection } from '@ai-governance/storage';
import { McpApi, McpServer, McpTool, McpVersion } from './types';

/** Reads and writes for MCP servers, their APIs, tools and published versions, in the shared storage layer. */
const servers = () => collection<McpServer>('mcpServers');
const apis = () => collection<McpApi>('mcpApis');
const tools = () => collection<McpTool>('mcpTools');
/** Version headers (`<serverId>#v000001`) and their tools (`<serverId>#t000001#<name>`) share one collection. */
const versions = () => collection<McpVersion | (McpTool & { versionKey: string })>('mcpVersions');

export const pad = (n: number) => String(n).padStart(6, '0');

export const mcpStore = {
  listServers: (tenantId: string) => allPages((after) => servers().query({ partition: tenantId, after })),
  getServer: (tenantId: string, serverId: string) => servers().get({ tenantId, serverId }),
  createServer: (s: McpServer) => servers().put(s, { ifNotExists: true }),
  updateServer: (tenantId: string, serverId: string, set: Partial<McpServer>, remove: string[] = []) =>
    servers().update({ tenantId, serverId }, { set: { ...set, updatedAt: new Date().toISOString() } as Record<string, unknown>, ...(remove.length ? { remove } : {}), ifExists: true }),

  async deleteServer(tenantId: string, serverId: string) {
    for (const t of await this.listTools(tenantId, serverId)) await tools().delete({ tenantId, toolKey: t.toolKey });
    for (const a of await this.listApis(tenantId, serverId)) await apis().delete({ tenantId, apiId: a.apiId });
    for (const v of await allPages((after) => versions().query({ partition: tenantId, range: { beginsWith: `${serverId}#` }, after }))) {
      await versions().delete({ tenantId, versionKey: (v as { versionKey: string }).versionKey });
    }
    await servers().delete({ tenantId, serverId });
  },

  async listApis(tenantId: string, serverId: string) {
    return (await allPages((after) => apis().query({ partition: tenantId, after }))).filter((a) => a.serverId === serverId);
  },
  listAllApis: (tenantId: string) => allPages((after) => apis().query({ partition: tenantId, after })),
  getApi: (tenantId: string, apiId: string) => apis().get({ tenantId, apiId }),
  putApi: (a: McpApi) => apis().put(a),
  async deleteApi(tenantId: string, api: McpApi) {
    for (const t of await this.listTools(tenantId, api.serverId)) if (t.apiId === api.apiId) await tools().delete({ tenantId, toolKey: t.toolKey });
    await apis().delete({ tenantId, apiId: api.apiId });
  },

  listTools: (tenantId: string, serverId: string) =>
    allPages((after) => tools().query({ partition: tenantId, range: { beginsWith: `${serverId}#` }, after })),
  getTool: (tenantId: string, serverId: string, name: string) => tools().get({ tenantId, toolKey: `${serverId}#${name}` }),
  putTool: (t: McpTool) => tools().put(t),
  deleteTool: (tenantId: string, toolKey: string) => tools().delete({ tenantId, toolKey }),
  updateTool: (tenantId: string, serverId: string, name: string, set: Partial<McpTool>) =>
    tools().update({ tenantId, toolKey: `${serverId}#${name}` }, { set: set as Record<string, unknown>, ifExists: true }),

  async listVersions(tenantId: string, serverId: string): Promise<McpVersion[]> {
    return (await allPages((after) => versions().query({ partition: tenantId, range: { beginsWith: `${serverId}#v` }, order: 'desc', after }))) as McpVersion[];
  },
  getVersion: async (tenantId: string, serverId: string, n: number) => (await versions().get({ tenantId, versionKey: `${serverId}#v${pad(n)}` })) as McpVersion | null,
  /** Claim a version number; false if another publish took it first. */
  claimVersion: (v: McpVersion) => versions().put(v, { ifNotExists: true }),
  putVersion: (v: McpVersion) => versions().put(v),
  putVersionTool: (n: number, t: McpTool) => versions().put({ ...t, versionKey: `${t.serverId}#t${pad(n)}#${t.name}` }),
  async versionTools(tenantId: string, serverId: string, n: number): Promise<McpTool[]> {
    const rows = await allPages((after) => versions().query({ partition: tenantId, range: { beginsWith: `${serverId}#t${pad(n)}#` }, after }));
    return rows.map((r) => { const { versionKey: _k, ...t } = r as McpTool & { versionKey: string }; return t as McpTool; });
  },
};
