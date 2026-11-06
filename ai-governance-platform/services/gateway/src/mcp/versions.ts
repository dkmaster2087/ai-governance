import { mcpStore, pad } from './store';
import { configOf, McpApi, McpServer, McpTool, McpVersion, ServerConfig, withDefaults } from './types';

/**
 * Draft and published. Admins change a server's draft; publishing copies it into a numbered version that
 * agents then see, all at once. Versions never change, so each gateway instance can keep them in memory.
 */

export interface Live { config: ServerConfig; apis: McpApi[]; tools: McpTool[]; version?: number }

const cache = new Map<string, Live>();
const remember = (key: string, live: Live) => {
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, live);
  return live;
};

/** What agents see: the published version (or, for servers published before versions existed, the draft). */
export async function liveConfig(server: McpServer): Promise<Live> {
  const n = server.publishedVersion;
  if (!n) {
    const [apis, tools] = await Promise.all([mcpStore.listApis(server.tenantId, server.serverId), mcpStore.listTools(server.tenantId, server.serverId)]);
    return { config: configOf(withDefaults(server)), apis, tools };
  }
  // createdAt too: a server deleted and created again under the same name starts from version 1.
  const key = `${server.tenantId}/${server.serverId}/${server.createdAt}/${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [v, tools] = await Promise.all([mcpStore.getVersion(server.tenantId, server.serverId, n), mcpStore.versionTools(server.tenantId, server.serverId, n)]);
  if (!v) throw new Error(`Version ${n} of ${server.serverId} is missing`);
  return remember(key, { config: withDefaults(v.config), apis: v.apis, tools, version: n });
}

export async function publishVersion(server: McpServer, by: string, note: string): Promise<McpVersion> {
  const { tenantId, serverId } = server;
  const [apis, tools, existing] = await Promise.all([
    mcpStore.listApis(tenantId, serverId), mcpStore.listTools(tenantId, serverId), mcpStore.listVersions(tenantId, serverId),
  ]);
  let n = Math.max(server.publishedVersion ?? 0, ...existing.map((v) => v.version)) + 1;
  const make = (version: number): McpVersion => ({
    tenantId, versionKey: `${serverId}#v${pad(version)}`, serverId, version, note: note.slice(0, 200),
    publishedAt: new Date().toISOString(), publishedBy: by, config: configOf(withDefaults(server)), apis, toolCount: tools.length,
  });
  // Claim the number first; tools are written before the server points at the version.
  while (!(await mcpStore.claimVersion(make(n)))) n++;
  for (const t of tools) await mcpStore.putVersionTool(n, t);
  await mcpStore.updateServer(tenantId, serverId, { status: 'published', publishedAt: new Date().toISOString(), publishedVersion: n, hasChanges: false });
  return make(n);
}

/** Make an earlier version the draft again (publish it to put it live). */
export async function restoreVersion(server: McpServer, n: number): Promise<boolean> {
  const { tenantId, serverId } = server;
  const v = await mcpStore.getVersion(tenantId, serverId, n);
  if (!v) return false;
  const tools = await mcpStore.versionTools(tenantId, serverId, n);
  const [draftApis, draftTools] = await Promise.all([mcpStore.listApis(tenantId, serverId), mcpStore.listTools(tenantId, serverId)]);
  const keepTools = new Set(tools.map((t) => t.toolKey));
  for (const t of draftTools) if (!keepTools.has(t.toolKey)) await mcpStore.deleteTool(tenantId, t.toolKey);
  const keepApis = new Set(v.apis.map((a) => a.apiId));
  for (const a of draftApis) if (!keepApis.has(a.apiId)) await mcpStore.deleteApi(tenantId, a);
  for (const a of v.apis) await mcpStore.putApi(a);
  for (const t of tools) await mcpStore.putTool(t);
  await mcpStore.updateServer(tenantId, serverId, { ...v.config, hasChanges: true });
  return true;
}

/** Every credential any version or the draft of this server still uses. */
export async function credentialsInUse(server: McpServer): Promise<string[]> {
  const arns = new Set<string>();
  const add = (a: McpApi) => { if (a.auth.type !== 'none' && a.auth.secretArn) arns.add(a.auth.secretArn); };
  (await mcpStore.listApis(server.tenantId, server.serverId)).forEach(add);
  for (const v of await mcpStore.listVersions(server.tenantId, server.serverId)) v.apis.forEach(add);
  return [...arns];
}
