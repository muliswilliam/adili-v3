/**
 * The referrals intake's workflow (ADR-003), hosted by the reporting worker (`../workflows.ts`).
 * Bundled into Temporal's deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { proxyActivities, sleep } from '@temporalio/workflow';

import type { ReferralIcmsActivities } from './activities.js';
import {
  ICMS_CHECK_FIRST_DELAY_MS,
  ICMS_CHECK_MAX_DELAY_MS,
  ICMS_REGISTRATION_TIMEOUT_MS,
  type IcmsRegistrationInput,
  type IcmsRegistrationResult,
} from './contract.js';

/** Asking the gateway where an ICMS registration stands: retried with backoff while unreachable. */
const { checkIcmsRegistration, recordIcmsTimeout } = proxyActivities<ReferralIcmsActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

/**
 * `ReferralIcmsRegistrationWorkflow` (spec 09 referrals intake): ICMS accepted an EACC push of a
 * referral without a case number yet. Asks the gateway a minute later, then twice as late each
 * time (at most an hour apart), until the case number is stored (`registered`), ICMS failed the
 * registration, or the referral was registered or pushed again meanwhile (`superseded`). After
 * seven days without a case number the referral is left `push-failed` for EACC to push again.
 * Started by the push, one per push. History holds the referral id, the push attempt and
 * outcomes only: never the case number, a name or an ID number.
 */
export async function referralIcmsRegistration(
  input: IcmsRegistrationInput,
): Promise<IcmsRegistrationResult> {
  const deadline = Date.now() + ICMS_REGISTRATION_TIMEOUT_MS;
  let delay = ICMS_CHECK_FIRST_DELAY_MS;
  let checks = 0;
  while (Date.now() + delay <= deadline) {
    await sleep(delay);
    const outcome = await checkIcmsRegistration(input);
    checks += 1;
    if (outcome !== 'pending') return { outcome, checks };
    delay = Math.min(delay * 2, ICMS_CHECK_MAX_DELAY_MS);
  }
  const timedOut = await recordIcmsTimeout(input);
  return { outcome: timedOut ? 'timed-out' : 'superseded', checks };
}
