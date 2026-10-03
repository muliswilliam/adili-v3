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

  it('#476: blanks identifiers in the URL attributes of a registry call', async () => {
    const inner = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new RedactingSpanExporter(inner))],
    });
    const tracer = provider.getTracer('test');

    // As undici's instrumentation records a fetch: `url.query` keeps its `?`.
    tracer
      .startSpan('GET', {
        attributes: {
          'url.full': 'http://mocks:8000/kra/v1/pins?id_number=22607781',
          'url.path': '/kra/v1/pins',
          'url.query': '?id_number=22607781',
          'server.port': 8000,
        },
      })
      .end();
    // As the HTTP instrumentation records a call: `url.query` without it, the path in `http.target`.
    tracer
      .startSpan('GET', {
        attributes: {
          'http.url': 'http://mocks:8000/kra/v1/pins/A002260778R/compliance',
          'http.target': '/kra/v1/pins/A002260778R/compliance?search=Kamau',
          'url.query': 'id_number=22607781',
        },
      })
      .end();
    await provider.forceFlush();

    const [undici, http] = inner.getFinishedSpans();
    expect(undici?.attributes).toEqual({
      'url.full': 'http://mocks:8000/kra/v1/pins?id_number=[redacted]',
      'url.path': '/kra/v1/pins',
      'url.query': '?id_number=[redacted]',
      'server.port': 8000,
    });
    expect(http?.attributes).toEqual({
      'http.url': 'http://mocks:8000/kra/v1/pins/[redacted]/compliance',
      'http.target': '/kra/v1/pins/[redacted]/compliance?search=[redacted]',
      'url.query': 'id_number=[redacted]',
    });
    await provider.shutdown();
  });
});
