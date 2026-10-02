import type { Attributes } from '@opentelemetry/api';
import type { tracing } from '@opentelemetry/sdk-node';

import { redactUrl } from './url-redaction.js';

/** Span attributes that hold a request's URL, or its query alone (`url.query`). */
const URL_ATTRIBUTES = ['url.full', 'url.original', 'http.url', 'http.target'] as const;
const QUERY_ATTRIBUTES = ['url.query'] as const;

/** `attributes` with free-text query values blanked; the same object when there were none. */
export function redactAttributes(attributes: Attributes): Attributes {
  let redacted: Attributes | undefined;
  const set = (key: string, value: string) => {
    if (value === attributes[key]) return;
    redacted ??= { ...attributes };
    redacted[key] = value;
  };
  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string') set(key, redactUrl(value));
  }
  for (const key of QUERY_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string') set(key, redactUrl(`?${value}`).slice(1));
  }
  return redacted ?? attributes;
}

/**
 * Exports spans through `exporter` with free-text query values (`search=`, `name=`, ...) blanked
 * in their URL attributes. HTTP auto-instrumentation records the full URL of every request a
 * service serves or sends, so a name in a query string would otherwise reach the trace store.
 * A safety net: endpoints take such text in a body.
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
