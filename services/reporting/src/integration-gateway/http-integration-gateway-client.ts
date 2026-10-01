import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './integration-gateway-api.gen.js';
import {
  type IcmsReferral,
  type IcmsReferralRequest,
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from './integration-gateway-client.js';

/** The scope the reporting service's token needs for the gateway's ICMS adapter. */
export const ICMS_SCOPE = 'icms';

/** The legal basis of every ICMS registration: a referral to EACC under Regs r.20. */
export const ICMS_LEGAL_BASIS = 'regs-r20-referral';

/**
 * How long an ICMS call may take: the gateway's adapter kit times ICMS out well within it.
 * Recorded in ADR-013 §2; registration is idempotent by the referral reference.
 */
export const ICMS_TIMEOUT_MS = 15_000;

export interface HttpIntegrationGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `ICMS_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const referralSchema = z.object({
  referralReference: z.string().min(1),
  caseNumber: z.string().min(1).nullable(),
  status: z.enum(['registered', 'pending', 'failed']),
  registeredAt: z.string().nullable(),
  sentAt: z.string(),
});

/**
 * The integration-gateway's ICMS adapter through the client generated from its contract
 * (packages/schemas/internal/integration-gateway.yaml → integration-gateway-api.gen.ts via
 * `pnpm generate:api`), with the reporting service's own token (`icms`) and the legal basis of a
 * referral: `submitIcmsReferral` (201 registered now, 200 a replay of the same reference) and
 * `getIcmsReferral`.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly gateway: ServiceClient<paths>;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    this.gateway = createServiceClient<paths>({
      baseUrl: options.gatewayUrl,
      service: 'integration-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? ICMS_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  submitReferral(referral: IcmsReferralRequest): Promise<IcmsReferral> {
    return this.gateway.call(
      (api) =>
        api.POST('/internal/v1/icms/referrals', {
          params: { header: { 'X-Legal-Basis': ICMS_LEGAL_BASIS } },
          body: referral,
        }),
      {
        status: [200, 201],
        schema: referralSchema,
        otherwise: refusedWith('integration-gateway', [400]),
      },
    );
  }

  getReferral(referralReference: string): Promise<IcmsReferral | null> {
    return this.gateway.call(
      (api) =>
        api.GET('/internal/v1/icms/referrals/{referralReference}', {
          params: { path: { referralReference } },
        }),
      { status: 200, schema: referralSchema, otherwise: { 404: () => null } },
    );
  }
}
