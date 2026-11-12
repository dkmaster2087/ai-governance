# Storage: DynamoDB or PostgreSQL

Status: phases 1–3 built; phase 4 planned. Written 2026-11-05.

## Why

Probaline stores everything in DynamoDB, with S3 for audit archives. That ties every deployment to AWS. Customers
who run on-premises, on another cloud or in Kubernetes, and the hybrid model where the gateway runs on the
customer's side, need a database they already operate. PostgreSQL is the one almost every security team can
run and approve.

The goal is **one codebase that runs on either**, chosen by a setting, with no change in behaviour.
AWS deployments keep DynamoDB; nothing about them changes.

## What is stored today

| Data | Key | Other lookups | Expires |
|---|---|---|---|
| Tenants | tenantId | list all | |
| Policies | tenantId + policyId | | |
| Compliance packs | tenantId + framework | | |
| Model configs | tenantId + modelConfigId | | |
| API keys | tenantId + keyId | by key hash | |
| Alert rules | tenantId + ruleId | | |
| Shadow AI events | tenantId + eventId | newest first, paged | yes |
| Audit records | tenantId + requestId | by tenant and time range, newest first | yes |
| Metrics | tenantId + period | period prefix, newest first | yes |
| Audit archive, contact requests | object key | | |

About 50 calls in three services (gateway, policy engine, analytics). The collector has its own storage
(local files or S3) and is not part of this.

## Design

A shared package, `@ai-governance/storage`, with two interfaces:

- **Collections** for records: `get`, `put` (optionally only if new), `update` (set fields, including nested
  ones such as `settings.secretsAction`; remove fields; add to a counter; optionally only if the record
  exists), `delete`, `query` (by key or a named secondary index, with an optional range or prefix on the
  second key, ordering, limit and paging), and `scan`. Each collection is declared once: its name, keys,
  secondary indexes and expiry field.
- **Objects** for files: `put`, `get`, `list`.

Backends, chosen with `STORAGE_BACKEND`:

| Backend | Records | Used for |
|---|---|---|
| `dynamodb` (default) | DynamoDB, same tables and indexes as today | AWS deployments |
| `postgres` | One table per collection: key columns plus the record as JSONB; secondary indexes as expression indexes | On-premises, other clouds, Kubernetes, hybrid |
| `memory` | In process | Unit tests |

`OBJECT_STORE` chooses `s3` (default; also any S3-compatible store such as MinIO, via `S3_ENDPOINT`) or
`file` (a directory).

PostgreSQL details:
- Tables are created on startup if missing (`CREATE TABLE IF NOT EXISTS`), so a fresh database works with no
  separate migration step. Schema changes later get numbered migrations.
- Expiry: rows with a past `ttl` are hidden from reads and deleted in the background.
- Conditional writes and counters are single SQL statements, so they stay atomic like DynamoDB's.
- Connection with `DATABASE_URL`; TLS when the URL asks for it.

One contract test suite runs against every backend (memory always; DynamoDB through LocalStack and
PostgreSQL in Docker when they are available), so the backends can't drift apart.

## Phases

1. **Storage package and the PostgreSQL backend**, with the contract tests. *Built* (`shared/storage`).
2. **Move every service onto it.** *Built.* The gateway, policy engine and analytics use collections; no service
   calls DynamoDB or S3 directly. All unit tests run on the memory backend; the 25 end-to-end scenarios pass on
   both DynamoDB and PostgreSQL.
3. **Local stack.** *Built.* PostgreSQL in `docker-compose.yml` (port 5433); `scripts/dev-local.sh start --postgres`
   runs everything on it, with demo data loaded by `scripts/seed-dev-data.mjs`. CI runs the contract tests on a
   real PostgreSQL.
4. **Other AWS ties** (planned): provider keys still live in AWS Secrets Manager, so a PostgreSQL deployment
   still needs it (or LocalStack, locally). Next: provider keys encrypted in the database with a customer key;
   Comprehend (already optional); Bedrock (just one of the providers); a Helm chart and a compose file for
   running the whole platform outside AWS.

## Behaviour worth knowing

- **Updates that must find a record.** Revoking a key, saving settings, suspending a tenant and similar changes
  now only touch records that exist. Before, DynamoDB would quietly create a half-empty record for a missing
  key or tenant; those calls now return 404 instead.
- **Expired records** are hidden on every backend as soon as they expire. DynamoDB deletes them some time later;
  PostgreSQL deletes them hourly.
- **Field paths** are one or two levels (`settings.secretsAction`), plain identifiers only, so nothing from a
  request can reach SQL as code. Values are always passed as parameters.
- **Paging** tokens are opaque and only valid for the backend that issued them.

## Audit records: database window and archive

- The database keeps the last `AUDIT_DB_DAYS` days (90 by default, plus two days' margin) so it stays small and
  fast. Each record's expiry is the shorter of that window and the company's retention; legal hold removes it.
- The archive copy (`OBJECT_STORE`: S3, MinIO, or a directory) keeps each record for the company's full
  retention and is swept daily. Reads older than the window (evidence search, a case file) come from it, a day
  folder at a time: slower, by design. On AWS the archive moves to Glacier Instant Retrieval after 90 days, so it
  stays readable without a restore.
- With `OBJECT_STORE=none` there is no archive, and the database keeps every record for the full retention.

## What stays the same

- The AWS deployment (CDK) is unchanged and still uses DynamoDB and S3.
- Record shapes and API responses don't change.
- No data migration between backends is offered yet; a new deployment picks one.
