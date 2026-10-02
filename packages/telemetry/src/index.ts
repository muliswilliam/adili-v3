import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK, type tracing } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { RedactingSpanExporter } from './redacting-span-exporter.js';

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  /** OTLP gRPC endpoint, e.g. http://localhost:4317. */
  endpoint?: string;
  /**
   * Tests only, never set in a service: spans go here (redacted, as in production) rather than to
   * OTLP, and metrics are not exported at all. Tests pass an in-memory exporter to read what a
   * service's spans would carry.
   */
  testSpanExporter?: tracing.SpanExporter;
}

/**
 * Starts OpenTelemetry tracing and metrics. W3C `traceparent` propagation is the SDK default,
 * so traces follow requests across HTTP, AMQP and Temporal (ADR-013 §6).
 */
export function startTelemetry(options: TelemetryOptions): NodeSDK {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.0.0',
    }),
    // No free text a person typed and no identifier leaves in a traced URL ("no PII in URLs",
    // docs/architecture).
    traceExporter: new RedactingSpanExporter(
      options.testSpanExporter ?? new OTLPTraceExporter({ url: options.endpoint }),
    ),
    metricReaders: options.testSpanExporter
      ? []
      : [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: options.endpoint }),
          }),
        ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem and DNS spans are noise at our scale.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();

  const shutdown = () => {
    sdk.shutdown().catch((error: unknown) => {
      console.error('Telemetry shutdown failed', error);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return sdk;
}
