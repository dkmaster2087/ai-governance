#!/usr/bin/env node
/**
 * Certificates for calls between Probaline's services (mutual TLS). Each install gets its own private
 * certificate authority; each service a certificate naming it (gateway, policy-engine, data-protection,
 * analytics, reporting-agent), used both to serve and to call. Needs `openssl` (present on macOS, Linux and
 * CI runners).
 *
 *   node scripts/internal-pki.mjs local <dir>
 *       Local development and self-hosted installs: make the CA and every certificate once in <dir>
 *       (ca.pem, ca.key, <service>.pem, <service>.key). Existing files are kept.
 *
 *   node scripts/internal-pki.mjs aws --prefix ai-gov --stage prod [--region us-east-1] [--renew]
 *       AWS: keep the CA and each service's certificate in Secrets Manager as
 *       <prefix>/<stage>/internal-tls/<service>/tls = {"ca","cert","key"}. Run before `cdk deploy`; existing
 *       secrets are kept. --renew issues new service certificates from the same CA (then redeploy).
 *
 * Service certificates last 397 days; the CA 10 years.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVICES = ['gateway', 'policy-engine', 'data-protection', 'analytics', 'reporting-agent'];

const ssl = (args, opts = {}) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function makeCa(dir) {
  ssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', path.join(dir, 'ca.key')]);
  ssl(['req', '-x509', '-new', '-key', path.join(dir, 'ca.key'), '-sha256', '-days', '3650', '-subj', '/O=Probaline/CN=Probaline internal CA', '-out', path.join(dir, 'ca.pem')]);
}

/** A certificate for one service, usable to serve (its name) and to call (client auth). */
function makeCert(dir, name, extraNames = []) {
  const key = path.join(dir, `${name}.key`);
  const csr = path.join(dir, `${name}.csr`);
  const ext = path.join(dir, `${name}.ext`);
  const names = [name, ...extraNames, 'localhost'];
  fs.writeFileSync(ext, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth,clientAuth',
    `subjectAltName=${[...names.map((n) => `DNS:${n}`), 'IP:127.0.0.1'].join(',')}`,
  ].join('\n'));
  ssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key]);
  // PKCS#8, which every TLS library reads.
  const pk8 = ssl(['pkcs8', '-topk8', '-nocrypt', '-in', key]);
  fs.writeFileSync(key, pk8, { mode: 0o600 });
  ssl(['req', '-new', '-key', key, '-subj', `/O=Probaline/CN=${name}`, '-out', csr]);
  ssl(['x509', '-req', '-in', csr, '-CA', path.join(dir, 'ca.pem'), '-CAkey', path.join(dir, 'ca.key'), '-CAcreateserial',
    '-days', '397', '-sha256', '-extfile', ext, '-out', path.join(dir, `${name}.pem`)]);
  fs.rmSync(csr); fs.rmSync(ext);
}

function local(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(path.join(dir, 'ca.pem'))) makeCa(dir);
  for (const s of SERVICES) if (!fs.existsSync(path.join(dir, `${s}.pem`))) makeCert(dir, s);
  console.log(`Certificates in ${dir}`);
}

function aws(flags) {
  const { prefix, stage, region } = flags;
  if (!prefix || !stage) throw new Error('--prefix and --stage are required');
  const base = `${prefix}/${stage}/internal-tls`;
  const awsCli = (args) => execFileSync('aws', [...args, ...(region ? ['--region', region] : [])], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const get = (name) => { try { return JSON.parse(awsCli(['secretsmanager', 'get-secret-value', '--secret-id', name, '--query', 'SecretString', '--output', 'text'])); } catch { return null; } };
  const put = (name, value, exists) => awsCli(exists
    ? ['secretsmanager', 'put-secret-value', '--secret-id', name, '--secret-string', JSON.stringify(value)]
    : ['secretsmanager', 'create-secret', '--name', name, '--description', 'Probaline internal TLS', '--secret-string', JSON.stringify(value)]);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'probaline-pki-'));
  try {
    const ca = get(`${base}/ca`);
    if (ca) { fs.writeFileSync(path.join(work, 'ca.pem'), ca.cert); fs.writeFileSync(path.join(work, 'ca.key'), ca.key, { mode: 0o600 }); }
    else { makeCa(work); put(`${base}/ca`, { cert: fs.readFileSync(path.join(work, 'ca.pem'), 'utf8'), key: fs.readFileSync(path.join(work, 'ca.key'), 'utf8') }, false); console.log(`Created ${base}/ca`); }
    const caPem = fs.readFileSync(path.join(work, 'ca.pem'), 'utf8');
    // Services find each other at <service>.<prefix>-<stage>.internal (Cloud Map, set up by CDK).
    const namespace = `${prefix}-${stage}.internal`;
    for (const s of SERVICES) {
      // `/tls` at the end: a name ending in a hyphen and six characters (policy-engine) is taken by Secrets
      // Manager as carrying its random suffix, and ECS then can't fetch it.
      const name = `${base}/${s}/tls`;
      const existing = get(name);
      if (existing && !flags.renew) continue;
      makeCert(work, s, [`${s}.${namespace}`]);
      put(name, { ca: caPem, cert: fs.readFileSync(path.join(work, `${s}.pem`), 'utf8'), key: fs.readFileSync(path.join(work, `${s}.key`), 'utf8') }, !!existing);
      console.log(`${existing ? 'Renewed' : 'Created'} ${name}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const n = rest[i + 1]; if (!n || n.startsWith('--')) flags[rest[i].slice(2)] = true; else { flags[rest[i].slice(2)] = n; i++; } }
}
try {
  if (cmd === 'local' && rest[0] && !rest[0].startsWith('--')) local(rest[0]);
  else if (cmd === 'aws') aws(flags);
  else { console.error('Usage: internal-pki.mjs local <dir>  |  internal-pki.mjs aws --prefix <p> --stage <s> [--region r] [--renew]'); process.exit(2); }
} catch (err) {
  console.error(`internal-pki: ${err.stderr?.toString() || err.message}`);
  process.exit(1);
}
