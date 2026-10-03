import { mockableClient } from '@adili/api-kit/client';
import type { Client } from 'openapi-fetch';

import { callService, type ServiceResult } from '../service-call';
import type { components, paths } from './api.gen';

/**
 * Typed client for the integration-gateway's public routes, generated from the committed contract
 * (packages/schemas/internal/integration-gateway.yaml → api.gen.ts via `pnpm generate:api`).
 * Runs on the server only: the browser never holds a token.
 */
export type IntegrationGatewayClient = Client<paths>;

type Schemas = components['schemas'];
export type IntegrationSystem = Schemas['System'];
export type SystemCoverage = Schemas['SystemCoverage'];
export type BreakerState = SystemCoverage['breaker'];
export type ProblemDetails = Schemas['ProblemDetails'];

/** How long the console waits for coverage: a few indexed counts. */
export const INTEGRATION_GATEWAY_TIMEOUT_MS = 5_000;

export function createIntegrationGatewayClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}): IntegrationGatewayClient {
  return mockableClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}` },
    timeoutMs: INTEGRATION_GATEWAY_TIMEOUT_MS,
    fetch: options.fetch,
  });
}

export type IntegrationGatewayResult<T> = ServiceResult<T, ProblemDetails>;

/** Runs one integration-gateway call and folds every outcome into a result. */
export const callIntegrationGateway: <T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
) => Promise<IntegrationGatewayResult<T>> = callService;
