import { toolForDomain, toolById } from '../services/ai-tools';
import { applyPolicyChange, extensionConfig, DEFAULT_SHADOW_POLICY, DEFAULT_GUIDANCE } from '../services/shadow-ai-policy';

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
    expect('policy' in b && b.policy).toEqual({ mode: 'block', decisions: { claude: 'allowed' }, guidance: DEFAULT_GUIDANCE });
  });

  it('rejects unknown tools', () => {
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { decisions: { nope: 'blocked' } })).toEqual({ error: 'Unknown tool: nope' });
  });

  it('turns decisions into what the extension enforces', () => {
    const cfg = extensionConfig('t', { mode: 'monitor', decisions: { chatgpt: 'blocked', claude: 'allowed' }, guidance: DEFAULT_GUIDANCE });
    expect(cfg.enforcedDomains).toEqual(['chatgpt.com', 'chat.openai.com']);
    expect(cfg.allowedDomains).toEqual(['claude.ai']);
    expect(cfg.blockedDomains).toContain('gemini.google.com');
    expect(cfg.mode).toBe('monitor');
  });
});

describe('block page guidance', () => {
  const internal = { name: 'Acme Assistant', url: 'https://assistant.acme.example' };

  it('lists the company’s own links first, then approved tools, without repeats', () => {
    const r = applyPolicyChange(DEFAULT_SHADOW_POLICY, {
      decisions: { claude: 'allowed', chatgpt: 'blocked' },
      guidance: { message: 'Use the approved tools.', links: [internal, { name: 'Claude', url: 'https://claude.ai' }] },
    });
    const cfg = extensionConfig('t', (r as any).policy);
    expect(cfg.blockPage).toEqual({ message: 'Use the approved tools.', links: [internal, { name: 'Claude', url: 'https://claude.ai' }] });
  });

  it('accepts only named https links, at most five', () => {
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { guidance: { links: [{ name: 'x', url: 'javascript:alert(1)' }] } })).toHaveProperty('error');
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { guidance: { links: [{ name: 'x', url: 'http://plain.example' }] } })).toHaveProperty('error');
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { guidance: { links: [{ name: ' ', url: 'https://a.example' }] } })).toHaveProperty('error');
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `L${i}`, url: `https://l${i}.example` }));
    expect(applyPolicyChange(DEFAULT_SHADOW_POLICY, { guidance: { links: six } })).toHaveProperty('error');
  });

  it('falls back to the default message when cleared', () => {
    const r = applyPolicyChange(DEFAULT_SHADOW_POLICY, { guidance: { message: '  ' } });
    expect((r as any).policy.guidance.message).toBe(DEFAULT_GUIDANCE.message);
  });
});
