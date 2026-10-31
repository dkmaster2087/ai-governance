import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Pseudonymizer, Sighting } from './sightings';

/**
 * Where the collector keeps its results, always in the customer's environment: a folder, or a bucket
 * in their cloud account.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, body: string, contentType?: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class FileStore implements Store {
  constructor(private readonly root: string) {}

  private file(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Key outside the store: ${key}`);
    return resolved;
  }

  async get(key: string) {
    try { return await fs.readFile(this.file(key), 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }

  async put(key: string, body: string) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body, { mode: 0o600 });
  }

  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(path.relative(this.root, full).split(path.sep).join('/'));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
}

const KEY_FILE = 'private/pseudonym.key';
const NAMES_FILE = 'private/names.json';

/** The pseudonym key, created on first use. It never leaves the store. */
export async function loadPseudonymizer(store: Store): Promise<Pseudonymizer> {
  let key = (await store.get(KEY_FILE))?.trim();
  if (!key) {
    key = randomBytes(32).toString('hex');
    await store.put(KEY_FILE, key);
  }
  return new Pseudonymizer(key);
}

/** Add newly seen code → name pairs to the private lookup, so the customer's team can reveal names. */
export async function saveNames(store: Store, p: Pseudonymizer): Promise<void> {
  if (p.names.size === 0) return;
  const existing = JSON.parse((await store.get(NAMES_FILE)) ?? '{}') as Record<string, string>;
  for (const [code, name] of p.names) existing[code] = name;
  await store.put(NAMES_FILE, JSON.stringify(existing, null, 2), 'application/json');
}

export async function loadNames(store: Store): Promise<Record<string, string>> {
  return JSON.parse((await store.get(NAMES_FILE)) ?? '{}');
}

/**
 * Write one batch's sightings, one file per day. `batchId` identifies the input (for example a hash of the log
 * file's key), so processing the same input again replaces its files instead of counting twice.
 */
export async function saveSightings(store: Store, batchId: string, byDay: Map<string, Sighting[]>): Promise<number> {
  let files = 0;
  for (const [day, rows] of byDay) {
    await store.put(`sightings/${day}/${batchId}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'application/x-ndjson');
    files++;
  }
  return files;
}

/** All sightings between two days (inclusive). */
export async function loadSightings(store: Store, from: string, to: string): Promise<Sighting[][]> {
  const keys = (await store.list('sightings/')).filter((k) => {
    const day = k.split('/')[1];
    return day >= from && day <= to && k.endsWith('.jsonl');
  });
  const out: Sighting[][] = [];
  for (const k of keys) {
    const body = (await store.get(k)) ?? '';
    out.push(body.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Sighting));
  }
  return out;
}
