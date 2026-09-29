/**
 * Workflows hosted by the reporting worker (ADR-003). This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';

import type { NationalReportActivities } from '../national-reports/activities.js';
import type {
  NationalReportApprovalInput,
  NationalReportApprovalResult,
} from '../national-reports/contract.js';
import type { AnnualCompileActivities } from './annual-compile-activities.js';
import type { ComplianceReportActivities } from './activities.js';
import {
  CHASE_INTERVAL_MS,
  chaseRoundAt,
  type ChaseWorkflowInput,
  type ChaseWorkflowResult,
  firstChaseAt,
  NCR_APPROVED_SIGNAL,
  RECOMPILE_SIGNAL,
  REMINDER_DAYS,
  reminderAt,
  type ReportWorkflowInput,
  type ReportWorkflowResult,
  SUBMITTED_SIGNAL,
} from './contract.js';
import type { NationalChaseActivities } from './national-chase-activities.js';

/**
 * Reads of the projections and pulls from declarations, review, the directory, documents and
 * notifications: retried with backoff until they succeed, so an outage delays a draft, a reminder
 * or a receipt, never loses it. The first retry comes after a second, each later one twice as
 * late, at most five minutes apart.
 */
const {
  aggregate,
  compileDraft,
  notifyDraftReady,
  remind,
  issueSubmissionDocuments,
  notifySubmitted,
} = proxyActivities<ComplianceReportActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

const { annualCompileTargets, startCompile } = proxyActivities<AnnualCompileActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

const { chaseTargets, chaseCommission, startNationalChase } =
  proxyActivities<NationalChaseActivities>({
    startToCloseTimeout: '1 minute',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  });

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

export const recompile = defineSignal(RECOMPILE_SIGNAL);
export const submitted = defineSignal(SUBMITTED_SIGNAL);

/**
 * `ComplianceReportWorkflow(tenant, fy)` (spec 09): compiles the Commission's Form M draft for the
 * financial year from the projections, then waits. A `recompile` signal compiles it again (edited
 * remarks and manual fields are kept by `compileDraft`); a recompile asked for while one runs is
 * compiled once more after it. The supervisor and the commission-admin are told when the first
 * draft is ready, and reminded 14, 7 and 1 days before 31 July while the report is not submitted
 * (reminders already past when the workflow starts are not sent). `submitted` ends the waiting:
 * the Form M PDF and the receipt are issued, both officers are told, and the workflow ends.
 *
 * Started, or signalled when already running, by the compile and confirm endpoints and the
 * yearly compile (`signalWithStart`).
 */
export async function complianceReport(input: ReportWorkflowInput): Promise<ReportWorkflowResult> {
  let pending = true;
  let done = false;
  let compiles = 0;
  let reminders = 0;
  setHandler(recompile, () => {
    pending = true;
  });
  setHandler(submitted, () => {
    done = true;
  });
  // Read through functions: the handlers change these while the workflow awaits.
  const ended = () => done;
  const asked = () => pending;
  const dueAt = REMINDER_DAYS.map((days) => reminderAt(input.fy, days));
  let next = dueAt.findIndex((at) => at > Date.now());
  if (next < 0) next = dueAt.length;

  for (;;) {
    const due = dueAt[next];
    if (due === undefined) {
      await condition(() => pending || done);
    } else if (due > Date.now()) {
      await condition(() => pending || done, due - Date.now());
    }
    if (ended()) break;
    if (due !== undefined && Date.now() >= due) {
      const daysBefore = REMINDER_DAYS[next] ?? 0;
      next += 1;
      const reminded = await remind({ ...input, daysBefore });
      if (reminded.outcome === 'submitted') break;
      reminders += 1;
      continue;
    }
    if (!asked()) continue;
    pending = false;
    const facts = await aggregate(input);
    const draft = await compileDraft({ ...input, aggregate: facts });
    compiles += 1;
    if (draft.outcome === 'submitted') break;
    if (draft.first) await notifyDraftReady({ ...input, reportId: draft.reportId });
  }

  const documents = await issueSubmissionDocuments(input);
  await notifySubmitted({ ...input, reportId: documents.reportId });
  return { compiles, reminders };
}

/**
 * The yearly compile (spec 09), started by the service's Temporal schedule on 1 July: starts, or
 * asks to recompile, `ComplianceReportWorkflow` of each Commission for the financial year that
 * just ended. A Commission whose report is submitted already is left alone.
 */
export async function annualCompile(): Promise<{ fy: number; started: number }> {
  const plan = await annualCompileTargets();
  let started = 0;
  for (const tenant of plan.tenants) {
    if (await startCompile({ tenant, fy: plan.fy })) started += 1;
  }
  return { fy: plan.fy, started };
}

export const ncrApproved = defineSignal(NCR_APPROVED_SIGNAL);

/**
 * `NationalConsolidationWorkflow(fy)` (spec 09): from 1 August, EACC chases every Commission that
 * has not submitted the year's report, weekly: its reporting officers and commission-admins are
 * emailed and `compliance-report.chased.v1` recorded. A Commission that submits drops out of the
 * next round. The chase ends once every Commission has reported, or when the national
 * consolidated report is approved (`ncr-approved`). Started late, it chases at once and weekly
 * from then. History holds the year, rounds, Commission slugs and counts only.
 */
export async function nationalConsolidation(
  input: ChaseWorkflowInput,
): Promise<ChaseWorkflowResult> {
  let approved = false;
  setHandler(ncrApproved, () => {
    approved = true;
  });
  // Read through a function: the handler changes it while the workflow awaits.
  const ended = () => approved;
  let rounds = input.rounds ?? 0;
  let chases = input.chases ?? 0;
  let at = input.nextAt ?? firstChaseAt(input.fy);
  for (;;) {
    if (at > Date.now()) await condition(ended, at - Date.now());
    if (ended()) return { rounds, chases, ended: 'ncr-approved' };
    const now = Date.now();
    const round = chaseRoundAt(input.fy, now);
    const { tenants, ncrApproved: approvedAlready = false } = await chaseTargets({ fy: input.fy });
    if (approvedAlready) return { rounds, chases, ended: 'ncr-approved' };
    if (tenants.length === 0) return { rounds, chases, ended: 'all-reported' };
    for (const tenant of tenants) {
      const chased = await chaseCommission({ fy: input.fy, tenant, round });
      if (chased.outcome === 'chased') chases += 1;
    }
    rounds += 1;
    at = Math.max(at, now) + CHASE_INTERVAL_MS;
    // A long chase of many Commissions: carry on in a fresh history.
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof nationalConsolidation>({
        fy: input.fy,
        rounds,
        chases,
        nextAt: at,
      });
    }
  }
}

/**
 * The yearly start of the chase, run by the service's Temporal schedule on 1 August: starts
 * `NationalConsolidationWorkflow` for the financial year whose reports were due on 31 July, unless
 * it runs already.
 */
export async function nationalChaseStart(): Promise<{ fy: number; started: boolean }> {
  return startNationalChase();
}

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
