/**
 * One-off migration: move provider API keys stored in plaintext on model configs (`apiKeyStored`)
 * into Secrets Manager, and delete the plaintext copy.
 *
 * Usage (with AWS credentials for the target account):
 *   MODELS_TABLE=ai-gov-models-prod STAGE=prod npx ts-node -r tsconfig-paths/register scripts/migrate-provider-keys.ts [--dry-run]
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ModelConfig } from '@ai-governance/types';
import { ModelConfigService } from '../src/services/model-config.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const table = process.env.MODELS_TABLE || 'ai-gov-models-dev';
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  const service = new ModelConfigService();

  let lastKey: Record<string, unknown> | undefined;
  let found = 0;
  do {
    const page = await client.send(new ScanCommand({
      TableName: table,
      FilterExpression: 'attribute_exists(apiKeyStored)',
      ExclusiveStartKey: lastKey,
    }));
    for (const item of (page.Items ?? []) as ModelConfig[]) {
      found++;
      console.log(`${dryRun ? '[dry run] would migrate' : 'Migrating'} ${item.tenantId}/${item.modelConfigId}`);
      if (!dryRun) await service.resolveProviderKey(item);
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`${found} model config(s) had a plaintext key.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
