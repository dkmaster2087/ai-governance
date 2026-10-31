import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, DEDUPE_WINDOW_MS, blockingRules, effectiveConfig, isBlocked, isManaged, pruneSeen, safeLinks, sighting } from '../lib.js';

const cfg = (over = {}) => ({ ...DEFAULTS, ...over });

test('IT policy wins over the gateway and over the popup', () => {
  const c = effectiveConfig({
    local: { gatewayUrl: 'https://typed.example', apiKey: 'typed' },
    remote: { mode: 'block', gatewayUrl: 'https://evil.example', apiKey: 'evil' },
    managed: { gatewayUrl: 'https://gw.acme.example', apiKey: 'managed' },
  });
  assert.equal(c.gatewayUrl, 'https://gw.acme.example');
  assert.equal(c.apiKey, 'managed');
  assert.equal(c.mode, 'block', 'decisions still come from the gateway');
});

test('the gateway cannot change where the extension reports', () => {
  const c = effectiveConfig({ local: { gatewayUrl: 'https://gw.example', apiKey: 'k' }, remote: { gatewayUrl: 'https://evil.example', identifyUsers: true } });
  assert.equal(c.gatewayUrl, 'https://gw.example');
  assert.equal(c.identifyUsers, false);
});

test('typed settings are ignored once IT manages the install', () => {
  const c = effectiveConfig({ local: { apiKey: 'typed' }, managed: { gatewayUrl: 'https://gw.example' } });
  assert.equal(c.apiKey, '');
  assert.equal(isManaged({ gatewayUrl: 'x' }), true);
  assert.equal(isManaged({}), false);
});

test('monitor by default: nothing is blocked until the company decides', () => {
  const c = effectiveConfig();
  assert.equal(c.mode, 'monitor');
  assert.equal(isBlocked('chatgpt.com', c), false);
  assert.deepEqual(blockingRules(c), []);
});

test('blocked tools open the block page; background calls are refused', () => {
  const c = cfg({ enforcedDomains: ['chat.deepseek.com'] });
  const rules = blockingRules(c);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].action.redirect.extensionPath, '/blocked.html?domain=chat.deepseek.com');
  assert.deepEqual(rules[0].condition.resourceTypes, ['main_frame']);
  assert.equal(rules[1].action.type, 'block');
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'rule ids are unique');
});

test('approved tools are never blocked, even in block mode', () => {
  const c = cfg({ mode: 'block', allowedDomains: ['claude.ai'] });
  assert.equal(isBlocked('claude.ai', c), false);
  assert.equal(isBlocked('chatgpt.com', c), true);
  assert.ok(!blockingRules(c).some((r) => r.condition.urlFilter === '||claude.ai'));
});

test('records the domain only, never the address', () => {
  const evt = sighting({ url: 'https://www.perplexity.ai/search?q=acme+layoffs+plan', type: 'main_frame' }, cfg(), { user: 'device-1' });
  assert.equal(evt.domain, 'www.perplexity.ai');
  assert.equal(evt.type, 'visit');
  assert.equal(evt.userId, 'device-1');
  assert.equal(evt.source, 'browser_extension');
  assert.ok(!JSON.stringify(evt).includes('layoffs'));
  assert.ok(!('url' in evt));
});

test('one sighting per tool and kind in a ten-minute window', () => {
  const lastSeen = {};
  const now = 1_000_000;
  const first = sighting({ url: 'https://chatgpt.com/', type: 'main_frame' }, cfg(), { now, lastSeen });
  const again = sighting({ url: 'https://chatgpt.com/c/123', type: 'main_frame' }, cfg(), { now: now + 1000, lastSeen });
  const xhr = sighting({ url: 'https://chatgpt.com/backend-api/x', type: 'xmlhttprequest' }, cfg(), { now: now + 2000, lastSeen });
  const later = sighting({ url: 'https://chatgpt.com/', type: 'main_frame' }, cfg(), { now: now + DEDUPE_WINDOW_MS + 1, lastSeen });
  assert.ok(first);
  assert.equal(again, null);
  assert.equal(xhr.type, 'background');
  assert.ok(later);
  assert.deepEqual(Object.keys(pruneSeen(lastSeen, now + DEDUPE_WINDOW_MS + 3000)).sort(), ['chatgpt.com|visit']);
});

test('ignores sites that are not watched, and approved tools', () => {
  assert.equal(sighting({ url: 'https://example.com/', type: 'main_frame' }, cfg()), null);
  assert.equal(sighting({ url: 'https://claude.ai/', type: 'main_frame' }, cfg({ allowedDomains: ['claude.ai'] })), null);
  assert.equal(sighting({ url: 'chrome-extension://abc/x', type: 'main_frame' }, cfg()), null);
});

test('marks sightings of blocked tools as blocked', () => {
  const evt = sighting({ url: 'https://chat.deepseek.com/', type: 'main_frame' }, cfg({ enforcedDomains: ['chat.deepseek.com'] }));
  assert.equal(evt.blocked, true);
});

test('block page links must be https', () => {
  assert.deepEqual(safeLinks([
    { name: 'Good', url: 'https://ok.example' },
    { name: 'Script', url: 'javascript:alert(1)' },
    { name: 'Plain', url: 'http://plain.example' },
    { name: '', url: 'https://noname.example' },
  ]), [{ name: 'Good', url: 'https://ok.example' }]);
});
