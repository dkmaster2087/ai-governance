import { allPages, collection } from '@ai-governance/storage';
import { McpApi, McpServer, McpTool } from './types';

/** Reads and writes for MCP servers, their APIs and their tools, in the shared storage layer. */
const servers = () => collection<McpServer>('mcpServers');
const apis = () => collection<McpApi>('mcpApis');
const tools = () => collection<McpTool>('mcpTools');

export const mcpStore = {
  listServers: (tenantId: string) => allPages((after) => servers().query({ partition: tenantId, after })),
  getServer: (tenantId: string, serverId: string) => servers().get({ tenantId, serverId }),
  createServer: (s: McpServer) => servers().put(s, { ifNotExists: true }),
  updateServer: (tenantId: string, serverId: string, set: Partial<McpServer>) =>
    servers().update({ tenantId, serverId }, { set: { ...set, updatedAt: new Date().toISOString() } as Record<string, unknown>, ifExists: true }),

  async deleteServer(tenantId: string, serverId: string) {
    for (const t of await this.listTools(tenantId, serverId)) await tools().delete({ tenantId, toolKey: t.toolKey });
    for (const a of await this.listApis(tenantId, serverId)) await apis().delete({ tenantId, apiId: a.apiId });
    await servers().delete({ tenantId, serverId });
  },

  async listApis(tenantId: string, serverId: string) {
    return (await allPages((after) => apis().query({ partition: tenantId, after }))).filter((a) => a.serverId === serverId);
  },
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
  updateTool: (tenantId: string, serverId: string, name: string, set: Partial<McpTool>) =>
    tools().update({ tenantId, toolKey: `${serverId}#${name}` }, { set: set as Record<string, unknown>, ifExists: true }),
};
