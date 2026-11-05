import { toOpenAIResponse } from '../routes/ai.routes';

describe('chat completions response', () => {
  it('uses the OpenAI chat.completion shape with the Probaline request ID as its id', () => {
    const res = toOpenAIResponse({
      requestId: 'req_1', provider: 'openai', modelId: 'gpt-4o-mini', content: 'Hello', inputTokens: 5, outputTokens: 7,
      latencyMs: 12, finishReason: 'stop', timestamp: '2026-10-29T12:00:00.000Z',
    });
    expect(res).toEqual({
      id: 'req_1',
      object: 'chat.completion',
      created: 1793275200,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    });
  });
});
