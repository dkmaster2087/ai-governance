#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { buildReport, decode, isoDay, processInput } from './core/run';
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
  probaline-collector report  --out <dir> [--days 30 | --from YYYY-MM-DD --to YYYY-MM-DD] [--company "Acme"] [--reveal-names]
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

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = args(argv);
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
    let matched = 0; let count = 0; let through = 0;
    for (const f of await files(rest)) {
      count++;
      const text = decode(await fs.readFile(f));
      const aws = wanted === 'onprem' ? null : ((wanted as AwsSource | null) ?? detectSource(f, text));
      const observations = aws ? parse(aws, text) : parseOnpremText(text);
      const r = await processInput(store, path.resolve(f), observations, ignore, gateway);
      matched += r.matched;
      through += r.throughProbaline;
    }
    // Files can be one record per line or one big JSON document, so lines aren't a useful count.
    console.log(`Read ${count} ${count === 1 ? 'file' : 'files'}; ${matched} records matched an AI service${gateway.length ? `, ${through} of them through Probaline` : ''}.`);
    return;
  }

  if (cmd === 'report') {
    const days = Number(flags.days) || 30;
    const to = typeof flags.to === 'string' ? flags.to : isoDay(new Date());
    const from = typeof flags.from === 'string' ? flags.from : isoDay(new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86_400_000));
    const { findings, key } = await buildReport(store, { from, to, revealNames: flags['reveal-names'] === true, company: typeof flags.company === 'string' ? flags.company : undefined });
    console.log(`${findings.totals.services} AI services, ${findings.recommendations.length} recommendations. Report: ${path.join(out, key)}`);
    return;
  }

  process.stdout.write(USAGE);
  process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
