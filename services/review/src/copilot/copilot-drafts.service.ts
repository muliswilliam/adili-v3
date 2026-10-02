import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  isFinished,
  MAX_TASK_WAIT_SECONDS,
} from '../ai-gateway/ai-gateway-client.js';
import { caseTenant } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import { reviewFlags } from '../cases/schema.js';
import { requireAssignee } from '../clarifications/access.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
} from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { declarationsUnavailable, withUpstream } from '../internal-api/upstream.js';
import { COPILOT_FAILURES, copilotOf, dataClassOf } from './copilot-requests.js';
import {
  COPILOT_DRAFT_TTL_HOURS,
  type CopilotDraftRow,
  type CopilotDraftStatus,
  reviewCopilotDrafts,
} from './draft-schema.js';
import {
  type CopilotDraftInput,
  type DraftItem,
  draftClarificationInput,
  draftOfOutput,
  InvalidDraftSelection,
} from './draft-input.js';
import { caseSubjectRef } from './events.js';
import { aiGatewayUnavailable as gatewayUnavailable, aiNotEnabled } from './problems.js';

/** review.yaml `CopilotDraft`. */
export interface CopilotDraft {
  id: string;
  status: CopilotDraftStatus;
  jobId: string | null;
  /** ai-gateway `AiLabel`; null until ready. */
  label: Record<string, unknown> | null;
  opening: string | null;
  items: DraftItem[];
  failureReason: string | null;
}

/** How long the reviewer's request waits for the draft before answering a pending one to poll. */
export const DRAFT_WAIT_SECONDS = MAX_TASK_WAIT_SECONDS;

/** Names the drafts (UUID v5, RFC 9562): one per assignee, case and Idempotency-Key. */
const DRAFT_NAMESPACE = '3f0c2b8e-71d4-4a52-9a1e-6c0f5d2e8b47';

/**
 * Clarification drafts by the ai-gateway's `draft-clarification` task (spec 07c S12): the case's
 * assignee selects flags and items, the service builds the task input from the case's version
 * and asks the gateway, waiting up to `DRAFT_WAIT_SECONDS`; a draft not ready by then is polled.
 * A draft is a suggestion for the composer only: nothing here creates or changes a
 * clarification, and it can be polled for `COPILOT_DRAFT_TTL_HOURS`.
 */
@Injectable()
export class CopilotDraftsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly gateway: AiGatewayClient,
  ) {}

  /**
   * Drafts the items of a clarification from the assignee's selection: `ready` (or `failed`)
   * when the job ended within the wait, `pending` otherwise. Only the assignee (403); 409 when AI
   * is not enabled for the Commission; 400 for a selection not on the case. The declaration is
   * read for the caller. A retry with the same Idempotency-Key gets the same draft.
   */
  async draft(
    principal: Principal,
    caseId: string,
    selection: CopilotDraftInput,
    idempotencyKey: string,
  ): Promise<CopilotDraft> {
    const tenant = caseTenant(principal);
    const { row, flags, copilot } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const found = await findCase(tx, tenant, caseId);
        return {
          row: found,
          flags: await tx
            .select()
            .from(reviewFlags)
            .where(eq(reviewFlags.caseId, found.id))
            .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id)),
          copilot: await copilotOf(tx, found.id),
        };
      },
    );
    requireAssignee(principal, row.assignee);
    if (copilot?.status === 'not-enabled') throw aiNotEnabled();

    const document = await this.document(principal, tenant, row);
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    let input;
    try {
      input = draftClarificationInput({
        document,
        flags,
        selection,
        commissionName: commission.name,
      });
    } catch (error) {
      if (!(error instanceof InvalidDraftSelection)) throw error;
      throw new ProblemException(
        {
          type: 'selection-not-on-case',
          title: 'Selection not on the case',
          status: HttpStatus.BAD_REQUEST,
          detail: error.message,
        },
        { code: 'selection-not-on-case' },
      );
    }

    const id = uuidv5([row.id, principal.subject, idempotencyKey].join('|'), DRAFT_NAMESPACE);
    let job: AiJob | null;
    try {
      job = await this.gateway.runTask(
        'draft-clarification',
        { tenant, dataClass: dataClassOf(tenant), subjectRef: caseSubjectRef(row.id), input },
        id,
        { waitSeconds: DRAFT_WAIT_SECONDS },
      );
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) throw gatewayUnavailable();
      if (!(error instanceof InternalApiRejected)) throw error;
      job = null;
    }
    if (job?.status === 'blocked' && job.reason === 'policy') throw aiNotEnabled();

    const outcome: Outcome = job
      ? outcomeOf(job)
      : { status: 'failed', reason: COPILOT_FAILURES.rejected };
    const [stored] = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        await tx
          .insert(reviewCopilotDrafts)
          .values({
            id,
            tenant,
            caseId: row.id,
            requestedBy: principal.subject,
            jobId: job?.id ?? null,
            status: outcome.status,
            failureReason: outcome.reason,
            expiresAt: sql`now() + make_interval(hours => ${COPILOT_DRAFT_TTL_HOURS})`,
          })
          .onConflictDoNothing();
        return tx.select().from(reviewCopilotDrafts).where(eq(reviewCopilotDrafts.id, id));
      },
    );
    if (!stored) throw new Error(`Draft ${id} not stored`);
    return this.viewOf(stored, job);
  }

  /**
   * A draft as it is now, for the assignee who asked; anyone else, and a draft past its day,
   * 404. A pending draft is read from the gateway, and recorded once its job has ended.
   */
  async get(principal: Principal, draftId: string): Promise<CopilotDraft> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const row = await withTenant(this.db, context, async (tx) => {
      const [found] = await tx
        .select()
        .from(reviewCopilotDrafts)
        .where(
          and(eq(reviewCopilotDrafts.id, draftId), gt(reviewCopilotDrafts.expiresAt, sql`now()`)),
        );
      return found;
    });
    const draft = notFoundIfInvisible(row?.requestedBy === principal.subject ? row : null);
    if (draft.status === 'failed' || draft.jobId === null) return this.viewOf(draft, null);

    const job = await this.gateway.getJob(draft.jobId).catch((error: unknown) => {
      throw error instanceof AiGatewayUnavailable ? gatewayUnavailable() : error;
    });
    if (draft.status === 'pending' && (job === null || isFinished(job))) {
      // A job the gateway no longer has: its outcome cannot be known.
      const outcome: Outcome = job ? outcomeOf(job) : { status: 'failed', reason: 'missing' };
      const [updated] = await withTenant(this.db, context, (tx) =>
        tx
          .update(reviewCopilotDrafts)
          .set({ status: outcome.status, failureReason: outcome.reason })
          .where(
            and(eq(reviewCopilotDrafts.id, draft.id), eq(reviewCopilotDrafts.status, 'pending')),
          )
          .returning(),
      );
      return this.viewOf(updated ?? draft, job);
    }
    return this.viewOf(draft, job);
  }

  /** The draft's answer: its items from the job once it is ready. */
  private viewOf(draft: CopilotDraftRow, job: AiJob | null): CopilotDraft {
    const empty = { label: null, opening: null, items: [] };
    const content = draft.status === 'ready' && job ? draftOfOutput(job.output) : null;
    if (draft.status === 'ready' && !content) {
      // A ready job whose output the gateway no longer gives, or breaks its contract.
      throw gatewayUnavailable();
    }
    return {
      id: draft.id,
      status: draft.status,
      jobId: draft.jobId,
      ...(content ?? empty),
      failureReason: draft.failureReason,
    };
  }

  /** The case's current version, read for the caller (declarations audits the pull). */
  private async document(
    principal: Principal,
    tenant: string,
    row: { id: string; declarationId: string; currentVersion: number },
  ): Promise<DeclarationV1> {
    try {
      const pulled = await this.declarations.getVersionDocument(
        row.declarationId,
        row.currentVersion,
        {
          tenant,
          actingSubject: principal.subject,
          caseId: row.id,
        },
      );
      if (!pulled) throw declarationsUnavailable();
      return pulled.document as unknown as DeclarationV1;
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      throw error;
    }
  }
}

interface Outcome {
  status: CopilotDraftStatus;
  reason: string | null;
}

/** A draft's status and failure reason from its job. */
function outcomeOf(job: AiJob): Outcome {
  if (job.status === 'succeeded') return { status: 'ready', reason: null };
  if (isFinished(job)) return { status: 'failed', reason: job.reason ?? 'provider' };
  return { status: 'pending', reason: null };
}
