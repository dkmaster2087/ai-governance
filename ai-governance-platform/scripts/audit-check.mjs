#!/usr/bin/env node
/**
 * Fails when a dependency that ships in Probaline has a known high or critical vulnerability, unless it is in
 * security/accepted-risks.json with a reason and a date to look again. An accepted risk past its date fails too,
 * so nothing is accepted for ever. Development-only packages (tests, build tools) are left out.
 *
 *   node scripts/audit-check.mjs            run by CI on every push
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BLOCKING = new Set(['high', 'critical']);
let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50e6 });
} catch (e) {
  raw = e.stdout; // npm audit exits non-zero whenever it finds anything
}
const report = JSON.parse(raw);
if (report.error) { console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`); process.exit(2); }

const accepted = JSON.parse(fs.readFileSync(new URL('../security/accepted-risks.json', import.meta.url), 'utf8')).accepted;
const today = new Date().toISOString().slice(0, 10);

// Each advisory once, with the packages it reaches.
const advisories = new Map();
for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'string') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    const a = advisories.get(id) ?? { id, severity: via.severity, title: via.title, url: via.url, packages: new Set() };
    a.packages.add(pkg);
    advisories.set(id, a);
  }
}

const failing = [];
const expired = [];
for (const a of advisories.values()) {
  if (!BLOCKING.has(a.severity)) continue;
  const ok = accepted.find((x) => x.advisory === a.id);
  if (!ok) failing.push(a);
  else if (ok.reviewBy < today) expired.push({ ...a, reviewBy: ok.reviewBy });
  else console.log(`accepted until ${ok.reviewBy}: ${a.severity} ${a.id} ${a.title} (${ok.reason})`);
}
for (const x of accepted) {
  if (![...advisories.values()].some((a) => a.id === x.advisory)) console.log(`no longer found, remove from accepted-risks.json: ${x.advisory}`);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit (shipped packages): ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low`);
for (const a of failing) console.error(`NOT ACCEPTED: ${a.severity} ${a.id} ${a.title} in ${[...a.packages].join(', ')} ${a.url}`);
for (const a of expired) console.error(`REVIEW DATE PASSED (${a.reviewBy}): ${a.severity} ${a.id} ${a.title}`);
if (failing.length || expired.length) {
  console.error('\nFix with npm audit fix (or an upgrade), or record the risk in security/accepted-risks.json with a reason and a review date.');
  process.exit(1);
}
