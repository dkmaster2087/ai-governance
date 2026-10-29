import { toolForDomain, toolById } from '../services/ai-tools';
import { applyPolicyChange, extensionConfig, DEFAULT_SHADOW_POLICY } from '../services/shadow-ai-policy';
import { summarizeShadowAi } from '../services/shadow-ai-summary';

describe('AI tool catalog', () => {
  it('groups domains and subdomains into tools', () => {
    expect(toolForDomain('chatgpt.com').id).toBe('chatgpt');
    expect(toolForDomain('chat.openai.com').id).toBe('chatgpt');
    expect(toolForDomain('www.perplexity.ai').id).toBe('perplexity');
  });

  it('treats unknown domains as their own tool', () => {
    expect(toolForDomain('new-ai.example').id).toBe('domain:new-ai.example');
    expect(toolById('domain:new-ai.example')?.domains).toEqual(['new-ai.example']);
    expect(toolById('domain:bad domain!')).toBeNull();
    expect(toolById('not-a-tool')).toBeNull();
  });
});

describe('shadow AI policy', () => {
  it('sets and clears decisions', () => {
    const a = applyPolicyChange(DEFAULT_SHADOW_POLICY, { decisions: { chatgpt: 'blocked', claude: 'allowed' } });
    expect('policy' in a && a.policy.decisions).toEqual({ chatgpt: 'blocked', claude: 'allowed' });
    const b = applyPolicyChange((a as any).policy, { decisions: { chatgpt: null }, mode: 'block' });
    expect('policy' in b && b.policy).toEqual({ mode: 'block', decisions: { claude: 'allowed' } });
  });

  it('rejects unknown tools', () => {
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { decisions: { nope: 'blocked' } })).toEqual({ error: 'Unknown tool: nope' });
  });

  it('turns decisions into what the extension enforces', () => {
    const cfg = extensionConfig('t', { mode: 'monitor', decisions: { chatgpt: 'blocked', claude: 'allowed' } });
    expect(cfg.enforcedDomains).toEqual(['chatgpt.com', 'chat.openai.com']);
    expect(cfg.allowedDomains).toEqual(['claude.ai']);
    expect(cfg.blockedDomains).toContain('gemini.google.com');
    expect(cfg.mode).toBe('monitor');
  });
});

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
    const s = summarizeShadowAi(events, DEFAULT_SHADOW_POLICY, range);
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
    const s = summarizeShadowAi(events, DEFAULT_SHADOW_POLICY, { from: '2026-09-28T12:00:00.000Z', to: range.to, now });
    expect(s.tools[0].previousVisits).toBeNull();
  });
});
