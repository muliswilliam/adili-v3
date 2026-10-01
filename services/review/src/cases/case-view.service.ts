import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { asc, eq, inArray } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import { determinationView } from '../determinations/representation.js';
import { determinations } from '../determinations/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PulledVersion,
} from '../declarations/declarations-client.js';
import { DocumentsClient, DocumentsUnavailable } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { declarationsUnavailable, upstreamUnavailable } from '../internal-api/upstream.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { caseTenant } from './access.js';
import {
  caseItem,
  type CaseRow,
  findCase,
  type ReviewTransaction,
  visibleId,
} from './case-lookup.js';
import { type CaseViewedData, REVIEW_CASE_VIEWED } from './events.js';
import {
  type Assignee,
  type AttachmentDownload,
  type CaseDetail,
  type ClarificationView,
  flagView,
  type NoteView,
  type TimelineEntryView,
} from './representation.js';
import {
  clarificationResponses,
  clarifications,
  reviewAssignments,
  reviewCaseVersions,
  reviewFlags,
  reviewNotes,
  reviewTimeline,
} from './schema.js';

/**
 * The case view (spec 07a): the case's own data (flags, clarifications, notes, timeline,
 * reviewer-of-record history) with the declaration pulled from the declarations service on every
 * view and never stored. Declarations audits each pull with the viewer and the case (ADR-008);
 * this service records `review.case.viewed.v1`, and the route an `audit.read.v1`.
 */
@Injectable()
export class CaseViewService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly declarations: DeclarationsClient,
    private readonly documents: DocumentsClient,
  ) {}

  /**
   * The case with its declaration. When declarations cannot give the document, 502 with the rest
   * of the case in the problem, so the reviewer still sees the case's own data.
   */
  async detail(principal: Principal, caseId: string): Promise<CaseDetail> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const { row, detail } = await withTenant(this.db, context, async (tx) => {
      const found = await findCase(tx, tenant, caseId);
      return { row: found, detail: await caseData(tx, found) };
    });

    const pulled = await this.pull(principal, row).catch((error: unknown) => {
      if (error instanceof ProblemException) {
        throw new ProblemException(error.problem, { ...detail, document: null });
      }
      throw error;
    });

    await withTenant(this.db, context, (tx) =>
      this.events.record<CaseViewedData>(tx, {
        type: REVIEW_CASE_VIEWED,
        subject: row.id,
        tenant,
        data: { caseId: row.id, subject: principal.subject },
      }),
    );
    return { ...detail, document: pulled.document };
  }

  /**
   * A short-lived link to an attachment of the version under review, from the documents service.
   * The upload must be one of the version's attachments: 404 for any other upload.
   */
  async attachmentDownload(
    principal: Principal,
    caseId: string,
    uploadId: string,
  ): Promise<AttachmentDownload> {
    const tenant = caseTenant(principal);
    const upload = visibleId(uploadId);
    const row = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      findCase(tx, tenant, caseId),
    );
    const pulled = await this.pull(principal, row);
    notFoundIfInvisible(pulled.attachments.find((attachment) => attachment.uploadId === upload));
    let link: AttachmentDownload | null;
    try {
      const found = await this.documents.getUploadDownload(upload, tenant);
      link = found && { downloadUrl: found.downloadUrl, expiresAt: found.expiresAt };
    } catch (error) {
      // A filed attachment is clean; one documents refuses is as good as unreachable.
      if (error instanceof DocumentsUnavailable || error instanceof InternalApiRejected) {
        throw upstreamUnavailable('documents', 'The documents service could not give the link.');
      }
      throw error;
    }
    return notFoundIfInvisible(link);
  }

  /** The current version as the declarations service gives it, read for the viewer and case. */
  private async pull(principal: Principal, row: CaseRow): Promise<PulledVersion> {
    let pulled: PulledVersion | null;
    try {
      pulled = await this.declarations.getVersionDocument(row.declarationId, row.currentVersion, {
        tenant: row.tenant,
        actingSubject: principal.subject,
        caseId: row.id,
      });
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      throw error;
    }
    if (pulled === null) {
      throw declarationsUnavailable(
        'The declarations service does not have the version under review.',
      );
    }
    return pulled;
  }
}

/** Everything the case view shows from the review database. */
async function caseData(
  tx: ReviewTransaction,
  row: CaseRow,
): Promise<Omit<CaseDetail, 'document'>> {
  const flags = await tx
    .select()
    .from(reviewFlags)
    .where(eq(reviewFlags.caseId, row.id))
    .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id));
  const clarificationRows = await tx
    .select()
    .from(clarifications)
    .where(eq(clarifications.caseId, row.id))
    .orderBy(asc(clarifications.createdAt), asc(clarifications.id));
  const responses =
    clarificationRows.length === 0
      ? []
      : await tx
          .select()
          .from(clarificationResponses)
          .where(
            inArray(
              clarificationResponses.clarificationId,
              clarificationRows.map((clarification) => clarification.id),
            ),
          );
  const notes = await tx
    .select()
    .from(reviewNotes)
    .where(eq(reviewNotes.caseId, row.id))
    .orderBy(asc(reviewNotes.at), asc(reviewNotes.id));
  const timeline = await tx
    .select()
    .from(reviewTimeline)
    .where(eq(reviewTimeline.caseId, row.id))
    .orderBy(asc(reviewTimeline.at), asc(reviewTimeline.id));
  const versions = await tx
    .select()
    .from(reviewCaseVersions)
    .where(eq(reviewCaseVersions.caseId, row.id))
    .orderBy(asc(reviewCaseVersions.version));
  const determinationRows = await tx
    .select()
    .from(determinations)
    .where(eq(determinations.caseId, row.id))
    .orderBy(asc(determinations.proposedAt), asc(determinations.id));
  const assignments = await tx
    .select()
    .from(reviewAssignments)
    .where(eq(reviewAssignments.caseId, row.id))
    .orderBy(asc(reviewAssignments.at), asc(reviewAssignments.id));

  // Display names of the officers who worked the case, as their tokens gave them.
  const names = new Map<string, string>();
  for (const assignment of assignments) {
    if (assignment.subject !== null && assignment.subjectName !== null) {
      names.set(assignment.subject, assignment.subjectName);
    }
  }
  for (const note of notes) if (note.authorName !== null) names.set(note.author, note.authorName);
  const officer = (subject: string): Assignee => ({ subject, name: names.get(subject) ?? subject });

  const reviewerHistory: Assignee[] = [];
  for (const assignment of assignments) {
    const subject = assignment.subject;
    if (subject !== null && !reviewerHistory.some((reviewer) => reviewer.subject === subject)) {
      reviewerHistory.push(officer(subject));
    }
  }

  const responseOf = new Map(responses.map((response) => [response.clarificationId, response]));
  return {
    case: await caseItem(tx, row),
    flags: flags.map((flag) => flagView(flag, officer)),
    clarifications: clarificationRows.map((clarification) =>
      clarificationView(clarification, responseOf.get(clarification.id)),
    ),
    notes: notes.map((note): NoteView => ({
      id: note.id,
      author: officer(note.author),
      text: note.text,
      at: note.at.toISOString(),
    })),
    timeline: timeline.map((entry): TimelineEntryView => ({
      id: entry.id,
      kind: entry.kind,
      actor: entry.actor === SYSTEM_SUBJECT ? null : officer(entry.actor),
      at: entry.at.toISOString(),
      summary: entry.summary,
      ref: entry.ref,
    })),
    versions: versions.map((version) => ({
      versionId: version.versionId,
      version: version.version,
      submittedAt: version.submittedAt.toISOString(),
      late: version.late,
      amendment: version.amendment,
    })),
    reviewerHistory,
    determinations: determinationRows.map(determinationView),
  };
}

function clarificationView(
  row: typeof clarifications.$inferSelect,
  response: typeof clarificationResponses.$inferSelect | undefined,
): ClarificationView {
  const indexOf = (itemId: string) => {
    const index = row.items.findIndex((item) => item.id === itemId);
    return index === -1 ? Number(itemId) : index;
  };
  return {
    id: row.id,
    caseId: row.caseId,
    reference: row.reference,
    status: row.status,
    items: row.items.map((item) => ({
      sectionKey: item.sectionKey,
      personKey: item.personKey,
      itemId: item.itemId,
      requirement: item.requirement,
      text: item.text,
    })),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseLate: row.responseLate ?? false,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
    letter:
      row.letterDocumentId === null
        ? null
        : {
            documentId: row.letterDocumentId,
            verificationId: row.letterVerificationId ?? '',
            status:
              row.status === 'withdrawn'
                ? 'revoked'
                : row.letterVerificationId === null
                  ? 'pending'
                  : 'issued',
          },
    followUpOf: row.followUpOf,
    response:
      response === undefined
        ? null
        : {
            items: response.items.map((item) => ({
              index: indexOf(item.itemId),
              text: item.text,
              attachments: response.attachments
                .filter((attachment) => attachment.itemId === item.itemId)
                .map(({ uploadId, fileName, sha256 }) => ({ uploadId, fileName, sha256 })),
            })),
            submittedAt: response.submittedAt.toISOString(),
          },
  };
}
