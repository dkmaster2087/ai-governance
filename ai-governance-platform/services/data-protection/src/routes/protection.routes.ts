import { FastifyInstance } from 'fastify';
import { PIIDetectionService } from '../services/pii-detection.service';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';

export async function protectionRoutes(app: FastifyInstance) {
  const piiService = new PIIDetectionService();

  app.post('/request', async (request) => {
    const aiRequest = request.body as NormalizedAIRequest;
    return piiService.protectRequest(aiRequest);
  });

  app.post('/response', async (request) => {
    const aiResponse = request.body as NormalizedAIResponse;
    return piiService.filterResponse(aiResponse);
  });
}
