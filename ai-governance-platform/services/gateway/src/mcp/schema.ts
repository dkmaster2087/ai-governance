import { JsonSchema } from './openapi';

/**
 * Check tool arguments against the tool's input schema: the subset of JSON Schema OpenAPI descriptions use
 * (type, properties, required, additionalProperties, items, enum, string length, numeric range). Returns the
 * problems, in plain words; empty when the arguments are fine.
 */
export function validateArguments(schema: JsonSchema, value: unknown, path = 'arguments', depth = 0): string[] {
  if (depth > 20) return [];
  const s = schema as any;
  const errors: string[] = [];
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (types.length) {
    const t = typeOf(value);
    const ok = types.some((want) => want === t || (want === 'number' && t === 'integer'));
    if (!ok) return [`${path} should be ${types.join(' or ')}`];
  }
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path} should be one of ${s.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(`${path} is longer than ${s.maxLength}`);
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${path} is shorter than ${s.minLength}`);
  }
  if (typeof value === 'number') {
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path} is above ${s.maximum}`);
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path} is below ${s.minimum}`);
  }
  if (Array.isArray(value) && s.items) {
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${path} has more than ${s.maxItems} items`);
    value.slice(0, 200).forEach((v, i) => errors.push(...validateArguments(s.items, v, `${path}[${i}]`, depth + 1)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props: Record<string, JsonSchema> = s.properties ?? {};
    for (const r of s.required ?? []) if (obj[r] === undefined) errors.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errors.push(...validateArguments(props[k], v, `${path}.${k}`, depth + 1));
      else if (s.additionalProperties === false) errors.push(`${path}.${k} isn't an argument of this tool`);
    }
  }
  return errors;
}
