#!/usr/bin/env node
/**
 * Sign the AI service catalog installs download (docs/ASSESSMENT.md, "The AI service catalog").
 *
 *   node scripts/catalog-sign.mjs --kms <key id or alias> --out catalog/v1/latest.json        publish (our KMS key)
 *   node scripts/catalog-sign.mjs --key-file key.pem --out latest.json                        local, or a company's mirror
 *   node scripts/catalog-sign.mjs --kms <key> --public-key                                     print the key to trust
 *
 * Options:
 *   --input <file>      catalog data (JSON: { services, advisories }) instead of the list built into this commit
 *   --sequence <n>      publication number; default: this commit's time (seconds), so an unchanged commit re-signs
 *                       the same sequence and installs ignore it
 *   --version <text>    edition name, at most 20 characters; default: the sequence's date and time, e.g. 2026-11-12.1430
 *
 * The signature is ECDSA P-256 / SHA-256 over "probaline.catalog/1.<payload>", the same check the gateway makes
 * (services/gateway/src/catalog/catalog-document.ts). Needs shared/catalog built (npm run build -w shared/catalog).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign as signRaw } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(`--${name}`);
const FORMAT = 'probaline.catalog/1';

const kmsKey = arg('kms');
const keyFile = arg('key-file');
if (!kmsKey === !keyFile) {
  console.error('Give exactly one of --kms <key id> or --key-file <private key PEM>.');
  process.exit(2);
}

/** The signer: its public key (SPKI DER) and a function returning DER signatures. */
async function signer() {
  if (keyFile) {
    const key = createPrivateKey(fs.readFileSync(keyFile));
    const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
    return { spki, sign: async (bytes) => signRaw('sha256', bytes, { key, dsaEncoding: 'der' }) };
  }
  const { KMSClient, GetPublicKeyCommand, SignCommand } = require(require.resolve('@aws-sdk/client-kms', { paths: [path.join(ROOT, 'services/gateway')] }));
  const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const pub = await kms.send(new GetPublicKeyCommand({ KeyId: kmsKey }));
  if (pub.KeySpec !== 'ECC_NIST_P256') throw new Error(`Key ${kmsKey} is ${pub.KeySpec}, not ECC_NIST_P256`);
  return {
    spki: Buffer.from(pub.PublicKey),
    // KMS signs at most 4 KB of raw data; sign the SHA-256 digest instead (the same ECDSA_SHA_256 signature).
    sign: async (bytes) => Buffer.from((await kms.send(new SignCommand({ KeyId: kmsKey, Message: createHash('sha256').update(bytes).digest(), MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' }))).Signature),
  };
}

const { spki, sign } = await signer();
const kid = createHash('sha256').update(spki).digest('hex').slice(0, 16);

if (has('public-key')) {
  const pem = createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ format: 'pem', type: 'spki' });
  console.log(`kid ${kid}\n${pem.trim()}`);
  process.exit(0);
}

const catalog = require(path.join(ROOT, 'shared/catalog/dist/index.js'));
const commitTime = () => { try { return Number(execSync('git log -1 --format=%ct', { cwd: ROOT }).toString().trim()); } catch { return 0; } };
const sequence = Number(arg('sequence')) || commitTime() || Math.floor(Date.now() / 1000);
const stamp = new Date(sequence * 1000).toISOString();
const version = arg('version') || `${stamp.slice(0, 10)}.${stamp.slice(11, 13)}${stamp.slice(14, 16)}`;

let data = catalog.builtInCatalogData(sequence, version, stamp);
if (arg('input')) {
  const input = JSON.parse(fs.readFileSync(arg('input'), 'utf8'));
  data = { sequence, version, publishedAt: stamp, services: input.services, advisories: input.advisories ?? [] };
}
catalog.servicesFromData(data); // the same checks an install makes; throws on anything malformed

const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
const signature = (await sign(Buffer.from(`${FORMAT}.${payload}`, 'ascii'))).toString('base64url');
const doc = JSON.stringify({ format: FORMAT, kid, payload, signature });

const out = arg('out');
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, doc);
  console.log(`Signed catalog ${version} (sequence ${sequence}, ${data.services.length} services, key ${kid}) → ${out}`);
} else {
  process.stdout.write(doc);
}
