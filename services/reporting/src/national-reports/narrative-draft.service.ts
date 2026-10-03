import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { EACC_TENANT } from '@adili/roles';
import { and, eq } from 'drizzle-orm';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

import { requireEacc } from '../access.js';
import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  MAX_TASK_WAIT_SECONDS,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import type { ReportingSchema } from '../db/schema.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { aiGatewayUnavailable, badGateway, conflict } from '../problems.js';
import { eaccContext } from '../system-context.js';
import { NCR_NARRATIVE_DRAFTED, type NcrNarrativeDraftedData } from './events.js';
import { insertDraft } from './narrative.js';
import {
  DRAFT_FAILURES,
  type DraftFailureReason,
  type DraftOutcome,
  NARRATE_DATA_CLASS,
  NARRATE_PROMPT_VERSION,
  narrateInput,
  nationalReportSubjectRef,
  needsCandidates,
  outcomeOf,
} from './narrative-draft.js';
import {
  approvedConflict,
  draftOf,
  lockedReport,
  lockedUnapprovedReport,
  narrativeInputOf,
  paragraphsOf,
  replaceParagraphs,
  reportOf,
  reportView,
  touch,
} from './national-report-store.js';
import type { NarrativeDraftRow, NationalReportRow, NationalReportView } from './representation.js';
import {
  type DraftScope,
  nationalReportAggregates,
  nationalReportNarrativeDrafts,
} from './schema.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on the national consolidated report.';

/** Names a draft's ai-gateway job (UUID v5, RFC 9562): one per report, request and build. */
const DRAFT_NAMESPACE = '6b1d3f0a-52c4-4e8f-9d27-0a8c6e4b7f13';

/** reporting.yaml `draftNationalReportNarrative` body. */
export interface DraftRequest {
  section: DraftScope;
  replaceAll: boolean;
}

/** A draft request's answer: the report, and whether the draft is still being written (202). */
export interface DraftAnswer {
  report: NationalReportView;
  drafting: boolean;
}

/**
 * The national consolidated report's AI narrative draft (spec 09b S2, S3): the ai-gateway's
 * `narrate-compliance-report` task writes it from the year's figures and pattern candidates, and
 * it is inserted into the narrative as AI-draft paragraphs once its job ends, whether the request
 * waited for it or a later read of the report finds it ended. EACC roles; everything runs in
 * EACC's row-level security tenant.
 */
@Injectable()
export class NarrativeDraftService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly ai: AiGatewayClient,
  ) {}

  /**
   * Drafts the narrative (an `Idempotency-Key` at the controller): the ai-gateway's
   * `narrate-compliance-report` task gets the year's figures and pattern candidates only, and the
   * request waits up to `MAX_TASK_WAIT_SECONDS` for it. A draft ready by then is inserted at once
   * (`insertDraft`: AI-draft paragraphs citing their aggregate keys, replacing only paragraphs
   * still AI drafts unless `replaceAll`), the requester becomes a contributor and
   * `ncr.narrative-drafted.v1` is recorded; one not ready is answered `drafting` (202) and
   * inserted when the report is next read (`settlePending`). A draft that failed inserts nothing:
   * 409 `narrative-validation` when it cited a figure not in the input, `ai-not-enabled` when the
   * gateway's gate refuses EACC's data, 502 `narrative-draft-failed` otherwise. 404 before the
   * first build; 409 `ncr-approved` once approved, `no-pattern-candidates` for findings with no
   * candidate to narrate; 503 while the gateway cannot be reached. A retry with the same key
   * reads the same job: a draft is inserted once.
   */
  async draft(
    principal: Principal,
    fy: number,
    request: DraftRequest,
    idempotencyKey: string,
  ): Promise<DraftAnswer> {
    requireEacc(principal, EACC_ONLY);
    const context = eaccContext(principal.subject);
    const { report, builtAt, input } = await withTenant(this.db, context, async (tx) => {
      const found = await reportOf(tx, fy);
      if (found.status === 'approved') throw approvedConflict();
      const { figures, candidates, builtAt: at } = await narrativeInputOf(tx, fy);
      if (needsCandidates(request.section) && candidates.length === 0) {
        throw conflict(
          'no-pattern-candidates',
          'The year has no notable patterns for findings to narrate. Draft the overview or the recommendations instead.',
        );
      }
      return {
        report: found,
        builtAt: at,
        input: narrateInput(figures, candidates, request.section),
      };
    });

    const jobKey = uuidv5(
      [
        report.id,
        idempotencyKey,
        request.section,
        String(request.replaceAll),
        builtAt.toISOString(),
      ].join('|'),
      DRAFT_NAMESPACE,
    );
    let job: AiJob;
    try {
      job = await this.ai.runTask(
        'narrate-compliance-report',
        {
          tenant: EACC_TENANT,
          dataClass: NARRATE_DATA_CLASS,
          subjectRef: nationalReportSubjectRef(report.id),
          promptVersion: NARRATE_PROMPT_VERSION,
          input,
        },
        jobKey,
        { waitSeconds: MAX_TASK_WAIT_SECONDS },
      );
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) throw aiGatewayUnavailable();
      if (error instanceof InternalApiRejected) throw draftFailed(DRAFT_FAILURES.rejected);
      throw error;
    }

    const outcome = outcomeOf(job);
    const { view, draft } = await withTenant(this.db, context, async (tx) => {
      const locked = await lockedUnapprovedReport(tx, fy);
      const existing = await draftOf(tx, locked.id);
      // A retry of a draft a read of the report has settled since: answered as it ended.
      if (existing?.jobId === job.id && existing.status !== 'drafting') {
        return { view: await reportView(tx, locked), draft: existing };
      }
      const values = {
        jobId: job.id,
        section: request.section,
        replaceAll: request.replaceAll,
        status: 'drafting' as const,
        failureReason: null,
        aggregatesBuiltAt: builtAt,
        requestedBy: principal.subject,
        requestedAt: this.clock.now(),
        finishedAt: null,
      };
      const [stored] = await tx
        .insert(nationalReportNarrativeDrafts)
        .values({ nationalReportId: locked.id, ...values })
        .onConflictDoUpdate({ target: nationalReportNarrativeDrafts.nationalReportId, set: values })
        .returning();
      if (!stored) throw new Error(`Narrative draft of ${locked.id} not stored`);
      const settled = await this.settle(tx, locked, stored, outcome);
      return { view: await reportView(tx, settled.report), draft: settled.draft };
    });
    if (draft.status === 'failed') throw draftProblem(draft.failureReason);
    return { report: view, drafting: draft.status === 'drafting' };
  }

  /**
   * Polls the year's narrative draft still being written, if any: its job is looked up at the
   * ai-gateway and, once ended, the draft inserted (or recorded as failed). Reading the report is
   * how a 202 draft is polled. While the gateway cannot be reached the draft stays `drafting`.
   * 404 before the first build.
   */
  async settlePending(principal: Principal, fy: number): Promise<void> {
    requireEacc(principal, EACC_ONLY);
    const context = eaccContext(principal.subject);
    const draft = await withTenant(this.db, context, async (tx) =>
      draftOf(tx, (await reportOf(tx, fy)).id),
    );
    if (draft?.status !== 'drafting') return;
    const job = await this.ai.getJob(EACC_TENANT, draft.jobId).catch((error: unknown) => {
      if (error instanceof AiGatewayUnavailable) return undefined;
      throw error;
    });
    const outcome = job === undefined ? null : outcomeOf(job);
    if (!outcome || outcome.status === 'drafting') return;
    await withTenant(this.db, context, async (tx) => {
      const report = await lockedReport(tx, fy);
      const current = await draftOf(tx, report.id);
      // Settled meanwhile by another read or a retry, or replaced by a new draft.
      if (current?.jobId !== draft.jobId || current.status !== 'drafting') return;
      await this.settle(tx, report, current, outcome);
    });
  }

  /**
   * Records how `draft`'s job ended, in the transaction holding the report's lock: a draft still
   * being written is left as it is; a failed one is recorded with its reason; a succeeded one is
   * inserted into the narrative as its requester's, unless the aggregates were rebuilt or the
   * report approved since it was asked for (then it is discarded).
   */
  private async settle(
    tx: ReportingTransaction,
    report: NationalReportRow,
    draft: NarrativeDraftRow,
    outcome: DraftOutcome,
  ): Promise<{ report: NationalReportRow; draft: NarrativeDraftRow }> {
    if (outcome.status === 'drafting') return { report, draft };
    const failed = (reason: DraftFailureReason) =>
      finishDraft(tx, draft, 'failed', reason, this.clock.now());
    if (outcome.status === 'failed') return { report, draft: await failed(outcome.reason) };
    if (report.status === 'approved') {
      return { report, draft: await failed(DRAFT_FAILURES.approved) };
    }
    const [aggregates] = await tx
      .select({ builtAt: nationalReportAggregates.builtAt })
      .from(nationalReportAggregates)
      .where(eq(nationalReportAggregates.nationalReportId, report.id));
    if (aggregates?.builtAt.getTime() !== draft.aggregatesBuiltAt.getTime()) {
      return { report, draft: await failed(DRAFT_FAILURES.aggregatesRebuilt) };
    }
    const stored = await paragraphsOf(tx, report.id);
    const saved = insertDraft(stored, outcome.paragraphs, draft.section, draft.replaceAll, uuidv7);
    await replaceParagraphs(tx, report.id, stored, saved, draft.requestedBy);
    const updated = await touch(tx, report, draft.requestedBy);
    const inserted = await finishDraft(tx, draft, 'inserted', null, this.clock.now());
    await this.events.record<NcrNarrativeDraftedData>(tx, {
      type: NCR_NARRATIVE_DRAFTED,
      subject: updated.id,
      tenant: EACC_TENANT,
      data: {
        nationalReportId: updated.id,
        fy: updated.fy,
        section: draft.section,
        jobId: draft.jobId,
      },
    });
    return { report: updated, draft: inserted };
  }
}

/** Records that the draft ended: inserted, or failed for `reason`. */
async function finishDraft(
  tx: ReportingTransaction,
  draft: NarrativeDraftRow,
  status: 'inserted' | 'failed',
  reason: DraftFailureReason | null,
  now: Date,
): Promise<NarrativeDraftRow> {
  const [finished] = await tx
    .update(nationalReportNarrativeDrafts)
    .set({ status, failureReason: reason, finishedAt: now })
    .where(
      and(
        eq(nationalReportNarrativeDrafts.nationalReportId, draft.nationalReportId),
        eq(nationalReportNarrativeDrafts.jobId, draft.jobId),
      ),
    )
    .returning();
  if (!finished) throw new Error(`Narrative draft ${draft.jobId} vanished while it was settled`);
  return finished;
}

/** The problem a failed draft answers, by why it failed; nothing was inserted. */
function draftProblem(reason: DraftFailureReason | null) {
  switch (reason) {
    case 'validation':
      return conflict(
        'narrative-validation',
        'The draft cited a figure that is not in the report and was discarded. Nothing was inserted.',
      );
    case 'policy':
      return conflict('ai-not-enabled', 'AI assistance is not enabled for EACC.');
    case DRAFT_FAILURES.aggregatesRebuilt:
      return conflict(
        'aggregates-rebuilt',
        'The report was rebuilt while the draft was written, so the draft was discarded. Draft again.',
      );
    case DRAFT_FAILURES.approved:
      return approvedConflict();
    default:
      return draftFailed(reason ?? 'unknown');
  }
}

function draftFailed(reason: DraftFailureReason | 'unknown') {
  return badGateway(
    'narrative-draft-failed',
    'The narrative could not be drafted just now. Nothing was inserted; try again.',
    { reason },
  );
}
