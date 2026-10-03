import { recordHttpRoute } from '@adili/telemetry/http-route';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Names each request's server span after the route it matched (`GET /internal/v1/things/:id`,
 * with `http.route`), rather than just `GET`. The span exporter redacts identifiers and other
 * values from URLs, so without the template a trace would not say which endpoint was called.
 * Requests that match no route (404s) keep the bare method name.
 */
export function traceRouteTemplates(app: NestFastifyApplication): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, _reply, done) => {
      const route = request.routeOptions.url;
      if (route !== undefined) recordHttpRoute(route);
      done();
    });
}
