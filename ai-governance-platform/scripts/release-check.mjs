#!/usr/bin/env node
/**
 * Before a release of the connector or collector: the version being released must match the program's
 * package.json and the version the program reports (`--version`).
 *
 *   node scripts/release-check.mjs <connector|collector> <version>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = { connector: 'connector/src/connector.ts', collector: 'collector/src/cli.ts' };

const [program, version] = process.argv.slice(2);
if (!SOURCES[program] || !version) {
  console.error('Usage: release-check.mjs <connector|collector> <version>');
  process.exit(2);
}
const problems = [];
if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`"${version}" isn't a version like 1.2.3`);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, program, 'package.json'), 'utf8')).version;
if (pkg !== version) problems.push(`${program}/package.json says ${pkg}`);
const source = fs.readFileSync(path.join(ROOT, SOURCES[program]), 'utf8');
const constant = /VERSION = '([^']+)'/.exec(source)?.[1];
if (constant !== version) problems.push(`${SOURCES[program]} says ${constant ?? 'nothing'}`);

if (problems.length) {
  console.error(`Not releasing ${program} ${version}: ${problems.join('; ')}.`);
  process.exit(1);
}
console.log(`${program} ${version}: versions agree`);
