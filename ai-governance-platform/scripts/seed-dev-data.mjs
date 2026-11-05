#!/usr/bin/env node
// Load the local demo data (tenants, models, default policy) into whichever store STORAGE_BACKEND picks.
// The records are read from scripts/localstack-init.sh, so DynamoDB and PostgreSQL start with the same data.
// Records that already exist are left alone. Usage (from the repository folder):
//   STORAGE_BACKEND=postgres DATABASE_URL=postgres://… node scripts/seed-dev-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { collection, records } = require('@ai-governance/storage');

// DynamoDB table suffix in localstack-init.sh → collection name.
const COLLECTION = {
  tenants: 'tenants', models: 'models', policies: 'policies', 'api-keys': 'apiKeys', alerts: 'alerts',
  compliance: 'compliance', 'shadow-ai': 'shadowAi', 'audit-logs': 'auditLogs', metrics: 'metrics',
};

const script = fs.readFileSync(path.join(ROOT, 'scripts/localstack-init.sh'), 'utf8');
const re = /--table-name \$PREFIX-([a-z-]+)-\$STAGE\s*\\\s*--item '(\{[\s\S]*?\})'/g;
let added = 0;
let kept = 0;
for (const m of script.matchAll(re)) {
  const name = COLLECTION[m[1]];
  if (!name) throw new Error(`No collection for table ${m[1]}`);
  const item = unmarshall(JSON.parse(m[2]));
  if (await collection(name).put(item, { ifNotExists: true })) added++;
  else kept++;
}
console.log(`Demo data in ${records().kind}: ${added} added, ${kept} already there.`);
await records().close();
