import { McpTool, ServerConfig } from './types';
import type { Caller } from './calls';

/** Who may use a server and which of its tools they get. */

const inGroups = (mine: string[] | undefined, wanted: string[]) => {
  const have = new Set((mine ?? []).map((g) => g.toLowerCase()));
  return wanted.some((g) => have.has(g.toLowerCase()));
};

/** null when allowed; otherwise why not. */
export function connectRefusal(config: ServerConfig, caller: Caller): string | null {
  if (caller.kind === 'api_key') {
    return config.access.allKeys || config.access.keyIds.includes(caller.id) ? null : 'This API key may not use this MCP server';
  }
  if (caller.kind === 'person') {
    if (config.access.people === 'all') return null;
    if (config.access.people === 'groups' && inGroups(caller.groups, config.access.groups)) return null;
    return 'You don\'t have access to this MCP server. Ask your administrator to add you or one of your groups.';
  }
  return null; // admins testing in the dashboard
}

/** The tools this caller gets: switched on, and, for tools limited to groups, only people in those groups. */
export function toolsFor(tools: McpTool[], caller: Caller): McpTool[] {
  return tools.filter((t) => t.enabled && (!t.groups?.length || caller.kind === 'test' || (caller.kind === 'person' && inGroups(caller.groups, t.groups))));
}
