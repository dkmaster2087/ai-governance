import { LineReader, parseOnpremLine, parseOnpremText } from '../onprem/parsers';
import { hostOf, leefFields, timeOf, w3cFields } from '../sse/parsers';

const NOW = new Date('2026-11-05T12:00:00Z');
const one = (line: string) => parseOnpremLine(line, NOW);

describe('Zscaler web logs', () => {
  it('reads the JSON feed', () => {
    const line = '<134>1 2026-11-05T09:14:02Z nss01 - - - - {"sourcetype":"zscalernss-web","event":{"datetime":"Thu Nov  5 09:14:02 2026","action":"Allowed","login":"jdoe@acme.example","cip":"10.20.1.15","hostname":"chatgpt.com","url":"chatgpt.com/backend-api/conversation","urlcategory":"Generative AI","appclass":"General Browsing","requestsize":"18342","vendor":"Zscaler","product":"NSS"}}';
    expect(one(line)).toEqual({ time: new Date('2026-11-05T09:14:02Z'), domain: 'chatgpt.com', who: { type: 'user', value: 'jdoe@acme.example' }, source: 'zscaler', bytesOut: 18342 });
  });

  it('reads a flat JSON record and uses epochtime', () => {
    const o = one('{"epochtime":"1793869200","login":"a.khan","cip":"10.0.0.9","url":"https://claude.ai/api/organizations","urlcategory":"AI and ML Applications","vendor":"Zscaler"}');
    expect(o).toMatchObject({ domain: 'claude.ai', who: { type: 'user', value: 'a.khan' }, source: 'zscaler' });
    expect(new Date(o!.time as Date).toISOString()).toBe('2026-11-05T09:00:00.000Z');
  });

  it('reads the LEEF (QRadar) feed', () => {
    const line = '<13>Nov  5 09:20:11 nss01 LEEF:1.0|Zscaler|NSSWeblog|5.7|Allowed|cat=Generative AI\tdevTime=1793870411\tsrc=10.20.1.16\tusrName=m.chen@acme.example\turl=gemini.google.com/app\thost=gemini.google.com\treqsize=5120';
    expect(one(line)).toMatchObject({ domain: 'gemini.google.com', who: { type: 'user', value: 'm.chen@acme.example' }, source: 'zscaler', bytesOut: 5120 });
  });

  it('reads the key=value (Splunk) feed', () => {
    const o = one('datetime="Thu Nov  5 10:01:00 2026" action=Allowed login=s.ortiz@acme.example cip=10.1.1.4 url=https://www.perplexity.ai/search urlcategory="Generative AI" appclass=General');
    expect(o).toMatchObject({ domain: 'www.perplexity.ai', who: { type: 'user', value: 's.ortiz@acme.example' }, source: 'zscaler' });
  });

  it('labels Zscaler CEF as Zscaler', () => {
    const o = one('<134>Nov  5 10:02:00 nss01 CEF:0|Zscaler|NSSWeblog|5.7|Allowed|Allowed|3|act=Allowed suser=r.lee@acme.example src=10.1.1.5 dhost=api.openai.com request=https://api.openai.com/v1/chat/completions out=900');
    expect(o).toMatchObject({ domain: 'api.openai.com', source: 'zscaler', bytesOut: 900 });
  });

  it('falls back to the client IP when no one is signed in', () => {
    expect(one('{"login":"Unknown","cip":"10.9.9.9","hostname":"chatgpt.com","urlcategory":"Generative AI"}')?.who).toEqual({ type: 'ip', value: '10.9.9.9' });
  });
});

describe('Netskope events', () => {
  it('reads Cloud Log Shipper JSON page events', () => {
    const o = one('{"_id":"e1","timestamp":1793869500,"type":"page","access_method":"Client","user":"jdoe@acme.example","ur_normalized":"jdoe@acme.example","srcip":"192.168.1.20","domain":"chat.openai.com","url":"chat.openai.com/c/123","app":"ChatGPT","appcategory":"Generative AI","client_bytes":2048}');
    expect(o).toMatchObject({ domain: 'chat.openai.com', who: { type: 'user', value: 'jdoe@acme.example' }, source: 'netskope', bytesOut: 2048 });
  });

  it('labels Netskope CEF as Netskope', () => {
    expect(one('CEF:0|Netskope|Netskope|NA|page|page|0|suser=k.ng@acme.example src=10.2.2.2 dhost=copilot.microsoft.com')?.source).toBe('netskope');
  });

  it('reads a CSV transaction file with a header row', () => {
    const text = [
      'date,time,time-taken,cs-bytes,sc-bytes,c-ip,cs-username,cs-method,cs-host,cs-uri,x-cs-app,x-cs-access-method',
      '2026-11-05,09:30:00,120,4096,800,10.3.3.3,p.shah@acme.example,POST,api.anthropic.com,/v1/messages,Anthropic,Client',
      '2026-11-05,09:31:00,80,100,200,10.3.3.4,-,GET,www.example.com,/,Example,Client',
    ].join('\n');
    const out = [...parseOnpremText(text, NOW)];
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ time: new Date('2026-11-05T09:30:00Z'), domain: 'api.anthropic.com', who: { type: 'user', value: 'p.shah@acme.example' }, source: 'netskope', bytesOut: 4096 });
    expect(out[1].who).toEqual({ type: 'ip', value: '10.3.3.4' });
  });

  it('reads a W3C file with a #Fields line', () => {
    const text = [
      '#Version: 1.0',
      '#Fields: date time c-ip cs-username cs-host cs-uri cs-bytes x-cs-app',
      '2026-11-05 09:40:00 10.4.4.4 "l.wu@acme.example" claude.ai /new 512 "Claude AI"',
    ].join('\n');
    expect([...parseOnpremText(text, NOW)]).toEqual([
      { time: new Date('2026-11-05T09:40:00Z'), domain: 'claude.ai', who: { type: 'user', value: 'l.wu@acme.example' }, source: 'netskope', bytesOut: 512 },
    ]);
  });

  it('remembers a header across reads, so a tailed file resumes after a restart', () => {
    const first = new LineReader();
    first.read('date,time,c-ip,cs-username,cs-host,cs-uri', NOW);
    const resumed = new LineReader(first.header);
    expect(resumed.read('2026-11-05,10:00:00,10.5.5.5,z.ali@acme.example,chatgpt.com,/', NOW)).toMatchObject({ domain: 'chatgpt.com', source: 'netskope' });
  });
});

describe('other LEEF devices', () => {
  it('are read as LEEF', () => {
    expect(one('LEEF:2.0|Acme|WebGateway|1.0|allow|^|usrName=t.ray^src=10.6.6.6^url=https://chatgpt.com/^devTime=1793869200')).toMatchObject({ domain: 'chatgpt.com', source: 'syslog_leef' });
  });
});

describe('does not misread', () => {
  it.each([
    ['ordinary JSON', '{"level":"info","msg":"started","host":"web01"}'],
    ['a Fortinet line', 'date=2026-11-05 time=09:00:00 devname="fw1" devid="FG100" logid="0316013056" type="utm" hostname="chatgpt.com" srcip=10.0.0.1'],
    ['a CSV line without a header', '2026-11-05,09:30:00,10.3.3.3,chatgpt.com'],
    ['a header-like line with no Netskope columns', 'date,time,host,path'],
  ])('%s', (_, line) => {
    const o = one(line);
    expect(o?.source === 'zscaler' || o?.source === 'netskope').toBe(false);
  });
});

describe('helpers', () => {
  it('reads times in the formats these products use', () => {
    expect(timeOf('1793869200')?.toISOString()).toBe('2026-11-05T09:00:00.000Z');
    expect(timeOf('1793869200000')?.toISOString()).toBe('2026-11-05T09:00:00.000Z');
    expect(timeOf('Thu Nov  5 09:14:02 2026')?.toISOString()).toBe('2026-11-05T09:14:02.000Z');
    expect(timeOf('2026-11-05 09:30:00')?.toISOString()).toBe('2026-11-05T09:30:00.000Z');
  });
  it('decodes percent-encoded URLs', () => {
    expect(hostOf('https%3A%2F%2Fchatgpt.com%2Fc%2F1')).toBe('chatgpt.com');
  });
  it('splits LEEF 2.0 with a hex delimiter, and W3C quoted fields', () => {
    expect(leefFields('LEEF:2.0|V|P|1|E|x5E|a=1^b=2')?.fields).toEqual({ a: '1', b: '2' });
    expect(w3cFields('a "b c" d')).toEqual(['a', 'b c', 'd']);
  });
});
