import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NormalizedAIRequest } from '@ai-governance/types';
import { BedrockProvider, finishReason, toConverse } from '../providers/bedrock.provider';

const request = (over: Partial<NormalizedAIRequest> = {}): NormalizedAIRequest => ({
  requestId: 'r1', tenantId: 't', userId: 'u', appId: 'a', provider: 'bedrock', modelId: 'us.amazon.nova-micro-v1:0',
  messages: [{ role: 'user', content: 'Hello' }], metadata: {}, timestamp: new Date().toISOString(), ...over,
});

describe('Bedrock through Converse', () => {
  const send = jest.spyOn(BedrockRuntimeClient.prototype, 'send');
  afterEach(() => send.mockReset());

  it('moves system instructions out of the turns and joins consecutive turns from one side', () => {
    const { system, messages } = toConverse(request({
      systemPrompt: 'Be brief.',
      messages: [
        { role: 'system', content: 'Answer in English.' },
        { role: 'user', content: 'First part.' },
        { role: 'user', content: 'Second part.' },
        { role: 'assistant', content: 'OK.' },
        { role: 'user', content: '' },
        { role: 'user', content: 'Go on.' },
      ],
    }));
    expect(system).toEqual([{ text: 'Be brief.' }, { text: 'Answer in English.' }]);
    expect(messages).toEqual([
      { role: 'user', content: [{ text: 'First part.' }, { text: 'Second part.' }] },
      { role: 'assistant', content: [{ text: 'OK.' }] },
      { role: 'user', content: [{ text: 'Go on.' }] },
    ]);
  });

  it('answers from any model with the text, token counts and stop reason', async () => {
    send.mockResolvedValue({ output: { message: { role: 'assistant', content: [{ text: 'Hi ' }, { text: 'there.' }] } }, usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }, stopReason: 'end_turn' } as never);
    const res = await new BedrockProvider().complete(request({ maxTokens: 50, temperature: 0.2 }));
    expect(res).toMatchObject({ content: 'Hi there.', inputTokens: 7, outputTokens: 3, finishReason: 'stop', provider: 'bedrock', modelId: 'us.amazon.nova-micro-v1:0' });
    const cmd = send.mock.calls[0][0] as ConverseCommand;
    expect(cmd).toBeInstanceOf(ConverseCommand);
    expect(cmd.input).toMatchObject({ modelId: 'us.amazon.nova-micro-v1:0', inferenceConfig: { maxTokens: 50, temperature: 0.2 } });
    expect(cmd.input.system).toBeUndefined();
  });

  it('reports why it stopped in the words OpenAI clients expect', () => {
    expect(['end_turn', 'stop_sequence', 'max_tokens', 'guardrail_intervened', 'tool_use'].map(finishReason)).toEqual(['stop', 'stop', 'length', 'content_filter', 'tool_calls']);
  });

  it('reports a refusal as a provider error with Bedrock’s reason', async () => {
    send.mockRejectedValue(new Error('model is not available for this account') as never);
    await expect(new BedrockProvider().complete(request())).rejects.toThrow('model is not available for this account');
  });

  it('streams text, then the stop reason and token counts', async () => {
    async function* events() {
      yield { messageStart: { role: 'assistant' } };
      yield { contentBlockDelta: { delta: { text: 'Hel' }, contentBlockIndex: 0 } };
      yield { contentBlockDelta: { delta: { text: 'lo' }, contentBlockIndex: 0 } };
      yield { messageStop: { stopReason: 'end_turn' } };
      yield { metadata: { usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } };
    }
    send.mockResolvedValue({ stream: events() } as never);
    const out = [];
    for await (const d of new BedrockProvider().stream(request())) out.push(d);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ConverseStreamCommand);
    expect(out).toEqual([{ text: 'Hel' }, { text: 'lo' }, { finishReason: 'stop' }, { inputTokens: 4, outputTokens: 2 }]);
  });

  it('turns an error inside the stream into a provider error', async () => {
    async function* events() {
      yield { contentBlockDelta: { delta: { text: 'Par' }, contentBlockIndex: 0 } };
      yield { throttlingException: { message: 'Too many requests' } };
    }
    send.mockResolvedValue({ stream: events() } as never);
    const out: unknown[] = [];
    await expect((async () => { for await (const d of new BedrockProvider().stream(request())) out.push(d); })()).rejects.toThrow('Too many requests');
    expect(out).toEqual([{ text: 'Par' }]);
  });
});
