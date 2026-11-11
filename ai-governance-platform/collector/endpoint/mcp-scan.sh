#!/bin/sh
# Probaline: list the MCP servers configured on this Mac, for the AI usage assessment.
#
# Read-only. Reads the MCP settings of Claude Desktop, Claude Code, Cursor, VS Code and Windsurf and prints one
# JSON line per server: which app, the server's name, whether it runs a local program or calls a URL, the
# program's name and package, or the URL's host. It never prints environment values, headers, arguments other
# than a package name, or anything after a URL's host. Nothing is sent anywhere; collect the output with your
# device-management tool (Jamf, Kandji, Intune) and give the files to the Probaline collector.
#
# Usage: mcp-scan.sh [--home DIR] [--out FILE]
#   Run as root (device management), it scans every account in /Users; otherwise the current one.
#   --home scans one home folder (its name is the account). --out appends to a file instead of printing.
set -eu

HOME_ARG=""
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_ARG="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$HOME_ARG" ]; then HOMES="$HOME_ARG"
elif [ "$(id -u)" = "0" ]; then HOMES=$(find /Users -mindepth 1 -maxdepth 1 -type d ! -name Shared ! -name '.*' 2>/dev/null)
else HOMES="$HOME"
fi

scan() {
  # shellcheck disable=SC2086
  osascript -l JavaScript - $HOMES <<'JXA'
ObjC.import('Foundation');

const CONFIGS = [
  { client: 'claude_desktop', path: 'Library/Application Support/Claude/claude_desktop_config.json', keys: [['mcpServers']] },
  { client: 'claude_code', path: '.claude.json', keys: [['mcpServers']], projects: true },
  { client: 'cursor', path: '.cursor/mcp.json', keys: [['mcpServers']] },
  { client: 'vscode', path: 'Library/Application Support/Code/User/mcp.json', keys: [['servers']] },
  { client: 'vscode', path: 'Library/Application Support/Code/User/settings.json', keys: [['mcp', 'servers']] },
  { client: 'windsurf', path: '.codeium/windsurf/mcp_config.json', keys: [['mcpServers']] },
];
const RUNNERS = ['npx', 'uvx', 'bunx', 'pnpx', 'pipx', 'docker', 'podman', 'deno'];
const PACKAGE = /^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(@[A-Za-z0-9._^~-]+)?$/;
const IMAGE = /^[a-z0-9][a-z0-9._\/-]*(:[A-Za-z0-9._-]+)?$/;
// Flags whose next argument is a value, never the package or image.
const VALUE_FLAGS = ['-e', '--env', '--env-file', '-v', '--volume', '--mount', '--name', '-p', '--publish', '--network', '-w', '--workdir', '-u', '--user', '--token', '--api-key', '--key', '--secret', '--password', '--from'];
// Tokens and keys: never printed even if they sit where a package name would.
const SECRETISH = (a) => /^(gh[pousr]_|github_pat_|sk-|sk_|xox[abpr]-|AKIA|ASIA|eyJ|glpat-|AIza)/.test(a) || (a.length >= 24 && /\d/.test(a) && /[A-Za-z]/.test(a) && !/[\/@.:-]/.test(a));

function read(path) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return s.isNil() ? null : ObjC.unwrap(s);
}

// VS Code settings allow comments and trailing commas.
function parse(text) {
  try { return JSON.parse(text); } catch (e) {}
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')); } catch (e) { return null; }
}

const dig = (o, keys) => keys.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const clean = (s, n) => String(s).replace(/[\u0000-\u001f]/g, '').slice(0, n);

function describe(name, cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = { name: clean(name, 100) };
  const url = cfg.url || cfg.serverUrl || cfg.httpUrl;
  if (typeof url === 'string') {
    out.transport = cfg.type === 'sse' || /\/sse\/?([?#]|$)/.test(url) ? 'sse' : 'http';
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^\/@?#]*@)?(\[[^\]]+\]|[^\/:?#]+)/i.exec(url);
    if (m) out.urlHost = m[1].toLowerCase();
  } else {
    out.transport = 'stdio';
    if (typeof cfg.command === 'string') {
      const command = cfg.command.split(/[\\\/]/).pop();
      out.command = clean(command, 60);
      const args = Array.isArray(cfg.args) ? cfg.args.filter((a) => typeof a === 'string') : [];
      const runner = RUNNERS.includes(command.replace(/\.(exe|cmd)$/, ''));
      if (runner) {
        const isDocker = /^(docker|podman)/.test(command);
        const candidates = args.filter((a, i) => !a.startsWith('-') && !VALUE_FLAGS.includes(args[i - 1]) && !['run', 'dlx', 'x', 'exec', 'tool'].includes(a));
        const pkg = candidates.find((a) => (isDocker ? IMAGE : PACKAGE).test(a) && !a.includes('=') && !SECRETISH(a));
        if (pkg) out.package = clean(pkg, 120);
      }
    }
  }
  // Whether the server is given credentials of its own: names and values are never printed.
  const env = cfg.env && typeof cfg.env === 'object' ? Object.keys(cfg.env).length : 0;
  const headers = cfg.headers && typeof cfg.headers === 'object' ? Object.keys(cfg.headers).length : 0;
  out.credentials = env + headers > 0;
  return out;
}

function run(homes) {
  const device = ObjC.unwrap($.NSProcessInfo.processInfo.hostName);
  const time = new Date().toISOString();
  const lines = [];
  for (const home of homes) {
    const user = home.replace(/\/+$/, '').split('/').pop();
    const found = [];
    for (const c of CONFIGS) {
      const text = read(`${home}/${c.path}`);
      if (text === null) continue;
      const doc = parse(text);
      if (!doc) continue;
      found.push(c.client);
      const blocks = c.keys.map((k) => dig(doc, k));
      if (c.projects && doc.projects && typeof doc.projects === 'object') {
        for (const p of Object.values(doc.projects)) blocks.push(p && p.mcpServers);
      }
      const seen = new Set();
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        for (const [name, cfg] of Object.entries(block)) {
          const d = describe(name, cfg);
          if (!d) continue;
          const key = JSON.stringify(d);
          if (seen.has(key)) continue;
          seen.add(key);
          lines.push(JSON.stringify({ schema: 'probaline.endpoint_mcp/1', time, device, user, client: c.client, config: `~/${c.path}`, ...d }));
        }
      }
    }
    lines.push(JSON.stringify({ schema: 'probaline.endpoint_mcp/1', kind: 'scan', time, device, user, clients: [...new Set(found)] }));
  }
  return lines.join('\n');
}
JXA
}

if [ -n "$OUT" ]; then scan >> "$OUT"; else scan; fi
