import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { RegistryResult, RegistrySystem } from '../suggestions/registry-results.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type RegistryLookup,
} from './integration-gateway-client.js';
import { REGISTRY_SCOPE, type RegistryLookupPaths } from './registry-lookup-api.js';

/** The scope the declarations service's token needs for the registry lookups. */
export { REGISTRY_SCOPE };

/**
 * How long a lookup may take: the gateway times each registry out at 2 s behind its breaker and
 * rate limit, plus the hop and its cache and audit writes. Recorded in ADR-013 §2; lookups run in
 * workflow activities, which retry.
 */
export const REGISTRY_LOOKUP_TIMEOUT_MS = 5_000;

export interface HttpIntegrationGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `REGISTRY_LOOKUP_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const envelope = <TSystem extends RegistrySystem>(system: TSystem) =>
  z.object({
    resultId: z.uuid(),
    system: z.literal(system),
    outcome: z.enum(['found', 'not-found', 'unavailable']),
    // #461 adds `rate-limited`, which the committed contract's types lack until regenerated: the
    // registry gave no answer either way, and only `outcome` matters to the suggestions.
    reason: z
      .enum(['timeout', 'breaker-open', 'paused', 'rate-limited', 'upstream-error'])
      .nullable()
      .transform((reason) => (reason === 'rate-limited' ? 'upstream-error' : reason)),
    cached: z.boolean(),
    checkedAt: z.string(),
  });

const kraResultSchema = envelope('kra').extend({
  taxpayers: z.array(
    z.object({
      pin: z.string(),
      registeredOn: z.string(),
      compliance: z.object({
        status: z.enum(['compliant', 'non-compliant', 'unknown']),
        certificateNumber: z.string().nullable(),
        validUntil: z.string().nullable(),
        annualIncomeDeclaredCents: z.int().nullable(),
      }),
    }),
  ),
});

const ntsaResultSchema = envelope('ntsa').extend({
  vehicles: z.array(
    z.object({
      registrationNumber: z.string(),
      make: z.string(),
      model: z.string(),
      yearOfManufacture: z.int(),
      registeredOn: z.string(),
    }),
  ),
});

const brsResultSchema = envelope('brs').extend({
  directorships: z.array(
    z.object({
      companyRegistrationNumber: z.string(),
      companyName: z.string(),
      companyStatus: z.string(),
      role: z.string(),
      shares: z.number().nullable(),
      appointedOn: z.string(),
    }),
  ),
});

const ardhisasaResultSchema = envelope('ardhisasa').extend({
  parcels: z.array(
    z.object({
      parcelNumber: z.string(),
      county: z.string(),
      areaHectares: z.number(),
      tenure: z.string(),
      registeredOn: z.string(),
    }),
  ),
});

/**
 * The integration-gateway's registry lookups (KRA, NTSA, BRS, ArdhiSasa) on api-kit's service
 * client, typed by `registry-lookup-api.ts` until the gateway's contract has them (#461): the
 * service's own token (`registry`), the national ID in the body, the Commission in
 * `X-Acting-Tenant`, the legal basis in `X-Legal-Basis`, the declaration in `X-Case-Ref` and the
 * declarant in `X-Subject-Person`. Each answer is validated at the boundary; an unreachable
 * gateway, any other status (a refusal, or 503 `lookup-not-recorded`) or a body off contract is
 * `IntegrationGatewayUnavailable`. A registry that did not answer (timeout, open breaker, paused,
 * rate-limited) is a 200 with outcome `unavailable`, passed on as it is.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly gateway: ServiceClient<RegistryLookupPaths>;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    this.gateway = createServiceClient<RegistryLookupPaths>({
      baseUrl: options.gatewayUrl,
      service: 'integration-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? REGISTRY_LOOKUP_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  lookup(request: RegistryLookup): Promise<RegistryResult> {
    const params = {
      header: {
        'X-Acting-Tenant': request.tenant,
        'X-Legal-Basis': request.legalBasis,
        'X-Case-Ref': request.caseRef,
        'X-Subject-Person': request.subjectPersonId,
      },
    };
    const body = { nationalId: request.nationalId };
    switch (request.system) {
      case 'kra':
        return this.gateway.call(
          (api) => api.POST('/internal/v1/kra/taxpayer-lookups', { params, body }),
          { status: 200, schema: kraResultSchema },
        );
      case 'ntsa':
        return this.gateway.call(
          (api) => api.POST('/internal/v1/ntsa/vehicle-lookups', { params, body }),
          { status: 200, schema: ntsaResultSchema },
        );
      case 'brs':
        return this.gateway.call(
          (api) => api.POST('/internal/v1/brs/directorship-lookups', { params, body }),
          { status: 200, schema: brsResultSchema },
        );
      case 'ardhisasa':
        return this.gateway.call(
          (api) => api.POST('/internal/v1/ardhisasa/parcel-lookups', { params, body }),
          { status: 200, schema: ardhisasaResultSchema },
        );
    }
  }
}
