import { FastifyInstance } from 'fastify';
import { PolicyEvaluator } from '../services/policy.evaluator';

export async function evaluateRoutes(app: FastifyInstance) {
  const evaluator = new PolicyEvaluator();

  app.post('/evaluate', async (request, reply) => {
    const result = await evaluator.evaluate(request.body as any);
    return reply.send(result);
  });
}
