import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  AiGatewayClient,
  type AiJobReason,
  type ExtractionJob,
  isFinished,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import { requireTransactionEnded } from '../db/workflow-transactions.js';
import { isEditable } from '../declaration/schema.js';
import { type DeclarationRow, liveDeclaration } from '../drafts/repository.js';
import { declarationAttachments } from '../drafts/schema.js';
import { statementKey } from '../drafts/sections.js';
import { readingContents } from './document-reading.js';
import { declarationSuggestionsReady } from './events.js';
import {
  type ExtractionFailure,
  type SuggestionSetStatus,
  suggestions,
  suggestionSets,
} from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import type { SetRow } from './views.js';
import { READING_TIMEOUT_MS, type ReadingOutcome, type ReadingRef } from './workflow/contract.js';

/** How a job that ended without a reading reads to the declarant; null while it has not. */
export function outcomeOf(job: ExtractionJob): {
  status: Exclude<SuggestionSetStatus, 'ready'>;
  reason: ExtractionFailure | null;
} | null {
  if (job.status === 'blocked' && job.reason === 'policy') {
    return { status: 'not-enabled', reason: null };
  }
  if (job.status === 'blocked' || job.status === 'failed') {
    return { status: 'failed', reason: failureOf(job.reason) };
  }
  // Succeeded, but its reading is gone (purged): nothing to offer.
  if (job.status === 'succeeded' && !job.output) return { status: 'failed', reason: 'not-read' };
  return null;
}

function failureOf(reason: AiJobReason | null): ExtractionFailure {
  switch (reason) {
    case 'document-unavailable':
    case 'document-unreadable':
      return reason;
    case 'validation':
    case 'refused':
      return 'not-read';
    default:
      return 'unavailable';
  }
}

/**
 * Settling a document's readings (spec 05b S6), always as the declarant who asked: the request
 * (from its token) and `DocumentReadingWorkflow` (which the request started with that person)
 * call it, never anything acting on the gateway's word about whose job it is. A job settles only
 * the pending sets of the declaration that carry its id.
 */
@Injectable()
export class DocumentReadingSteps {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: SuggestionCipher,
    private readonly gateway: AiGatewayClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Pulls the job and, once it has ended, records how on its pending sets: `pending` while it
   * has not, `settled` once nothing waits for it. Nothing waits when the transaction that
   * recorded the job rolled back (`transactionId`, waited on first: a retryable failure while it
   * is open), when the declaration is gone or past the draft (submitted: a draft's suggestions
   * never reach it, ADR-018 decision 5), or when the gateway knows no such job (its sets fail).
   * Throws `AiGatewayUnavailable` when the gateway cannot answer.
   */
  async settle(ref: ReadingRef & { transactionId?: string | null }): Promise<ReadingOutcome> {
    if (ref.transactionId) await requireTransactionEnded(this.db, ref.transactionId);
    const person = personOf(ref);
    const declaration = await withPerson(this.db, person, async (tx) => {
      const found = await liveDeclaration(tx, ref.declarationId);
      if (!found || !isEditable(found.status)) return null;
      const [waiting] = await tx
        .select({ id: suggestionSets.id })
        .from(suggestionSets)
        .where(pendingOf(ref))
        .limit(1);
      return waiting ? found : null;
    });
    if (!declaration) return 'settled';
    const job = await this.gateway.getJob(declaration.tenant, ref.jobId);
    if (!job) {
      await this.expire(ref);
      return 'settled';
    }
    if (!isFinished(job)) return 'pending';
    await this.record(person, declaration, job);
    return 'settled';
  }

  /** Records a job known to have ended (the request's own answer) on its pending sets. */
  async settled(
    person: PersonContext,
    declaration: DeclarationRow,
    job: ExtractionJob,
  ): Promise<void> {
    if (isFinished(job)) await this.record(person, declaration, job);
  }

  /** Fails the job's sets still pending (`unavailable`): it took too long. */
  async expire(ref: ReadingRef): Promise<void> {
    await withPerson(this.db, personOf(ref), (tx) =>
      tx
        .update(suggestionSets)
        .set({ status: 'failed', reason: 'unavailable' })
        .where(pendingOf(ref)),
    );
  }

  /**
   * Fails the declaration's readings pending for longer than `READING_TIMEOUT_MS`, whatever
   * kept them so (a lost job, a request that stopped half way), so they can be asked again.
   */
  async expireStale(person: PersonContext, declarationId: string): Promise<void> {
    const before = new Date(this.clock.now().getTime() - READING_TIMEOUT_MS);
    await withPerson(this.db, person, (tx) =>
      tx
        .update(suggestionSets)
        .set({ status: 'failed', reason: 'unavailable' })
        .where(
          and(
            eq(suggestionSets.declarationId, declarationId),
            eq(suggestionSets.source, 'document'),
            eq(suggestionSets.status, 'pending'),
            lt(suggestionSets.requestedAt, before),
          ),
        ),
    );
  }

  private async record(
    person: PersonContext,
    declaration: DeclarationRow,
    job: ExtractionJob,
  ): Promise<void> {
    const waiting = await withPerson(this.db, person, (tx) =>
      tx
        .select()
        .from(suggestionSets)
        .where(pendingOf({ declarationId: declaration.id, jobId: job.id })),
    );
    for (const set of waiting) {
      if (job.status === 'succeeded' && job.output) {
        const suggestionId = uuidv7();
        const contents = readingContents(job.output, set.attachmentId);
        // Sealed before the transaction: the key service is not called with a row lock held.
        const sealed = await this.cipher.seal(declaration.tenant, declaration.id, suggestionId, {
          fields: contents.fields,
          sourceRef: contents.sourceRef,
          matchKeys: [],
        });
        await this.ready(person, declaration, set, {
          id: suggestionId,
          setId: set.id,
          declarationId: declaration.id,
          personKey: set.personKey,
          sectionKey: statementKey(set.personKey),
          itemType: set.targetItemType ?? 'other',
          ciphertext: sealed.ciphertext,
          envelope: sealed.envelope,
          confidence: contents.confidence,
          status: 'new',
          createdAt: this.clock.now(),
        });
      } else {
        const outcome = outcomeOf(job);
        if (!outcome) continue;
        await withPerson(this.db, person, (tx) =>
          tx
            .update(suggestionSets)
            .set(outcome)
            .where(and(eq(suggestionSets.id, set.id), eq(suggestionSets.status, 'pending'))),
        );
      }
    }
  }

  /**
   * The set becomes `ready` with its one suggestion, matched to the item the document is on
   * while it is still attached; the `new` suggestions of earlier readings of the attachment are
   * superseded. Nothing when another settling got there first.
   */
  private async ready(
    person: PersonContext,
    declaration: DeclarationRow,
    pending: SetRow,
    row: typeof suggestions.$inferInsert,
  ): Promise<void> {
    await withPerson(this.db, person, async (tx) => {
      const [set] = await tx
        .select()
        .from(suggestionSets)
        .where(eq(suggestionSets.id, pending.id))
        .for('update');
      if (set?.status !== 'pending' || !set.attachmentId) return;
      const [attached] = await tx
        .select({ itemId: declarationAttachments.itemId })
        .from(declarationAttachments)
        .where(eq(declarationAttachments.id, set.attachmentId));
      const earlier = tx
        .select({ id: suggestionSets.id })
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.declarationId, set.declarationId),
            eq(suggestionSets.source, 'document'),
            eq(suggestionSets.attachmentId, set.attachmentId),
            ne(suggestionSets.id, set.id),
          ),
        );
      await tx
        .update(suggestions)
        .set({ status: 'superseded' })
        .where(and(inArray(suggestions.setId, earlier), eq(suggestions.status, 'new')));
      await tx.insert(suggestions).values({ ...row, matchItemId: attached?.itemId ?? null });
      await tx
        .update(suggestionSets)
        .set({ status: 'ready', readyAt: this.clock.now(), reason: null })
        .where(eq(suggestionSets.id, set.id));
      await this.events.record(
        tx,
        declarationSuggestionsReady(declaration.tenant, {
          declarationId: declaration.id,
          setId: set.id,
          source: 'document',
          count: 1,
        }),
      );
    });
  }
}

/** The declaration's sets still pending on the job. */
function pendingOf({ declarationId, jobId }: Pick<ReadingRef, 'declarationId' | 'jobId'>) {
  return and(
    eq(suggestionSets.declarationId, declarationId),
    eq(suggestionSets.aiJobId, jobId),
    eq(suggestionSets.status, 'pending'),
  );
}

function personOf({ personId, subject }: Pick<ReadingRef, 'personId' | 'subject'>): PersonContext {
  return { personId, subject };
}
