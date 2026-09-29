/**
 * Workflows hosted by the reporting worker (ADR-003). This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

import type { ComplianceReportActivities } from './activities.js';
import {
  RECOMPILE_SIGNAL,
  type ReportWorkflowInput,
  type ReportWorkflowResult,
  SUBMITTED_SIGNAL,
} from './contract.js';

/**
 * Reads of the projections and pulls from declarations, review and the directory: retried with
 * backoff until they succeed, so an outage delays a draft, never loses it. The first retry comes
 * after a second, each later one twice as late, at most five minutes apart.
 */
const { aggregate, compileDraft, notifyDraftReady } = proxyActivities<ComplianceReportActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

export const recompile = defineSignal(RECOMPILE_SIGNAL);
export const submitted = defineSignal(SUBMITTED_SIGNAL);

/**
 * `ComplianceReportWorkflow(tenant, fy)` (spec 09): compiles the Commission's Form M draft for the
 * financial year from the projections, then waits. A `recompile` signal compiles it again (edited
 * remarks and manual fields are kept by `compileDraft`); a recompile asked for while one runs is
 * compiled once more after it. `submitted` ends the workflow. The supervisor and the
 * commission-admin are told when the first draft is ready.
 *
 * Started, or signalled when already running, by the compile endpoint (`signalWithStart`).
 */
export async function complianceReport(input: ReportWorkflowInput): Promise<ReportWorkflowResult> {
  let pending = true;
  let done = false;
  let compiles = 0;
  setHandler(recompile, () => {
    pending = true;
  });
  setHandler(submitted, () => {
    done = true;
  });
  // Read through a function: the handlers change these while the workflow awaits.
  const ended = () => done;

  for (;;) {
    await condition(() => pending || done);
    if (ended()) break;
    pending = false;
    const facts = await aggregate(input);
    const draft = await compileDraft({ ...input, aggregate: facts });
    compiles += 1;
    if (draft.outcome === 'submitted') break;
    if (draft.first) await notifyDraftReady({ ...input, reportId: draft.reportId });
  }
  return { compiles };
}
