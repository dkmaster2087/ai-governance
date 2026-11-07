import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { records } from '@ai-governance/storage';
import { analyticsClient } from '../clients/analytics.client';
import { internalHttpsAgent } from '../clients/internal';

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
  const pingStore = () => records().ping();

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
      checkDependency(storeName(), pingStore),
      checkDependency('policy-engine', async () => {
        const url = process.env.POLICY_ENGINE_URL || 'http://localhost:3001';
        await axios.get(`${url}/health`, { timeout: 3000, httpsAgent: internalHttpsAgent() });
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
      checkDependency(storeName(), pingStore),
      checkDependency('policy-engine', async () => {
        const url = process.env.POLICY_ENGINE_URL || 'http://localhost:3001';
        await axios.get(`${url}/health`, { timeout: 3000, httpsAgent: internalHttpsAgent() });
      }),
      checkDependency('data-protection', async () => {
        const url = process.env.DATA_PROTECTION_URL || 'http://localhost:3002';
        await axios.get(`${url}/health`, { timeout: 3000, httpsAgent: internalHttpsAgent() });
      }),
      // Off the request path: if it's down, reports are unavailable but prompts are unaffected.
      checkDependency('analytics', () => analyticsClient().ping()),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');
    const criticalHealthy = checks.filter((c) => c.name !== 'data-protection' && c.name !== 'analytics').every((c) => c.status === 'healthy');

    return {
      status: allHealthy ? 'healthy' : criticalHealthy ? 'degraded' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      uptime: Math.round((Date.now() - startTime) / 1000),
      dependencies: checks,
    };
  });
}
