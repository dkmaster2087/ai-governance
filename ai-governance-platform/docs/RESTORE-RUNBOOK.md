# Restore runbook

How to bring Probaline's data back after a mistake or a loss, and the quarterly test that proves it works.
Written 2026-11-07 for the AWS deployment (DynamoDB, S3, Secrets Manager, KMS). The steps have been written and
the test script checked locally; **neither has been run against a real AWS account yet**.

## What is kept, and for how long

| Data | Where | How it can come back |
|---|---|---|
| Every table except `metrics` (short-lived counters) | DynamoDB | Point-in-time recovery: any second in the last 35 days. On deletion, a final system backup kept 35 days. |
| Archive copies of audit records | S3 audit bucket | Versioned with Object Lock: an overwritten or deleted file's earlier version stays for 30 days (`RemoveDeletedArchives`). |
| Provider keys, MCP API credentials, log-export tokens, the gateway's MCP keys | Secrets Manager | A deleted secret can be restored for 30 days (the default recovery window). |
| Internal signing keys and service certificates | Secrets Manager | As above; or make new ones (`scripts/internal-keys.mjs`, `scripts/internal-pki.mjs aws --renew`) and redeploy. |
| The storage KMS key | KMS | Rotates yearly; deletion waits 30 days (cancellable). **Without it nothing above can be read.** |

In production every table and the bucket are kept when a stack is deleted (`RemovalPolicy.RETAIN`).

## Before you start

1. Write down the time things went wrong (UTC), as precisely as you can. Restore to just before it.
2. Stop the damage: if a person or an integration is deleting or changing data, turn off their access first
   (Users page, API keys page, or the integration).
3. Note who is doing the restore and why; this goes into the incident record.

## A company's records were deleted or changed by mistake

For one company, or a few records: restore a copy of the table, then copy the affected records back. The live
table keeps running throughout.

```bash
TABLE=ai-gov-models-prod          # the table holding the records
WHEN=2026-11-07T14:30:00Z         # just before the mistake
aws dynamodb restore-table-to-point-in-time --source-table-name $TABLE --target-table-name $TABLE-recovered \
  --restore-date-time $WHEN --billing-mode-override PAY_PER_REQUEST \
  --sse-specification-override "Enabled=true,SSEType=KMS,KMSMasterKeyId=$(aws dynamodb describe-table --table-name $TABLE --query Table.SSEDescription.KMSMasterKeyArn --output text)"
aws dynamodb wait table-exists --table-name $TABLE-recovered

# The company's records as they were:
aws dynamodb query --table-name $TABLE-recovered --key-condition-expression 'tenantId = :t' \
  --expression-attribute-values '{":t":{"S":"tenant_xxx"}}' > recovered.json
# Check them, then write each back to the live table:
jq -c '.Items[]' recovered.json | while read -r item; do aws dynamodb put-item --table-name $TABLE --item "$item"; done

aws dynamodb delete-table --table-name $TABLE-recovered
```

Which table holds what: `tenants` (companies and settings), `users`, `api-keys` (also licenses), `models`,
`policies` (rules), `compliance`, `alerts`, `mcp-*` (MCP servers), `log-export`, `audit-logs` (case files),
`activity` (admin activity and sign-ins), `shadow-ai`.

Restored records keep their `ttl`: a record past its company's retention period is deleted again by DynamoDB
within a day or two. Keep it by removing `ttl` from the item before writing it back, and say so in the
incident record.

## A whole table is lost or unusable

1. Make a copy as above (`$TABLE-recovered`) and check it.
2. Back up the checked copy: `aws dynamodb create-backup --table-name $TABLE-recovered --backup-name $TABLE-restore`
   and wait until `aws dynamodb describe-backup --backup-arn <arn>` says `AVAILABLE`.
3. Delete the damaged table: `aws dynamodb delete-table --table-name $TABLE`. Its final system backup keeps the
   damaged state for 35 days, for the investigation.
4. Restore the copy's backup under the original name:
   `aws dynamodb restore-table-from-backup --target-table-name $TABLE --backup-arn <arn> --billing-mode-override PAY_PER_REQUEST --sse-specification-override "Enabled=true,SSEType=KMS,KMSMasterKeyId=<storage key ARN>"`,
   then `aws dynamodb wait table-exists --table-name $TABLE`. Requests to this table fail between steps 3 and 4,
   so do them back to back (minutes for a small table).
5. A restored table doesn't keep everything. Put back:
   - point-in-time recovery: `aws dynamodb update-continuous-backups --table-name $TABLE --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true`;
   - the expiry field on tables that have one (`audit-logs`, `activity`, `shadow-ai`, `metrics`, MCP approvals,
     OAuth and connectors, `log-export`): `aws dynamodb update-time-to-live --table-name $TABLE --time-to-live-specification Enabled=true,AttributeName=ttl`;
   - tags, if you use them for costs.
   The services use the table by name, so they pick it up straight away; CloudFormation still knows it by that
   name too.
6. Delete `$TABLE-recovered` and the backup, then run the end-to-end check below.

## Archive copies in S3

An overwritten or deleted file keeps its earlier version for 30 days:

```bash
aws s3api list-object-versions --bucket ai-gov-audit-logs-prod-<account> --prefix logs/<tenant>/<day>/
aws s3api copy-object --bucket ai-gov-audit-logs-prod-<account> --key <key> \
  --copy-source "ai-gov-audit-logs-prod-<account>/<key>?versionId=<version>"
```

## Secrets

```bash
aws secretsmanager list-secrets --include-planned-deletion --filters Key=name,Values=ai-gov/prod/
aws secretsmanager restore-secret --secret-id <name>
```

If a provider key is lost for good, the company's admin enters it again on the Models page. If the internal
signing key or certificates are lost, make new ones and redeploy (README, "Trust between services").

## The KMS key

If a deletion was scheduled, cancel it: `aws kms cancel-key-deletion --key-id <key>` then
`aws kms enable-key --key-id <key>`. A key that has been deleted can't be recovered, and neither can anything it
encrypted: the deployment protects it by keeping it when the stack is deleted, and only an account
administrator can schedule its deletion.

## After any restore

- Run the end-to-end check against the environment: sign in to the dashboard, open Gateway, Evidence and the
  restored company's pages; send one prompt with a test key and find its case file.
- Write the incident record: what went wrong, the time restored to, what was restored, by whom, and anything that
  couldn't be (records created between the restore point and the restore).

## Quarterly restore test

Once a quarter, and after any change to the storage stack:

```bash
node scripts/restore-test.mjs --prefix ai-gov --stage prod --table audit-logs
node scripts/restore-test.mjs --prefix ai-gov --stage prod --table tenants
```

Each restores a copy of the table as it was an hour ago, checks that records in the copy are in the live table,
prints a summary and deletes the copy (`--keep` keeps it). Keep the summaries with the quarter's evidence; a
failed test is an incident. Record how long each restore took: that's your recovery time for that table.

## Self-hosted installs on PostgreSQL

Probaline's records, settings and (with `SECRET_STORE=database`) secrets are all in the PostgreSQL database;
archive copies are in `OBJECT_STORE_DIR` or the S3-compatible store. Back up the database with your usual tool
(continuous archiving, or `pg_dump` at least daily) and the object store with it. Keep
`SECRETS_ENCRYPTION_KEY` somewhere other than the database backups: secrets can't be read without it, and anyone
with both can read them.
