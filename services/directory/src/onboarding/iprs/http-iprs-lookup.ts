import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './integration-gateway-api.gen.js';
import { type IprsPerson, IprsLookup, IprsUnavailable } from './iprs-lookup.js';

/** The scope the directory's service token needs for the IPRS lookup. */
export const IPRS_SCOPE = 'iprs';

export interface HttpIprsLookupOptions {
  /** Base URL of the integration-gateway, e.g. `http://localhost:4009`. */
  integrationGatewayUrl: string;
  /** Client credentials tokens of the directory carrying `iprs`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Per call. Default ADR-013's 2 s: the gateway gives IPRS 2 s itself and answers 503 past that,
   * so a slow IPRS reads the same either way.
   */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** What the directory reads of the gateway's `IprsPerson`, validated at the boundary. */
const iprsPersonSchema = z.object({
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
});

/**
 * IPRS through the integration-gateway's internal API (`POST /internal/v1/iprs/person-lookups`,
 * the national ID in the body so it stays out of URLs and logs), with the client generated from
 * its contract (packages/schemas/internal/integration-gateway.yaml → integration-gateway-api.gen.ts
 * via `pnpm generate:api`) on api-kit's service client (the directory's own token with `iprs`,
 * one retry after a 401). 200 is the person, 404 no such person; anything else (503
 * `upstream-unavailable`, a person that breaks the contract, no answer in time, no token) is
 * `IprsUnavailable`.
 */
export class HttpIprsLookup extends IprsLookup {
  private readonly gateway: ServiceClient<paths>;

  constructor(options: HttpIprsLookupOptions) {
    super();
    this.gateway = createServiceClient<paths>({
      baseUrl: options.integrationGatewayUrl,
      service: 'the integration-gateway',
      tokens: options.tokens,
      unavailable: (message, options) => new IprsUnavailable(message, options),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  find(nationalId: string): Promise<IprsPerson | null> {
    return this.gateway.call(
      (api) => api.POST('/internal/v1/iprs/person-lookups', { body: { nationalId } }),
      { status: 200, schema: iprsPersonSchema, otherwise: { 404: () => null } },
    );
  }
}
