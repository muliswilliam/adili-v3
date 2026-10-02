import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  isFinished,
  MAX_TASK_WAIT_SECONDS,
} from '../ai-gateway/ai-gateway-client.js';
import { caseTenant } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import { reviewCases, reviewFlags } from '../cases/schema.js';
import { requireAssignee } from '../clarifications/access.js';
import { clarificationItemInput } from '../clarifications/clarification-input.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
} from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { declarationsUnavailable, withUpstream } from '../internal-api/upstream.js';
import { COPILOT_FAILURES, dataClassOf, succeededWithout } from './copilot-requests.js';
import {
  COPILOT_DRAFT_STATUSES,
  COPILOT_DRAFT_TTL_HOURS,
  type CopilotDraftRow,
  type CopilotDraftStatus,
  reviewCopilotDrafts,
} from './draft-schema.js';
import {
  type CopilotDraftInput,
  type DraftContent,
  type DraftItem,
  draftClarificationInput,
  draftOfOutput,
  InvalidDraftSelection,
} from './draft-input.js';
import { caseSubjectRef } from './events.js';
import { aiGatewayUnavailable as gatewayUnavailable, aiNotEnabled } from './problems.js';
import { COPILOT_PROMPT_VERSIONS } from './prompt-versions.js';

/** review.yaml `CopilotDraft`. */
export const copilotDraftSchema = z.object({
  id: z.uuid(),
  status: z.enum(COPILOT_DRAFT_STATUSES),
  jobId: z.uuid().nullable(),
  label: z
    .record(z.string(), z.unknown())
    .nullable()
    .meta({ description: 'ai-gateway AiLabel; null until ready' }),
  opening: z.string().nullable(),
  items: z.array(clarificationItemInput).meta({
    description:
      'Empty until ready. Each item names the job that drafted it (`aiJobId`), which the composer keeps',
  }),
  failureReason: z.string().nullable().meta({
    description:
      "The ai-gateway's job reason (`validation`, `budget`, `provider`, ...), `output-purged` when the job succeeded but its output was purged before it was read, or `rejected` when the gateway refused the request",
  }),
});

/** A draft as the service answers it: each item names the job that drafted it. */
export type CopilotDraft = Omit<z.infer<typeof copilotDraftSchema>, 'items'> & {
  items: (DraftItem & { aiJobId: string })[];
};

/** How long the reviewer's request waits for the draft before answering a pending one to poll. */
export const DRAFT_WAIT_SECONDS = MAX_TASK_WAIT_SECONDS;

/** Names the drafts (UUID v5, RFC 9562): one per assignee, case and Idempotency-Key. */
const DRAFT_NAMESPACE = '3f0c2b8e-71d4-4a52-9a1e-6c0f5d2e8b47';

/** How a draft's job ended, with the drafted text once ready. */
interface Outcome {
  status: CopilotDraftStatus;
  reason: string | null;
  content: DraftContent | null;
}

/** The sealed columns of a draft's outcome. */
type Sealed = Pick<CopilotDraftRow, 'status' | 'failureReason' | 'ciphertext' | 'envelope'>;

/**
 * Clarification drafts by the ai-gateway's `draft-clarification` task (spec 07c S12): the case's
 * assignee selects flags and items, the service builds the task input from the case's version
 * and asks the gateway, waiting up to `DRAFT_WAIT_SECONDS`; a draft not ready by then is polled.
 * A ready draft's text is stored encrypted and served from here, never read from the gateway
 * again. A draft is a suggestion for the composer only: nothing here creates or changes a
 * clarification, and it can be read for `COPILOT_DRAFT_TTL_HOURS`.
 */
@Injectable()
export class CopilotDraftsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly gateway: AiGatewayClient,
    private readonly cipher: FieldCipher,
  ) {}

  /**
   * Drafts the items of a clarification from the assignee's selection: `ready` (or `failed`)
   * when the job ended within the wait, `pending` otherwise. Only the assignee (403); 409 when the
   * gateway's classification gate blocks the Commission; 400 for a selection not on the case. The
   * declaration is read for the caller. A retry with the same Idempotency-Key gets the same draft,
   * as it is now; 409 `draft-expired` once its 24 hours are over.
   */
  async draft(
    principal: Principal,
    caseId: string,
    selection: CopilotDraftInput,
    idempotencyKey: string,
  ): Promise<CopilotDraft> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const { row, flags } = await withTenant(this.db, context, async (tx) => {
      const found = await findCase(tx, tenant, caseId);
      return {
        row: found,
        flags: await tx
          .select()
          .from(reviewFlags)
          .where(eq(reviewFlags.caseId, found.id))
          .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id)),
      };
    });
    requireAssignee(principal, row.assignee);

    const id = uuidv5([row.id, principal.subject, idempotencyKey].join('|'), DRAFT_NAMESPACE);
    // A retry: an ended draft is answered as it is, from here; one past its day is gone.
    const [existing] = await withTenant(this.db, context, (tx) =>
      tx
        .select({
          draft: reviewCopilotDrafts,
          expired: sql<boolean>`${reviewCopilotDrafts.expiresAt} <= now()`,
        })
        .from(reviewCopilotDrafts)
        .where(eq(reviewCopilotDrafts.id, id)),
    );
    const selectionHash = hashOf(selection);
    if (existing && existing.draft.selectionHash !== selectionHash) throw keyReused();
    if (existing?.expired) throw draftExpired();
    if (existing && existing.draft.status !== 'pending') return this.viewOf(existing.draft);

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

    let job: AiJob | null;
    try {
      // The gateway decides whether the Commission may use AI now: a policy change applies at once.
      job = await this.gateway.runTask(
        'draft-clarification',
        {
          tenant,
          dataClass: dataClassOf(tenant),
          subjectRef: caseSubjectRef(row.id),
          promptVersion: COPILOT_PROMPT_VERSIONS['draft-clarification'],
          input,
        },
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
      : { status: 'failed', reason: COPILOT_FAILURES.rejected, content: null };
    const sealed = await this.seal(tenant, id, job?.id ?? null, outcome);
    const [stored] = await withTenant(this.db, context, async (tx) => {
      await tx
        .insert(reviewCopilotDrafts)
        .values({
          id,
          tenant,
          caseId: row.id,
          requestedBy: principal.subject,
          selectionHash,
          language: selection.language,
          jobId: job?.id ?? null,
          ...sealed,
          expiresAt: sql`now() + make_interval(hours => ${COPILOT_DRAFT_TTL_HOURS})`,
        })
        // A retry of a pending draft records how its job has ended since; an ended draft stays.
        .onConflictDoUpdate({
          target: reviewCopilotDrafts.id,
          set: sealed,
          setWhere: eq(reviewCopilotDrafts.status, 'pending'),
        });
      return tx.select().from(reviewCopilotDrafts).where(eq(reviewCopilotDrafts.id, id));
    });
    if (!stored) throw new Error(`Draft ${id} not stored`);
    return this.viewOf(stored);
  }

  /**
   * A draft as it is now, for the reviewer who asked while they are still the case's assignee;
   * anyone else, and a draft past its day, 404. A pending draft is read from the gateway, and
   * recorded (its text sealed) once its job has ended.
   */
  async get(principal: Principal, draftId: string): Promise<CopilotDraft> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const found = await withTenant(this.db, context, async (tx) => {
      const [joined] = await tx
        .select({ draft: reviewCopilotDrafts, assignee: reviewCases.assignee })
        .from(reviewCopilotDrafts)
        .innerJoin(reviewCases, eq(reviewCases.id, reviewCopilotDrafts.caseId))
        .where(
          and(eq(reviewCopilotDrafts.id, draftId), gt(reviewCopilotDrafts.expiresAt, sql`now()`)),
        );
      return joined;
    });
    const draft = notFoundIfInvisible(
      found?.draft.requestedBy === principal.subject && found.assignee === principal.subject
        ? found.draft
        : null,
    );
    if (draft.status !== 'pending' || draft.jobId === null) return this.viewOf(draft);

    const job = await this.gateway.getJob(tenant, draft.jobId).catch((error: unknown) => {
      throw error instanceof AiGatewayUnavailable ? gatewayUnavailable() : error;
    });
    // A job the gateway no longer has: its outcome cannot be known.
    const outcome: Outcome = job
      ? outcomeOf(job)
      : { status: 'failed', reason: 'missing', content: null };
    if (outcome.status === 'pending') return this.viewOf(draft);

    const sealed = await this.seal(tenant, draft.id, draft.jobId, outcome);
    const updated = await withTenant(this.db, context, async (tx) => {
      const [changed] = await tx
        .update(reviewCopilotDrafts)
        .set(sealed)
        .where(and(eq(reviewCopilotDrafts.id, draft.id), eq(reviewCopilotDrafts.status, 'pending')))
        .returning();
      if (changed) return changed;
      // Recorded meanwhile by another poll or a retry.
      const [current] = await tx
        .select()
        .from(reviewCopilotDrafts)
        .where(eq(reviewCopilotDrafts.id, draft.id));
      return current;
    });
    return this.viewOf(updated ?? draft);
  }

  /** The draft's answer: its stored text once it is ready. */
  private async viewOf(draft: CopilotDraftRow): Promise<CopilotDraft> {
    const content = await this.open(draft);
    const { jobId } = draft;
    return {
      id: draft.id,
      status: draft.status,
      jobId: draft.jobId,
      label: content?.label ?? null,
      opening: content?.opening ?? null,
      items: content && jobId ? content.items.map((item) => ({ ...item, aiJobId: jobId })) : [],
      failureReason: draft.failureReason,
    };
  }

  /** The columns of an outcome, the drafted text encrypted under the Commission's key. */
  private async seal(
    tenant: string,
    draftId: string,
    jobId: string | null,
    outcome: Outcome,
  ): Promise<Sealed> {
    if (outcome.status !== 'ready' || outcome.content === null || jobId === null) {
      return {
        status: outcome.status,
        failureReason: outcome.reason,
        ciphertext: null,
        envelope: null,
      };
    }
    const sealed = await this.cipher.encrypt({
      tenant,
      recordId: copilotDraftRecordId(draftId, jobId),
      plaintext: JSON.stringify(outcome.content),
    });
    return {
      status: 'ready',
      failureReason: null,
      ciphertext: sealed.ciphertext,
      envelope: sealed.envelope,
    };
  }

  private async open(draft: CopilotDraftRow): Promise<DraftContent | null> {
    if (draft.status !== 'ready' || !draft.jobId || !draft.ciphertext || !draft.envelope) {
      return null;
    }
    const plaintext = await this.cipher.decrypt({
      tenant: draft.tenant,
      recordId: copilotDraftRecordId(draft.id, draft.jobId),
      ciphertext: draft.ciphertext,
      envelope: draft.envelope,
    });
    return JSON.parse(plaintext.toString('utf8')) as DraftContent;
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

/** The SHA-256 of a selection, as validated (the schema's key order). */
function hashOf(selection: CopilotDraftInput): string {
  return createHash('sha256').update(JSON.stringify(selection)).digest('hex');
}

/** 422: the Idempotency-Key names a draft of another selection. */
function keyReused(): ProblemException {
  return new ProblemException(
    {
      type: 'idempotency-key-reused',
      title: 'Idempotency-Key reused',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      detail: 'The Idempotency-Key was used for a draft of another selection.',
    },
    { code: 'idempotency-key-reused' },
  );
}

/** 409: the draft of this Idempotency-Key is past its day; a new key asks anew. */
function draftExpired(): ProblemException {
  return new ProblemException(
    {
      type: 'draft-expired',
      title: 'Draft expired',
      status: HttpStatus.CONFLICT,
      detail: 'The draft of this Idempotency-Key is past its 24 hours. Ask again with a new key.',
    },
    { code: 'draft-expired' },
  );
}

/** The AAD record id of a stored draft: the draft and the job that drafted it. */
export function copilotDraftRecordId(draftId: string, jobId: string): string {
  return `review-copilot-draft:${draftId}:${jobId}`;
}

/**
 * A draft's status and failure reason from its job, with its text once it succeeded; a succeeded
 * job whose output breaks the contract failed `validation`, one the gateway no longer gives
 * (purged) `output-purged`.
 */
function outcomeOf(job: AiJob): Outcome {
  if (job.status === 'succeeded') {
    const content = draftOfOutput(job.output);
    return content
      ? { status: 'ready', reason: null, content }
      : { status: 'failed', reason: succeededWithout(job), content: null };
  }
  if (isFinished(job)) return { status: 'failed', reason: job.reason ?? 'provider', content: null };
  return { status: 'pending', reason: null, content: null };
}
