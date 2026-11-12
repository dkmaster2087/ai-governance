#!/usr/bin/env node
/**
 * Build Probaline, the connector or the collector for shipping: bundled, compiled to V8 bytecode, so no
 * readable source ships.
 *
 *   node scripts/build-service.mjs <probaline|gateway|analytics|connector|collector> [--out build] [--compile]
 *
 * `probaline` is the product image: the gateway (with every check inside it) and reports (analytics), with a
 * loader that starts them by role. Writes <out>/probaline/:
 *   gateway.js, reports.js   each program in one minified file (no source maps, no comments)
 *   loader.js                starts the programs for PROBALINE_ROLE (see LOADER below)
 *   compile.cjs              turns each .js into .jsc and deletes the .js
 * The other targets write one program as app.js, with the same loader and compiler.
 *
 * Bytecode runs only on the exact Node version that made it, so the image runs compile.cjs inside the
 * runtime image itself (see services/Dockerfile). --compile does it here, with this machine's Node, for tests.
 * Services need the shared packages (shared/catalog, types, utils, storage) built first.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROGRAMS = {
  gateway: 'services/gateway/src/index.ts',
  analytics: 'services/analytics/src/index.ts',
  // Programs customers run in their own network.
  connector: 'connector/src/cli.ts',
  collector: 'collector/src/cli.ts',
};
// What goes in each output: file name → program.
const TARGETS = {
  probaline: { 'gateway.js': 'gateway', 'reports.js': 'analytics' },
  ...Object.fromEntries(Object.keys(PROGRAMS).map((p) => [p, { 'app.js': p }])),
};

/**
 * The product image's loader. PROBALINE_ROLE picks what this container runs:
 *   all (default)  the gateway and reports in one process; reports listen only on 127.0.0.1, so a customer runs
 *                  one kind of container. If no internal signing key is set, one is made for this process: the
 *                  gateway signs report requests with it and reports trust only it.
 *   gateway        the gateway alone; reports run elsewhere (ANALYTICS_URL, over mutual TLS in Cloud).
 *   reports        reports alone.
 */
const LOADER = `
require('bytenode');
const role = (process.env.PROBALINE_ROLE || 'all').toLowerCase();
if (!['all', 'gateway', 'reports'].includes(role)) { console.error('PROBALINE_ROLE must be all, gateway or reports'); process.exit(2); }
if (role === 'all') {
  const crypto = require('crypto');
  if (!process.env.INTERNAL_SIGNING_KEY) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.INTERNAL_SIGNING_KEY = JSON.stringify({ iss: 'gateway', privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) });
    process.env.INTERNAL_TRUSTED_KEYS = JSON.stringify([{ iss: 'gateway', publicKey: publicKey.export({ format: 'pem', type: 'spki' }) }]);
  } else if (!process.env.INTERNAL_TRUSTED_KEYS) {
    const k = JSON.parse(process.env.INTERNAL_SIGNING_KEY);
    process.env.INTERNAL_TRUSTED_KEYS = JSON.stringify([{ iss: k.iss, publicKey: crypto.createPublicKey(k.privateKey).export({ format: 'pem', type: 'spki' }) }]);
  }
  process.env.ANALYTICS_HOST = '127.0.0.1';
  process.env.ANALYTICS_PORT = process.env.ANALYTICS_PORT || '3003';
  process.env.ANALYTICS_URL = 'http://127.0.0.1:' + process.env.ANALYTICS_PORT;
}
if (role !== 'gateway') require('./reports.jsc');
if (role !== 'reports') require('./gateway.jsc');
`;

const args = process.argv.slice(2);
const target = args[0];
const outRoot = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'build');
if (!TARGETS[target]) {
  console.error(`Usage: build-service.mjs <${Object.keys(TARGETS).join('|')}> [--out dir] [--compile]`);
  process.exit(2);
}
const files = TARGETS[target];
const out = path.join(outRoot, target);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// bytenode can also target Electron, which we never use.
const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', minify: true, legalComments: 'none', sourcemap: false, logLevel: 'warning', external: ['electron'] };

// 1. Each program, with everything it uses, in one file. Optional native add-ons it never loads stay out.
for (const [file, program] of Object.entries(files)) {
  await build({
    ...common,
    entryPoints: [path.join(ROOT, PROGRAMS[program])],
    outfile: path.join(out, file),
    external: ['electron', 'pg-native', 'bufferutil', 'utf-8-validate'],
    // Keep function names: some libraries read them (Fastify plugins, the AWS SDK's error classes).
    keepNames: true,
  });
}

// 2. The loader: registers .jsc and starts the program(s).
const loaderSource = target === 'probaline' ? LOADER : "require('bytenode'); require('./app.jsc');";
const compiled = Object.keys(files).map((f) => './' + f.replace(/\.js$/, '.jsc'));
await build({
  ...common,
  stdin: { contents: loaderSource, resolveDir: ROOT, loader: 'js' },
  outfile: path.join(out, 'loader.js'),
  external: ['electron', ...compiled],
});

// 3. The compiler, self-contained so it runs in an image with nothing but Node.
await build({
  ...common,
  stdin: {
    contents: `
      const fs = require('fs'); const path = require('path'); const bytenode = require('bytenode');
      const dir = process.argv[2];
      for (const name of ${JSON.stringify(Object.keys(files))}) {
        const js = path.join(dir, name);
        bytenode.compileFile({ filename: js, output: js.replace(/\\.js$/, '.jsc') });
        fs.unlinkSync(js);
        console.log('compiled ' + js.replace(/\\.js$/, '.jsc'));
      }`,
    resolveDir: ROOT, loader: 'js',
  },
  outfile: path.join(out, 'compile.cjs'),
});

const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`${target}: bundled ${Object.keys(files).map((f) => `${f} (${size(f)})`).join(', ')}`);

if (args.includes('--compile')) {
  execFileSync(process.execPath, [path.join(out, 'compile.cjs'), out], { stdio: 'inherit' });
  fs.rmSync(path.join(out, 'compile.cjs'));
  console.log(`${target}: bytecode ${Object.keys(files).map((f) => size(f.replace(/\.js$/, '.jsc'))).join(', ')}`);
}
