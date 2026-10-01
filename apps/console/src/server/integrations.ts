import { createServerFn } from '@tanstack/react-start';

import { asIntegrationGatewayViewer } from './as-viewer.server';
import {
  callIntegrationGateway,
  type IntegrationGatewayResult,
  type SystemCoverage,
} from './integration-gateway/client';

/**
 * `GET /v1/integrations/coverage`: per registry integration, calls and failures in the last 24
 * hours, cache hit rate, breaker, last success, paused and configuration. Platform admins only;
 * 403 for anyone else.
 */
export const getIntegrationsCoverage = createServerFn({ method: 'GET' }).handler(
  (): Promise<IntegrationGatewayResult<SystemCoverage[]>> =>
    asIntegrationGatewayViewer((client) =>
      callIntegrationGateway(() => client.GET('/v1/integrations/coverage')),
    ),
);
