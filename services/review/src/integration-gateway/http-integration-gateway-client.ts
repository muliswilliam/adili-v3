import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { paths } from './integration-gateway-api.gen.js';
import {
  lookupResultSchema,
  rateLimitsSchema,
  storedResultSchema,
  supplierCheckSchema,
} from './registry-records.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type LookupSystem,
  type PayrollContext,
  type PayrollInstruction,
  type PayrollInstructionRequest,
  type RegistryContext,
  type RegistryResults,
  type StoredResult,
  type SupplierCheckResult,
} from './integration-gateway-client.js';

/** The scope the review service's token needs for the gateway's payroll instructions. */
export const PAYROLL_SCOPE = 'payroll';

/** The legal basis of every payroll instruction: sanctions under the Administrative Mechanisms. */
export const PAYROLL_LEGAL_BASIS = 'am-sanctions';

/**
 * The gateway's adapter kit times payroll out well within this. Instructions go out from workflow
 * activities, which retry. Recorded in ADR-013 §2 (synchronous budgets).
 */
export const PAYROLL_TIMEOUT_MS = 15_000;

/**
 * A registry lookup answers within the gateway's 2-second registry timeout plus up to a second
 * waiting for the system's rate limit, twice over for KRA (PINs, then compliance). Lookups go out
 * from workflow activities, which look up again. Recorded in ADR-013 §2 (synchronous budgets).
 */
export const REGISTRY_TIMEOUT_MS = 10_000;

export interface HttpIntegrationGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Payroll instructions'; `PAYROLL_TIMEOUT_MS` by default. */
  timeoutMs?: number;
  /** Registry lookups' and stored results'; `REGISTRY_TIMEOUT_MS` by default. */
  registryTimeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const instructionSchema = z.object({
  instructionReference: z.string().min(1),
  action: z.enum(['stop_salary', 'resume_salary']),
  status: z.enum(['accepted', 'pending', 'failed']),
  payrollReference: z.string().nullable(),
  receivedAt: z.string().nullable(),
  sentAt: z.string(),
});

/** Each registry's lookup operation. */
const LOOKUP_PATHS = {
  kra: '/internal/v1/kra/taxpayer-lookups',
  ntsa: '/internal/v1/ntsa/vehicle-lookups',
  brs: '/internal/v1/brs/directorship-lookups',
  ardhisasa: '/internal/v1/ardhisasa/parcel-lookups',
} as const satisfies Record<LookupSystem, string>;

/** A refusal: the request is wrong (legal basis, case reference) or the token lacks the scope. */
const refused = {
  400: rejectedBy('integration-gateway'),
  403: rejectedBy('integration-gateway'),
};

/**
 * The integration-gateway's internal API through the client generated from its contract
 * (integration-gateway-api.gen.ts), with the review service's own token.
 *
 * - `POST /internal/v1/payroll/instructions` (`payroll`), with the legal basis `am-sanctions` and
 *   the review case when there is one. 201 (sent now) and 200 (a replay of the same reference)
 *   both answer the acknowledgement; an instruction the gateway refuses (400) is
 *   `InternalApiRejected`, anything else unexpected `IntegrationGatewayUnavailable`.
 * - The registry lookups, the supplier check and stored results (`registry`), acting for the
 *   Commission (`X-Acting-Tenant`) with the legal basis, the case and its declarant
 *   (`X-Subject-Person`, so reads of the stored result are audited as reads of their data). A lookup always answers
 *   200, `unavailable` included; 503 `lookup-not-recorded` (the gateway could not audit it) and
 *   anything else unexpected is `IntegrationGatewayUnavailable`, a refusal (400, 403)
 *   `InternalApiRejected`.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly gateway: ServiceClient<paths>;
  private readonly registries: ServiceClient<paths>;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    const client = (timeoutMs: number) =>
      createServiceClient<paths>({
        baseUrl: options.gatewayUrl,
        service: 'integration-gateway',
        tokens: options.tokens,
        unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
        timeoutMs,
        fetch: options.fetch,
      });
    this.gateway = client(options.timeoutMs ?? PAYROLL_TIMEOUT_MS);
    this.registries = client(options.registryTimeoutMs ?? REGISTRY_TIMEOUT_MS);
  }

  submitPayrollInstruction(
    instruction: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction> {
    return this.gateway.call(
      (api) =>
        api.POST('/internal/v1/payroll/instructions', {
          params: {
            header: {
              'X-Legal-Basis': PAYROLL_LEGAL_BASIS,
              ...(context.caseRef === undefined ? {} : { 'X-Case-Ref': context.caseRef }),
            },
          },
          body: instruction,
        }),
      {
        status: [200, 201],
        schema: instructionSchema,
        otherwise: { 400: rejectedBy('integration-gateway') },
      },
    );
  }

  lookupRegistry<S extends LookupSystem>(
    system: S,
    nationalId: string,
    context: RegistryContext,
  ): Promise<RegistryResults[S]> {
    // The four lookups take the same request; only the path differs.
    const path = LOOKUP_PATHS[system] as (typeof LOOKUP_PATHS)['kra'];
    return this.registries.call(
      (api) =>
        api.POST(path, { params: { header: registryHeaders(context) }, body: { nationalId } }),
      { status: 200, schema: lookupResultSchema(system), otherwise: refused },
    );
  }

  checkSupplier(
    registrationNumber: string,
    employerCode: string,
    context: RegistryContext,
  ): Promise<SupplierCheckResult> {
    return this.registries.call(
      (api) =>
        api.GET('/internal/v1/brs/companies/{registrationNumber}/supplies', {
          params: {
            path: { registrationNumber },
            query: { employerCode },
            header: registryHeaders(context),
          },
        }),
      { status: 200, schema: supplierCheckSchema, otherwise: refused },
    );
  }

  getStoredResult(
    resultId: string,
    tenant: string,
    actingSubject: string,
  ): Promise<StoredResult | null> {
    return this.registries.call(
      (api) =>
        api.GET('/internal/v1/verification-results/{resultId}', {
          params: {
            path: { resultId },
            header: { 'X-Acting-Tenant': tenant, 'X-Acting-Subject': actingSubject },
          },
        }),
      { status: 200, schema: storedResultSchema, otherwise: { ...refused, 404: () => null } },
    );
  }

  async getRegistryRateLimits(): Promise<Record<string, number>> {
    const limits = await this.registries.call(
      (api) => api.GET('/internal/v1/registry-rate-limits'),
      { status: 200, schema: rateLimitsSchema, otherwise: refused },
    );
    return Object.fromEntries(limits.map(({ system, ratePerMinute }) => [system, ratePerMinute]));
  }
}

function registryHeaders({ tenant, legalBasis, caseRef, subjectPersonId }: RegistryContext) {
  return {
    'X-Acting-Tenant': tenant,
    'X-Legal-Basis': legalBasis,
    'X-Case-Ref': caseRef,
    'X-Subject-Person': subjectPersonId,
  };
}
