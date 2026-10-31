#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { buildReport, decode, isoDay, processInput } from './core/run';
import { FileStore } from './core/store';
import { AwsSource, detectSource, parse } from './aws/parsers';

const USAGE = `Aegis collector: finds AI usage in your logs. Everything stays in --out.

  aegis-collector collect --out <dir> [--source auto|aws_dns|aws_firewall|aws_cloudtrail] [--ignore role:aegis-gateway,…] <files or folders…>
  aegis-collector report  --out <dir> [--days 30 | --from YYYY-MM-DD --to YYYY-MM-DD] [--company "Acme"] [--reveal-names]
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
  const out = typeof flags.out === 'string' ? flags.out : '';
  if (!cmd || !out || flags.help) { process.stdout.write(USAGE); process.exit(cmd ? 1 : 0); }
  const store = new FileStore(out);

  if (cmd === 'collect') {
    const forced = typeof flags.source === 'string' && flags.source !== 'auto' ? (flags.source as AwsSource) : null;
    const ignore = typeof flags.ignore === 'string' ? flags.ignore.split(',') : [];
    let lines = 0; let matched = 0; let skipped = 0;
    for (const f of await files(rest)) {
      const text = decode(await fs.readFile(f));
      const source = forced ?? detectSource(f, text);
      if (!source) { skipped++; continue; }
      const r = await processInput(store, path.resolve(f), parse(source, text), ignore);
      lines += r.lines; matched += r.matched;
    }
    console.log(`Read ${lines} log lines; ${matched} matched an AI service.${skipped ? ` Skipped ${skipped} files of an unknown kind.` : ''}`);
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
