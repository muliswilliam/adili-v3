import { Injectable, Logger } from '@nestjs/common';
import { errorType, notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ASSET_TYPES, INCOME_TYPES, LIABILITY_TYPES, type PersonKey } from '@adili/forms';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type ExtractDocumentInput,
  type ExtractionJob,
  isFinished,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import { isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type UploadDownload,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { personOf } from '../drafts/access.js';
import {
  aiGatewayUnavailable,
  declarationNotDraft,
  documentsUnavailable,
  fieldErrors,
  uploadNotClean,
  readingConflict,
  validationProblem,
} from '../drafts/problems.js';
import { type DeclarationRow, liveDeclaration } from '../drafts/repository.js';
import { declarationAttachments, declarationSections } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { isRecord, isUuid } from '../guards.js';
import { statementPersonKey } from '../drafts/sections.js';
import { DocumentReadingSteps, outcomeOf } from './document-reading-steps.js';
import { DocumentReadingWorkflows } from './document-reading-workflows.js';
import { declarationExtractionRequested } from './events.js';
import { READING_TIMEOUT_MS, type ReadingRef } from './workflow/contract.js';
import { currentTransactionId, startOrRefuse } from '../db/workflow-transactions.js';
import {
  type ExtractAttachmentRequest,
  extractAttachmentRequestSchema,
  type SuggestionSet,
} from './representation.js';
import {
  type DocumentKind,
  type SetFailure,
  type StatementList,
  STATEMENT_LISTS,
  type SuggestionSetStatus,
  suggestions,
  suggestionSets,
} from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import { type SetRow, setView, type SuggestionRow, suggestionView } from './views.js';

/** The content types a reading takes (ai-gateway `extract-document`): what documents accepts, less HEIC. */
const READABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
type ReadableType = (typeof READABLE_TYPES)[number];

const ITEM_TYPES: Record<StatementList, readonly string[]> = {
  assets: ASSET_TYPES,
  income: INCOME_TYPES,
  liabilities: LIABILITY_TYPES,
};

/** The subject a reading's job names, which its events carry back. */
export function readingSubjectRef(declarationId: string): string {
  return `declaration:${declarationId}`;
}

/** The reading's workflow ref without its job: the declarant as the request's token names them. */
function refOf(person: PersonContext, declaration: DeclarationRow): Omit<ReadingRef, 'jobId'> {
  return {
    tenant: declaration.tenant,
    declarationId: declaration.id,
    personId: person.personId,
    subject: person.subject,
  };
}

/** The declaration a reading's job is about, from its subject; null for anyone else's job. */
export function declarationOfSubjectRef(subjectRef: string): string | null {
  const id = subjectRef.startsWith('declaration:') ? subjectRef.slice('declaration:'.length) : '';
  return isUuid(id) ? id : null;
}

interface Reading {
  declaration: DeclarationRow;
  attachment: typeof declarationAttachments.$inferSelect;
  personKey: PersonKey;
  target: { section: StatementList; itemType: string };
}

/**
 * "Read into the form" (spec 05b S6): an attached document read by the ai-gateway's
 * `extract-document` task into a `document` suggestion set for the item it is on. The declarant's
 * own, by the `person_id` claim, under person-scoped row-level security; anyone else gets 404.
 *
 * Asking: the attachment's item says where the reading goes: its statement list (the gateway's
 * `target.section`) and its type. Documents hands out a short-lived link to the
 * clean file, audited as read for the declarant; the gateway takes the job, with data class
 * `highly-confidential` (an image cannot be minimised) and the declaration as subject, and its
 * policy decides whether the document may go to a provider at all. The set is recorded with the
 * job: `pending`, `not-enabled` when the gateway blocks it by policy, `failed` when it cannot run.
 *
 * Settling (`DocumentReadingSteps`, always as the declarant from the request's token): a job that
 * ended at once (the gateway's cache) is settled by the request; a live one by its
 * `DocumentReadingWorkflow`, started with that person, on the job's `ai.job.*` event or by
 * pulling, or by the declarant asking again. A succeeded job becomes one suggestion with each
 * field's confidence and page, a failed one the set's reason; one pending past the timeout fails.
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly sections: SectionCipher,
    private readonly cipher: SuggestionCipher,
    private readonly documents: DocumentsClient,
    private readonly gateway: AiGatewayClient,
    private readonly steps: DocumentReadingSteps,
    private readonly workflows: DocumentReadingWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Asks for the attachment to be read, or answers the reading of it already asked for with the
   * same kind into the same section and item type while pending or offered and not decided on
   * (idempotent per attachment, kind, section and item type; a reading pending past
   * `READING_TIMEOUT_MS` counts as failed first). Concurrent first requests reserve one pending
   * set; only the one that reserved it downloads and asks the gateway (`failReservation` says
   * what is left when that fails). 400 for a malformed body or an item with no type yet, 404
   * when the draft or attachment is not the caller's, 409 when it is past the draft or the file
   * is not clean (nothing recorded), 503 when documents or the gateway cannot take it now (the
   * reading recorded `failed`, no job).
   */
  async request(
    principal: Principal,
    declarationId: string,
    attachmentId: string,
    body: unknown,
  ): Promise<SuggestionSet> {
    const person = personOf(principal);
    const parsed = extractAttachmentRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationProblem(fieldErrors(parsed.error.issues));
    const request = parsed.data;
    const reading = notFoundIfInvisible(
      await withPerson(this.db, person, (tx) => this.readingOf(tx, declarationId, attachmentId)),
    );
    const { declaration } = reading;
    await this.steps.expireStale(person, declaration.id);

    const earlier = await this.underWay(person, reading, request.documentKindHint);
    if (earlier) {
      if (earlier.status === 'pending' && earlier.aiJobId) {
        await this.pull({ ...refOf(person, declaration), jobId: earlier.aiJobId });
      }
      return this.view(person, declaration, earlier.id);
    }

    const setId = uuidv7();
    const reserved = await this.reserve(person, reading, request.documentKindHint, setId);
    // Another request reserved it first: it reads the document.
    if (reserved !== setId) return this.view(person, declaration, reserved);
    try {
      await this.read(person, reading, request, setId);
    } catch (error) {
      await this.failReservation(person, setId, error);
      throw error;
    }
    return this.view(person, declaration, setId);
  }

  /**
   * Reads the reserved set's document: documents' link, then the gateway's job, recorded on the
   * set with the request's event. A job that ended already (refused by policy, or an equal
   * request read before) is settled at once; a live one by its `DocumentReadingWorkflow`.
   */
  private async read(
    person: PersonContext,
    reading: Reading,
    request: ExtractAttachmentRequest,
    setId: string,
  ): Promise<void> {
    const { declaration, attachment, target } = reading;
    const download = await this.download(declaration, attachment.uploadId, person.subject);
    if (!isReadable(download.contentType)) {
      await this.recordJob(person, reading, setId, null, {
        status: 'failed',
        reason: 'document-unreadable',
      });
      return;
    }
    const input: ExtractDocumentInput = {
      kind: 'extract-document',
      documentKindHint: request.documentKindHint,
      target: target as ExtractDocumentInput['target'],
      attachment: {
        downloadUrl: download.downloadUrl,
        contentType: download.contentType,
        sha256: download.sha256,
      },
      language: request.language,
    };
    let job: ExtractionJob;
    try {
      job = await this.gateway.extractDocument(
        { tenant: declaration.tenant, subjectRef: readingSubjectRef(declaration.id), input },
        uuidv7(),
      );
    } catch (error) {
      if (!(error instanceof AiGatewayUnavailable)) throw error;
      this.logger.warn(
        { declarationId: declaration.id, err: error.name },
        'The ai-gateway did not take a document reading',
      );
      throw aiGatewayUnavailable();
    }
    // A live job's workflow is started in the transaction that records it (ADR-003 decision 7).
    const live = !isFinished(job);
    await this.recordJob(person, reading, setId, job.id, outcomeOf(job), live);
    if (job.status !== 'succeeded') return;
    try {
      await this.steps.settled(person, declaration, job);
    } catch (error) {
      // Recorded, but its reading could not be: fail it, so it can be asked again.
      this.logger.warn(
        { declarationId: declaration.id, jobId: job.id, err: errorType(error) },
        'A document reading the gateway had read was not recorded',
      );
      await this.steps.expire({ ...refOf(person, declaration), jobId: job.id });
    }
  }

  /** `settle`, as a best effort: a gateway that does not answer leaves it to the workflow. */
  private async pull(ref: ReadingRef): Promise<void> {
    try {
      await this.steps.settle(ref);
    } catch (error) {
      if (!(error instanceof AiGatewayUnavailable)) throw error;
      this.logger.warn(
        { declarationId: ref.declarationId, jobId: ref.jobId, err: error.name },
        'A document reading was not pulled; its workflow will record it',
      );
    }
  }

  /**
   * The draft, the attachment and the item it is on, if the caller's: null for 404; 409 past the
   * draft; 400 for an item with no type yet. The reading targets the item's list and type.
   */
  private async readingOf(
    tx: Transaction,
    declarationId: string,
    attachmentId: string,
  ): Promise<Reading | null> {
    const declaration = await liveDeclaration(tx, declarationId);
    if (!declaration) return null;
    const [attachment] = isUuid(attachmentId)
      ? await tx
          .select()
          .from(declarationAttachments)
          .where(
            and(
              eq(declarationAttachments.id, attachmentId),
              eq(declarationAttachments.declarationId, declaration.id),
            ),
          )
      : [];
    if (!attachment) return null;
    if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
    const [section] = await tx
      .select()
      .from(declarationSections)
      .where(
        and(
          eq(declarationSections.declarationId, declaration.id),
          eq(declarationSections.sectionKey, attachment.sectionKey),
        ),
      );
    if (!section) return null;
    const contents = await this.sections.open(declaration.tenant, section);
    const found = STATEMENT_LISTS.flatMap((list) => {
      const items: unknown = contents[list];
      const item = Array.isArray(items)
        ? (items as unknown[]).find((each) => isRecord(each) && each.id === attachment.itemId)
        : undefined;
      return isRecord(item) ? [{ list, type: item.type }] : [];
    })[0];
    const personKey = statementPersonKey(attachment.sectionKey);
    if (!found || !personKey) return null;
    const itemType = typeof found.type === 'string' ? found.type : '';
    // An item saved without a type (a draft can be) has nothing to be read into yet.
    if (!ITEM_TYPES[found.list].includes(itemType)) {
      throw validationProblem([
        { path: 'attachmentId', message: 'The item the document is on has no item type yet' },
      ]);
    }
    return {
      declaration,
      attachment,
      personKey,
      target: { section: found.list, itemType },
    };
  }

  /** The reading of the attachment as this kind and type still pending, or offered and undecided. */
  private async underWay(
    person: PersonContext,
    { declaration, attachment, target }: Reading,
    documentKind: DocumentKind,
  ): Promise<SetRow | null> {
    return withPerson(this.db, person, async (tx) => {
      const sets = await tx
        .select()
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.declarationId, declaration.id),
            eq(suggestionSets.source, 'document'),
            eq(suggestionSets.attachmentId, attachment.id),
            eq(suggestionSets.documentKind, documentKind),
            eq(suggestionSets.targetSection, target.section),
            eq(suggestionSets.targetItemType, target.itemType),
            inArray(suggestionSets.status, ['pending', 'ready']),
          ),
        )
        .orderBy(asc(suggestionSets.requestedAt));
      const offered =
        sets.length === 0
          ? []
          : await tx
              .select({ setId: suggestions.setId })
              .from(suggestions)
              .where(
                and(
                  inArray(
                    suggestions.setId,
                    sets.map((set) => set.id),
                  ),
                  eq(suggestions.status, 'new'),
                ),
              );
      return (
        sets.findLast(
          (set) => set.status === 'pending' || offered.some((each) => each.setId === set.id),
        ) ?? null
      );
    });
  }

  private async download(
    declaration: DeclarationRow,
    uploadId: string,
    subject: string,
  ): Promise<UploadDownload> {
    try {
      return await this.documents.getDownload(declaration.tenant, uploadId, subject);
    } catch (error) {
      if (error instanceof UploadNotFound) notFoundIfInvisible(null);
      if (error instanceof UploadNotClean) throw uploadNotClean();
      if (error instanceof DocumentsUnavailable) throw documentsUnavailable('read');
      throw error;
    }
  }

  /**
   * Reserves the reading: a `pending` set without a job, or, when a concurrent request reserved
   * the same attachment, kind, section and item type first
   * (`suggestion_sets_pending_reading_key`), that one's id.
   */
  private async reserve(
    person: PersonContext,
    { declaration, attachment, personKey, target }: Reading,
    documentKind: DocumentKind,
    setId: string,
  ): Promise<string> {
    return withPerson(this.db, person, async (tx) => {
      const inserted = await tx
        .insert(suggestionSets)
        .values({
          id: setId,
          declarationId: declaration.id,
          personKey,
          source: 'document',
          status: 'pending',
          attachmentId: attachment.id,
          documentKind,
          targetSection: target.section,
          targetItemType: target.itemType,
          requestedAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ id: suggestionSets.id });
      if (inserted.length > 0) return setId;
      const [first] = await tx
        .select({ id: suggestionSets.id })
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.attachmentId, attachment.id),
            eq(suggestionSets.documentKind, documentKind),
            eq(suggestionSets.targetSection, target.section),
            eq(suggestionSets.targetItemType, target.itemType),
            eq(suggestionSets.status, 'pending'),
          ),
        );
      // The winner's set is no longer pending: taken back (refused for the file) or already
      // ended (failed on a 503, not-enabled, cached, unreadable). Retryable.
      if (!first) throw readingConflict();
      return first.id;
    });
  }

  /**
   * The reserved set's job and, if it ended at once, its outcome, with the request's event. For a
   * live job (`live`) its `DocumentReadingWorkflow` is started in the same transaction, before
   * the set is written, with the transaction's id: Temporal unreachable rolls it back (503
   * `workflow-unavailable`), so a job is never recorded without its workflow.
   */
  private async recordJob(
    person: PersonContext,
    { declaration, attachment }: Reading,
    setId: string,
    aiJobId: string | null,
    outcome: { status: SuggestionSetStatus; reason: SetFailure | null } | null,
    live = false,
  ): Promise<void> {
    await withPerson(this.db, person, async (tx) => {
      if (live && aiJobId) {
        const transactionId = await currentTransactionId(tx);
        await startOrRefuse(
          () =>
            this.workflows.start({
              ...refOf(person, declaration),
              jobId: aiJobId,
              transactionId,
              timeoutMs: READING_TIMEOUT_MS,
            }),
          this.logger,
          { declarationId: declaration.id, jobId: aiJobId },
          'Document reading workflow not started',
        );
      }
      await tx
        .update(suggestionSets)
        .set({ aiJobId, ...(outcome ?? {}) })
        .where(eq(suggestionSets.id, setId));
      await this.events.record(
        tx,
        declarationExtractionRequested(declaration.tenant, {
          declarationId: declaration.id,
          attachmentId: attachment.id,
          setId,
          aiJobId,
        }),
      );
    });
  }

  /**
   * Ends a reservation whose reading could not be asked for. A request refused for the file
   * itself (a 4xx problem: 404 gone, 409 not clean or past the draft) records nothing: the
   * reservation is taken back. A concurrent request that was answered with it finds it gone,
   * either at once (a retryable 503 `reading-conflict`) or when its poll no longer lists it (the
   * portal ends the reading); asking again gets the refusal. Anything else (a 503 problem, or an
   * error of the service's own) leaves it `failed`, so a concurrent request sees it end and
   * either may ask again: `document-unavailable` when documents did not answer, `unavailable`
   * otherwise.
   */
  private async failReservation(
    person: PersonContext,
    setId: string,
    error: unknown,
  ): Promise<void> {
    const refused =
      error instanceof ProblemException &&
      error.problem.status >= 400 &&
      error.problem.status < 500;
    const reserved = and(
      eq(suggestionSets.id, setId),
      eq(suggestionSets.status, 'pending'),
      isNull(suggestionSets.aiJobId),
    );
    await withPerson(this.db, person, async (tx) => {
      if (refused) {
        await tx.delete(suggestionSets).where(reserved);
        return;
      }
      const documentsDown =
        error instanceof ProblemException && error.problem.type === 'documents-unavailable';
      await tx
        .update(suggestionSets)
        .set({ status: 'failed', reason: documentsDown ? 'document-unavailable' : 'unavailable' })
        .where(reserved);
    });
  }

  /** The set as the declarant lists it, its suggestion decrypted. */
  private async view(
    person: PersonContext,
    declaration: DeclarationRow,
    setId: string,
  ): Promise<SuggestionSet> {
    const { set, rows } = await withPerson(this.db, person, async (tx) => {
      const [found] = await tx.select().from(suggestionSets).where(eq(suggestionSets.id, setId));
      const own: SuggestionRow[] = await tx
        .select()
        .from(suggestions)
        .where(eq(suggestions.setId, setId))
        .orderBy(asc(suggestions.id));
      return { set: found, rows: own };
    });
    // A concurrent reservation taken back after a refusal: asking again gets that refusal.
    if (!set) throw readingConflict();
    const opened = await Promise.all(
      rows.map(async (row) =>
        suggestionView(
          row,
          await this.cipher.open(declaration.tenant, declaration.id, row.id, row),
        ),
      ),
    );
    return setView(set, opened);
  }
}

function isReadable(contentType: string): contentType is ReadableType {
  return (READABLE_TYPES as readonly string[]).includes(contentType);
}
