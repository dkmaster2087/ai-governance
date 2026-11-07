#!/usr/bin/env node
/**
 * Build a service, the connector or the collector for shipping: one bundled file, compiled to V8 bytecode, so
 * no readable source ships.
 *
 *   node scripts/build-service.mjs <service|connector|collector> [--out build] [--compile]
 *
 * Writes <out>/<service>/:
 *   app.js       the whole service in one minified file (no source maps, no comments)
 *   loader.js    starts the service from app.jsc
 *   compile.cjs  turns app.js into app.jsc and deletes app.js
 *
 * Bytecode runs only on the exact Node version that made it, so the image runs compile.cjs inside the
 * runtime image itself (see services/Dockerfile). --compile does it here, with this machine's Node, for tests.
 * Services need the shared packages (shared/types, utils, storage) built first.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = ['gateway', 'policy-engine', 'data-protection', 'analytics', 'reporting-agent'];
// Programs customers run in their own network.
const AGENTS = { connector: 'connector/src/cli.ts', collector: 'collector/src/cli.ts' };
const entryOf = (name) => AGENTS[name] ?? `services/${name}/src/index.ts`;

const args = process.argv.slice(2);
const service = args[0];
const outRoot = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'build');
if (!SERVICES.includes(service) && !AGENTS[service]) {
  console.error(`Usage: build-service.mjs <${[...SERVICES, ...Object.keys(AGENTS)].join('|')}> [--out dir] [--compile]`);
  process.exit(2);
}
const out = path.join(outRoot, service);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// bytenode can also target Electron, which we never use.
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', minify: true, legalComments: 'none', sourcemap: false, logLevel: 'warning', external: ['electron'] };

// 1. The service, with everything it uses, in one file. Optional native add-ons it never loads stay out.
await build({
  ...common,
  entryPoints: [path.join(ROOT, entryOf(service))],
  outfile: path.join(out, 'app.js'),
  external: ['electron', 'pg-native', 'bufferutil', 'utf-8-validate'],
  // Keep function names: some libraries read them (Fastify plugins, the AWS SDK's error classes).
  keepNames: true,
});

// 2. The loader: registers .jsc and starts the service.
await build({
  ...common,
  stdin: { contents: "require('bytenode'); require('./app.jsc');", resolveDir: ROOT, loader: 'js' },
  outfile: path.join(out, 'loader.js'),
  external: ['electron', './app.jsc'],
});

// 3. The compiler, self-contained so it runs in an image with nothing but Node.
await build({
  ...common,
  stdin: {
    contents: `
      const fs = require('fs'); const path = require('path'); const bytenode = require('bytenode');
      const dir = process.argv[2];
      bytenode.compileFile({ filename: path.join(dir, 'app.js'), output: path.join(dir, 'app.jsc') });
      fs.unlinkSync(path.join(dir, 'app.js'));
      console.log('compiled ' + path.join(dir, 'app.jsc'));`,
    resolveDir: ROOT, loader: 'js',
  },
  outfile: path.join(out, 'compile.cjs'),
});

const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`${service}: bundled (${size('app.js')})`);

if (args.includes('--compile')) {
  execFileSync(process.execPath, [path.join(out, 'compile.cjs'), out], { stdio: 'inherit' });
  fs.rmSync(path.join(out, 'compile.cjs'));
  console.log(`${service}: bytecode ${size('app.jsc')}`);
}
