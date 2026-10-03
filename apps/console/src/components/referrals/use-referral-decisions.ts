import { useRef } from 'react';

import { approveCaseReferral, declineCaseReferral } from '../../server/referrals';
import type { ReferralDecisionRefusal, ReferralResult } from '../../server/referrals.server';
import type { Referral } from '../../server/review/types';

export type ReferralDecision = ReferralResult<Referral, ReferralDecisionRefusal>;

/**
 * Approve and decline one referral, as the inbox card and the referral page both call them. One
 * Idempotency-Key per approval, reused on retry after a failure so a retry cannot approve twice,
 * and dropped once review answered (approved, or refused by its rules).
 */
export function useReferralDecisions(referralId: string, newKey: () => string) {
  const approvalKey = useRef<string | null>(null);
  return {
    approve: async (): Promise<ReferralDecision> => {
      approvalKey.current ??= newKey();
      const result = await approveCaseReferral({
        data: { referralId, idempotencyKey: approvalKey.current },
      });
      if (result.ok || result.refusal) approvalKey.current = null;
      return result;
    },
    decline: (note: string): Promise<ReferralDecision> =>
      declineCaseReferral({ data: { referralId, note } }),
  };
}
