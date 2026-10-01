/**
 * The referral workflows (spec 08, ADR-003), hosted by the review worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow`, `@temporalio/common` and types.
 */
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { continueAsNew, executeChild, proxyActivities, sleep } from '@temporalio/workflow';

import type { ReferralActivities } from './activities.js';
import {
  type ReferralSendingInput,
  type ReferralSendingResult,
  type ReferralSweepCounts,
  type ReferralSweepInput,
  referralSweepWorkflowId,
} from './contract.js';

/**
 * Calls to declarations, documents, the directory and the database: retried with backoff until
 * they succeed, so an outage delays a proposal or a package, never loses it.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const {
  referralSweepTenants,
  missedCyclesCandidates,
  proposeMissedCycles,
  proposeUnansweredClarifications,
  issuePackage,
  markSent,
} = proxyActivities<ReferralActivities>({ startToCloseTimeout: '2 minutes', retry: RETRY });

const { buildManifest } = proxyActivities<ReferralActivities>({
  // Pulls every version of the source cases and hashes each letter.
  startToCloseTimeout: '10 minutes',
  retry: RETRY,
});

/** Persons one page of the two-missed-cycles pass looks at. */
export const CANDIDATE_PAGE = 100;

/** Candidate pages one run of a sweep takes before continuing as new, to keep its history short. */
const PAGES_PER_RUN = 20;

/** Clarifications one activity of the unanswered-clarification pass proposes, in one transaction. */
export const CLARIFICATION_CHUNK = 200;

/** How long the sending waits for the approval transaction that started it, in seconds. */
const COMMIT_WAIT_SECONDS = 60;

/**
 * The daily run of the referral sweep, started by the service's Temporal schedule: runs
 * `ReferralSweep` for each Commission with enforcement ladders, as a child workflow per Commission
 * and day.
 */
export async function referralSweeps(): Promise<{ swept: number }> {
  const plan = await referralSweepTenants();
  let swept = 0;
  for (const tenant of plan.tenants) {
    try {
      await executeChild(referralSweep, {
        workflowId: referralSweepWorkflowId(tenant, plan.runDate),
        args: [{ tenant }],
      });
      swept += 1;
    } catch (error) {
      // The day's sweep of this Commission already runs (a manual trigger, say): leave it.
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  return { swept };
}

/**
 * `ReferralSweep(tenant)` (spec 08, Regs r.20(2)): proposes `two-missed-cycles` for every person
 * whose obligation history (declarations) shows two consecutive biennial cycles overdue and
 * unfiled after the ladder window, and `unanswered-clarification` for every clarification whose
 * ladder has run past the stoppage window without a response; once per person, grounds and cycle.
 * Ids and counts only in history.
 */
export async function referralSweep(input: ReferralSweepInput): Promise<ReferralSweepCounts> {
  let twoMissedCycles = input.twoMissedCycles ?? 0;
  let after = input.after ?? null;
  for (let pages = 0; ; pages += 1) {
    if (pages >= PAGES_PER_RUN) {
      return continueAsNew<typeof referralSweep>({ tenant: input.tenant, after, twoMissedCycles });
    }
    const page = await missedCyclesCandidates({
      tenant: input.tenant,
      after,
      limit: CANDIDATE_PAGE,
    });
    for (const personId of page.personIds) {
      const outcome = await proposeMissedCycles({ tenant: input.tenant, personId });
      if (outcome === 'proposed') twoMissedCycles += 1;
    }
    after = page.next;
    if (after === null) break;
  }
  let unansweredClarifications = 0;
  for (;;) {
    const chunk = await proposeUnansweredClarifications({
      tenant: input.tenant,
      limit: CLARIFICATION_CHUNK,
    });
    unansweredClarifications += chunk.proposed;
    if (chunk.scanned < CLARIFICATION_CHUNK) break;
  }
  return { twoMissedCycles, unansweredClarifications };
}

/**
 * The sending of an approved referral (spec 08), started by the approval transaction: the
 * evidence is pulled and its manifest stored (hashes of every version, flag, clarification,
 * obligation and letter), the Confidential `referral-package` is issued by documents (which pulls
 * the package's content from the review service), and the referral is marked sent with
 * `referral.sent.v1` for EACC's intake (spec 09). The declarant is not told.
 */
export async function referralSending(input: ReferralSendingInput): Promise<ReferralSendingResult> {
  let items: number | null = null;
  for (let waited = 0; items === null; waited += 1) {
    const manifest = await buildManifest(input);
    if (manifest.outcome !== 'not-approved') {
      items = manifest.items;
    } else {
      if (waited >= COMMIT_WAIT_SECONDS) return { outcome: 'not-approved' };
      await sleep('1 second');
    }
  }
  await issuePackage(input);
  await markSent(input);
  return { outcome: 'sent', items };
}
