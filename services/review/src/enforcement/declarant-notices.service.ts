import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { asPerson, personSubject } from '../clarifications/declarant-clarifications.service.js';
import { letterDownloadUrl } from '../clarifications/links.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { withUpstream } from '../internal-api/upstream.js';
import { ACTION_RESPONDED } from './events.js';
import { clarifications } from '../cases/schema.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import {
  type ActionRow,
  type LadderRow,
  recordAction,
  REVIEW_STAFF_STEPS,
  whatToDo,
} from './ladder-records.js';
import { type DeclarantNoticeView, responseView } from './representation.js';
import {
  type ActionResponse,
  administrativeActions,
  enforcementLadders,
  ISSUED_ACTION_STATUSES,
} from './schema.js';

/** review.yaml `respondToNotice` body. */
export const noticeResponseInput = z.object({
  text: z.string().trim().min(1).max(4000),
  attachments: z.array(z.uuid()).max(10),
});
export type NoticeResponseInput = z.infer<typeof noticeResponseInput>;

/**
 * The upload purposes a response to a notice accepts: the clarification response's, reused
 * (spec 08), and a dedicated one should documents add it.
 */
export const NOTICE_ATTACHMENT_PURPOSES: readonly string[] = [
  'clarification-attachment',
  'action-response',
];

/**
 * The declarant's notices across Commissions (spec 08): the ladder's steps issued to them, read
 * under the person's row-level security (`app.person`), never another person's. A draft, or a
 * step approved but not yet sent, stays the Commission's. The declarant answers a notice or a
 * warning once; the answer does not stop the ladder's clock (the next step's approver reads it).
 */
@Injectable()
export class DeclarantNoticesService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async list(personId: string): Promise<DeclarantNoticeView[]> {
    const { rows, subjects } = await this.db.transaction(async (tx) => {
      await asPerson(tx, personId);
      const own = await tx
        .select()
        .from(administrativeActions)
        .where(ownIssued(personId))
        .orderBy(desc(administrativeActions.issuedAt));
      return { rows: own, subjects: await subjectsOf(tx, own) };
    });
    return this.views(rows, subjects);
  }

  /**
   * The declarant's one response to an issued notice or warning: text and attachments, each a
   * clean upload of the Commission for a response (verified through documents). The step becomes
   * `responded`, with the history entry and `action.responded.v1` in the same transaction.
   */
  async respond(
    personId: string,
    actionId: string,
    input: NoticeResponseInput,
  ): Promise<DeclarantNoticeView> {
    requireDistinct(input.attachments);
    const now = this.clock.now();
    const responded = await this.db.transaction(async (tx) => {
      await asPerson(tx, personId);
      const [visible] = await tx
        .select({ tenant: administrativeActions.tenant })
        .from(administrativeActions)
        .where(and(eq(administrativeActions.id, actionId), ownIssued(personId)));
      const { tenant } = notFoundIfInvisible(visible);
      // The person's own notice, found: now written as its Commission's data.
      await tx.execute(sql`select set_config('app.tenant', ${tenant}, true)`);
      const [locked] = await tx
        .select()
        .from(administrativeActions)
        .where(and(eq(administrativeActions.id, actionId), ownIssued(personId)))
        .for('update');
      const action = notFoundIfInvisible(locked);
      requireAnswerable(action);
      const response: ActionResponse = {
        text: input.text,
        attachments: await this.verifiedAttachments(tenant, personId, input.attachments),
        submittedAt: now.toISOString(),
      };
      const [updated] = await tx
        .update(administrativeActions)
        .set({ status: 'responded', response, respondedAt: now })
        .where(eq(administrativeActions.id, actionId))
        .returning();
      const row = notFoundIfInvisible(updated);
      await recordAction(tx, this.events, row, {
        kind: 'action-responded',
        type: ACTION_RESPONDED,
        actor: `person:${personId}`,
        at: now,
      });
      return { row, subjects: await subjectsOf(tx, [row]) };
    });
    const [view] = await this.views([responded.row], responded.subjects);
    return notFoundIfInvisible(view);
  }

  /** Each upload checked with documents, in the order given; the first one refused is a 409. */
  private async verifiedAttachments(
    tenant: string,
    personId: string,
    uploadIds: readonly string[],
  ): Promise<ActionResponse['attachments']> {
    const verified: ActionResponse['attachments'] = [];
    for (const uploadId of uploadIds) {
      let upload;
      try {
        upload = await withUpstream(() =>
          this.documents.getUploadDownload(uploadId, tenant, personSubject(personId)),
        );
      } catch (error) {
        if (error instanceof InternalApiRejected) throw attachmentRefused(uploadId, 'not-clean');
        throw error;
      }
      if (!upload || !NOTICE_ATTACHMENT_PURPOSES.includes(upload.purpose)) {
        throw attachmentRefused(uploadId, 'not-accepted');
      }
      verified.push({ uploadId, fileName: upload.fileName ?? uploadId, sha256: upload.sha256 });
    }
    return verified;
  }

  /** Adds each Commission's name, read from the directory once per Commission. */
  private async views(
    rows: ActionRow[],
    subjects: ReadonlyMap<string, NoticeSubject>,
  ): Promise<DeclarantNoticeView[]> {
    const names = new Map<string, string>();
    for (const tenant of new Set(rows.map((row) => row.tenant))) {
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      names.set(tenant, commission.name);
    }
    return rows.flatMap((row) => {
      const subject = subjects.get(row.ladderId);
      return row.reference === null || row.issuedAt === null || subject === undefined
        ? []
        : [
            {
              actionId: row.id,
              ladderId: row.ladderId,
              subject,
              windowDays:
                row.windowEndsAt === null
                  ? null
                  : Math.max(
                      1,
                      Math.round((row.windowEndsAt.getTime() - row.issuedAt.getTime()) / DAY_MS),
                    ),
              commission: { slug: row.tenant, name: names.get(row.tenant) ?? row.tenant },
              step: row.step,
              status: row.status,
              issuedAt: row.issuedAt.toISOString(),
              actBy: row.windowEndsAt?.toISOString() ?? null,
              whatToDo: whatToDo(row),
              reference: row.reference,
              letterDownloadUrl:
                row.letterDocumentId === null ? null : letterDownloadUrl(row.letterDocumentId),
              response: responseView(row),
              salaryStoppedAt: row.salaryStoppedAt?.toISOString() ?? null,
              salaryReinstatedAt: row.salaryReinstatedAt?.toISOString() ?? null,
            },
          ];
    });
  }
}

const DAY_MS = 86_400_000;

type NoticeSubject = DeclarantNoticeView['subject'];

/**
 * The subject of each ladder the person's steps belong to, by ladder id: its kind and reference,
 * and for a clarification when its response was due. The ladders are their Commission's records
 * (no person policy), so each Commission's are read under its tenant, by the ids of steps the
 * person may see; the clarifications under the person's own policy.
 */
async function subjectsOf(
  tx: ReviewTransaction,
  rows: readonly ActionRow[],
): Promise<Map<string, NoticeSubject>> {
  const subjects = new Map<string, NoticeSubject>();
  const byTenant = new Map<string, Set<string>>();
  for (const row of rows) {
    byTenant.set(row.tenant, (byTenant.get(row.tenant) ?? new Set()).add(row.ladderId));
  }
  const ladders: {
    id: string;
    kind: LadderRow['subjectKind'];
    subjectId: string;
    reference: string;
  }[] = [];
  for (const [tenant, ids] of byTenant) {
    await tx.execute(sql`select set_config('app.tenant', ${tenant}, true)`);
    ladders.push(
      ...(await tx
        .select({
          id: enforcementLadders.id,
          kind: enforcementLadders.subjectKind,
          subjectId: enforcementLadders.subjectId,
          reference: enforcementLadders.subjectReference,
        })
        .from(enforcementLadders)
        .where(
          and(eq(enforcementLadders.tenant, tenant), inArray(enforcementLadders.id, [...ids])),
        )),
    );
  }
  await tx.execute(sql`select set_config('app.tenant', '', true)`);
  const clarificationIds = ladders.flatMap((ladder) =>
    ladder.kind === 'clarification' ? [ladder.subjectId] : [],
  );
  const due = new Map(
    clarificationIds.length === 0
      ? []
      : (
          await tx
            .select({ id: clarifications.id, dueAt: clarifications.dueAt })
            .from(clarifications)
            .where(inArray(clarifications.id, clarificationIds))
        ).map((each) => [each.id, each.dueAt] as const),
  );
  for (const ladder of ladders) {
    subjects.set(ladder.id, {
      kind: ladder.kind,
      reference: ladder.reference,
      dueAt:
        ladder.kind === 'clarification' ? (due.get(ladder.subjectId)?.toISOString() ?? null) : null,
    });
  }
  return subjects;
}

/** The person's own steps that have gone to them. */
function ownIssued(personId: string) {
  return and(
    eq(administrativeActions.personId, personId),
    inArray(administrativeActions.status, ISSUED_ACTION_STATUSES),
    isNotNull(administrativeActions.issuedAt),
  );
}

/** Only an issued notice or warning, not yet answered, takes a response. */
function requireAnswerable(action: ActionRow): void {
  if (action.status === 'issued' && REVIEW_STAFF_STEPS.includes(action.step)) return;
  const responded = action.status === 'responded';
  throw new ProblemException(
    {
      type: responded ? 'already-responded' : 'notice-closed',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: responded
        ? 'You have already responded to this notice; a notice takes one response.'
        : `The notice is ${action.status}; it no longer takes a response.`,
    },
    { code: responded ? 'already-responded' : 'notice-closed' },
  );
}

/** An upload is attached once; anything else fails validation (400). */
function requireDistinct(uploadIds: readonly string[]): void {
  const seen = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  uploadIds.forEach((uploadId, at) => {
    if (seen.has(uploadId)) {
      errors.push({ path: `attachments.${String(at)}`, message: 'Upload attached twice' });
    }
    seen.add(uploadId);
  });
  if (errors.length === 0) return;
  throw new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors,
  });
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
          : 'An attachment is not an upload for a response.',
    },
    { code, uploadId },
  );
}
