import { z } from 'zod';

import type {
  AiJob,
  AiJobReason,
  AiJobStatus,
  NarrateComplianceReportInput,
} from '../ai-gateway/ai-gateway-client.js';
import type { PatternCandidate } from './candidates.js';
import type { DraftedParagraph } from './narrative.js';
import type { NarrativeFigures } from './narrative-input.js';
import { type DraftScope, NARRATIVE_SECTIONS } from './schema.js';

/**
 * The NCR narrative draft (spec 09b S2) as the ai-gateway's `narrate-compliance-report` task
 * takes and gives it: the input is the year's figures and pattern candidates only (aggregates, no
 * person: data class `restricted`), the output paragraphs citing aggregate keys and candidates.
 */

/** The task's prompt version the reporting service asks for. */
export const NARRATE_PROMPT_VERSION = 1;

/** Aggregates only, but Commission-level figures before publication (spec 09b). */
export const NARRATE_DATA_CLASS = 'restricted';

/** The job's `subjectRef`: the report it drafts for. */
export function nationalReportSubjectRef(nationalReportId: string): string {
  return `national-report:${nationalReportId}`;
}

/** Sections whose draft narrates findings: the task needs at least one candidate for them. */
export function needsCandidates(scope: DraftScope): boolean {
  return scope === 'findings' || scope === 'all';
}

/** The task input: the figures as `narrativeFigures` built them, the candidates and the scope. */
export function narrateInput(
  figures: NarrativeFigures,
  candidates: readonly PatternCandidate[],
  section: DraftScope,
): NarrateComplianceReportInput {
  return {
    kind: 'narrate-compliance-report',
    fy: figures.fy,
    totals: figures.totals,
    rates: figures.rates,
    commissionTable: figures.commissionTable,
    priorYears: figures.priorYears,
    candidates: candidates.map((candidate) => ({ ...candidate })),
    section,
    language: 'en',
  };
}

/** ai-gateway.yaml `NarrateComplianceReportOutput`, the part the report keeps. */
const outputSchema = z.object({
  paragraphs: z.array(
    z.object({
      section: z.enum(NARRATIVE_SECTIONS),
      text: z.string(),
      aggregateRefs: z.array(z.string()),
      candidateIds: z.array(z.string()),
    }),
  ),
});

/** How a draft's job ended, as the report records it. */
export type DraftOutcome =
  | { status: 'drafting' }
  | { status: 'succeeded'; paragraphs: DraftedParagraph[] }
  | { status: 'failed'; reason: DraftFailureReason };

/**
 * Why a draft was discarded beyond the gateway's job reasons: the gateway refused the request, no
 * longer has the job, or answered an output outside its contract; the aggregates were rebuilt or
 * the report approved before the draft ended.
 */
export const DRAFT_FAILURES = {
  rejected: 'rejected',
  missing: 'missing',
  invalidOutput: 'invalid-output',
  aggregatesRebuilt: 'aggregates-rebuilt',
  approved: 'ncr-approved',
} as const;

/**
 * Why a draft failed, as recorded (`national_report_narrative_drafts.failure_reason`) and
 * answered: the gateway job's reason (ai-gateway.yaml `JobReason`), its ended status when it gave
 * none, or the service's own (`DRAFT_FAILURES`).
 */
export type DraftFailureReason =
  | AiJobReason
  | Exclude<AiJobStatus, 'queued' | 'running' | 'succeeded'>
  | (typeof DRAFT_FAILURES)[keyof typeof DRAFT_FAILURES];

/** The outcome of a job as the gateway answers it (null: it has no such job). */
export function outcomeOf(job: AiJob | null): DraftOutcome {
  if (job === null) return { status: 'failed', reason: DRAFT_FAILURES.missing };
  if (job.status === 'queued' || job.status === 'running') return { status: 'drafting' };
  if (job.status === 'failed' || job.status === 'blocked') {
    return { status: 'failed', reason: job.reason ?? job.status };
  }
  const output = outputSchema.safeParse(job.output);
  if (!output.success) return { status: 'failed', reason: DRAFT_FAILURES.invalidOutput };
  return { status: 'succeeded', paragraphs: output.data.paragraphs };
}
