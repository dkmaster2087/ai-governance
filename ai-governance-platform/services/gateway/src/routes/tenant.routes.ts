import { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, ScanCommand, GetCommand,
  PutCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:tenants');

export async function tenantRoutes(app: FastifyInstance) {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const client = DynamoDBDocumentClient.from(dynamo);
  const table = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  // List all tenants (platform admin only in production)
  app.get('/tenants', async (_request, reply) => {
    try {
      const result = await client.send(new ScanCommand({ TableName: table }));
      return reply.send(result.Items || []);
    } catch (err) {
      logger.error('Failed to list tenants', { error: err });
      return reply.status(500).send({ error: 'Failed to fetch tenants' });
    }
  });

  // Get single tenant
  app.get('/tenants/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    try {
      const result = await client.send(new GetCommand({ TableName: table, Key: { tenantId } }));
      if (!result.Item) return reply.status(404).send({ error: 'Tenant not found' });
      return reply.send(result.Item);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch tenant' });
    }
  });

  // Create / onboard tenant
  app.post('/tenants', async (request, reply) => {
    const body = request.body as any;
    const tenant = {
      tenantId: `tenant_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: body.name,
      adminEmail: body.adminEmail,
      plan: body.plan ?? 'starter',
      status: 'active',
      deploymentMode: body.deploymentMode ?? 'saas',
      region: body.region ?? 'us-east-1',
      settings: body.settings ?? {
        allowedModels: [],
        maxTokensPerRequest: 4096,
        maxRequestsPerMinute: 100,
        dataResidencyRegion: body.region ?? 'us-east-1',
        piiMaskingEnabled: true,
        auditLogRetentionDays: 90,
        allowExternalProviders: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.send(new PutCommand({ TableName: table, Item: tenant }));
    logger.info('Tenant onboarded', { tenantId: tenant.tenantId, name: tenant.name });
    return reply.status(201).send(tenant);
  });

  // Update tenant
  app.put('/tenants/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = request.body as any;
    const updatedAt = new Date().toISOString();

    await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId },
      UpdateExpression: 'SET #name = :name, plan = :plan, settings = :settings, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':name': body.name,
        ':plan': body.plan,
        ':settings': body.settings,
        ':updatedAt': updatedAt,
      },
    }));

    return reply.send({ tenantId, ...body, updatedAt });
  });

  // Suspend tenant
  app.post('/tenants/:tenantId/suspend', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'suspended', ':updatedAt': new Date().toISOString() },
    }));
    logger.info('Tenant suspended', { tenantId });
    return reply.send({ tenantId, status: 'suspended' });
  });

  // Activate tenant
  app.post('/tenants/:tenantId/activate', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'active', ':updatedAt': new Date().toISOString() },
    }));
    logger.info('Tenant activated', { tenantId });
    return reply.send({ tenantId, status: 'active' });
  });
}
