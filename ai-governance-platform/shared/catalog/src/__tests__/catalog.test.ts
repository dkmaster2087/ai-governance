import { CATALOG, CATALOG_VERSION, catalogDomains, serviceById, serviceForAppName, serviceForDomain } from '..';

describe('AI catalog', () => {
  it('has unique ids, aliases and domains', () => {
    const ids = CATALOG.flatMap((s) => [s.id, ...(s.aliases ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
    const domains = CATALOG.flatMap((s) => s.domains);
    expect(new Set(domains).size).toBe(domains.length);
    expect(CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches exact and parent domains, longest first', () => {
    expect(serviceForDomain('chatgpt.com')?.id).toBe('chatgpt');
    expect(serviceForDomain('Chat.OpenAI.com.')?.id).toBe('chatgpt');
    expect(serviceForDomain('www.perplexity.ai')?.id).toBe('perplexity');
    expect(serviceForDomain('api.perplexity.ai')?.id).toBe('perplexity-api');
    expect(serviceForDomain('deepseek.com')?.id).toBe('deepseek');
    expect(serviceForDomain('api.deepseek.com')?.id).toBe('deepseek-api');
    expect(serviceForDomain('api-inference.huggingface.co')?.id).toBe('hf-inference');
    expect(serviceForDomain('notopenai.com')).toBeUndefined();
    expect(serviceForDomain('')).toBeUndefined();
  });

  it('matches cloud endpoints by pattern', () => {
    expect(serviceForDomain('bedrock-runtime.eu-west-1.amazonaws.com')?.id).toBe('aws-bedrock');
    expect(serviceForDomain('acme.openai.azure.com')?.id).toBe('azure-openai');
    expect(serviceForDomain('s3.eu-west-1.amazonaws.com')).toBeUndefined();
  });

  it('finds services by earlier ids', () => {
    expect(serviceById('mistral')?.id).toBe('mistral-chat');
    expect(serviceById('huggingface')?.id).toBe('huggingchat');
    expect(serviceById('nope')).toBeUndefined();
  });

  it('matches app names word for word', () => {
    expect(serviceForAppName('ChatGPT Enterprise (Prod)')?.id).toBe('chatgpt');
    expect(serviceForAppName('Cursor Analytics Dashboard')?.id).toBe('cursor');
    expect(serviceForAppName('Precursor')).toBeUndefined();
  });

  it('lists domains by category', () => {
    const chat = catalogDomains(['chat']);
    expect(chat).toContain('claude.ai');
    expect(chat).not.toContain('api.openai.com');
    expect(catalogDomains().length).toBeGreaterThan(chat.length);
  });

  it('gives chat apps an https link for the block page', () => {
    for (const s of CATALOG.filter((x) => x.url)) expect(s.url).toMatch(/^https:\/\//);
  });
});
