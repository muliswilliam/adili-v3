import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';

/**
 * Records `route`, the template the server matched (`/internal/v1/things/:id`), for the request
 * being served. The HTTP instrumentation then sets `http.route` on the request's server span and
 * names it `GET /internal/v1/things/:id` (OTel HTTP semantic conventions), so the span still
 * says which endpoint ran once its URL attributes are redacted. Call it while the request's
 * context is active, e.g. from the web framework's `onRequest` hook; a no-op outside one.
 */
export function recordHttpRoute(route: string): void {
  const rpcMetadata = getRPCMetadata(context.active());
  if (rpcMetadata?.type === RPCType.HTTP) rpcMetadata.route = route;
}
