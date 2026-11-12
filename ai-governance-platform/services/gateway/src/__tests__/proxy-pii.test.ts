import { maskPromptFields } from '../services/proxy-pii';
import { PIIDetectionService } from '../data-protection/pii-detection.service';

const pii = new PIIDetectionService();
const mask = (t: string) => pii.maskText(t);
const EMAIL = 'jane.doe@example.com';

describe('personal data in proxy mode (IDEs and tools)', () => {
  it('cleans OpenAI and Mistral messages, string or text parts, and leaves everything else as sent', async () => {
    const body: any = {
      model: 'gpt-4o', stream: true, user: 'dev-42', tools: [{ type: 'function', function: { name: 'email_user', description: `e.g. ${EMAIL}` } }],
      messages: [
        { role: 'system', content: 'You review code.' },
        { role: 'user', content: [{ type: 'text', text: `Email ${EMAIL} about it` }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'email_user', arguments: `{"to":"${EMAIL}"}` } }] },
        { role: 'tool', tool_call_id: 'call_1', content: `Sent to ${EMAIL}` },
      ],
    };
    const { body: out, changed } = await maskPromptFields(body, mask);
    expect(changed).toBe(true);
    const json = JSON.stringify(out.messages);
    expect(json).not.toMatch(/jane\.doe@example\.com(?!\\"})/); // only the assistant's own tool call keeps it
    expect(out.messages[1].content[0].text).not.toContain(EMAIL);
    expect(out.messages[1].content[1]).toEqual(body.messages[1].content[1]);
    expect(out.messages[2]).toEqual(body.messages[2]);
    expect(out.messages[3].content).not.toContain(EMAIL);
    // Not prompt text: model, tool definitions and IDs are untouched.
    expect({ model: out.model, tools: out.tools, user: out.user, stream: out.stream }).toEqual({ model: body.model, tools: body.tools, user: body.user, stream: true });
  });

  it('cleans Anthropic system prompts and tool results, but not the assistant’s tool calls', async () => {
    const body: any = {
      model: 'claude', system: [{ type: 'text', text: `Owner: ${EMAIL}` }],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup', input: { email: EMAIL } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: `SSN 123-45-6789 for ${EMAIL}` }] }] },
      ],
    };
    const { body: out } = await maskPromptFields(body, mask);
    expect(out.system[0].text).not.toContain(EMAIL);
    expect(out.messages[0]).toEqual(body.messages[0]);
    const result = JSON.stringify(out.messages[1]);
    expect(result).not.toContain(EMAIL);
    expect(result).not.toContain('123-45-6789');
    expect(out.messages[1].content[0].tool_use_id).toBe('t1');
  });

  it('cleans Cohere’s message, preamble and chat history, and says when nothing changed', async () => {
    const { body: out } = await maskPromptFields({ message: `call 415-555-0134`, preamble: `for ${EMAIL}`, chat_history: [{ role: 'USER', message: `me: ${EMAIL}` }] }, mask);
    expect(JSON.stringify(out)).not.toMatch(/415-555-0134|jane\.doe/);
    expect((await maskPromptFields({ model: 'm', messages: [{ role: 'user', content: 'refactor this' }] }, mask)).changed).toBe(false);
  });
});
