import { HOLD, StreamMasker } from '../services/stream-masker';

const run = (chunks: string[]) => {
  const m = new StreamMasker();
  return chunks.map((c) => m.push(c)).join('') + m.end();
};

describe('stream masker', () => {
  it('catches a phone number and an email split across chunks', () => {
    const out = run(['Call me on 415-55', '5-0134 or write to jane.d', 'oe@example.com today. ', 'x'.repeat(10)]);
    expect(out).not.toContain('415-555-0134');
    expect(out).not.toContain('jane.doe@example.com');
    expect(out).toContain('[PHONE REDACTED]');
  });

  it('catches a card number delivered one character at a time', () => {
    const out = run([...'Card: 4111 1111 1111 1111 thanks. And more text after it to push it out.']);
    expect(out).not.toContain('4111 1111 1111 1111');
  });

  it('releases text once enough has arrived, and nothing is lost', () => {
    const m = new StreamMasker();
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    let released = '';
    for (const ch of words.match(/.{1,7}/g)!) released += m.push(ch);
    expect(released.length).toBeGreaterThan(0);
    expect(words.length - released.length).toBeLessThanOrEqual(HOLD + 10);
    expect(released + m.end()).toBe(words);
  });

  it('leaves clean text unchanged', () => {
    expect(run(['Hello ', 'there, ', 'how can I help?'])).toBe('Hello there, how can I help?');
  });
});
