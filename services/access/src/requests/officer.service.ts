import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, type ReadAudit } from '@adili/api-kit';
import { DATABASE, FieldCipher, withTenant } from '@adili/data-access';
import { CANNOT_IDENTIFY_DECLINE_REASON } from '@adili/events/contracts';
import { and, asc, eq, gte, ilike, inArray, lt, notInArray, or, type SQL, sql } from 'drizzle-orm';

import { commissionTenant, ownCommissionTenant, requireAccessOfficer } from '../access.js';
import { Clock } from '../clock.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import {
  DECIDED_STATUS,
  type DecisionInput,
  decisionOf,
  isDecisionRejection,
} from '../decision.js';
import {
  DirectoryClient,
  DirectoryUnavailable,
  type RosterRecordFacts,
} from '../directory/directory-client.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type UploadDownload,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { decodeCursor, encodeCursor, type Position } from '../paging.js';
import {
  badRequest,
  conflict,
  directoryUnavailable,
  documentsUnavailable,
  notFound,
  problem,
} from '../problems.js';
import { AccessRegister, type RegisterRow } from '../register/access-register.js';
import { openFormK } from './form-k.js';
import {
  type QueueItem,
  type QueuePage,
  type QueueQuery,
  type ResolveOfficerBody,
  type RosterCandidates,
} from './officer-representation.js';
import {
  type OfficerRequestView,
  type RepresentationsRow,
  toOfficerRequestView,
} from './officer-view.js';
import { AccessRequestWorkflows } from './request-workflows.js';
import type { AccessRequestRow } from './representation.js';
import {
  type AccessRequestStatus,
  accessRequests,
  CLOSED_STATUSES,
  representations,
} from './schema.js';
import { officerTimeline, registerEntriesOf } from './timeline.js';

/** Statuses in which the officer named in a request can be resolved. */
const RESOLVABLE: readonly AccessRequestStatus[] = ['submitted', 'officer-unresolved'];

/**
 * The Commission's access work on Form K requests (spec 10): the queue with its deadlines, a
 * request as the access officer reads it, and resolving the officer it names to a roster record
 * (or recording that they cannot be identified), and deciding it. The access officer acts; the Commission's
 * supervisor reads (403 on acting); anyone else, another Commission or EACC, gets 404.
 */
@Injectable()
export class OfficerService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly cipher: FieldCipher,
    private readonly register: AccessRegister,
    private readonly workflows: AccessRequestWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * One page of the Commission's queue: open requests first, earliest decision deadline first;
   * then decided and closed ones, latest deadline first (each then by id). Each says
   * whether it is late: past its deadline and neither decided nor closed. Law enforcement
   * requests join it with #264; until then `kind=lea` is an empty page.
   */
  async queue(principal: Principal, slug: string, query: QueueQuery): Promise<QueuePage> {
    const tenant = commissionTenant(principal, slug);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.kind === 'lea') return { items: [], nextCursor: null };
    const now = this.clock.now();
    const rows = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx
        .select()
        .from(accessRequests)
        .where(
          and(
            eq(accessRequests.tenant, tenant),
            query.status === undefined ? undefined : inArray(accessRequests.status, query.status),
            query.late === undefined ? undefined : lateCondition(query.late, now),
            query.search === undefined ? undefined : searchCondition(query.search),
            after === undefined ? undefined : afterPosition(after),
          ),
        )
        .orderBy(
          asc(CLOSED),
          sql`case when ${CLOSED} then null else ${accessRequests.decisionDeadlineAt} end asc`,
          sql`case when ${CLOSED} then ${accessRequests.decisionDeadlineAt} end desc`,
          asc(accessRequests.id),
        )
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toQueueItem(row, now)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              closed: isClosed(last.status),
              at: last.decisionDeadlineAt,
              id: last.id,
            })
          : null,
    };
  }

  /** A request of the caller's Commission with its Form K, representations and timeline. */
  async get(principal: Principal, requestId: string): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    const found = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      officerRecord(tx, requestId),
    );
    return this.view(notFoundIfInvisible(found));
  }

  /**
   * A short-lived link to a file the declarant attached to their representations on a request of
   * the caller's Commission (access officer or supervisor, who read the representations). 404
   * when the request is not the Commission's or the upload is not attached to it.
   */
  async representationAttachmentDownload(
    principal: Principal,
    requestId: string,
    uploadId: string,
    audit: ReadAudit,
  ): Promise<UploadDownload> {
    const tenant = ownCommissionTenant(principal);
    const found = notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
        officerRecord(tx, requestId),
      ),
    );
    const attached = found.representations?.attachments.some(
      (attachment) => attachment.uploadId === uploadId,
    );
    if (!attached) throw notFound();
    audit.resource({ tenant, subjectPersonId: found.row.resolvedPersonId });
    try {
      return await this.documents.uploadDownload(tenant, uploadId);
    } catch (error) {
      if (error instanceof UploadNotFound || error instanceof UploadNotClean) throw notFound();
      if (error instanceof DocumentsUnavailable) throw documentsUnavailable();
      throw error;
    }
  }

  /**
   * The Commission's roster records the officer named in a request may be: by personnel file
   * number or name, as the access officer searches (the request must be the Commission's).
   */
  async rosterCandidates(
    principal: Principal,
    requestId: string,
    search: string,
  ): Promise<RosterCandidates> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'search the roster for the officer a request names');
    notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
        requestRow(tx, requestId),
      ),
    );
    let found;
    try {
      found = await this.directory.searchRoster(tenant, search);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    return {
      items: found.map((record) => ({
        id: record.id,
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        designation: record.designation,
        reportingEntity: record.reportingEntityName,
        state: record.state,
        onboarded: record.personId !== null,
      })),
    };
  }

  /**
   * The access officer resolves the officer Form K Part II names (S3). To a roster record of the
   * Commission: the record and its declarant are recorded on the request, and the workflow
   * notifies the declarant (the `notified` register entry). The record must be onboarded (a
   * declarant account to notify): 400 at `rosterRecordId` otherwise, as for a record the
   * Commission does not have. To null: the officer cannot be identified, and the request closes
   * as `cannot-identify` with its register entry and event (Form M counts it declined for reason
   * `other`); the workflow tells the applicant. Once only: 409 `officer-resolved`; closed or
   * decided requests are 409 `request-closed` / `request-decided`, and one held for the
   * applicant's verification is 409 until it is verified.
   */
  async resolve(
    principal: Principal,
    requestId: string,
    body: ResolveOfficerBody,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'resolve the officer a request names');
    const context = { tenant, subject: principal.subject };

    requireResolvable(
      notFoundIfInvisible(await withTenant(this.db, context, (tx) => requestRow(tx, requestId))),
    );
    const record =
      body.rosterRecordId === null ? null : await this.onboardedRecord(tenant, body.rosterRecordId);

    const now = this.clock.now();
    const resolved = await withTenant(this.db, context, async (tx) => {
      const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
      requireResolvable(current);
      const resolution = {
        resolvedBy: principal.subject,
        resolvedAt: now,
      };
      const [updated] = await tx
        .update(accessRequests)
        .set(
          record === null
            ? { ...resolution, status: 'cannot-identify', closedAt: now }
            : {
                ...resolution,
                resolvedRosterRecordId: record.id,
                resolvedPersonId: record.personId,
                resolvedName: record.fullName,
                resolvedFileNumber: record.personnelFileNumber,
              },
        )
        .where(eq(accessRequests.id, current.id))
        .returning();
      if (!updated) throw new Error('The access request was not resolved');
      if (record === null) {
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: null,
          kind: 'cannot-identify',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
          eventData: { declineReason: CANNOT_IDENTIFY_DECLINE_REASON },
        });
      }
      return notFoundIfInvisible(await officerRecord(tx, updated.id));
    });
    await this.workflows.signal(requestId, 'resolved');
    return this.view(resolved);
  }

  /**
   * The access officer decides a request under decision (S6): grant, partial grant (a narrower
   * scope) or denial, with Regulation 24 grounds for what is refused and reasons always. The
   * decision is final: the request becomes `granted`, `partially-granted` or `denied` with the
   * `decided` register entry and its event (outcome and grounds, for Form M section 5); then the
   * workflow tells both parties and, for a grant, has the package issued. A second decision is
   * 409 `request-decided`; a closed request 409 `request-closed`; one not yet under decision
   * (the declarant's window still open, or the officer named still to be resolved) 409
   * `not-under-decision`.
   */
  async decide(
    principal: Principal,
    requestId: string,
    input: DecisionInput,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'decide a request');
    const now = this.clock.now();
    const decided = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
        requireUnderDecision(current);
        const decision = decisionOf(
          input,
          current.scope,
          { subject: principal.subject, name: principal.name ?? principal.subject },
          now,
        );
        if (isDecisionRejection(decision)) {
          const errors = [{ path: decision.path, message: decision.message }];
          const detail = `${decision.path} ${decision.message}.`;
          throw decision.code === null
            ? badRequest(detail, errors)
            : problem(decision.code, detail, errors);
        }
        const [updated] = await tx
          .update(accessRequests)
          .set({ status: DECIDED_STATUS[decision.outcome], decision })
          .where(eq(accessRequests.id, current.id))
          .returning();
        if (!updated) throw new Error('The access request was not decided');
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: updated.resolvedPersonId,
          kind: 'decided',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
          details: { outcome: decision.outcome, grantedScope: decision.grantedScope },
          eventData: { outcome: decision.outcome, grounds: decision.grounds },
        });
        return notFoundIfInvisible(await officerRecord(tx, updated.id));
      },
    );
    await this.workflows.signal(requestId, 'decided');
    return this.view(decided);
  }

  /** The roster record `recordId` of the Commission, onboarded; 400 otherwise. */
  private async onboardedRecord(
    tenant: string,
    recordId: string,
  ): Promise<RosterRecordFacts & { personId: string }> {
    let record;
    try {
      record = await this.directory.rosterRecord(tenant, recordId);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (record === null) {
      throw badRequest('No such roster record of the Commission.', [
        { path: 'rosterRecordId', message: 'is not a roster record of the Commission' },
      ]);
    }
    const { personId } = record;
    if (personId === null) {
      throw badRequest('The officer has not onboarded, so they cannot be notified.', [
        {
          path: 'rosterRecordId',
          message: 'has not onboarded: the officer has no declarant account to be notified on',
        },
      ]);
    }
    return { ...record, personId };
  }

  private async view(found: OfficerRecord): Promise<OfficerRequestView> {
    const formK = await openFormK(this.cipher, found.row);
    return toOfficerRequestView(
      found.row,
      formK,
      officerTimeline(found.entries),
      found.representations,
    );
  }
}

/** A request as the officer reads it: the row, its register entries and its representations. */
interface OfficerRecord {
  row: AccessRequestRow;
  entries: RegisterRow[];
  representations: RepresentationsRow | null;
}

async function officerRecord(
  tx: AccessTransaction,
  requestId: string,
): Promise<OfficerRecord | null> {
  const row = await requestRow(tx, requestId);
  if (!row) return null;
  const [representationsRow] = await tx
    .select()
    .from(representations)
    .where(eq(representations.requestId, row.id));
  return {
    row,
    entries: (await registerEntriesOf(tx, [row.id])).get(row.id) ?? [],
    representations: representationsRow ?? null,
  };
}

async function requestRow(
  tx: AccessTransaction,
  requestId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<AccessRequestRow | undefined> {
  const query = tx.select().from(accessRequests).where(eq(accessRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

function requireResolvable(row: AccessRequestRow): void {
  if (RESOLVABLE.includes(row.status) && row.resolvedRosterRecordId === null) return;
  if (row.status === 'granted' || row.status === 'partially-granted' || row.status === 'denied') {
    throw problem('request-decided', 'The request is decided, and a decision is final.');
  }
  if (row.status === 'withdrawn' || row.status === 'cannot-identify') {
    throw problem('request-closed', 'The request is closed already.');
  }
  if (row.status === 'pending-applicant-verification') {
    throw conflict("The applicant's identity must be verified before the officer is identified.");
  }
  throw problem('officer-resolved', 'The officer this request names is resolved already.');
}

function requireUnderDecision(row: AccessRequestRow): void {
  if (row.status === 'under-decision') return;
  if (row.status === 'granted' || row.status === 'partially-granted' || row.status === 'denied') {
    throw problem('request-decided', 'The request is decided, and a decision is final.');
  }
  if (row.status === 'withdrawn' || row.status === 'cannot-identify') {
    throw problem('request-closed', 'The request is closed.');
  }
  throw problem(
    'not-under-decision',
    "The request is not under decision yet: the declarant's window for representations has not closed.",
  );
}

/** Whether a request is decided or closed: nothing changes it but its package. */
function isClosed(status: AccessRequestStatus): boolean {
  return (CLOSED_STATUSES as readonly AccessRequestStatus[]).includes(status);
}

/** True for decided and closed requests, which the queue lists after the open ones. */
const CLOSED = sql<boolean>`(${accessRequests.status} in (${sql.join(
  CLOSED_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)}))`;

/**
 * The requests after `position` in the queue's order: open ones by earliest deadline, then
 * closed ones by latest deadline, each then by id.
 */
function afterPosition(position: Position): SQL | undefined {
  const at = sql`${position.at.toISOString()}::timestamptz`;
  const id = sql`${position.id}::uuid`;
  const deadline = accessRequests.decisionDeadlineAt;
  if (position.closed) {
    return and(
      CLOSED,
      or(
        sql`${deadline} < ${at}`,
        and(sql`${deadline} = ${at}`, sql`${accessRequests.id} > ${id}`),
      ),
    );
  }
  // After an open request: the open ones after it, then every closed one.
  return or(CLOSED, sql`(${deadline}, ${accessRequests.id}) > (${at}, ${id})`);
}

/**
 * Requests past their decision deadline and neither decided nor closed (`late`), or the others.
 * The same rule as `QueueItem.late`.
 */
function lateCondition(late: boolean, now: Date): SQL | undefined {
  const closed = [...CLOSED_STATUSES];
  return late
    ? and(notInArray(accessRequests.status, closed), lt(accessRequests.decisionDeadlineAt, now))
    : or(inArray(accessRequests.status, closed), gte(accessRequests.decisionDeadlineAt, now));
}

/**
 * The officer's search of the queue: the reference or the identified officer's personnel file
 * number by their beginning, the applicant's name, the officer Part II names or the identified
 * officer's name by any part (case-insensitive).
 */
function searchCondition(search: string): SQL | undefined {
  const text = escapeLike(search);
  return or(
    ilike(accessRequests.reference, `${text}%`),
    ilike(accessRequests.resolvedFileNumber, `${text}%`),
    ilike(accessRequests.applicantName, `%${text}%`),
    ilike(sql`${accessRequests.officerSought}->>'name'`, `%${text}%`),
    ilike(accessRequests.resolvedName, `%${text}%`),
  );
}

/** `text` with LIKE's wildcards and escape character taken literally. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toQueueItem(row: AccessRequestRow, now: Date): QueueItem {
  return {
    kind: 'form-k',
    id: row.id,
    reference: row.reference,
    applicantOrAgency: row.applicantName,
    officerSought: row.officerSought.name,
    resolvedName: row.resolvedName,
    resolvedFileNumber: row.resolvedFileNumber,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    deadlineAt: row.decisionDeadlineAt.toISOString(),
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    late: !isClosed(row.status) && now.getTime() > row.decisionDeadlineAt.getTime(),
    closedAt: row.decision?.decidedAt ?? row.closedAt?.toISOString() ?? null,
  };
}
