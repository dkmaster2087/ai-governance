import { summarizeShadowAi } from '../reports/shadow-ai-summary';
import { ShadowAiPolicy } from '../reports/tenant';

const MONITOR: ShadowAiPolicy = { mode: 'monitor', decisions: {} };

describe('summarizeShadowAi', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const range = { from: '2026-10-21T12:00:00.000Z', to: '2026-10-28T12:00:00.000Z', now };
  const events = [
    { domain: 'chatgpt.com', timestamp: '2026-10-27T10:00:00Z', userId: 'alice' },
    { domain: 'chat.openai.com', timestamp: '2026-10-26T10:00:00Z', userId: 'bob' },
    { domain: 'chatgpt.com', timestamp: '2026-10-25T10:00:00Z', userId: 'alice' },
    { domain: 'claude.ai', timestamp: '2026-10-27T11:00:00Z', userId: 'alice', blocked: true },
    { domain: 'chatgpt.com', timestamp: '2026-10-18T10:00:00Z', userId: 'carol' }, // previous week
  ];

  it('groups visits by tool with people and trend', () => {
    const s = summarizeShadowAi(events, MONITOR, range);
    expect(s.totals).toEqual({ people: 2, visits: 4, blockedVisits: 1 });
    const chatgpt = s.tools.find((t) => t.id === 'chatgpt')!;
    expect(chatgpt).toMatchObject({ name: 'ChatGPT', visits: 3, people: 2, previousVisits: 1, decision: 'undecided' });
    expect(s.people[0]).toEqual({ user: 'alice', visits: 3, tools: ['ChatGPT', 'Claude'] });
  });

  it('keeps decided tools listed even without visits', () => {
    const s = summarizeShadowAi(events, { mode: 'monitor', decisions: { deepseek: 'blocked' } }, range);
    expect(s.tools.find((t) => t.id === 'deepseek')).toMatchObject({ visits: 0, decision: 'blocked' });
  });

  it('has no trend when the previous period is older than retention', () => {
    const s = summarizeShadowAi(events, MONITOR, { from: '2026-09-28T12:00:00.000Z', to: range.to, now });
    expect(s.tools[0].previousVisits).toBeNull();
  });
});
