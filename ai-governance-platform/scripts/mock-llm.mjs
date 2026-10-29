#!/usr/bin/env node
// Local stand-in for an OpenAI-compatible model API, so the gateway can complete requests without
// real provider credentials. Dev and end-to-end tests only. Usage: node scripts/mock-llm.mjs [port]
//
// For tests:
//   GET /_received?contains=<text>  the requests this mock received whose prompt contains <text>
//   A prompt containing "MOCK_REPLY_WITH_PII" gets a reply containing an email and a phone number.
import http from 'node:http';

const port = Number(process.argv[2] || process.env.MOCK_LLM_PORT || 4010);
const received = []; // newest last, capped
const MAX_KEPT = 500;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  if (req.method === 'GET' && url.pathname === '/_received') {
    const needle = url.searchParams.get('contains') ?? '';
    const hits = received.filter((r) => r.prompt.includes(needle));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(hits));
    return;
  }
  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const prompt = (parsed.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' ');
      received.push({ at: new Date().toISOString(), path: url.pathname, model: parsed.model, prompt, messages: parsed.messages });
      if (received.length > MAX_KEPT) received.shift();
      const words = prompt.split(/\s+/).filter(Boolean).length;
      const content = prompt.includes('MOCK_REPLY_WITH_PII')
        ? 'Sure. Contact jane.doe@example.com or call 415-555-0134.'
        : `Mock reply to a ${words}-word prompt.`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `mock-${Date.now()}`,
        object: 'chat.completion',
        model: parsed.model ?? 'mock',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: Math.ceil(words * 1.3), completion_tokens: 12, total_tokens: Math.ceil(words * 1.3) + 12 },
      }));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`mock LLM listening on http://localhost:${port}/v1`));
