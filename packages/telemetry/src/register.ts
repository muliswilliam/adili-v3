/**
 * Preload entry: `node --import @adili/telemetry/register dist/main.js`.
 * Must run before application modules load so instrumentations can patch them.
 */
import { register } from 'node:module';

import { startTelemetry } from './index.js';

if (process.env.OTEL_SDK_DISABLED !== 'true') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  startTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'unknown-service',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
}
