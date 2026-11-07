#!/usr/bin/env node
/**
 * Keys for calls between Probaline's services (see shared/utils/src/internal-auth.ts).
 *
 *   node scripts/internal-keys.mjs new gateway|reporting-agent
 *       A new key pair: {"signing": {...}, "trusted": {...}}. The signing half goes only to the signer
 *       (INTERNAL_SIGNING_KEY); the trusted half is added to INTERNAL_TRUSTED_KEYS on every service.
 *
 *   node scripts/internal-keys.mjs local <file>
 *       Local development: make the gateway's and a reporting agent's keys once, kept in <file>.
 *
 * Rotating: add the new trusted half next to the old one everywhere, restart the services, then give the
 * gateway the new signing half, restart it, and remove the old trusted half.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const pair = (iss) => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    signing: { iss, privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) },
    trusted: { iss, publicKey: publicKey.export({ format: 'pem', type: 'spki' }) },
  };
};

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'new' && (arg === 'gateway' || arg === 'reporting-agent')) {
  console.log(JSON.stringify(pair(arg)));
} else if (cmd === 'local' && arg) {
  if (!fs.existsSync(arg)) {
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, JSON.stringify({ gateway: pair('gateway'), agent: pair('reporting-agent') }), { mode: 0o600 });
  }
  const k = JSON.parse(fs.readFileSync(arg, 'utf8'));
  // Shell-ready lines for dev-local.sh.
  const q = (v) => `'${JSON.stringify(v).replace(/'/g, `'\\''`)}'`;
  console.log(`INTERNAL_SIGNING_KEY_GATEWAY=${q(k.gateway.signing)}`);
  console.log(`INTERNAL_SIGNING_KEY_AGENT=${q(k.agent.signing)}`);
  console.log(`INTERNAL_TRUSTED_KEYS=${q([k.gateway.trusted, k.agent.trusted])}`);
} else {
  console.error('Usage: internal-keys.mjs new gateway|reporting-agent  |  internal-keys.mjs local <file>');
  process.exit(2);
}
