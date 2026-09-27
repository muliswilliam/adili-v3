import type { OpenAPIObject } from '@nestjs/swagger';

const OPERATION_KEY_ORDER = [
  'tags',
  'summary',
  'description',
  'operationId',
  'x-draft',
  'parameters',
  'requestBody',
  'responses',
  'security',
];

/**
 * The document with keys in reading order (info before paths, an operation's summary before
 * its responses) and without empty lists, as people read the exported contract.
 */
export function readable(document: OpenAPIObject): OpenAPIObject {
  const { openapi, info, servers, tags, paths, components, ...rest } = document;
  return {
    openapi,
    info,
    ...(servers?.length ? { servers } : {}),
    ...(tags?.length ? { tags } : {}),
    paths: Object.fromEntries(
      Object.entries(paths).map(([path, item]) => [
        path,
        Object.fromEntries(
          Object.entries(item).map(([key, value]) => [
            key,
            isOperation(value) ? orderOperation(value) : value,
          ]),
        ),
      ]),
    ),
    ...(components ? { components } : {}),
    ...rest,
  };
}

function isOperation(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && 'responses' in value;
}

function orderOperation(operation: Record<string, unknown>): Record<string, unknown> {
  const rank = (key: string) => {
    const index = OPERATION_KEY_ORDER.indexOf(key);
    return index === -1 ? OPERATION_KEY_ORDER.length : index;
  };
  return Object.fromEntries(
    Object.entries(operation)
      .filter(([key, value]) => !(key === 'parameters' && Array.isArray(value) && !value.length))
      .sort(([a], [b]) => rank(a) - rank(b)),
  );
}
