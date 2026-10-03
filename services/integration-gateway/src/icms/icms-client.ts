import { Inject, Injectable } from '@nestjs/common';

import { UpstreamError } from '../adapter-kit/upstream-error.js';
import { callUpstream } from '../adapter-kit/upstream-http.js';
import {
  type IcmsReferralRequest,
  type IcmsRegistration,
  icmsRegistrationSchema,
} from './icms-records.js';

export const ICMS_CLIENT_OPTIONS = Symbol('ICMS_CLIENT_OPTIONS');

export interface IcmsClientOptions {
  /** Ends before `/v1`, e.g. `http://localhost:8000/icms`. */
  baseUrl: string;
}

/**
 * The ICMS adapter (external/icms.yaml `submitReferral`): registers one referral and answers
 * ICMS's registration. ICMS is idempotent by referral reference, answering a resubmission with
 * the original (200), so sending again after a timeout never opens a second case. Everything
 * about the declarant travels in the body. Anything but a registration of this referral
 * reference is an `UpstreamError`. No retries here: the caller retries, and the kit's timeout
 * and breaker apply (`ResilientCalls`).
 */
@Injectable()
export class IcmsClient {
  constructor(@Inject(ICMS_CLIENT_OPTIONS) private readonly options: IcmsClientOptions) {}

  async submit(referral: IcmsReferralRequest, signal: AbortSignal): Promise<IcmsRegistration> {
    const registration = await callUpstream(
      {
        name: 'ICMS',
        url: `${this.options.baseUrl}/v1/referrals`,
        signal,
        ok: [200, 201],
        body: {
          referral_reference: referral.referralReference,
          id_number: referral.nationalId,
          full_name: referral.fullName,
          referring_commission: referral.referringCommission,
          grounds: referral.grounds,
          details: referral.details,
        },
      },
      icmsRegistrationSchema,
    );
    if (registration?.referralReference !== referral.referralReference) {
      throw new UpstreamError('upstream-error', 'ICMS registered another referral');
    }
    return registration;
  }
}
