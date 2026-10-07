import { FREE_TEXT_PARAMS, REDACTED, redactUrl } from '@adili/telemetry/url-redaction';
import { stdSerializers } from 'pino';

export { REDACTED, redactUrl } from '@adili/telemetry/url-redaction';

/**
 * A national ID as the directory accepts it: 5 to 10 digits. The same shape in a log line is
 * treated as an identifier, and an amount of that many digits written into a message is too.
 * A fresh expression each scan: a shared global expression keeps `lastIndex` between calls.
 */
const NATIONAL_ID_PATTERN = /\b\d{5,10}\b/;

function nationalIdPattern(): RegExp {
  return new RegExp(NATIONAL_ID_PATTERN.source, 'g');
}

/** Structured fields that must not be logged: a national ID, or an amount. */
const FORBIDDEN_FIELDS = new Set(['nationalid', 'amount', 'amounts']);

/**
 * Numeric fields a process log always carries. A pid or a timestamp is not an identifier, so the
 * scanner leaves them. Anything else of 5 to 10 digits is the national ID pattern.
 */
const SAFE_NUMERIC_FIELDS = new Set([
  'level',
  'time',
  'pid',
  'port',
  'statuscode',
  'responsetime',
  'hostname',
]);

export type LogFindingKind = 'forbidden-field' | 'national-id';

export interface LogFinding {
  kind: LogFindingKind;
  /** The field name, or the digit sequence. */
  detail: string;
}

function fieldKey(key: string): string {
  return key.toLowerCase().replaceAll(/[_-]/g, '');
}

function isForbiddenField(key: string): boolean {
  return FORBIDDEN_FIELDS.has(fieldKey(key));
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactString(value: string): string {
  return value.replaceAll(nationalIdPattern(), REDACTED);
}

/**
 * A copy of a log argument with forbidden fields and national ID patterns removed. Request
 * objects are left for {@link serializeRequest}; an Error is reduced to its redacted message.
 */
export function redactLogValue(value: unknown, key?: string): unknown {
  if (key !== undefined && isForbiddenField(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    return {
      type: value.name,
      message: redactString(value.message),
      ...(value.stack === undefined ? {} : { stack: redactString(value.stack) }),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (typeof value === 'object' && value !== null && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !isForbiddenField(entryKey))
        .map(([entryKey, entry]) => [entryKey, redactLogValue(entry, entryKey)]),
    );
  }
  return value;
}

function walkLog(value: unknown, key: string | undefined, findings: LogFinding[]): void {
  if (key !== undefined && isForbiddenField(key)) {
    findings.push({ kind: 'forbidden-field', detail: key });
    return;
  }
  if (typeof value === 'string') {
    for (const match of value.matchAll(nationalIdPattern())) {
      findings.push({ kind: 'national-id', detail: match[0] });
    }
    return;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    const digits = String(Math.abs(value));
    if (
      digits.length >= 5 &&
      digits.length <= 10 &&
      (key === undefined || !SAFE_NUMERIC_FIELDS.has(fieldKey(key)))
    ) {
      findings.push({ kind: 'national-id', detail: digits });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkLog(item, undefined, findings);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [entryKey, entry] of Object.entries(value)) walkLog(entry, entryKey, findings);
  }
}

/**
 * What a structured log line must not contain. A JSON line is walked; anything else is scanned
 * as text. Empty when the line is safe to keep.
 */
export function scanLogLine(line: string): LogFinding[] {
  const findings: LogFinding[] = [];
  try {
    walkLog(JSON.parse(line) as unknown, undefined, findings);
  } catch {
    walkLog(line, undefined, findings);
  }
  return findings;
}

function redactQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      FREE_TEXT_PARAMS.has(key.toLowerCase()) ? REDACTED : value,
    ]),
  );
}

/** pino `req` serializer: the standard one, with free-text query values redacted. */
export function serializeRequest(request: Parameters<typeof stdSerializers.req>[0]) {
  const serialized = stdSerializers.req(request);
  return {
    ...serialized,
    url:
      typeof serialized.url === 'string'
        ? redactLogValue(redactUrl(serialized.url))
        : serialized.url,
    ...('query' in serialized ? { query: redactQuery(serialized.query) } : {}),
  };
}
