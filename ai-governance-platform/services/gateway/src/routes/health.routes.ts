import { FastifyInstance } from 'fastify';
import { records, SPECS } from '@ai-governance/storage';
import { analyticsClient } from '../clients/analytics.client';

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
  // The record store's name in health output: dynamodb, postgres or memory.
  const storeName = () => records().kind;
  const pingStore = () => records().ping(SPECS.tenants());

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
      // Rules, secrets, personal data and prompt-attack checks run in this process; the store is what they need.
      checkDependency(storeName(), pingStore),
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
      checkDependency(storeName(), pingStore),
      // Off the request path: if it's down, reports are unavailable but prompts are unaffected.
      checkDependency('analytics', () => analyticsClient().ping()),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');
    const criticalHealthy = checks.filter((c) => c.name !== 'analytics').every((c) => c.status === 'healthy');

    return {
      status: allHealthy ? 'healthy' : criticalHealthy ? 'degraded' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      uptime: Math.round((Date.now() - startTime) / 1000),
      dependencies: checks,
    };
  });
}
