/**
 * `OnboardedNoticeWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types (and constants modules that
 * import nothing else).
 */
import { proxyActivities } from '@temporalio/workflow';

import { ACTIVITY_RETRY } from '../activity-retry.js';
import type { OnboardedNoticeActivities } from './activities.js';
import type { OnboardedNoticeResult, OnboardedNoticeWorkflowInput } from './contract.js';

const { onlineNoticeAfterWrittenNotice } = proxyActivities<OnboardedNoticeActivities>({
  // A read and a few messages.
  startToCloseTimeout: '1 minute',
  retry: ACTIVITY_RETRY,
});

/**
 * `OnboardedNoticeWorkflow(requestId)` (spec 10 decision 2): started when a request served on its
 * declarant in writing is linked to the account they onboarded with, inside the linking
 * transaction. Tells them online what the written notice told them, while it still matters: one
 * step, retried through outages; the messages carry the request's own keys, so nothing is sent
 * twice.
 */
export async function onboardedNotice(
  input: OnboardedNoticeWorkflowInput,
): Promise<OnboardedNoticeResult> {
  return { outcome: await onlineNoticeAfterWrittenNotice(input) };
}
