import { FastifyInstance } from 'fastify';
import { ReportingAgent } from '../agent';

export async function configRoutes(app: FastifyInstance) {
  const agent = ReportingAgent.getInstance();

  /** Get current reporting configuration */
  app.get('/', async () => {
    const config = agent.getConfig();
    // Don't expose the full license key
    return { ...config, licenseKey: config.licenseKey ? config.licenseKey.slice(0, 10) + '...' : '' };
  });

  /** Update reporting configuration */
  app.put('/', async (request, reply) => {
    const body = request.body as any;
    agent.configure(body);

    // If enabling, start the agent
    if (body.enabled && body.licenseKey) {
      agent.start();
    } else if (body.enabled === false) {
      agent.stop();
    }

    return reply.send({ success: true, config: agent.getConfig() });
  });

  /** Validate license key */
  app.post('/validate-license', async (_request, reply) => {
    const valid = await agent.validateLicense();
    return reply.send({ valid });
  });

  /** Trigger an immediate report */
  app.post('/report-now', async (_request, reply) => {
    await agent.report();
    return reply.send({ success: true, status: agent.getStatus() });
  });
}
