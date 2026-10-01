/**
 * The JSON Canonicalization Scheme (RFC 8785) of a JSON value: no whitespace, object members
 * sorted by the UTF-16 code units of their names at every level, numbers and strings serialised as
 * ECMAScript's `JSON.stringify` does. Equal values serialise to the same string, so a hash of it
 * identifies the value however it was written.
 *
 * Built by hand rather than by sorting inside a `JSON.stringify` replacer: JavaScript enumerates
 * integer-like member names (`"2"`, `"10"`) in numeric order whatever order they were inserted in,
 * where RFC 8785 sorts them as strings (`"10"` before `"2"`).
 *
 * Values `JSON.stringify` would serialise differently than JSON allows are refused: non-finite
 * numbers throw. Members whose value is `undefined`, a function or a symbol are left out, and
 * `toJSON` is honoured (dates become ISO strings), as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  return serialise(toJsonValue(value)) ?? 'null';
}

function serialise(value: unknown): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RangeError(`canonical JSON has no representation for ${String(value)}`);
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => serialise(toJsonValue(item)) ?? 'null').join(',')}]`;
      }
      const members: string[] = [];
      for (const name of Object.keys(value).sort(byCodeUnits)) {
        const serialised = serialise(toJsonValue((value as Record<string, unknown>)[name]));
        if (serialised !== undefined) members.push(`${JSON.stringify(name)}:${serialised}`);
      }
      return `{${members.join(',')}}`;
    }
    default:
      // undefined, functions and symbols have no JSON form.
      return undefined;
  }
}

/** The value `JSON.stringify` would serialise in its place (its `toJSON`, if it has one). */
function toJsonValue(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    'toJSON' in value &&
    typeof value.toJSON === 'function'
  ) {
    return (value.toJSON as () => unknown)();
  }
  return value;
}

/** RFC 8785 §3.2.3: member names compared as arrays of UTF-16 code units. */
function byCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
