import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, NCR } from '@adili/numbering';
import { EACC_TENANT } from '@adili/roles';
import { and, between, eq } from 'drizzle-orm';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

import { requireEacc, requireEaccSupervisor } from '../access.js';
import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  MAX_TASK_WAIT_SECONDS,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import { config } from '../config.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import { reportReceipts } from '../compliance-reports/schema.js';
import type { ReportingSchema } from '../db/schema.js';
import { activeCommissions } from '../compliance-reports/commission.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { referencePeriodOf } from '../financial-year.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { officerOf } from '../officer.js';
import {
  aiGatewayUnavailable,
  badGateway,
  conflict,
  forbidden,
  notFound,
  workflowUnavailable,
} from '../problems.js';
import { buildAggregates } from './aggregates.js';
import {
  type CandidateThresholds,
  historyYears,
  type PatternCandidate,
  patternCandidates,
} from './candidates.js';
import { eaccContext } from '../system-context.js';
import { NCR_ISSUER } from './contract.js';
import {
  NCR_APPROVED,
  NCR_DRAFTED,
  NCR_NARRATIVE_DRAFTED,
  type NcrApprovedData,
  type NcrDraftedData,
  type NcrNarrativeDraftedData,
} from './events.js';
import { insertDraft, type Narrative, type Paragraph, saveSection } from './narrative.js';
import {
  DRAFT_FAILURES,
  type DraftOutcome,
  NARRATE_DATA_CLASS,
  NARRATE_PROMPT_VERSION,
  narrateInput,
  nationalReportSubjectRef,
  needsCandidates,
  outcomeOf,
} from './narrative-draft.js';
import { type NarrativeFigures, narrativeFigures } from './narrative-input.js';
import { NationalReportWorkflows } from './national-report-workflows.js';
import {
  type NarrativeDraftRow,
  type NationalReportRow,
  type NationalReportView,
  nationalReportView,
  paragraphOf,
} from './representation.js';
import {
  type DraftScope,
  NARRATIVE_SECTIONS,
  nationalReportAggregates,
  nationalReportNarrativeDrafts,
  nationalReportParagraphs,
  nationalReports,
} from './schema.js';

/** The configured thresholds of the pattern candidates. */
export const CANDIDATE_THRESHOLDS: CandidateThresholds = {
  minPoints: config.CANDIDATE_MIN_POINTS,
  rateChangeFactor: config.CANDIDATE_RATE_CHANGE_FACTOR,
  maxNonFilerRate: config.CANDIDATE_MAX_NON_FILER_RATE,
  chronicLateYears: config.CANDIDATE_CHRONIC_LATE_YEARS,
  clarificationRatioFactor: config.CANDIDATE_CLARIFICATION_RATIO_FACTOR,
  sizeBands: config.CANDIDATE_SIZE_BANDS,
  sizeBandFactor: config.CANDIDATE_SIZE_BAND_FACTOR,
};

const NOT_BUILT = 'The national consolidated report for the year has not been built yet.';

const EACC_ONLY = 'Only EACC analysts and supervisors work on the national consolidated report.';

/** How long a draft request waits for the narrative before answering 202 to poll the report. */
export const DRAFT_WAIT_SECONDS = MAX_TASK_WAIT_SECONDS;

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
 * EACC's national consolidated report (spec 09 NCR), one per financial year. An EACC analyst (or
 * supervisor) builds it from the Commissions' submitted reports: the aggregates are recomputed at
 * every build while the narrative is kept; they type the narrative (Overview, Findings,
 * Recommendations), or have the ai-gateway draft it from the figures and pattern candidates
 * (spec 09b) as AI-draft paragraphs they edit. An EACC supervisor who neither built it nor wrote any of it approves it: the
 * `NCR` reference is allocated, `ncr.approved.v1` published, and the approval workflow issues the
 * Restricted PDF and ends the year's chase. Once approved the report no longer changes (409).
 * Everything runs in EACC's row-level security tenant.
 */
@Injectable()
export class NationalReportsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly directory: DirectoryClient,
    private readonly workflows: NationalReportWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly ai: AiGatewayClient,
  ) {}

  /**
   * The year's report (EACC roles; anyone else 403); 404 until first built. A narrative draft
   * still being written is looked up at the ai-gateway first and, once its job has ended, inserted
   * (or recorded as failed): reading the report is how a 202 draft is polled. While the gateway
   * cannot be reached the report is answered with the draft still `drafting`.
   */
  async get(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    const context = eaccContext(principal.subject);
    const draft = await withTenant(this.db, context, async (tx) => {
      const [report] = await tx.select().from(nationalReports).where(eq(nationalReports.fy, fy));
      if (!report) throw notFound(NOT_BUILT);
      return draftOf(tx, report.id);
    });
    if (draft?.status === 'drafting') {
      const job = await this.ai.getJob(EACC_TENANT, draft.jobId).catch((error: unknown) => {
        if (error instanceof AiGatewayUnavailable) return undefined;
        throw error;
      });
      const outcome = job === undefined ? null : outcomeOf(job);
      if (outcome && outcome.status !== 'drafting') {
        await withTenant(this.db, context, async (tx) => {
          const report = await lockedReport(tx, fy);
          const current = await draftOf(tx, report.id);
          // Settled meanwhile by another read or a retry, or replaced by a new draft.
          if (current?.jobId !== draft.jobId || current.status !== 'drafting') return;
          await this.settle(tx, report, current, outcome);
        });
      }
    }
    return withTenant(this.db, context, async (tx) => this.viewOf(tx, await reportOf(tx, fy)));
  }

  /**
   * Builds the year's report, or rebuilds its draft, from the Commissions' submitted reports as
   * they are now: the aggregates are replaced, the narrative kept. The first build makes the
   * caller the author; `ncr.drafted.v1` each time. 409 `no-submitted-reports` before any
   * Commission reported, `ncr-approved` once approved; 503 while the directory is unreachable.
   */
  async build(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    const commissions = await activeCommissions(this.directory);
    const now = this.clock.now();
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const receipts = await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy));
      if (receipts.length === 0) {
        throw conflict(
          'no-submitted-reports',
          'No Commission has submitted its report for the year yet.',
        );
      }
      await tx
        .insert(nationalReports)
        .values({
          id: uuidv7(),
          fy,
          status: 'draft',
          version: 0,
          authorSubject: principal.subject,
          authorName: officerOf(principal).name,
          contributors: [],
        })
        .onConflictDoNothing();
      const report = await lockedDraft(tx, fy);
      const aggregates = buildAggregates({ fy, commissions, receipts });
      const values = {
        fy,
        builtAt: now,
        reportsIncluded: receipts.length,
        reportIds: receipts.map((receipt) => receipt.reportId).sort(),
        aggregates,
      };
      await tx
        .insert(nationalReportAggregates)
        .values({ nationalReportId: report.id, ...values })
        .onConflictDoUpdate({ target: nationalReportAggregates.nationalReportId, set: values });
      const updated = await touch(tx, report, principal.subject);
      await this.events.record<NcrDraftedData>(tx, {
        type: NCR_DRAFTED,
        subject: updated.id,
        tenant: EACC_TENANT,
        data: {
          nationalReportId: updated.id,
          fy,
          version: updated.version,
          status: updated.status,
          reference: null,
          reportsIncluded: receipts.length,
        },
      });
      return this.viewOf(tx, updated);
    });
  }

  /**
   * The year's pattern candidates (spec 09b, EACC roles; anyone else 403), computed from its
   * aggregates as last built and the prior years'; 404 until first built.
   */
  async candidates(principal: Principal, fy: number): Promise<PatternCandidate[]> {
    requireEacc(principal, EACC_ONLY);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const { candidates } = await this.narrativeInputOf(tx, fy);
      return candidates;
    });
  }

  /**
   * Saves the narrative's sections (EACC roles). Paragraphs whose text is unchanged keep their id
   * and labels; an edited paragraph loses its AI-draft label. The caller becomes a contributor,
   * who cannot approve. 404 before the first build; 409 `ncr-approved` once approved.
   */
  async saveNarrative(
    principal: Principal,
    fy: number,
    narrative: Narrative,
  ): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const report = await lockedDraft(tx, fy);
      const stored = (
        await tx
          .select()
          .from(nationalReportParagraphs)
          .where(eq(nationalReportParagraphs.nationalReportId, report.id))
      ).map(paragraphOf);
      const saved = NARRATIVE_SECTIONS.flatMap((section) =>
        saveSection(section, stored, narrative[section], uuidv7),
      );
      await replaceParagraphs(tx, report.id, stored, saved, principal.subject);
      const updated = await touch(tx, report, principal.subject);
      return this.viewOf(tx, updated);
    });
  }

  /**
   * Drafts the narrative (spec 09b S2, S3; EACC roles, an `Idempotency-Key` at the controller):
   * the ai-gateway's `narrate-compliance-report` task gets the year's figures and pattern
   * candidates only, and the request waits up to `DRAFT_WAIT_SECONDS` for it. A draft ready by
   * then is inserted at once (`insertDraft`: AI-draft paragraphs citing their aggregate keys,
   * replacing only paragraphs still AI drafts unless `replaceAll`), the requester becomes a
   * contributor and `ncr.narrative-drafted.v1` is recorded; one not ready is answered `drafting`
   * (202) and inserted when the report is next read. A draft that failed inserts nothing: 409
   * `narrative-validation` when it cited a figure not in the input, `ai-not-enabled` when the
   * gateway's gate refuses EACC's data, 502 `narrative-draft-failed` otherwise. 404 before the
   * first build; 409 `ncr-approved` once approved, `no-pattern-candidates` for findings with no
   * candidate to narrate; 503 while the gateway cannot be reached. A retry with the same key
   * reads the same job: a draft is inserted once.
   */
  async draftNarrative(
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
      const { figures, candidates, builtAt: at } = await this.narrativeInputOf(tx, fy);
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
        { waitSeconds: DRAFT_WAIT_SECONDS },
      );
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) throw aiGatewayUnavailable();
      if (error instanceof InternalApiRejected) throw draftFailed(DRAFT_FAILURES.rejected);
      throw error;
    }

    const outcome = outcomeOf(job);
    const { view, draft } = await withTenant(this.db, context, async (tx) => {
      const locked = await lockedDraft(tx, fy);
      const existing = await draftOf(tx, locked.id);
      // A retry of a draft a read of the report has settled since: answered as it ended.
      if (existing?.jobId === job.id && existing.status !== 'drafting') {
        return { view: await this.viewOf(tx, locked), draft: existing };
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
      return { view: await this.viewOf(tx, settled.report), draft: settled.draft };
    });
    if (draft.status === 'failed') throw draftProblem(draft.failureReason);
    return { report: view, drafting: draft.status === 'drafting' };
  }

  /**
   * An EACC supervisor approves the year's report (an `Idempotency-Key` at the controller). The
   * author and anyone who built it or wrote its narrative cannot (403 `separation-of-duties`).
   * Allocates `NCR-EACC-<FY end>-<seq>-<check>`, records the approver, publishes `ncr.approved.v1`
   * and starts the approval workflow before the commit, so a Temporal outage approves nothing;
   * the workflow issues the PDF and ends the chase once the commit is visible. 404 before the
   * first build; 409 `ncr-approved` once approved.
   */
  async approve(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEaccSupervisor(principal, 'approve the national consolidated report');
    const now = this.clock.now();
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const report = await lockedDraft(tx, fy);
      if (
        report.authorSubject === principal.subject ||
        report.contributors.includes(principal.subject)
      ) {
        throw forbidden(
          'The author cannot approve: another EACC supervisor approves the report.',
          'separation-of-duties',
        );
      }
      const reference = await allocateReference(tx, NCR, {
        issuer: NCR_ISSUER,
        period: referencePeriodOf(fy),
      });
      const [approved] = await tx
        .update(nationalReports)
        .set({
          status: 'approved',
          version: report.version + 1,
          approverSubject: principal.subject,
          approverName: officerOf(principal).name,
          approvedAt: now,
          reference,
        })
        .where(eq(nationalReports.id, report.id))
        .returning();
      if (!approved) throw new Error(`National report ${report.id} vanished while approved`);
      const [aggregates] = await tx
        .select({ reportsIncluded: nationalReportAggregates.reportsIncluded })
        .from(nationalReportAggregates)
        .where(eq(nationalReportAggregates.nationalReportId, report.id));
      await this.events.record<NcrApprovedData>(tx, {
        type: NCR_APPROVED,
        subject: approved.id,
        tenant: EACC_TENANT,
        data: {
          nationalReportId: approved.id,
          fy,
          version: approved.version,
          status: approved.status,
          reference,
          reportsIncluded: aggregates?.reportsIncluded ?? 0,
        },
      });
      await this.startApproval(approved.id, fy);
      return this.viewOf(tx, approved);
    });
  }

  /**
   * The year's figures in the ai-gateway's shape, with the prior years the candidates look back
   * on, and its pattern candidates: what a narrative draft is written from, as at the build of
   * `builtAt`. 404 until built.
   */
  private async narrativeInputOf(
    tx: ReportingTransaction,
    fy: number,
  ): Promise<{ figures: NarrativeFigures; candidates: PatternCandidate[]; builtAt: Date }> {
    const rows = await tx
      .select({
        fy: nationalReportAggregates.fy,
        builtAt: nationalReportAggregates.builtAt,
        aggregates: nationalReportAggregates.aggregates,
      })
      .from(nationalReportAggregates)
      .where(between(nationalReportAggregates.fy, fy - historyYears(CANDIDATE_THRESHOLDS), fy));
    const current = rows.find((row) => row.fy === fy);
    if (!current) throw notFound(NOT_BUILT);
    const figures = narrativeFigures(
      current.aggregates,
      rows.filter((row) => row.fy !== fy).map((row) => row.aggregates),
    );
    return {
      figures,
      candidates: patternCandidates(figures, CANDIDATE_THRESHOLDS),
      builtAt: current.builtAt,
    };
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
    const failed = (reason: string) => finishDraft(tx, draft, 'failed', reason, this.clock.now());
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
    const stored = (
      await tx
        .select()
        .from(nationalReportParagraphs)
        .where(eq(nationalReportParagraphs.nationalReportId, report.id))
    ).map(paragraphOf);
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

  private async viewOf(
    tx: ReportingTransaction,
    report: NationalReportRow,
  ): Promise<NationalReportView> {
    const [aggregates] = await tx
      .select()
      .from(nationalReportAggregates)
      .where(eq(nationalReportAggregates.nationalReportId, report.id));
    const paragraphs = await tx
      .select()
      .from(nationalReportParagraphs)
      .where(eq(nationalReportParagraphs.nationalReportId, report.id));
    const draft = await draftOf(tx, report.id);
    return nationalReportView(report, aggregates, paragraphs.map(paragraphOf), draft);
  }

  /** Starts the approval workflow; 503 while Temporal is unreachable (nothing is approved). */
  private async startApproval(nationalReportId: string, fy: number): Promise<void> {
    try {
      await this.workflows.approved({ nationalReportId, fy });
    } catch {
      throw workflowUnavailable('The report could not be approved just now. Try again shortly.');
    }
  }
}

/** The year's report; 404 for none. */
async function reportOf(tx: ReportingTransaction, fy: number): Promise<NationalReportRow> {
  const [report] = await tx.select().from(nationalReports).where(eq(nationalReports.fy, fy));
  if (!report) throw notFound(NOT_BUILT);
  return report;
}

/** The year's report locked against concurrent changes; 404 for none. */
async function lockedReport(tx: ReportingTransaction, fy: number): Promise<NationalReportRow> {
  const [report] = await tx
    .select()
    .from(nationalReports)
    .where(eq(nationalReports.fy, fy))
    .for('update');
  if (!report) throw notFound(NOT_BUILT);
  return report;
}

/** The year's report locked for a change: 404 for none, 409 `ncr-approved` once approved. */
async function lockedDraft(tx: ReportingTransaction, fy: number): Promise<NationalReportRow> {
  const report = await lockedReport(tx, fy);
  if (report.status === 'approved') throw approvedConflict();
  return report;
}

function approvedConflict() {
  return conflict('ncr-approved', 'The report is approved and can no longer change.');
}

/** The report's latest narrative draft, if any. */
async function draftOf(
  tx: ReportingTransaction,
  nationalReportId: string,
): Promise<NarrativeDraftRow | undefined> {
  const [draft] = await tx
    .select()
    .from(nationalReportNarrativeDrafts)
    .where(eq(nationalReportNarrativeDrafts.nationalReportId, nationalReportId));
  return draft;
}

/** Records that the draft ended: inserted, or failed for `reason`. */
async function finishDraft(
  tx: ReportingTransaction,
  draft: NarrativeDraftRow,
  status: 'inserted' | 'failed',
  reason: string | null,
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
function draftProblem(reason: string | null) {
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

function draftFailed(reason: string) {
  return badGateway(
    'narrative-draft-failed',
    'The narrative could not be drafted just now. Nothing was inserted; try again.',
    { reason },
  );
}

/** The next version of the report, with `subject` among its contributors. */
async function touch(
  tx: ReportingTransaction,
  report: NationalReportRow,
  subject: string,
): Promise<NationalReportRow> {
  const contributors = report.contributors.includes(subject)
    ? report.contributors
    : [...report.contributors, subject];
  const [updated] = await tx
    .update(nationalReports)
    .set({ version: report.version + 1, contributors })
    .where(eq(nationalReports.id, report.id))
    .returning();
  if (!updated) throw new Error(`National report ${report.id} vanished while it was saved`);
  return updated;
}

/**
 * Stores the narrative's paragraphs as `saved`: unchanged paragraphs are left alone (their editor
 * and time kept), changed and new ones written by `subject`, and those no longer there removed.
 */
async function replaceParagraphs(
  tx: ReportingTransaction,
  nationalReportId: string,
  stored: readonly Paragraph[],
  saved: readonly Paragraph[],
  subject: string,
): Promise<void> {
  const before = new Map(stored.map((paragraph) => [paragraph.id, paragraph]));
  const kept = new Set(saved.map((paragraph) => paragraph.id));
  for (const paragraph of stored) {
    if (kept.has(paragraph.id)) continue;
    await tx.delete(nationalReportParagraphs).where(eq(nationalReportParagraphs.id, paragraph.id));
  }
  for (const paragraph of saved) {
    const previous = before.get(paragraph.id);
    if (previous && sameParagraph(previous, paragraph)) continue;
    const values = {
      section: paragraph.section,
      position: paragraph.position,
      text: paragraph.text,
      aiDraft: paragraph.aiDraft,
      aggregateRefs: paragraph.aggregateRefs,
      candidateIds: paragraph.candidateIds,
    };
    // A paragraph only moved keeps its editor; a new or edited one is the caller's.
    const updatedBy = previous?.text === paragraph.text ? undefined : subject;
    await tx
      .insert(nationalReportParagraphs)
      .values({ id: paragraph.id, nationalReportId, ...values, updatedBy: updatedBy ?? subject })
      .onConflictDoUpdate({
        target: nationalReportParagraphs.id,
        set: updatedBy === undefined ? values : { ...values, updatedBy },
      });
  }
}

function sameParagraph(a: Paragraph, b: Paragraph): boolean {
  return a.section === b.section && a.position === b.position && a.text === b.text;
}
