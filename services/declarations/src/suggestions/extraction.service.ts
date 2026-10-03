import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import {
  type Database,
  InjectDatabase,
  type PersonContext,
  withPerson,
  withTenant,
} from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ASSET_TYPES, INCOME_TYPES, LIABILITY_TYPES, type PersonKey } from '@adili/forms';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type AiJobReason,
  type ExtractDocumentInput,
  type ExtractionJob,
  isFinished,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import { declarations, isEditable } from '../declaration/schema.js';
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
  declarationNotDraft,
  documentsUnavailable,
  fieldErrors,
  uploadNotClean,
  validationProblem,
} from '../drafts/problems.js';
import { type DeclarationRow, liveDeclaration } from '../drafts/repository.js';
import { declarationAttachments, declarationSections, obligationDrafts } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { isRecord } from '../guards.js';
import { readingContents } from './document-reading.js';
import { declarationExtractionRequested, declarationSuggestionsReady } from './events.js';
import {
  type ExtractAttachmentRequest,
  extractAttachmentRequestSchema,
  type SuggestionSet,
} from './representation.js';
import {
  type DocumentKind,
  type ExtractionFailure,
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

/** The declaration a reading's job is about, from its subject; null for anyone else's job. */
export function declarationOfSubjectRef(subjectRef: string): string | null {
  const match = /^declaration:([0-9a-f-]{36})$/iu.exec(subjectRef);
  return match?.[1] ?? null;
}

/** How a job that ended without a reading reads to the declarant. */
function outcomeOf(job: ExtractionJob): {
  status: Exclude<SuggestionSetStatus, 'ready'>;
  reason: ExtractionFailure | null;
} | null {
  if (job.status === 'blocked' && job.reason === 'policy') {
    return { status: 'not-enabled', reason: null };
  }
  if (job.status === 'blocked' || job.status === 'failed') {
    return { status: 'failed', reason: failureOf(job.reason) };
  }
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
 * Settling: the job's `ai.job.*` event (`ExtractionJobConsumer`), or the declarant asking again,
 * pulls the job; a succeeded one becomes one suggestion with each field's confidence and page, a
 * failed one the set's reason. A job that ended before its set was recorded (the gateway's cache)
 * is settled straight away.
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
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Asks for the attachment to be read, or answers the reading of it already asked for with the
   * same kind and item type while pending or offered and not decided on (idempotent per
   * attachment and kind). 400 for a malformed body or an item with no type yet, 404
   * when the draft or attachment is not the caller's, 409 when it is past the draft or the file
   * is not clean, 503 when documents or the gateway cannot take it now (nothing recorded).
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
    const { declaration, attachment, target } = reading;

    const earlier = await this.underWay(person, reading, request.documentKindHint);
    if (earlier) {
      if (earlier.status === 'pending' && earlier.aiJobId) {
        await this.pull(person, declaration, earlier.aiJobId);
      }
      return this.view(person, declaration, earlier.id);
    }

    const download = await this.download(declaration, attachment.uploadId, person.subject);
    const setId = uuidv7();
    if (!isReadable(download.contentType)) {
      await this.record(person, reading, request, setId, null, {
        status: 'failed',
        reason: 'document-unreadable',
      });
      return this.view(person, declaration, setId);
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
      throw aiUnavailable();
    }
    await this.record(person, reading, request, setId, job.id, outcomeOf(job));
    // A job that succeeded already (an equal request was read) is recorded now; a live one by its
    // event, or by this pull should it have ended before the set was recorded.
    if (job.status === 'succeeded' || !isFinished(job)) {
      await this.pull(person, declaration, job.id, job);
    }
    return this.view(person, declaration, setId);
  }

  /**
   * An `extract-document` job about the declaration ended (its `ai.job.*` event): its sets are
   * settled. The event names no person, and a draft is the declarant's alone, so the Commission
   * finds whose draft it is through the identifiers it may read (the live drafts of its
   * obligations, or the declaration once submitted, as one being amended is), and the sets are
   * settled as that person. Nothing when the declaration is gone.
   */
  async jobFinished(tenant: string, declarationId: string, jobId: string): Promise<void> {
    const subject = 'declarations:ai-job';
    const personId = await withTenant(this.db, { tenant, subject }, async (tx) => {
      const [draft] = await tx
        .select({ personId: obligationDrafts.personId })
        .from(obligationDrafts)
        .where(eq(obligationDrafts.declarationId, declarationId));
      if (draft) return draft.personId;
      const [amending] = await tx
        .select({ personId: declarations.personId })
        .from(declarations)
        .where(eq(declarations.id, declarationId));
      return amending?.personId ?? null;
    });
    if (personId === null) return;
    const person: PersonContext = { personId, subject };
    const declaration = await withPerson(this.db, person, (tx) =>
      liveDeclaration(tx, declarationId),
    );
    if (!declaration) return;
    await this.settle(person, declaration, jobId);
  }

  /**
   * Records how the job ended on its pending sets of the declaration, pulling it from the gateway
   * unless given finished. Nothing when it has not ended, or no set waits for it. Throws
   * `AiGatewayUnavailable` when the gateway cannot answer (the event is retried).
   */
  async settle(person: PersonContext, declaration: DeclarationRow, jobId: string): Promise<void> {
    const job = await this.gateway.getJob(declaration.tenant, jobId);
    if (job && isFinished(job)) await this.recordOutcome(person, declaration, job);
  }

  /** `settle`, as a best effort: a gateway that does not answer leaves it to the job's event. */
  private async pull(
    person: PersonContext,
    declaration: DeclarationRow,
    jobId: string,
    known?: ExtractionJob,
  ): Promise<void> {
    try {
      if (known?.status === 'succeeded' && known.output) {
        await this.recordOutcome(person, declaration, known);
      } else {
        await this.settle(person, declaration, jobId);
      }
    } catch (error) {
      if (!(error instanceof AiGatewayUnavailable)) throw error;
      this.logger.warn(
        { declarationId: declaration.id, jobId, err: error.name },
        'A document reading was not pulled; its event will record it',
      );
    }
  }

  private async recordOutcome(
    person: PersonContext,
    declaration: DeclarationRow,
    job: ExtractionJob,
  ): Promise<void> {
    const waiting = await withPerson(this.db, person, (tx) =>
      tx
        .select()
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.declarationId, declaration.id),
            eq(suggestionSets.aiJobId, job.id),
            eq(suggestionSets.status, 'pending'),
          ),
        ),
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
          sectionKey: `statement:${set.personKey}`,
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
    const [attachment] = /^[0-9a-f-]{36}$/iu.test(attachmentId)
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
    if (!found) return null;
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
      personKey: attachment.sectionKey.slice('statement:'.length) as PersonKey,
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

  /** The set, with the request's audit event, in one transaction. */
  private async record(
    person: PersonContext,
    { declaration, attachment, personKey, target }: Reading,
    request: ExtractAttachmentRequest,
    setId: string,
    aiJobId: string | null,
    outcome: { status: SuggestionSetStatus; reason: ExtractionFailure | null } | null,
  ): Promise<void> {
    await withPerson(this.db, person, async (tx) => {
      await tx.insert(suggestionSets).values({
        id: setId,
        declarationId: declaration.id,
        personKey,
        source: 'document',
        status: outcome?.status ?? 'pending',
        reason: outcome?.reason ?? null,
        aiJobId,
        attachmentId: attachment.id,
        documentKind: request.documentKindHint,
        targetSection: target.section,
        targetItemType: target.itemType,
        requestedAt: this.clock.now(),
      });
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
    if (!set) throw new Error(`Suggestion set ${setId} is gone`);
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

function aiUnavailable(): ProblemException {
  return new ProblemException({
    type: 'ai-gateway-unavailable',
    title: 'Document reading unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The document could not be sent to be read. Try again.',
  });
}
