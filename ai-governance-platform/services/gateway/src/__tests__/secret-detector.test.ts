import { describeSecrets, findSecrets, redactDeep, redactSecrets, scanTexts } from '../services/secret-detector';
import { checkSecrets } from '../services/secrets-check';

// Built at runtime so this file doesn't itself trip secret scanners.
const j = (...p: string[]) => p.join('');
const SAMPLES: Array<[string, string]> = [
  ['aws_access_key', j('AKIA', 'Q3EGRV7XKZ2PLM4N')],
  ['aws_access_key', j('ASIA', 'Q3EGRV7XKZ2PLM4N')],
  ['anthropic_key', j('sk-ant-', 'api03-', 'a'.repeat(20), 'B9c8D7e6F5g4H3i2J1k0')],
  ['openai_key', j('sk-proj-', 'Ab3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9nP2qR5')],
  ['github_token', j('ghp_', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6')],
  ['github_token', j('github_pat_', '11ABCDEFG0', 'abcdefghijklmnopqrstuvwxyz0123')],
  ['gitlab_token', j('glpat-', 'aB3dE6gH9jK2mN5pQ8sT')],
  ['slack_token', j('xoxb-', '1234567890-abcdefghij')],
  ['slack_webhook', j('https://hooks.slack.com/services/', 'T0123ABCD/B0123ABCD/', 'aB3dE6gH9jK2mN5pQ8sT1vW4')],
  ['stripe_key', j('sk_live_', 'aB3dE6gH9jK2mN5pQ8sT1vW4')],
  ['google_api_key', j('AIza', 'SyA-aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0e')],
  ['google_oauth_secret', j('GOCSPX-', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7b')],
  ['azure_storage_key', j('DefaultEndpointsProtocol=https;AccountName=x;AccountKey=', 'A'.repeat(40), 'b'.repeat(46), '==')],
  ['huggingface_token', j('hf_', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3h')],
  ['npm_token', j('npm_', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6')],
  ['sendgrid_key', j('SG.', 'aB3dE6gH9jK2mN5pQ8sT1v', '.', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9nP2q')],
  ['jwt', j('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')],
  ['private_key', j('-----BEGIN ', 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----')],
  ['connection_string', 'postgres://app:S3cr3tPass@db.internal:5432/orders'],
  ['password', 'password: hunter2024!'],
  ['password', 'client_secret="q8Zr2vLx9TfK"'],
];

describe('secret detector', () => {
  it.each(SAMPLES)('finds a %s', (type, sample) => {
    const text = `Can you help? ${sample} is what I have.`;
    const found = findSecrets(text);
    expect(found.map((f) => f.type)).toEqual([type]);
    expect(redactSecrets(text)).not.toContain(text.slice(found[0].start, found[0].end));
  });

  it('finds an unlabelled AWS secret key pasted after its access key, and keeps it out of the evidence', () => {
    const secret = j('q8Zr2vLx9TfK', '/W3nB7cY1mP5dH0sJ4gA6eU2', 'iR9o');
    const text = `my key is ${j('AKIA', 'Q3EGRV7XKZ2PLM4N')} and secret ${secret} thanks`;
    expect(findSecrets(text).map((f) => f.type)).toEqual(['aws_access_key', 'aws_secret_key']);
    expect(redactSecrets(text)).not.toContain(secret);
    expect(JSON.stringify(scanTexts([text]).evidence)).not.toContain(secret.slice(0, 12));
  });

  it.each([
    ['the AWS docs example key', j('AKIA', 'IOSFODNN7EXAMPLE')],
    ['a placeholder', 'api_key=<your-api-key>'],
    ['a template variable', 'password=${DB_PASSWORD}'],
    ['a code reference', 'password = config.password'],
    ['an environment lookup', 'api_key = process.env.OPENAI_API_KEY'],
    ['a masked value', 'password: ********'],
    ['a short value', 'pwd: abc'],
    ['a phone number', 'call me on 555-123-4567'],
    ['a UUID', 'request 3f2b8c1e-9a7d-4e2f-b6c5-1d0e9f8a7b6c failed'],
    ['a commit hash', 'see commit 9fceb02d0ae598e95dc970b74767f19372d61af8'],
    ['prose about passwords', 'Our password policy needs twelve characters.'],
    ['a connection string without a password', 'postgres://db.internal:5432/orders'],
  ])('ignores %s', (_, text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  it('counts a key once, not also as a password', () => {
    expect(findSecrets(`api_key=${SAMPLES[4][1]}`).map((f) => f.type)).toEqual(['github_token']);
  });

  it('redacts a private key pasted without its end line', () => {
    const cut = j('-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\nabcd');
    expect(redactSecrets(`here:\n${cut}`)).toBe('here:\n[REDACTED private_key]');
  });

  it('builds evidence with no secret in it', () => {
    const [, gh] = SAMPLES[4];
    const [, aws] = SAMPLES[0];
    const scan = scanTexts(['first message', `my token ${gh} and key ${aws} here`]);
    expect(scan).toMatchObject({ types: ['github_token', 'aws_access_key'], count: 2 });
    expect(scan.evidence).toEqual({ before: 'my token ', hit: '[GitHub token]', after: ' and key [REDACTED aws_access_key] here' });
  });

  it('describes what was found in plain words', () => {
    expect(describeSecrets(['AWS access key'])).toBe('an AWS access key');
    expect(describeSecrets(['GitHub token', 'private key'])).toBe('a GitHub token and a private key');
  });

  it('redacts every string in a provider request body', () => {
    const [, gh] = SAMPLES[4];
    const body = { model: 'x', system: [{ type: 'text', text: `use ${gh}` }], messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 };
    const { value, changed } = redactDeep(body);
    expect(changed).toBe(true);
    expect(value).toEqual({ ...body, system: [{ type: 'text', text: 'use [REDACTED github_token]' }] });
    expect(redactDeep({ a: 'nothing here' }).changed).toBe(false);
  });

  it('scans a long prompt quickly', () => {
    const text = 'lorem ipsum password: '.repeat(20000) + SAMPLES[0][1];
    const t = Date.now();
    expect(findSecrets(text).some((f) => f.type === 'aws_access_key')).toBe(true);
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('secrets check', () => {
  const msgs = [{ role: 'user', content: `deploy with ${SAMPLES[0][1]}` }];
  it('blocks by default, with a readable reason and no secret', () => {
    const r = checkSecrets(msgs, 'block');
    expect(r.outcome).toBe('blocked');
    if (r.outcome !== 'blocked') return;
    expect(r.result.reason).toBe('Contains an AWS access key');
    expect(JSON.stringify(r)).not.toContain(SAMPLES[0][1]);
  });
  it('redacts when asked', () => {
    const r = checkSecrets(msgs, 'redact');
    expect(r.outcome === 'redacted' && r.messages[0].content).toBe('deploy with [REDACTED aws_access_key]');
  });
  it('does nothing when off', () => {
    expect(checkSecrets(msgs, 'off')).toEqual({ outcome: 'off', metadata: {} });
  });
});
