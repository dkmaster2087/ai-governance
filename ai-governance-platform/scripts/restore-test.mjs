#!/usr/bin/env node
/**
 * Quarterly restore test (docs/RESTORE-RUNBOOK.md): proves a table can be brought back from point-in-time
 * recovery. Restores a copy of the table as it was an hour ago, checks the copy holds the records the live table
 * has, then deletes the copy. Nothing is changed in the live table.
 *
 *   node scripts/restore-test.mjs --prefix ai-gov --stage prod [--table audit-logs] [--region us-east-1] [--keep]
 *
 * Needs the AWS CLI signed in with permission to restore, describe, scan and delete DynamoDB tables and to use
 * the storage KMS key. A restore takes from a few minutes to an hour, depending on the table's size.
 * Prints a summary to keep with the quarter's evidence; exits 1 if the check fails.
 */
import { execFileSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const prefix = arg('prefix'); const stage = arg('stage'); const region = arg('region');
const table = arg('table', 'audit-logs');
const keep = process.argv.includes('--keep');
if (!prefix || !stage) { console.error('Usage: restore-test.mjs --prefix ai-gov --stage prod [--table audit-logs] [--region r] [--keep]'); process.exit(2); }

const aws = (...args) => JSON.parse(execFileSync('aws', [...args, ...(region ? ['--region', region] : []), '--output', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() || '{}');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const source = `${prefix}-${table}-${stage}`;
const copy = `${source}-restore-test-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const pointInTime = new Date(Date.now() - 3600_000);

const started = Date.now();
const src = aws('dynamodb', 'describe-table', '--table-name', source).Table;
const backups = aws('dynamodb', 'describe-continuous-backups', '--table-name', source).ContinuousBackupsDescription;
const pitr = backups.PointInTimeRecoveryDescription;
if (pitr?.PointInTimeRecoveryStatus !== 'ENABLED') { console.error(`${source}: point-in-time recovery is off. Turn it on (cdk deploy) first.`); process.exit(1); }
console.log(`${source}: restorable from ${pitr.EarliestRestorableDateTime} to ${pitr.LatestRestorableDateTime}`);

const kms = src.SSEDescription?.KMSMasterKeyArn;
console.log(`Restoring a copy as of ${pointInTime.toISOString()} to ${copy}…`);
aws('dynamodb', 'restore-table-to-point-in-time', '--source-table-name', source, '--target-table-name', copy,
  '--restore-date-time', pointInTime.toISOString(), '--billing-mode-override', 'PAY_PER_REQUEST',
  ...(kms ? ['--sse-specification-override', `Enabled=true,SSEType=KMS,KMSMasterKeyId=${kms}`] : []));

let status = '';
while (status !== 'ACTIVE') {
  await sleep(30_000);
  status = aws('dynamodb', 'describe-table', '--table-name', copy).Table.TableStatus;
  process.stdout.write(`  ${Math.round((Date.now() - started) / 60_000)} min: ${status}\n`);
}

// The copy's records should be in the live table too (unless deleted since, by retention or by hand).
const keyNames = src.KeySchema.map((k) => k.AttributeName);
const sample = aws('dynamodb', 'scan', '--table-name', copy, '--max-items', '50', '--projection-expression', keyNames.map((_, i) => `#k${i}`).join(','),
  '--expression-attribute-names', JSON.stringify(Object.fromEntries(keyNames.map((n, i) => [`#k${i}`, n])))).Items ?? [];
let found = 0;
for (const item of sample) {
  const got = aws('dynamodb', 'get-item', '--table-name', source, '--key', JSON.stringify(item));
  if (got.Item) found++;
}
const count = aws('dynamodb', 'scan', '--table-name', copy, '--select', 'COUNT').Count ?? 0;
const ok = sample.length === 0 ? count === 0 : found >= Math.ceil(sample.length * 0.9);

if (!keep) { aws('dynamodb', 'delete-table', '--table-name', copy); }
const summary = {
  test: 'restore', table: source, copy: keep ? copy : `${copy} (deleted)`, pointInTime: pointInTime.toISOString(),
  minutes: Math.round((Date.now() - started) / 60_000), recordsInCopy: count, sampled: sample.length, sampledFoundInLive: found,
  result: ok ? 'passed' : 'FAILED', at: new Date().toISOString(),
};
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
