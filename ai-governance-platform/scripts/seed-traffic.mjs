#!/usr/bin/env node
// Sends realistic sample traffic through a local gateway (dev only): clean prompts, prompts with
// personal data (masked), prompts that hit the "confidential" rule (stopped), and shadow-AI events.
// Needs the stack from scripts/dev-local.sh (gateway with AUTH_DEV_MODE, mock LLM on :4010).
// Usage: node scripts/seed-traffic.mjs [requests=120]
const GW = process.env.GATEWAY_URL || 'http://localhost:3000';
const TENANT = process.env.TENANT || 'tenant_demo';
const total = Number(process.argv[2] || 120);
const admin = { authorization: 'Bearer test-key', 'x-tenant-id': TENANT, 'x-dev-role': 'tenant_admin', 'content-type': 'application/json' };

async function call(method, path, headers, body) {
  const res = await fetch(GW + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// 1. A model routed to the local mock (key stored via the normal Secrets Manager path).
const models = await call('GET', '/v1/models/config', admin);
if (!models.json.some?.((m) => m.modelId === 'gpt-4o-mini')) {
  const created = await call('POST', '/v1/models/config', admin, {
    name: 'GPT-4o mini (local mock)', provider: 'openai', modelId: 'gpt-4o-mini', apiKey: 'sk-local-mock-0000', inputCostPer1kTokens: 0.00015, outputCostPer1kTokens: 0.0006,
  });
  console.log('model config', created.status);
}

// 1b. Two extra demo rules so the Stopped page shows several causes (policy engine is internal on :3001).
const POLICY = process.env.POLICY_ENGINE_URL || 'http://localhost:3001';
const existing = await (await fetch(`${POLICY}/v1/policies/${TENANT}`)).json();
if (!existing.some((p) => p.name === 'Demo rules')) {
  await fetch(`${POLICY}/v1/policies`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: TENANT, name: 'Demo rules', description: 'Sample rules for local development', enabled: true, createdBy: 'seed',
      rules: [
        { ruleId: 'rule_ssn', type: 'pii_detection', action: 'block', priority: 1, enabled: true, description: 'Stop Social Security numbers', config: { piiTypes: ['SSN'] } },
        { ruleId: 'rule_codenames', type: 'data_classification', action: 'block', priority: 2, enabled: true, description: 'Stop unreleased project codenames', config: { patterns: ['project\\s+(phoenix|atlas)'] } },
      ],
    }),
  });
  console.log('added demo rules');
}

// 2. One API key per app, so traffic is attributed to real app names.
const apps = ['support-bot', 'billing-api', 'hr-assistant', 'analytics-etl', 'sales-copilot'];
const keys = {};
for (const app of apps) {
  const k = await call('POST', '/v1/api-keys', admin, { name: app, scopes: ['chat', 'models'] });
  keys[app] = k.json.key;
}

const prompts = {
  clean: ['Summarise this support ticket in two sentences.', 'Draft a polite follow-up email about a delayed shipment.', 'Classify this feedback as positive, neutral or negative.', 'Turn these meeting notes into action items.'],
  pii: ['Reply to jane.doe@example.com about her refund, her phone is 415-555-0134.', 'Customer card 4111 1111 1111 1111 was charged twice, write an apology.', 'Call the customer back on 415-555-0199 about the late order.'],
  blocked: ['Summarise the attached confidential pricing memo for the board.', 'This is internal only: rewrite the layoff plan announcement.', 'Translate this top secret acquisition term sheet.',
    'Update the payroll record for SSN 123-45-6789 with the new address.', 'Write launch copy for Project Phoenix, our unreleased payments product.', 'Draft an FAQ about Project Atlas for the sales team.'],
};
const users = ['j.patel', 'm.chen', 'a.ruiz', 's.lindqvist', 'k.nakamura', 'service'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let ok = 0, stopped = 0, failed = 0;
for (let i = 0; i < total; i++) {
  const app = pick(apps);
  const r = Math.random();
  const kind = r < 0.2 ? 'blocked' : r < 0.35 ? 'pii' : 'clean';
  const res = await call('POST', '/v1/chat/completions',
    { authorization: `Bearer ${keys[app]}`, 'x-app-id': app, 'x-user-id': `${pick(users)}@democorp.com`, 'content-type': 'application/json' },
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: pick(prompts[kind]) }] });
  if (res.status === 200) ok++; else if (res.status === 403) stopped++; else { failed++; if (failed <= 3) console.log('unexpected', res.status, JSON.stringify(res.json).slice(0, 160)); }
}

// 3. Shadow-AI events from the browser extension.
const ingest = await call('POST', '/v1/api-keys', admin, { name: 'browser-extension', scopes: ['shadow_ai:ingest'] });
const domains = ['chatgpt.com', 'chatgpt.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
const events = Array.from({ length: 18 }, () => ({ domain: pick(domains), blocked: false, userId: pick(['m.okoro', 's.lindqvist', 'k.nakamura', 'd.brennan', 'p.alvarez']) }));
await call('POST', '/v1/shadow-ai/events', { authorization: `Bearer ${ingest.json.key}`, 'content-type': 'application/json' }, { events });

console.log(`sent ${total}: ${ok} delivered, ${stopped} stopped, ${failed} failed; 18 shadow-AI events`);
