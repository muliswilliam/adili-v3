import { tracing } from '@opentelemetry/sdk-node';
import { describe, expect, it } from 'vitest';

import { RedactingSpanExporter } from './redacting-span-exporter.js';

describe('RedactingSpanExporter', () => {
  it('M10: blanks free-text query values in URL attributes, keeping the rest of the span', async () => {
    const inner = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new RedactingSpanExporter(inner))],
    });
    const tracer = provider.getTracer('test');

    tracer
      .startSpan('GET', {
        attributes: {
          'url.full':
            'http://review:4006/v1/commissions/psc/review/queue?search=Wanjiku%20Kamau&band=high',
          'http.target': '/v1/commissions/psc/review/queue?band=high&name=Kamau',
          'url.query': 'search=Kamau&late=true',
          'http.request.method': 'GET',
        },
      })
      .end();
    tracer.startSpan('POST', { attributes: { 'url.full': 'http://review:4006/v1/x' } }).end();
    await provider.forceFlush();

    const [get, post] = inner.getFinishedSpans();
    expect(get?.attributes).toEqual({
      'url.full': 'http://review:4006/v1/commissions/psc/review/queue?search=[redacted]&band=high',
      'http.target': '/v1/commissions/psc/review/queue?band=high&name=[redacted]',
      'url.query': 'search=[redacted]&late=true',
      'http.request.method': 'GET',
    });
    expect(get?.name).toBe('GET');
    expect(get?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(post?.attributes).toEqual({ 'url.full': 'http://review:4006/v1/x' });
    await provider.shutdown();
  });
});
