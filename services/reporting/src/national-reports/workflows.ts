/**
 * The national consolidated report's workflow (ADR-003), hosted by the reporting worker (`../workflows.ts`).
 * Bundled into Temporal's deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { proxyActivities } from '@temporalio/workflow';

import type { NationalReportActivities } from './activities.js';
import type { NationalReportApprovalInput, NationalReportApprovalResult } from './contract.js';

/**
 * The NCR PDF: rendering and signing takes seconds; retried with backoff while documents is
 * unreachable. Ending the chase is one signal.
 */
const { issueNationalReportDocument, endNationalChase } = proxyActivities<NationalReportActivities>(
  {
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  },
);

/**
 * `NationalReportApprovalWorkflow` (spec 09 NCR): once an EACC supervisor approved the year's
 * national consolidated report, issues its Restricted PDF through documents (kept on the report)
 * and tells the year's chase to end (`ncr-approved`). Started by the approval, before its commit.
 * History holds the report id, the year and the document id only.
 */
export async function nationalReportApproval(
  input: NationalReportApprovalInput,
): Promise<NationalReportApprovalResult> {
  const { documentId } = await issueNationalReportDocument(input);
  const chaseEnded = await endNationalChase(input);
  return { documentId, chaseEnded };
}
