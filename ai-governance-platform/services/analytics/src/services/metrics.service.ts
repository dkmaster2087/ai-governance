import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('analytics:metrics');

export class MetricsService {
  async getSummary(tenantId: string, period: string) {
    try {
      const page = await collection('metrics').query({
        partition: tenantId, range: { beginsWith: this.periodPrefix(period) }, order: 'desc', limit: 30,
      });
      return { tenantId, period, data: page.items };
    } catch (err) {
      logger.error('Failed to fetch metrics summary', { tenantId, error: err });
      return { tenantId, period, data: [] };
    }
  }

  async getCostBreakdown(tenantId: string, from?: string, to?: string) {
    return { tenantId, from, to, breakdown: [] };
  }

  async getModelDistribution(tenantId: string) {
    return { tenantId, distribution: [] };
  }

  async getViolations(tenantId: string) {
    return { tenantId, violations: [] };
  }

  private periodPrefix(period: string): string {
    const now = new Date();
    if (period === '24h') return now.toISOString().slice(0, 10);
    if (period === '7d') return now.toISOString().slice(0, 7);
    return now.toISOString().slice(0, 4);
  }
}
