import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
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

export interface HttpIntegrationGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
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
 * The integration-gateway's ICMS adapter with the reporting service's own token (`icms`) and the
 * legal basis of a referral: `POST /internal/v1/icms/referrals` (201 registered now, 200 a replay
 * of the same reference) and `GET /internal/v1/icms/referrals/{referralReference}`.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly api: InternalApi;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.gatewayUrl,
      service: 'integration-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
      // The gateway's adapter kit times ICMS out well within this.
      timeoutMs: options.timeoutMs ?? 15_000,
      fetch: options.fetch,
    });
  }

  async submitReferral(tenant: string, referral: IcmsReferralRequest): Promise<IcmsReferral> {
    const registered = await this.api.post({
      path: 'internal/v1/icms/referrals',
      tenant,
      headers: { 'x-legal-basis': ICMS_LEGAL_BASIS },
      body: referral,
      schema: referralSchema,
    });
    if (!registered) {
      throw new IntegrationGatewayUnavailable('The integration-gateway answered 404');
    }
    return registered;
  }

  getReferral(tenant: string, referralReference: string): Promise<IcmsReferral | null> {
    return this.api.get({
      path: `internal/v1/icms/referrals/${encodeURIComponent(referralReference)}`,
      tenant,
      schema: referralSchema,
    });
  }
}
