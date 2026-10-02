import { Injectable } from '@nestjs/common';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationV1 } from '@adili/forms';
import { and, asc, eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import {
  type AiJob,
  AiGatewayClient,
  type DataClass,
  isFinished,
  type ReviewTask,
  type ReviewTaskInput,
} from '../ai-gateway/ai-gateway-client.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { reviewCases, reviewFlags } from '../cases/schema.js';
import { config } from '../config.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PulledVersion,
  type ReadContext,
} from '../declarations/declarations-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { systemContext } from '../system-context.js';
import { COPILOT_UNAVAILABLE, type CopilotActivityRequest } from './contract.js';
import { copilotInputs } from './copilot-inputs.js';
import { COPILOT_PROMPT_VERSIONS } from './prompt-versions.js';
import { caseSubjectRef, type CopilotUpdatedData, REVIEW_COPILOT_UPDATED } from './events.js';
import { type CopilotRow, type CopilotStatus, reviewCopilots } from './schema.js';

/** A request of a case's copilot, on whose behalf the declaration is read. */
export interface CopilotRequest extends CopilotActivityRequest {
  /** The service (`system:review`), or the reviewer who refreshed. */
  actingSubject: string;
}

/** Failure reasons of the review service's own, beside the gateway's job reasons. */
export const COPILOT_FAILURES = {
  /** The gateway refused the request (400, 404, 422): sending it again does not help. */
  rejected: 'rejected',
  /** The gateway could not be reached for as long as the workflow tried. */
  unavailable: COPILOT_UNAVAILABLE.aiGateway,
  /** The declaration could not be pulled for as long as the workflow tried. */
  declarationsUnavailable: COPILOT_UNAVAILABLE.declarations,
} as const;

/** Names the idempotency keys of the copilot's task calls (UUID v5, RFC 9562). */
const KEY_NAMESPACE = '6d1f7c84-5e1b-4f0e-9a43-6a5c3b2d9e10';

/** A sealed output of a job, ready to store. */
interface SealedOutput {
  ciphertext: string;
  envelope: CopilotRow['summaryEnvelope'];
}

/**
 * Asks the ai-gateway for a case's summary and flag explanations, and records the jobs' outcomes
 * as they end (spec 07c). Shared by the processing workflow's activities, the `ai.job.*`
 * consumer's workflow and the refresh endpoint.
 */
@Injectable()
export class CopilotRequests {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly declarations: DeclarationsClient,
    private readonly gateway: AiGatewayClient,
    private readonly cipher: FieldCipher,
  ) {}

  /**
   * Requests the copilot of the case's current version: builds the inputs from the version, the
   * previous one, their changes and the case's flags; runs `summarize-declaration` and, when the
   * case has flags, `explain-flags`; records the jobs with the record `pending` (or `stale`, when
   * earlier outputs are kept for show) and `review.copilot.updated.v1`.
   *
   * Safe to retry: the idempotency keys are derived from the case, the version, the registry
   * check, the task's prompt version and the request count, which moves on only once the previous request has ended, so a
   * retry gets the same jobs. A job that has already ended (a cached result, a blocked tenant) is
   * recorded at once.
   *
   * Throws `DeclarationsUnavailable` and `AiGatewayUnavailable` for the caller to retry.
   */
  async request(request: CopilotRequest): Promise<void> {
    const { tenant, caseId } = request;
    const context = { tenant, subject: request.actingSubject };
    const { row, flags, record } = await withTenant(this.db, context, async (tx) => ({
      row: await caseOf(tx, tenant, caseId),
      flags: await tx
        .select()
        .from(reviewFlags)
        .where(eq(reviewFlags.caseId, caseId))
        .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id)),
      record: await copilotOf(tx, caseId),
    }));
    // The case of a request is never deleted; one invisible here asks nothing of the gateway.
    if (!row) return;

    const read: ReadContext = { tenant, actingSubject: request.actingSubject, caseId };
    const current = await this.pull(row.declarationId, row.currentVersion, read);
    const previousRef = await this.declarations.findPreviousVersion(
      row.personId,
      tenant,
      row.currentVersionId,
    );
    const previous = previousRef
      ? await this.pull(previousRef.declarationId, previousRef.version, read)
      : null;
    const inputs = copilotInputs({
      current: current.document as unknown as DeclarationV1,
      previous: (previous?.document ?? null) as unknown as DeclarationV1 | null,
      flags,
      // Spec 07b's registry statuses join here once registry matching lands.
      registryStatuses: [],
    });

    const registryCheckedAt =
      request.registryCheckedAt === undefined
        ? (record?.registryCheckedAt?.toISOString() ?? null)
        : request.registryCheckedAt;
    // A request whose jobs are still being produced is asked again with the same keys (the same
    // jobs): a retry after a partial run. Anything else is a new request with new keys.
    const inFlight =
      record !== undefined &&
      (record.status === 'pending' || record.status === 'stale') &&
      record.forVersionId === row.currentVersionId &&
      (record.registryCheckedAt?.toISOString() ?? null) === registryCheckedAt;
    const attempt = inFlight ? record.attempt : (record?.attempt ?? 0) + 1;
    const key = (task: ReviewTask) =>
      copilotTaskKey({
        task,
        caseId,
        versionId: row.currentVersionId,
        registryCheckedAt,
        promptVersion: COPILOT_PROMPT_VERSIONS[task],
        attempt,
      });
    const call = (task: ReviewTask, input: ReviewTaskInput) =>
      this.gateway.runTask(
        task,
        {
          tenant,
          dataClass: dataClassOf(tenant),
          subjectRef: caseSubjectRef(caseId),
          promptVersion: COPILOT_PROMPT_VERSIONS[task],
          input,
        },
        key(task),
      );

    let jobs: AiJob[];
    try {
      jobs = [await call('summarize-declaration', inputs.summarize)];
      if (inputs.explain) jobs.push(await call('explain-flags', inputs.explain));
    } catch (error) {
      if (!(error instanceof InternalApiRejected)) throw error;
      await this.fail(tenant, caseId, COPILOT_FAILURES.rejected, {
        forVersionId: row.currentVersionId,
      });
      return;
    }
    const [summarize, explain] = jobs;

    await withTenant(this.db, context, async (tx) => {
      const locked = await copilotOf(tx, caseId, { lock: true });
      const status: CopilotStatus = hasOutputs(locked) ? 'stale' : 'pending';
      const values = {
        status,
        forVersionId: row.currentVersionId,
        registryCheckedAt: registryCheckedAt === null ? null : new Date(registryCheckedAt),
        attempt,
        requestedSummaryJobId: summarize?.id ?? null,
        requestedExplanationsJobId: explain?.id ?? null,
        requestedAt: new Date(),
        failureReason: null,
      };
      // An upsert: two first requests at once (the workflow and a refresh) write in turn.
      await tx
        .insert(reviewCopilots)
        .values({ caseId, tenant, ...values })
        .onConflictDoUpdate({ target: reviewCopilots.caseId, set: values });
      if (locked?.status !== status || locked.attempt !== attempt) {
        await this.updated(tx, tenant, caseId, status, row.currentVersionId);
      }
    });

    // A job may have ended before it was recorded here, its event then found no record to match:
    // read it again now that it is recorded.
    for (const job of jobs) {
      const latest = isFinished(job) ? job : await this.gateway.getJob(job.id);
      if (latest) await this.record(tenant, caseId, latest);
    }
  }

  /**
   * Records how a job of the case ended, when it is one of the latest request's (an earlier
   * request's job changes nothing): its output stored encrypted, then the record `ready` once
   * every job of the request has its output, `failed` when one failed or was blocked by the
   * budget, `not-enabled` when the classification gate blocked it. Idempotent.
   */
  async recordJob(tenant: string, caseId: string, jobId: string): Promise<void> {
    const record = await withTenant(this.db, systemContext(tenant), (tx) => copilotOf(tx, caseId));
    if (!record || !isRequested(record, jobId)) return;
    const job = await this.gateway.getJob(jobId);
    if (job) await this.record(tenant, caseId, job);
  }

  /**
   * The request could not be made (the gateway refused it, or stayed unreachable), or the outcome
   * of `jobId` could not be read: the record is `failed` with the reason, outputs kept, so the
   * assignee can try again. With a job, only while that job is still one of the latest request's.
   */
  async fail(
    tenant: string,
    caseId: string,
    reason: string,
    { jobId, forVersionId }: { jobId?: string; forVersionId?: string } = {},
  ): Promise<void> {
    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const locked = await copilotOf(tx, caseId, { lock: true });
      if (jobId !== undefined && (!locked || !isRequested(locked, jobId))) return;
      const versionId = forVersionId ?? (await caseOf(tx, tenant, caseId))?.currentVersionId;
      if (versionId === undefined) return;
      if (locked) {
        await tx
          .update(reviewCopilots)
          .set({ status: 'failed', failureReason: reason, forVersionId: versionId })
          .where(eq(reviewCopilots.caseId, caseId));
      } else {
        await tx.insert(reviewCopilots).values({
          caseId,
          tenant,
          status: 'failed',
          forVersionId: versionId,
          attempt: 0,
          requestedAt: new Date(),
          failureReason: reason,
        });
      }
      if (locked?.status !== 'failed') {
        await this.updated(tx, tenant, caseId, 'failed', versionId);
      }
    });
  }

  /** The cases of the Commission whose copilot the classification gate blocked. */
  async notEnabled(tenant: string): Promise<string[]> {
    const rows = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({ caseId: reviewCopilots.caseId })
        .from(reviewCopilots)
        .where(and(eq(reviewCopilots.tenant, tenant), eq(reviewCopilots.status, 'not-enabled')))
        .orderBy(asc(reviewCopilots.caseId)),
    );
    return rows.map((row) => row.caseId);
  }

  private async record(tenant: string, caseId: string, job: AiJob): Promise<void> {
    if (!isFinished(job)) return;
    const sealed =
      job.status === 'succeeded' && job.output !== null
        ? await this.seal(tenant, caseId, job)
        : null;

    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const locked = await copilotOf(tx, caseId, { lock: true });
      if (!locked || !isRequested(locked, job.id)) return;
      const next: Partial<typeof reviewCopilots.$inferInsert> = {};
      let status = locked.status;

      if (sealed) {
        Object.assign(
          next,
          job.id === locked.requestedSummaryJobId
            ? {
                summaryJobId: job.id,
                summaryPromptVersion: job.promptVersion,
                summaryCiphertext: sealed.ciphertext,
                summaryEnvelope: sealed.envelope,
              }
            : {
                explanationsJobId: job.id,
                explanationsPromptVersion: job.promptVersion,
                explanationsCiphertext: sealed.ciphertext,
                explanationsEnvelope: sealed.envelope,
              },
        );
        const after = { ...locked, ...next };
        const complete =
          after.summaryJobId === locked.requestedSummaryJobId &&
          (locked.requestedExplanationsJobId === null ||
            after.explanationsJobId === locked.requestedExplanationsJobId);
        // A failed or blocked job of the same request keeps the record failed or not enabled.
        if (complete && (status === 'pending' || status === 'stale')) {
          status = 'ready';
          Object.assign(next, {
            generatedForVersionId: locked.forVersionId,
            generatedAt: new Date(),
            // A first version's request has no explanations to show.
            ...(locked.requestedExplanationsJobId === null
              ? {
                  explanationsJobId: null,
                  explanationsPromptVersion: null,
                  explanationsCiphertext: null,
                  explanationsEnvelope: null,
                }
              : {}),
          });
        }
      } else if (job.status === 'blocked' && job.reason === 'policy') {
        status = 'not-enabled';
        next.failureReason = 'policy';
      } else if (job.status !== 'succeeded' && status !== 'not-enabled') {
        status = 'failed';
        next.failureReason = job.reason ?? 'provider';
      }

      next.status = status;
      await tx.update(reviewCopilots).set(next).where(eq(reviewCopilots.caseId, caseId));
      if (status !== locked.status) {
        await this.updated(tx, tenant, caseId, status, locked.forVersionId);
      }
    });
  }

  /** The job's output encrypted under the Commission's key, bound to the case and the job. */
  private async seal(tenant: string, caseId: string, job: AiJob): Promise<SealedOutput> {
    const sealed = await this.cipher.encrypt({
      tenant,
      recordId: copilotOutputRecordId(caseId, job.id),
      plaintext: JSON.stringify(job.output),
    });
    return { ciphertext: sealed.ciphertext, envelope: sealed.envelope };
  }

  private async updated(
    tx: ReviewTransaction,
    tenant: string,
    caseId: string,
    status: CopilotStatus,
    forVersionId: string,
  ): Promise<void> {
    await this.events.record<CopilotUpdatedData>(tx, {
      type: REVIEW_COPILOT_UPDATED,
      subject: caseId,
      tenant,
      data: { caseId, status, forVersionId },
    });
  }

  /** A version of the case; one that declarations no longer gives is an outage to retry. */
  private async pull(
    declarationId: string,
    version: number,
    context: ReadContext,
  ): Promise<PulledVersion> {
    const pulled = await this.declarations.getVersionDocument(declarationId, version, context);
    if (!pulled) {
      throw new DeclarationsUnavailable(
        `Version ${String(version)} of ${declarationId} is not available`,
      );
    }
    return pulled;
  }
}

/**
 * The idempotency key of a copilot task call: one per task, case, version, registry check, prompt
 * version and request count, so a retry gets the same job and anything else asks anew.
 */
export function copilotTaskKey(parts: {
  task: ReviewTask;
  caseId: string;
  versionId: string;
  registryCheckedAt: string | null;
  promptVersion: number;
  attempt: number;
}): string {
  return uuidv5(
    [
      parts.task,
      parts.caseId,
      parts.versionId,
      parts.registryCheckedAt ?? 'none',
      String(parts.promptVersion),
      String(parts.attempt),
    ].join('|'),
    KEY_NAMESPACE,
  );
}

/** The AAD record id of a stored output: the case and the job it came from. */
export function copilotOutputRecordId(caseId: string, jobId: string): string {
  return `review-copilot:${caseId}:${jobId}`;
}

/** How sensitive a Commission's declarations are, as the gateway's gate reads it. */
export function dataClassOf(tenant: string): DataClass {
  return config.AI_SYNTHETIC_DATA_TENANTS.includes(tenant) ? 'synthetic' : 'highly-confidential';
}

/** The case `caseId` of the Commission; undefined when it has none. */
async function caseOf(tx: ReviewTransaction, tenant: string, caseId: string) {
  const [row] = await tx
    .select()
    .from(reviewCases)
    .where(and(eq(reviewCases.id, caseId), eq(reviewCases.tenant, tenant)));
  return row;
}

/** The copilot record of a case, locked for update when `lock` is set. */
export async function copilotOf(
  tx: ReviewTransaction,
  caseId: string,
  { lock = false } = {},
): Promise<CopilotRow | undefined> {
  const query = tx.select().from(reviewCopilots).where(eq(reviewCopilots.caseId, caseId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

function isRequested(record: CopilotRow, jobId: string): boolean {
  return record.requestedSummaryJobId === jobId || record.requestedExplanationsJobId === jobId;
}

function hasOutputs(record: CopilotRow | undefined): boolean {
  return record?.summaryCiphertext != null;
}
