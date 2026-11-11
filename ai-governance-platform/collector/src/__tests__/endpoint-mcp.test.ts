import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Pseudonymizer } from '../core/sightings';
import { FileStore } from '../core/store';
import { buildReport, processMcpScan } from '../core/run';
import { buildLaptopMcp, isCompanyHost, isEndpointMcp, parseEndpointMcp } from '../endpoint/mcp';

const KEY = 'a'.repeat(64);
const SCRIPT = path.join(__dirname, '../../endpoint/mcp-scan.sh');
const SECRETS = ['ghp_SECRET1', 'SECRET2', 'pw_SECRET3', 'SECRET4', 'SECRET5', 'SECRET6', 'ghp_lowercasesecretvalue123456', 'secret-path'];

/** A home folder with each client's MCP settings, secrets in every place they could leak from. */
async function fixtureHome(root: string, user: string) {
  const home = path.join(root, user);
  const put = async (rel: string, body: string) => { await fs.mkdir(path.dirname(path.join(home, rel)), { recursive: true }); await fs.writeFile(path.join(home, rel), body); };
  await put('Library/Application Support/Claude/claude_desktop_config.json', JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github', '--token', 'ghp_SECRET1'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'SECRET2' } },
    postgres: { command: '/usr/local/bin/uvx', args: ['mcp-server-postgres', 'postgresql://admin:pw_SECRET3@db.acme.internal/hr'] },
    sneaky: { command: 'npx', args: ['--token', 'ghp_lowercasesecretvalue123456', 'some-mcp-server'] },
  } }));
  await put('.cursor/mcp.json', JSON.stringify({ mcpServers: {
    jira: { url: 'https://user:SECRET4@mcp.atlassian.com/v1/sse?token=SECRET5', headers: { Authorization: 'Bearer SECRET6' } },
    hr: { command: 'docker', args: ['run', '-i', '--rm', '-e', 'API_KEY', 'ghcr.io/acme/hr-mcp:1.2'] },
  } }));
  await put('Library/Application Support/Code/User/settings.json', '{\n  // comments are allowed here\n  "mcp": { "servers": { "acme-hr": { "type": "http", "url": "https://hr.acme.example/mcp/", }, }, },\n}');
  await put('.claude.json', JSON.stringify({ projects: { '/x': { mcpServers: { fs: { command: 'node', args: ['/Users/jdoe/secret-path/server.js'] } } } } }));
  await put('.codeium/windsurf/mcp_config.json', 'not json');
  return home;
}

const line = (o: Record<string, unknown>) => JSON.stringify({ schema: 'probaline.endpoint_mcp/1', time: '2026-11-09T08:00:00Z', ...o });

describe('laptop MCP scan output', () => {
  it('is recognized, and people become pseudonyms', () => {
    const text = [line({ device: 'MBP-Jane', user: 'jane', client: 'cursor', name: 'jira', transport: 'http', urlHost: 'mcp.atlassian.com', credentials: true }), 'junk', line({ kind: 'scan', device: 'MBP-Jane', user: 'jane', clients: ['cursor'] })].join('\n');
    expect(isEndpointMcp(text)).toBe(true);
    expect(isEndpointMcp('{"query_name":"x"}')).toBe(false);
    const rows = parseEndpointMcp(text, new Pseudonymizer(KEY));
    expect(rows).toHaveLength(2);
    expect(rows[0].device).toMatch(/^device-[0-9a-f]{12}$/);
    expect(rows[0]).toMatchObject({ day: '2026-11-09', kind: 'server', urlHost: 'mcp.atlassian.com', credentials: true });
    expect(rows[0].who).toMatch(/^user-[0-9a-f]{12}$/);
    expect(JSON.stringify(rows)).not.toContain('jane');
  });

  it('groups servers across laptops and marks company systems', () => {
    const p = new Pseudonymizer(KEY);
    const rows = parseEndpointMcp([
      line({ device: 'a', user: 'u1', client: 'claude_desktop', name: 'github', transport: 'stdio', command: 'npx', package: '@modelcontextprotocol/server-github', credentials: true }),
      line({ device: 'b', user: 'u2', client: 'cursor', name: 'gh', transport: 'stdio', command: 'npx', package: '@modelcontextprotocol/server-github', credentials: false }),
      line({ device: 'b', user: 'u2', client: 'vscode', name: 'acme-hr', transport: 'http', urlHost: 'hr.acme.example' }),
      line({ device: 'c', user: 'u3', client: 'cursor', name: 'db', transport: 'sse', urlHost: '10.0.4.2' }),
      line({ kind: 'scan', device: 'd', user: 'u4', clients: [] }),
    ].join('\n'), p);
    const m = buildLaptopMcp(rows, ['acme.example'])!;
    expect(m).toMatchObject({ scannedDevices: 4, devicesWithServers: 3, people: 3 });
    expect(m.servers.map((s) => [s.what, s.company])).toEqual([['10.0.4.2', true], ['hr.acme.example', true], ['@modelcontextprotocol/server-github', false]]);
    expect(m.servers[2]).toMatchObject({ devices: 2, withCredentials: 1, names: ['gh', 'github'], clients: ['claude_desktop', 'cursor'] });
    expect(isCompanyHost('mcp.atlassian.com', ['acme.example'])).toBe(false);
    expect(isCompanyHost('db.corp', [])).toBe(true);
  });
});

const onMac = process.platform === 'darwin' ? describe : describe.skip;

onMac('mcp-scan.sh on a Mac', () => {
  let root: string;
  beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-mcp-')); });

  it('reads every client’s settings and never prints a secret', async () => {
    const home = await fixtureHome(root, 'jdoe');
    const { stdout } = await promisify(execFile)('sh', [SCRIPT, '--home', home]);
    for (const s of SECRETS) expect(stdout).not.toContain(s);
    const out = stdout.trim().split('\n').map((l) => JSON.parse(l));
    const byName = Object.fromEntries(out.filter((o) => o.name).map((o) => [o.name, o]));
    expect(byName.github).toMatchObject({ client: 'claude_desktop', transport: 'stdio', command: 'npx', package: '@modelcontextprotocol/server-github', credentials: true, user: 'jdoe' });
    expect(byName.postgres).toMatchObject({ command: 'uvx', package: 'mcp-server-postgres', credentials: false });
    expect(byName.sneaky.package).toBe('some-mcp-server');
    expect(byName.jira).toMatchObject({ client: 'cursor', transport: 'sse', urlHost: 'mcp.atlassian.com', credentials: true });
    expect(byName.hr).toMatchObject({ command: 'docker', package: 'ghcr.io/acme/hr-mcp:1.2' });
    expect(byName['acme-hr']).toMatchObject({ client: 'vscode', transport: 'http', urlHost: 'hr.acme.example' });
    expect(byName.fs).toMatchObject({ client: 'claude_code', command: 'node' });
    expect(byName.fs.package).toBeUndefined();
    expect(out.at(-1)).toMatchObject({ kind: 'scan', user: 'jdoe', clients: ['claude_desktop', 'claude_code', 'cursor', 'vscode'] });
  });

  it('goes through the collector into the report, still without secrets or names', async () => {
    const home = await fixtureHome(root, 'asmith');
    const { stdout } = await promisify(execFile)('sh', [SCRIPT, '--home', home]);
    const scanFile = path.join(root, 'scan.jsonl');
    // Make the scan's day fall in the report period.
    await fs.writeFile(scanFile, stdout.replace(/"time":"[^"]+"/g, '"time":"2026-11-09T08:00:00.000Z"'));
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-mcp-out-'));
    const store = new FileStore(out);
    expect(await processMcpScan(store, scanFile, await fs.readFile(scanFile, 'utf8'))).toMatchObject({ servers: 7, devices: 1 });
    const { findings, html } = await buildReport(store, { from: '2026-11-01', to: '2026-11-10', companyDomains: ['acme.example'] });
    expect(findings.laptopMcp).toMatchObject({ scannedDevices: 1, devicesWithServers: 1, people: 1 });
    expect(findings.laptopMcp!.servers[0]).toMatchObject({ what: 'hr.acme.example', company: true });
    expect(findings.recommendations.find((r) => /MCP server/.test(r.title))).toMatchObject({ priority: 'high' });
    expect(html).toContain('MCP servers on laptops');
    expect(html).toContain('company system');
    const kept = (await Promise.all((await store.list('')).filter((k) => !k.startsWith('private/')).map((k) => store.get(k)))).join('\n');
    for (const s of [...SECRETS, 'asmith']) expect(kept).not.toContain(s);
  });
});
