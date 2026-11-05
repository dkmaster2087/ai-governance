import yaml from 'js-yaml';

/**
 * Turn an OpenAPI 3 description into candidate MCP tools: one per operation, with an input schema built from
 * its path and query parameters (and, for writes, its JSON request body). References inside the document are
 * resolved; nothing outside it is fetched.
 */

export type JsonSchema = Record<string, unknown>;

export interface Operation {
  /** Tool name agents see: letters, digits, _ and -, at most 64 characters, unique in the API. */
  name: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  title: string;
  description: string;
  /** Reads (GET, HEAD) are offered on; writes are off until chosen. */
  write: boolean;
  inputSchema: JsonSchema;
  /** Where each argument goes in the HTTP request. */
  params: { path: string[]; query: string[]; body: boolean };
}

export interface ParsedApi { title: string; version: string; servers: string[]; operations: Operation[]; skipped: string[] }

const METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete'] as const;
const MAX_DEPTH = 12;

export class OpenApiError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_OPENAPI';
}

export function parseDocument(text: string): any {
  const t = text.trim();
  if (!t) throw new OpenApiError('The OpenAPI description is empty');
  if (t.length > 5_000_000) throw new OpenApiError('The OpenAPI description is larger than 5 MB');
  let doc: any;
  try {
    doc = t.startsWith('{') ? JSON.parse(t) : yaml.load(t, { schema: yaml.JSON_SCHEMA });
  } catch (err) {
    throw new OpenApiError(`Couldn't read the description as JSON or YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (!doc || typeof doc !== 'object') throw new OpenApiError('The description is not an object');
  if (doc.swagger) throw new OpenApiError('Swagger 2.0 isn\'t supported; convert it to OpenAPI 3 first');
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) throw new OpenApiError('Only OpenAPI 3.x descriptions are supported');
  if (!doc.paths || typeof doc.paths !== 'object') throw new OpenApiError('The description has no paths');
  return doc;
}

/** Resolve local `$ref`s ("#/components/schemas/X") into a copy, stopping at cycles and deep nesting. */
function resolve(doc: any, node: any, seen: string[] = [], depth = 0): any {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((n) => resolve(doc, n, seen, depth + 1));
  if (typeof node.$ref === 'string') {
    const ref: string = node.$ref;
    if (!ref.startsWith('#/') || seen.includes(ref)) return { type: 'object', description: `(${ref.split('/').pop()})` };
    const target = ref.slice(2).split('/').reduce((o: any, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
    return resolve(doc, target ?? {}, [...seen, ref], depth + 1);
  }
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    // Drop OpenAPI-only keywords that aren't JSON Schema.
    if (k === 'example' || k === 'xml' || k === 'externalDocs' || k === 'discriminator' || k === 'nullable' || k.startsWith('x-')) continue;
    out[k] = resolve(doc, v, seen, depth + 1);
  }
  return out;
}

function toolName(op: any, method: string, path: string, used: Set<string>): string {
  const raw = typeof op.operationId === 'string' && op.operationId
    ? op.operationId
    : `${method}_${path.replace(/\{([^}]+)\}/g, 'by_$1').replace(/[^A-Za-z0-9]+/g, '_')}`;
  let name = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || method;
  let n = 2;
  while (used.has(name)) name = `${raw.slice(0, 60)}_${n++}`;
  used.add(name);
  return name;
}

export function parseOpenApi(text: string): ParsedApi {
  const doc = parseDocument(text);
  const used = new Set<string>();
  const operations: Operation[] = [];
  const skipped: string[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    const shared = resolve(doc, item.parameters ?? []) as any[];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = [...shared, ...(resolve(doc, op.parameters ?? []) as any[])];
      // Later (operation-level) parameters override path-level ones with the same name and place.
      const byKey = new Map<string, any>();
      for (const p of params) if (p?.name && p?.in) byKey.set(`${p.in}:${p.name}`, p);
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      const where = { path: [] as string[], query: [] as string[], body: false };
      let unsupported = '';
      for (const p of byKey.values()) {
        if (p.in === 'header' || p.in === 'cookie') {
          if (p.required) unsupported = `required ${p.in} parameter "${p.name}"`;
          continue;
        }
        if (p.in !== 'path' && p.in !== 'query') continue;
        properties[p.name] = { ...(p.schema ?? { type: 'string' }), ...(p.description ? { description: String(p.description) } : {}) };
        if (p.required || p.in === 'path') required.push(p.name);
        where[p.in as 'path' | 'query'].push(p.name);
      }
      const body = resolve(doc, op.requestBody);
      const json = body?.content?.['application/json']?.schema;
      if (json) {
        properties.body = { ...json, description: String(body.description ?? json.description ?? 'Request body') };
        if (body.required) required.push('body');
        where.body = true;
      } else if (body?.required && body?.content && Object.keys(body.content).length) {
        unsupported = `a ${Object.keys(body.content)[0]} request body`;
      }
      const label = `${method.toUpperCase()} ${path}`;
      if (unsupported) { skipped.push(`${label}: needs ${unsupported}`); continue; }
      const summary = String(op.summary ?? '').trim();
      const description = String(op.description ?? '').trim();
      operations.push({
        name: toolName(op, method, path, used),
        method: method.toUpperCase() as Operation['method'],
        path,
        title: summary || label,
        description: (description || summary || label).slice(0, 2000),
        write: method !== 'get' && method !== 'head',
        inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
        params: where,
      });
    }
  }
  if (operations.length === 0 && skipped.length === 0) throw new OpenApiError('The description has no operations');
  return {
    title: String(doc.info?.title ?? 'API'),
    version: String(doc.info?.version ?? ''),
    servers: (doc.servers ?? []).map((s: any) => String(s?.url ?? '')).filter(Boolean),
    operations,
    skipped,
  };
}
