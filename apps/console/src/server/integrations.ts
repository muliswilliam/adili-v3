import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asIntegrationGatewayViewer } from './as-viewer.server';
import {
  callIntegrationGateway,
  type IntegrationGatewayResult,
  type IntegrationSystem,
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

/**
 * A system as the coverage response names it: the page offers Pause and Resume only on the rows
 * coverage returns, so no list is kept here; the gateway answers 404 for a system without an
 * adapter.
 */
const systemInput = z.object({
  system: z.custom<IntegrationSystem>(
    (value) => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value),
  ),
});

/**
 * `POST /v1/integrations/{system}/pause`: the system's lookups answer unavailable (paused) until
 * it is resumed; the system's coverage after. Platform admins only.
 */
export const pauseIntegration = createServerFn({ method: 'POST' })
  .validator(systemInput)
  .handler(({ data }): Promise<IntegrationGatewayResult<SystemCoverage>> =>
    asIntegrationGatewayViewer((client) =>
      callIntegrationGateway(() =>
        client.POST('/v1/integrations/{system}/pause', {
          params: { path: { system: data.system } },
        }),
      ),
    ),
  );

/** `POST /v1/integrations/{system}/resume`: lookups call the system again. Platform admins only. */
export const resumeIntegration = createServerFn({ method: 'POST' })
  .validator(systemInput)
  .handler(({ data }): Promise<IntegrationGatewayResult<SystemCoverage>> =>
    asIntegrationGatewayViewer((client) =>
      callIntegrationGateway(() =>
        client.POST('/v1/integrations/{system}/resume', {
          params: { path: { system: data.system } },
        }),
      ),
    ),
  );
