import type { Attributes } from '@opentelemetry/api';
import type { tracing } from '@opentelemetry/sdk-node';

import { redactTracedUrl } from './url-redaction.js';

/**
 * Span attributes that hold a request's URL or path, or its query alone (`url.query`, which
 * undici's instrumentation records with its `?` and the HTTP instrumentation without).
 */
const URL_ATTRIBUTES = ['url.full', 'url.original', 'url.path', 'http.url', 'http.target'] as const;
const QUERY_ATTRIBUTES = ['url.query'] as const;

/** A query alone, redacted as it would be in its URL, with or without its leading `?`. */
const redactQueryAttribute = (query: string) =>
  query.startsWith('?') ? redactTracedUrl(query) : redactTracedUrl(`?${query}`).slice(1);

/**
 * `attributes` with free-text query values and identifiers blanked in their URLs
 * (`redactTracedUrl`); the same object when there were none.
 */
export function redactAttributes(attributes: Attributes): Attributes {
  let redacted: Attributes | undefined;
  const set = (key: string, value: string) => {
    if (value === attributes[key]) return;
    redacted ??= { ...attributes };
    redacted[key] = value;
  };
  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string') set(key, redactTracedUrl(value));
  }
  for (const key of QUERY_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string') set(key, redactQueryAttribute(value));
  }
  return redacted ?? attributes;
}

/**
 * Exports spans through `exporter` with free-text query values (`search=`, `name=`, ...) and
 * identifiers (`/v1/persons/22607781`, `?id_number=22607781`) blanked in their URL attributes.
 * HTTP auto-instrumentation records the full URL of every request a service serves or sends, so
 * a name in a query string, or a national ID, KRA PIN or personal number a registry takes in its
 * path, would otherwise reach the trace store. Our own endpoints take such values in a body; the
 * registries' wire protocols are theirs, so every service's spans are redacted here, centrally.
 */
export class RedactingSpanExporter implements tracing.SpanExporter {
  constructor(private readonly exporter: tracing.SpanExporter) {}

  export(
    spans: tracing.ReadableSpan[],
    resultCallback: Parameters<tracing.SpanExporter['export']>[1],
  ): void {
    this.exporter.export(spans.map(redactSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }
}

/** The span as it was, but for its attributes. */
function redactSpan(span: tracing.ReadableSpan): tracing.ReadableSpan {
  const attributes = redactAttributes(span.attributes);
  if (attributes === span.attributes) return span;
  return new Proxy(span, {
    get(target, property) {
      if (property === 'attributes') return attributes;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
}
