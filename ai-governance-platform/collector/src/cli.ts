#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { buildReport, decode, isEndpointMcp, isInventory, isoDay, processApiLog, processInput, processInventory, processMcpScan } from './core/run';
import { FileStore } from './core/store';
import { AwsSource, detectSource, parse } from './aws/parsers';
import { parseOnpremText } from './onprem/parsers';

const USAGE = `Probaline collector: finds AI usage in your logs. Everything stays in --out.

  probaline-collector collect --out <dir> [--source auto|aws_dns|aws_firewall|aws_cloudtrail|onprem] [--gateway role:probaline-gateway-task,ip:203.0.113.4,…] [--ignore …] <files or folders…>
      AWS logs are recognized by name or content; anything else is read line by line as on-premises logs
      (Palo Alto, Fortinet, CEF, LEEF, Squid, BIND, Windows DNS, Zscaler, Netskope) or Azure and Google Cloud
      exported log records.
      --gateway names the Probaline gateway and connector (type:value; ip: takes a range like ip:203.0.113.0/28,
      and a trailing * matches a prefix). Their traffic counts as through Probaline, for the share in the report.
      --ignore leaves other known-good callers out entirely.
      Laptop MCP scans (endpoint/mcp-scan.sh or .ps1 output) are recognized and read too.
      Probaline's API list (Enforcement → Your APIs → API list for the collector) is kept, and access logs of
      those APIs (AWS ALB, API Gateway JSON, nginx, Envoy) are read against it: calls through Probaline vs direct.
  probaline-collector report  --out <dir> [--days 30 | --from YYYY-MM-DD --to YYYY-MM-DD] [--company "Acme"] [--company-domains acme.com,acme.internal] [--reveal-names]
  probaline-collector serve
      The on-premises collector: receives syslog and watches a folder, configured by environment variables
      (the container image runs this): see collector/README.md.
  probaline-collector cloud-job
      One run of the in-cloud collector (Azure Container Apps job or Cloud Run job), configured by
      environment variables: see collector/README.md.
`;

function args(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
      else { flags[a.slice(2)] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

async function files(inputs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of inputs) {
    const st = await fs.stat(p);
    if (st.isDirectory()) {
      for (const e of await fs.readdir(p, { withFileTypes: true })) out.push(...(await files([path.join(p, e.name)])));
    } else out.push(p);
  }
  return out.sort();
}

/** Matches package.json; scripts/release-check.mjs checks they agree. */
export const COLLECTOR_VERSION = '0.1.0';

async function main() {
  if (process.argv[2] === '--version') { process.stdout.write(`${COLLECTOR_VERSION}\n`); return; }
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = args(argv);
  if (cmd === 'serve') {
    const { serve } = await import('./onprem/server');
    return serve();
  }
  if (cmd === 'cloud-job') {
    const { runCloudJob } = await import('./bucket/run-job');
    await runCloudJob();
    return;
  }
  const out = typeof flags.out === 'string' ? flags.out : '';
  if (!cmd || !out || flags.help) { process.stdout.write(USAGE); process.exit(cmd ? 1 : 0); }
  const store = new FileStore(out);

  if (cmd === 'collect') {
    const wanted = typeof flags.source === 'string' && flags.source !== 'auto' ? flags.source : null;
    const ignore = typeof flags.ignore === 'string' ? flags.ignore.split(',') : [];
    const gateway = typeof flags.gateway === 'string' ? flags.gateway.split(',') : [];
    let matched = 0; let count = 0; let through = 0; let mcpServers = 0; let mcpDevices = 0; let apiCalls = 0; let apiThrough = 0;
    // The API list first, wherever it sits among the files, so access logs can be matched against it.
    const all = await files(rest);
    const texts = new Map<string, string>();
    for (const f of all) {
      const text = decode(await fs.readFile(f));
      if (isInventory(text)) console.log(`API list: ${await processInventory(store, text)} APIs behind Probaline MCP servers.`);
      else texts.set(f, text);
    }
    for (const [f, text] of texts) {
      count++;
      const api = await processApiLog(store, path.resolve(f), text, gateway);
      if (api) { apiCalls += api.matched; apiThrough += api.throughProbaline; continue; }
      if (isEndpointMcp(text)) {
        const m = await processMcpScan(store, path.resolve(f), text);
        mcpServers += m.servers; mcpDevices += m.devices;
        continue;
      }
      const aws = wanted === 'onprem' ? null : ((wanted as AwsSource | null) ?? detectSource(f, text));
      const observations = aws ? parse(aws, text) : parseOnpremText(text);
      const r = await processInput(store, path.resolve(f), observations, ignore, gateway);
      matched += r.matched;
      through += r.throughProbaline;
    }
    // Files can be one record per line or one big JSON document, so lines aren't a useful count.
    console.log(`Read ${count} ${count === 1 ? 'file' : 'files'}; ${matched} records matched an AI service${gateway.length ? `, ${through} of them through Probaline` : ''}.${mcpDevices ? ` Laptop MCP scans: ${mcpServers} servers on ${mcpDevices} ${mcpDevices === 1 ? 'device' : 'devices'}.` : ''}${apiCalls ? ` API access logs: ${apiCalls} calls to APIs behind Probaline, ${apiThrough} through it.` : ''}`);
    return;
  }

  if (cmd === 'report') {
    const days = Number(flags.days) || 30;
    const to = typeof flags.to === 'string' ? flags.to : isoDay(new Date());
    const from = typeof flags.from === 'string' ? flags.from : isoDay(new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86_400_000));
    const { findings, key } = await buildReport(store, { from, to, revealNames: flags['reveal-names'] === true, company: typeof flags.company === 'string' ? flags.company : undefined, companyDomains: typeof flags['company-domains'] === 'string' ? flags['company-domains'].split(',') : [] });
    console.log(`${findings.totals.services} AI services, ${findings.recommendations.length} recommendations. Report: ${path.join(out, key)}`);
    return;
  }

  process.stdout.write(USAGE);
  process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
