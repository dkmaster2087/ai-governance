/**
 * OTLP logs in protobuf: the encoding every OpenTelemetry receiver must accept (JSON is optional, and Elastic's
 * APM Server, for one, takes only protobuf). Only the fields Probaline sends are encoded, by hand, following
 * opentelemetry/proto/collector/logs/v1/logs_service.proto (ExportLogsServiceRequest) and logs/v1/logs.proto.
 * The input is the same object the JSON encoding sends, so both carry exactly the same data.
 */

type AnyValue = { stringValue?: string; boolValue?: boolean; intValue?: string; doubleValue?: number };
type KeyValue = { key: string; value: AnyValue };
export interface OtlpLogsJson {
  resourceLogs: Array<{
    resource: { attributes: KeyValue[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<{ timeUnixNano: string; severityNumber: number; severityText: string; body: AnyValue; attributes: KeyValue[] }>;
    }>;
  }>;
}

const WIRE = { varint: 0, fixed64: 1, len: 2 } as const;

function varint(n: bigint): Buffer {
  const out: number[] = [];
  let v = BigInt.asUintN(64, n);
  while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; }
  out.push(Number(v));
  return Buffer.from(out);
}
const key = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
const len = (field: number, bytes: Buffer) => Buffer.concat([key(field, WIRE.len), varint(BigInt(bytes.length)), bytes]);
const str = (field: number, s: string) => len(field, Buffer.from(s, 'utf8'));
const int = (field: number, n: bigint) => Buffer.concat([key(field, WIRE.varint), varint(n)]);
function fixed64(field: number, n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt.asUintN(64, n));
  return Buffer.concat([key(field, WIRE.fixed64), b]);
}
function double(field: number, d: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(d);
  return Buffer.concat([key(field, WIRE.fixed64), b]);
}

function anyValue(v: AnyValue): Buffer {
  if (v.stringValue !== undefined) return str(1, v.stringValue);
  if (v.boolValue !== undefined) return int(2, v.boolValue ? 1n : 0n);
  if (v.intValue !== undefined) return int(3, BigInt(v.intValue));
  if (v.doubleValue !== undefined) return double(4, v.doubleValue);
  return Buffer.alloc(0);
}
const keyValue = (kv: KeyValue) => Buffer.concat([str(1, kv.key), len(2, anyValue(kv.value))]);

/** ExportLogsServiceRequest, from the OTLP/JSON shape. */
export function encodeOtlpLogs(req: OtlpLogsJson): Buffer {
  return Buffer.concat(req.resourceLogs.map((rl) => len(1, Buffer.concat([
    len(1, Buffer.concat(rl.resource.attributes.map((a) => len(1, keyValue(a))))),
    ...rl.scopeLogs.map((sl) => len(2, Buffer.concat([
      len(1, Buffer.concat([str(1, sl.scope.name), str(2, sl.scope.version)])),
      ...sl.logRecords.map((r) => len(2, Buffer.concat([
        fixed64(1, BigInt(r.timeUnixNano)),
        int(2, BigInt(r.severityNumber)),
        str(3, r.severityText),
        len(5, anyValue(r.body)),
        ...r.attributes.map((a) => len(6, keyValue(a))),
      ]))),
    ]))),
  ]))));
}
