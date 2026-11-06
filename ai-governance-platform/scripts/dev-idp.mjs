#!/usr/bin/env node
/**
 * A stand-in OpenID Connect identity provider for local development and the end-to-end tests, so people can
 * try "sign in to an MCP server" without Entra ID or Okta. Never use it for anything real.
 *
 *   node scripts/dev-idp.mjs [port]        (default 4030)
 *
 * Issuer http://localhost:<port>, client ID "probaline-dev", client secret "dev-secret". The sign-in page
 * lists demo people to choose from. POST /_disable?person=<id> makes the next refresh for them fail.
 */
import http from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const port = Number(process.argv[2] || process.env.PORT || 4030);
const issuer = `http://localhost:${port}`;
const CLIENT_ID = 'probaline-dev';
const CLIENT_SECRET = 'dev-secret';
const PEOPLE = {
  jane: { sub: 'dev-jane', email: 'jane@democorp.com', name: 'Jane Cooper', groups: ['HR'] },
  priya: { sub: 'dev-priya', email: 'priya@democorp.com', name: 'Priya Shah', groups: ['HR', 'Payroll'] },
  max: { sub: 'dev-max', email: 'max@democorp.com', name: 'Max Weber', groups: ['Sales'] },
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
// A new key each start gets a new key ID, as real providers do, so clients fetch it instead of reusing a cached one.
const KID = createHash('sha256').update(publicKey.export({ format: 'jwk' }).n).digest('base64url').slice(0, 16);
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const codes = new Map();
const refresh = new Map();
const disabled = new Set();

const b64 = (v) => Buffer.from(v).toString('base64url');
function idToken(p, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: issuer, aud: CLIENT_ID, sub: p.sub, email: p.email, name: p.name, groups: p.groups, ...(nonce ? { nonce } : {}), iat: now, exp: now + 600 }))}`;
  return `${input}.${b64(sign('sha256', Buffer.from(input), privateKey))}`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'] });
    }
    if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'unknown client' });
      const links = Object.entries(PEOPLE).map(([id, p]) => {
        const next = new URLSearchParams({ person: id, redirect_uri: q.get('redirect_uri'), state: q.get('state') ?? '', nonce: q.get('nonce') ?? '', code_challenge: q.get('code_challenge') ?? '' });
        return `<li><a href="/login?${esc(next)}">${esc(p.name)}</a> <small>${esc(p.email)} · ${esc(p.groups.join(', '))}</small></li>`;
      }).join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Dev sign-in</title><body style="font:16px system-ui;max-width:480px;margin:60px auto;padding:0 16px">
        <h1 style="font-size:22px">Dev identity provider</h1><p>Stand-in for your company sign-in. Choose who to be:</p><ul style="line-height:2">${links}</ul></body>`);
    }
    if (url.pathname === '/login') {
      const q = url.searchParams;
      const p = PEOPLE[q.get('person')];
      if (!p) return json(res, 400, { error: 'unknown person' });
      const code = randomBytes(12).toString('hex');
      codes.set(code, { person: q.get('person'), nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      if (req.headers.authorization !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) return json(res, 401, { error: 'invalid_client' });
      const f = Object.fromEntries(new URLSearchParams(body));
      if (f.grant_type === 'authorization_code') {
        const c = codes.get(f.code);
        codes.delete(f.code);
        if (!c || c.redirectUri !== f.redirect_uri || createHash('sha256').update(f.code_verifier ?? '').digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant' });
        const rt = randomBytes(12).toString('hex');
        refresh.set(rt, c.person);
        return json(res, 200, { access_token: randomBytes(8).toString('hex'), token_type: 'Bearer', id_token: idToken(PEOPLE[c.person], c.nonce), refresh_token: rt });
      }
      if (f.grant_type === 'refresh_token') {
        const person = refresh.get(f.refresh_token);
        if (!person || disabled.has(person)) return json(res, 400, { error: 'invalid_grant', error_description: 'The user is disabled' });
        return json(res, 200, { access_token: randomBytes(8).toString('hex'), token_type: 'Bearer', id_token: idToken(PEOPLE[person]) });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/_disable' && req.method === 'POST') { disabled.add(url.searchParams.get('person')); return json(res, 200, { ok: true }); }
    json(res, 404, { error: 'not found' });
  });
}).listen(port, () => console.log(`dev identity provider → ${issuer} (client ${CLIENT_ID} / ${CLIENT_SECRET})`));
