import { FastifyInstance } from 'fastify';
import { ReportingAgent } from '../agent';

export async function statusRoutes(app: FastifyInstance) {
  const agent = ReportingAgent.getInstance();

  /** Get agent status */
  app.get('/', async () => {
    return agent.getStatus();
  });
}
