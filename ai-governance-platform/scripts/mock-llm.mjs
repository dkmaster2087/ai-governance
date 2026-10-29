#!/usr/bin/env node
// Local stand-in for an OpenAI-compatible model API, so the gateway can complete requests without
// real provider credentials. Dev only. Usage: node scripts/mock-llm.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] || process.env.MOCK_LLM_PORT || 4010);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const prompt = (parsed.messages ?? []).map((m) => m.content).join(' ');
      const words = prompt.split(/\s+/).filter(Boolean).length;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `mock-${Date.now()}`,
        object: 'chat.completion',
        model: parsed.model ?? 'mock',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `Mock reply to a ${words}-word prompt.` } }],
        usage: { prompt_tokens: Math.ceil(words * 1.3), completion_tokens: 12, total_tokens: Math.ceil(words * 1.3) + 12 },
      }));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`mock LLM listening on http://localhost:${port}/v1`));
