import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const startTime = Date.now();

interface DependencyHealth {
  name: string;
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  error?: string;
}

async function checkDependency(name: string, fn: () => Promise<void>): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await fn();
    return { name, status: 'healthy', latencyMs: Date.now() - start };
  } catch (err: any) {
    return { name, status: 'unhealthy', latencyMs: Date.now() - start, error: err.message };
  }
}

export async function healthRoutes(app: FastifyInstance) {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const client = DynamoDBDocumentClient.from(dynamo);

  /** Liveness probe — is the process alive? */
  app.get('/', async () => ({
    status: 'healthy',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    uptime: Math.round((Date.now() - startTime) / 1000),
  }));

  /** Readiness probe — can the service handle requests? Checks dependencies. */
  app.get('/ready', async () => {
    const checks = await Promise.all([
      checkDependency('dynamodb', async () => {
        await client.send(new ScanCommand({
          TableName: process.env.TENANTS_TABLE || 'ai-gov-tenants-dev',
          Limit: 1,
        }));
      }),
      checkDependency('policy-engine', async () => {
        const url = process.env.POLICY_ENGINE_URL || 'http://localhost:3001';
        await axios.get(`${url}/health`, { timeout: 3000 });
      }),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');

    return {
      status: allHealthy ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - startTime) / 1000),
      dependencies: checks,
    };
  });

  /** Deep health check — all dependencies including optional ones */
  app.get('/deep', async () => {
    const checks = await Promise.all([
      checkDependency('dynamodb', async () => {
        await client.send(new ScanCommand({
          TableName: process.env.TENANTS_TABLE || 'ai-gov-tenants-dev',
          Limit: 1,
        }));
      }),
      checkDependency('policy-engine', async () => {
        const url = process.env.POLICY_ENGINE_URL || 'http://localhost:3001';
        await axios.get(`${url}/health`, { timeout: 3000 });
      }),
      checkDependency('data-protection', async () => {
        const url = process.env.DATA_PROTECTION_URL || 'http://localhost:3002';
        await axios.get(`${url}/health`, { timeout: 3000 });
      }),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');
    const criticalHealthy = checks.filter((c) => c.name !== 'data-protection').every((c) => c.status === 'healthy');

    return {
      status: allHealthy ? 'healthy' : criticalHealthy ? 'degraded' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      uptime: Math.round((Date.now() - startTime) / 1000),
      dependencies: checks,
    };
  });
}
