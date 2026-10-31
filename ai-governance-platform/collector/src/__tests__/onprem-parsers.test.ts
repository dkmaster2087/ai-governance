import { cefExtension, csv, decodeWindowsName, hostOf, keyValues, parseOnpremLine, parseOnpremText, unwrapSyslog } from '../onprem/parsers';

const NOW = new Date('2026-10-31T12:00:00Z');

describe('syslog headers', () => {
  it('unwraps RFC 5424', () => {
    const f = unwrapSyslog('<134>1 2026-10-30T10:00:00.000Z fw01 PAN-OS - - - 1,2026/10/30 10:00:00,x', NOW);
    expect(f).toEqual({ time: new Date('2026-10-30T10:00:00Z'), host: 'fw01', msg: '1,2026/10/30 10:00:00,x' });
  });

  it('unwraps RFC 5424 with structured data', () => {
    expect(unwrapSyslog('<134>1 2026-10-30T10:00:00Z h app 1 ID [ex@1 a="b"][x@2 c="d"] hello', NOW).msg).toBe('hello');
  });

  it('unwraps RFC 3164 and guesses the year', () => {
    expect(unwrapSyslog('<189>Oct 30 10:00:00 fgt01 logid="0316013056"', NOW)).toEqual({ time: new Date('2026-10-30T10:00:00Z'), host: 'fgt01', msg: 'logid="0316013056"' });
    expect(unwrapSyslog('<189>Dec 31 23:00:00 h x', new Date('2027-01-01T01:00:00Z')).time).toEqual(new Date('2026-12-31T23:00:00Z'));
  });

  it('passes plain lines through', () => {
    expect(unwrapSyslog('just text', NOW)).toEqual({ msg: 'just text' });
  });
});

describe('helpers', () => {
  it('takes the host from URLs, host:port and bare names, and rejects the rest', () => {
    expect(hostOf('https://chatgpt.com/c/123?q=secret')).toBe('chatgpt.com');
    expect(hostOf('api.openai.com:443')).toBe('api.openai.com');
    expect(hostOf('"claude.ai/new"')).toBe('claude.ai');
    expect(hostOf('user:pw@api.mistral.ai/v1')).toBe('api.mistral.ai');
    expect(hostOf('10.0.0.1')).toBeUndefined();
    expect(hostOf('-')).toBeUndefined();
    expect(hostOf('[2001:db8::1]:443')).toBeUndefined();
  });

  it('reads key=value, CEF extensions and CSV', () => {
    expect(keyValues('a=1 b="two words" c=')).toEqual({ a: '1', b: 'two words', c: '' });
    expect(cefExtension('src=10.0.0.5 dhost=api.openai.com request=https://api.openai.com/v1 msg=a\\=b and more')).toEqual({ src: '10.0.0.5', dhost: 'api.openai.com', request: 'https://api.openai.com/v1', msg: 'a=b and more' });
    expect(csv('a,"b,c","d ""q"""')).toEqual(['a', 'b,c', 'd "q"']);
    expect(decodeWindowsName('(7)chatgpt(3)com(0)')).toBe('chatgpt.com');
  });
});

describe('products', () => {
  it('Palo Alto URL filtering (THREAT/url) with a user', () => {
    const fields = Array(40).fill('');
    Object.assign(fields, { 0: '1', 1: '2026/10/30 10:15:00', 2: '012801012345', 3: 'THREAT', 4: 'url', 7: '10.1.2.3', 8: '104.18.32.47', 12: 'acme\\jdoe', 14: 'openai-chatgpt', 31: '"chatgpt.com/backend-api/conversation"' });
    const o = parseOnpremLine(`<14>1 2026-10-30T10:15:01Z pa-fw01 - - - - ${fields.join(',')}`, NOW)!;
    expect(o).toMatchObject({ domain: 'chatgpt.com', who: { type: 'user', value: 'acme\\jdoe' }, source: 'syslog_paloalto' });
    expect(new Date(o.time)).toEqual(new Date('2026-10-30T10:15:00Z'));
  });

  it('ignores Palo Alto traffic logs (no URL in them)', () => {
    const fields = Array(40).fill('');
    Object.assign(fields, { 0: '1', 1: '2026/10/30 10:15:00', 3: 'TRAFFIC', 4: 'end', 7: '10.1.2.3' });
    expect(parseOnpremLine(fields.join(','), NOW)).toBeNull();
  });

  it('Fortinet web filter, DNS, and bytes sent', () => {
    const web = parseOnpremLine('<189>date=2026-10-30 time=10:20:00 devname="FGT-HQ" devid="FG100F" eventtime=1793355600123456789 logid="0316013056" type="utm" subtype="webfilter" srcip=10.2.0.8 user="m.okoro" hostname="claude.ai" url="https://claude.ai/new" sentbyte=5120', NOW)!;
    expect(web).toMatchObject({ domain: 'claude.ai', who: { type: 'user', value: 'm.okoro' }, source: 'syslog_fortinet', bytesOut: 5120 });
    expect(new Date(web.time).toISOString()).toBe('2026-10-30T10:20:00.123Z');
    const dns = parseOnpremLine('date=2026-10-30 time=10:21:00 devid="FG100F" logid="1501054802" type="utm" subtype="dns" srcip=10.2.0.9 qname="api.openai.com"', NOW)!;
    expect(dns).toMatchObject({ domain: 'api.openai.com', who: { type: 'ip', value: '10.2.0.9' } });
    expect(new Date(dns.time).toISOString()).toBe('2026-10-30T10:21:00.000Z');
  });

  it('CEF from any vendor (here Check Point), with a user and epoch time', () => {
    const o = parseOnpremLine('<134>Oct 30 10:30:00 cp-gw CEF:0|Check Point|URL Filtering|R81|Allow|https traffic|1|rt=1793356200000 src=10.3.0.4 suser=alice@acme.example dhost=gemini.google.com request=https://gemini.google.com/app out=880', NOW)!;
    expect(o).toMatchObject({ domain: 'gemini.google.com', who: { type: 'user', value: 'alice@acme.example' }, source: 'syslog_cef', bytesOut: 880 });
    expect(new Date(o.time).toISOString()).toBe('2026-10-30T10:30:00.000Z');
  });

  it('Squid native access log, including CONNECT', () => {
    const lines = [
      '1793356800.123    245 10.4.0.7 TCP_TUNNEL/200 6234 CONNECT api.anthropic.com:443 - HIER_DIRECT/160.79.104.10 -',
      '1793356801.456     12 10.4.0.8 TCP_MISS/200 512 GET http://www.perplexity.ai/search?q=secret bob HIER_DIRECT/1.2.3.4 text/html',
    ].join('\n');
    const obs = [...parseOnpremText(lines, NOW)];
    expect(obs.map((o) => [o.domain, o.who])).toEqual([
      ['api.anthropic.com', { type: 'ip', value: '10.4.0.7' }],
      ['www.perplexity.ai', { type: 'user', value: 'bob' }],
    ]);
    expect(JSON.stringify(obs)).not.toContain('secret');
  });

  it('BIND query logs, with and without views', () => {
    const a = parseOnpremLine('30-Oct-2026 10:40:00.123 queries: info: client @0x7f2a1c0 10.5.0.11#53412 (chat.deepseek.com): query: chat.deepseek.com IN A +E(0)K (10.5.0.1)', NOW)!;
    expect(a).toMatchObject({ domain: 'chat.deepseek.com', who: { type: 'ip', value: '10.5.0.11' }, source: 'bind_dns' });
    expect(new Date(a.time).toISOString()).toBe('2026-10-30T10:40:00.000Z');
    expect(parseOnpremLine('client 10.5.0.12#5353: view internal: query: grok.com IN AAAA + (10.5.0.1)', NOW)!.domain).toBe('grok.com');
  });

  it('Windows DNS debug log', () => {
    const o = parseOnpremLine('10/30/2026 2:45:07 PM 0E58 PACKET  000000D3C2A5B1C0 UDP Rcv 10.6.0.21      d1f0   Q [0001   D   NOERROR] A      (7)chatgpt(3)com(0)', NOW)!;
    expect(o).toMatchObject({ domain: 'chatgpt.com', who: { type: 'ip', value: '10.6.0.21' }, source: 'windows_dns' });
    expect(new Date(o.time).toISOString()).toBe('2026-10-30T14:45:07.000Z');
  });

  it('returns nothing for unrelated or oversized lines', () => {
    expect(parseOnpremLine('<13>Oct 30 10:00:00 host sshd[1]: Accepted publickey for root', NOW)).toBeNull();
    expect(parseOnpremLine('x'.repeat(70_000), NOW)).toBeNull();
  });
});
