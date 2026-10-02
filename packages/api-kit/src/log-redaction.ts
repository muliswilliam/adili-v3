import { FREE_TEXT_PARAMS, REDACTED, redactUrl } from '@adili/telemetry/url-redaction';
import { stdSerializers } from 'pino';

export { REDACTED, redactUrl } from '@adili/telemetry/url-redaction';

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
    url: typeof serialized.url === 'string' ? redactUrl(serialized.url) : serialized.url,
    ...('query' in serialized ? { query: redactQuery(serialized.query) } : {}),
  };
}
