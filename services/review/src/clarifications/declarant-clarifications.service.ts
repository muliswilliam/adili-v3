import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import {
  type ClarificationResponseAttachment,
  type ClarificationStatus,
  clarificationResponses,
  clarifications,
  reviewCases,
  reviewTimeline,
} from '../cases/schema.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import type { ResponseInput } from './clarification-input.js';
import { ClarificationWorkflows } from './clarification-workflows.js';
import { CLARIFICATION_RESPONDED, type ClarificationRespondedData } from './events.js';
import { letterDownloadUrl } from './links.js';
import { clarificationView, type DeclarantClarificationView } from './representation.js';

type ClarificationRow = typeof clarifications.$inferSelect;
type ResponseRow = typeof clarificationResponses.$inferSelect;

/** The upload purpose of a clarification response's attachments (documents.yaml). */
export const CLARIFICATION_ATTACHMENT = 'clarification-attachment';

/**
 * The declarant's clarifications across Commissions (spec 07a): issued ones only, read under the
 * person's row-level security (`app.person`), never another person's. Drafts are the reviewer's
 * and stay invisible. The declarant responds once, even after the due date (then marked late).
 */
@Injectable()
export class DeclarantClarificationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly events: EventPublisher,
    private readonly workflows: ClarificationWorkflows,
    private readonly clock: Clock,
  ) {}

  async list(personId: string): Promise<DeclarantClarificationView[]> {
    const { rows, responses } = await this.read(personId);
    return this.views(rows, responses);
  }

  async get(personId: string, clarificationId: string): Promise<DeclarantClarificationView> {
    const { rows, responses } = await this.read(personId, clarificationId);
    const [view] = await this.views(rows, responses);
    return notFoundIfInvisible(view);
  }

  /**
   * The declarant's one response: text per item and attachments, each a clean upload of the
   * Commission with purpose `clarification-attachment` (verified through documents). After the
   * due date it is accepted and marked late. The clarification becomes `responded`, with the
   * timeline entry and `clarification.responded.v1` in the same transaction; then the workflow's
   * clock ends.
   */
  async respond(
    personId: string,
    clarificationId: string,
    input: ResponseInput,
  ): Promise<DeclarantClarificationView> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await asPerson(tx, personId);
      const [visible] = await tx
        .select({ tenant: clarifications.tenant })
        .from(clarifications)
        .where(
          and(
            eq(clarifications.id, clarificationId),
            eq(clarifications.personId, personId),
            ne(clarifications.status, 'draft'),
          ),
        );
      const { tenant } = notFoundIfInvisible(visible);
      // The person's own clarification, found: now written as its Commission's data.
      await tx.execute(sql`select set_config('app.tenant', ${tenant}, true)`);
      const [locked] = await tx
        .select()
        .from(clarifications)
        .where(and(eq(clarifications.id, clarificationId), eq(clarifications.personId, personId)))
        .for('update');
      const clarification = notFoundIfInvisible(locked);
      requireAnswerable(clarification.status);
      const answers = answersOf(clarification, input);
      const attachments = await this.verifiedAttachments(tenant, answers);
      const late = clarification.dueAt !== null && now > clarification.dueAt;

      await tx
        .update(clarifications)
        .set({ status: 'responded', respondedAt: now, responseLate: late })
        .where(eq(clarifications.id, clarificationId));
      await tx.insert(clarificationResponses).values({
        clarificationId,
        tenant,
        personId,
        items: answers.map(({ itemId, text }) => ({ itemId, text })),
        attachments,
        submittedAt: now,
      });
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: clarification.caseId,
        kind: 'clarification-responded',
        ref: clarificationId,
        actor: personSubject(personId),
        summary: `Clarification ${clarification.reference ?? clarificationId} responded${late ? ' late' : ''}`,
      });
      await this.events.record<ClarificationRespondedData>(tx, {
        type: CLARIFICATION_RESPONDED,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: clarification.caseId, late },
      });
    });
    await this.workflows.signal(clarificationId, 'responded');
    return this.get(personId, clarificationId);
  }

  /** Each upload checked with documents, in the order given; the first one refused is a 409. */
  private async verifiedAttachments(
    tenant: string,
    answers: Answer[],
  ): Promise<ClarificationResponseAttachment[]> {
    const verified: ClarificationResponseAttachment[] = [];
    for (const { itemId, attachments } of answers) {
      for (const uploadId of attachments) {
        let upload;
        try {
          upload = await withUpstream(() => this.documents.getUploadDownload(uploadId, tenant));
        } catch (error) {
          if (error instanceof InternalApiRejected) throw attachmentRefused(uploadId, 'not-clean');
          throw error;
        }
        if (upload?.purpose !== CLARIFICATION_ATTACHMENT) {
          throw attachmentRefused(uploadId, 'not-accepted');
        }
        verified.push({
          itemId,
          uploadId,
          fileName: upload.fileName ?? uploadId,
          sha256: upload.sha256,
        });
      }
    }
    return verified;
  }

  private read(personId: string, clarificationId?: string) {
    return this.db.transaction(async (tx) => {
      await asPerson(tx, personId);
      const rows = await tx
        .select()
        .from(clarifications)
        .where(
          and(
            eq(clarifications.personId, personId),
            ne(clarifications.status, 'draft'),
            clarificationId === undefined ? undefined : eq(clarifications.id, clarificationId),
          ),
        )
        .orderBy(desc(clarifications.issuedAt));
      const responses =
        rows.length === 0
          ? []
          : await tx
              .select()
              .from(clarificationResponses)
              .where(
                inArray(
                  clarificationResponses.clarificationId,
                  rows.map((row) => row.id),
                ),
              );
      return { rows, responses };
    });
  }

  /**
   * Adds the Commission and the declaration reference. The cases are read as the service, per
   * Commission, and only those of the clarifications the person's own read returned.
   */
  private async views(
    rows: ClarificationRow[],
    responses: ResponseRow[],
  ): Promise<DeclarantClarificationView[]> {
    const references = new Map<string, string>();
    const names = new Map<string, string>();
    for (const tenant of new Set(rows.map((row) => row.tenant))) {
      const caseIds = rows.filter((row) => row.tenant === tenant).map((row) => row.caseId);
      const cases = await withTenant(this.db, systemContext(tenant), (tx) =>
        tx
          .select({ id: reviewCases.id, reference: reviewCases.reference })
          .from(reviewCases)
          .where(inArray(reviewCases.id, caseIds)),
      );
      for (const reviewCase of cases) references.set(reviewCase.id, reviewCase.reference);
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      names.set(tenant, commission.name);
    }
    return rows.map((row) => {
      const view = clarificationView(
        row,
        responses.find((response) => response.clarificationId === row.id) ?? null,
      );
      return {
        ...view,
        commission: { slug: row.tenant, name: names.get(row.tenant) ?? row.tenant },
        declarationReference: references.get(row.caseId) ?? '',
        letterDownloadUrl:
          view.letter?.status === 'issued' ? letterDownloadUrl(view.letter.documentId) : null,
      };
    });
  }
}

/** One answer, tied to the item it answers. */
interface Answer {
  itemId: string;
  text: string;
  attachments: string[];
}

function personSubject(personId: string): string {
  return `person:${personId}`;
}

/** The person's row-level security context (`app.person`) for the rest of the transaction. */
export async function asPerson(tx: ReviewTransaction, personId: string): Promise<void> {
  await tx.execute(
    sql`select set_config('app.person', ${personId}, true), set_config('app.subject', ${personSubject(personId)}, true)`,
  );
}

/** Only a clarification awaiting the declarant (`issued` or `overdue`) takes a response. */
function requireAnswerable(status: ClarificationStatus): void {
  if (status === 'issued' || status === 'overdue') return;
  const responded = status === 'responded';
  throw new ProblemException(
    {
      type: responded ? 'already-responded' : 'clarification-closed',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: responded
        ? 'You have already responded to this clarification; a clarification takes one response.'
        : `The clarification is ${status}; it no longer takes a response.`,
    },
    { code: responded ? 'already-responded' : 'clarification-closed' },
  );
}

/**
 * The answers by item: each index names an item of the clarification, once; an upload is
 * attached once in the whole response. Anything else fails validation (400).
 */
function answersOf(clarification: ClarificationRow, input: ResponseInput): Answer[] {
  const errors: { path: string; message: string }[] = [];
  const seenItems = new Set<number>();
  const seenUploads = new Set<string>();
  const answers: Answer[] = [];
  input.items.forEach((answer, position) => {
    const item = clarification.items[answer.index];
    if (!item) {
      errors.push({ path: `items.${String(position)}.index`, message: 'No such item' });
    } else if (seenItems.has(answer.index)) {
      errors.push({ path: `items.${String(position)}.index`, message: 'Item answered twice' });
    } else {
      answers.push({ itemId: item.id, text: answer.text, attachments: answer.attachments });
    }
    seenItems.add(answer.index);
    answer.attachments.forEach((uploadId, at) => {
      if (seenUploads.has(uploadId)) {
        errors.push({
          path: `items.${String(position)}.attachments.${String(at)}`,
          message: 'Upload attached twice',
        });
      }
      seenUploads.add(uploadId);
    });
  });
  if (errors.length > 0) {
    throw new ProblemException({
      type: 'about:blank',
      title: 'Validation failed',
      status: HttpStatus.BAD_REQUEST,
      errors,
    });
  }
  return answers;
}

function attachmentRefused(uploadId: string, reason: 'not-clean' | 'not-accepted') {
  const code = reason === 'not-clean' ? 'attachment-not-clean' : 'attachment-not-accepted';
  return new ProblemException(
    {
      type: code,
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail:
        reason === 'not-clean'
          ? 'An attachment has not passed the malware check.'
          : 'An attachment is not an upload for a clarification response.',
    },
    { code, uploadId },
  );
}
