import { Inject, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, type ReadAudit } from '@adili/api-kit';
import { DATABASE, FieldCipher, withTenant } from '@adili/data-access';
import { CANNOT_IDENTIFY_DECLINE_REASON } from '@adili/events/contracts';
import { and, eq, gte, ilike, inArray, lt, not, or, type SQL, sql } from 'drizzle-orm';

import {
  accessOfficerName,
  commissionTenant,
  ownCommissionTenant,
  requireAccessOfficer,
} from '../access.js';
import { Clock } from '../clock.js';
import { accessPolicyOf } from '../commissions/responsible-commission.js';
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
import type { LeaRequestRow } from '../lea/representation.js';
import type { RepresentationsInput } from '../notices/representation.js';
import { windowOpen } from '../notices/representation.js';
import {
  LEA_OPEN_STATUSES,
  LEA_REQUEST_STATUSES,
  type LeaRequestStatus,
  leaRequests,
} from '../lea/schema.js';
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
  queueOrder,
  type QueueColumns,
} from '../paging.js';
import {
  badRequest,
  conflict,
  directoryUnavailable,
  documentsUnavailable,
  notFound,
  problem,
} from '../problems.js';
import { AccessRegister, type RegisterRow } from '../register/access-register.js';
import {
  requireNoticeDay,
  type WrittenNoticeBody,
  writtenNoticeOf,
  writtenNoticeWindow,
} from '../written-notice.js';
import { openFormK } from './form-k.js';
import {
  type QueueItem,
  type QueuePage,
  type QueueQuery,
  type ResolveOfficerBody,
  type RosterCandidates,
  statusesOfKind,
} from './officer-representation.js';
import { rosterCandidates } from './roster-candidates.js';
import {
  type OfficerRequestView,
  type RepresentationsRow,
  representationWindowDays,
  toOfficerRequestView,
} from './officer-view.js';
import { AccessRequestWorkflows } from './request-workflows.js';
import type { AccessRequestRow } from './representation.js';
import {
  ACCESS_REQUEST_STATUSES,
  type AccessRequestStatus,
  accessRequests,
  CLOSED_STATUSES,
  representations,
} from './schema.js';
import {
  cleanAttachments,
  linkUploads,
  releasedUploads,
  releaseUploads,
} from './representation-attachments.js';
import { requestRow } from './request-row.js';
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
  private readonly logger = new Logger(OfficerService.name);

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
   * One page of the Commission's queue, Form K and law enforcement requests together (or one
   * kind, by `kind`): open requests first, earliest decision deadline first; then decided and
   * closed ones, latest deadline first (each then by id). Each says whether it is late: past its
   * deadline and neither decided nor closed.
   */
  async queue(principal: Principal, slug: string, query: QueueQuery): Promise<QueuePage> {
    const tenant = commissionTenant(principal, slug);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const formKStatuses =
      query.status === undefined
        ? undefined
        : statusesOfKind(query.status, ACCESS_REQUEST_STATUSES);
    const leaStatuses =
      query.status === undefined ? undefined : statusesOfKind(query.status, LEA_REQUEST_STATUSES);
    const wantFormK = query.kind !== 'lea' && formKStatuses?.length !== 0;
    const wantLea = query.kind !== 'form-k' && leaStatuses?.length !== 0;
    const now = this.clock.now();
    const filtered = (queue: QueueColumns, search: (text: string) => SQL | undefined) =>
      and(
        query.late === undefined ? undefined : lateCondition(queue, query.late, now),
        query.search === undefined ? undefined : search(escapeLike(query.search)),
        after === undefined ? undefined : afterPosition(queue, after),
      );
    const entries = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        // Each kind's first `limit + 1` after the cursor, merged: the page is among them.
        const formK = wantFormK
          ? await tx
              .select()
              .from(accessRequests)
              .where(
                and(
                  eq(accessRequests.tenant, tenant),
                  formKStatuses === undefined
                    ? undefined
                    : inArray(accessRequests.status, formKStatuses),
                  filtered(FORM_K_QUEUE, formKSearch),
                ),
              )
              .orderBy(...queueOrder(FORM_K_QUEUE))
              .limit(query.limit + 1)
          : [];
        const lea = wantLea
          ? await tx
              .select()
              .from(leaRequests)
              .where(
                and(
                  eq(leaRequests.tenant, tenant),
                  leaStatuses === undefined ? undefined : inArray(leaRequests.status, leaStatuses),
                  filtered(LEA_QUEUE, leaSearch),
                ),
              )
              .orderBy(...queueOrder(LEA_QUEUE))
              .limit(query.limit + 1)
          : [];
        return [
          ...formK.map((row) => ({
            item: toQueueItem(row, now),
            closed: isClosed(row.status),
            formKRow: row,
          })),
          ...lea.map((row) => ({
            item: leaQueueItem(row, now),
            closed: isLeaClosed(row.status),
            formKRow: null,
          })),
        ].sort(compareQueueEntries);
      },
    );
    const page = entries.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await Promise.all(
        page.map(async (entry) =>
          entry.formKRow
            ? {
                ...entry.item,
                applicantOccupation: (await openFormK(this.cipher, entry.formKRow)).partI
                  .occupation,
              }
            : entry.item,
        ),
      ),
      nextCursor:
        entries.length > query.limit && last
          ? encodeCursor({
              closed: last.closed,
              at: new Date(last.item.deadlineAt),
              id: last.item.id,
            })
          : null,
    };
  }

  /** A request of the caller's Commission with its Form K, representations and timeline. */
  async get(
    principal: Principal,
    requestId: string,
    audit: ReadAudit,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    const found = notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
        officerRecord(tx, requestId),
      ),
    );
    audit.resource({ tenant, subjectPersonId: found.row.resolvedPersonId });
    return this.view(found);
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
    audit: ReadAudit,
  ): Promise<RosterCandidates> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'search the roster for the officer a request names');
    notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
        requestRow(tx, requestId),
      ),
    );
    return rosterCandidates(this.directory, tenant, search, audit);
  }

  /**
   * The access officer resolves the officer Form K Part II names (S3). To a roster record of the
   * Commission: the record and its declarant are recorded on the request, and the workflow
   * notifies the declarant (the `notified` register entry). A record whose officer has not
   * onboarded is taken too (spec 10 decision 2): the request keeps the record and no declarant
   * until they onboard; the workflow invites them to, and the access officer serves the notice in
   * writing and records it (`recordWrittenNotice`). A record the Commission does not have is 400
   * at `rosterRecordId`. To null: the officer cannot be identified, and the request closes
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
      body.rosterRecordId === null ? null : await this.rosterRecord(tenant, body.rosterRecordId);

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
      if (record !== null) {
        // Who identified the declarant, and as which record (with no person yet when its
        // officer has not onboarded); the `notified` entry follows from the workflow, or from the
        // access officer's record of the written notice.
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: record.personId,
          kind: 'identified',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
          details: { rosterRecordId: record.id, onboarded: record.personId !== null },
          eventData: { rosterRecordId: record.id },
        });
      } else {
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
   * The access officer records the written notice served on a declarant who has no account
   * (spec 10 decision 2, r.22(2)): the day it was served, not in the future and not before the
   * officer was identified (400 at `notifiedOn` otherwise). The request becomes
   * `awaiting-representations`, notified from the start of that day, with the window ending
   * the Commission's representation window (its policy in force) after it (the day of service
   * not counted), and the `notified`
   * register entry and event (channel `written`, the access officer its actor); the workflow
   * then holds the window (closing it at once when it has passed). Only for a request resolved
   * to an officer with no account and not yet notified: 409 `declarant-notified` once notified
   * (online or in writing), 409 when the officer is unidentified or has an account (notified
   * online), `request-decided` / `request-closed` as for the other steps.
   */
  async recordWrittenNotice(
    principal: Principal,
    requestId: string,
    body: WrittenNoticeBody,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'record a written notice');
    // The window is the Commission's in force as it opens: the request keeps it.
    const { representationWindowDays } = await accessPolicyOf(this.directory, tenant);
    const now = this.clock.now();
    const recorded = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
        requireAwaitingNotice(current);
        if (current.resolvedAt === null) throw new Error('A resolved request has no resolvedAt');
        requireNoticeDay(
          body.notifiedOn,
          { at: current.resolvedAt, what: 'the officer was identified' },
          now,
        );
        const { notifiedAt, windowEndsAt } = writtenNoticeWindow(
          body.notifiedOn,
          representationWindowDays,
        );
        const [updated] = await tx
          .update(accessRequests)
          .set({
            status: 'awaiting-representations',
            notifiedAt,
            windowEndsAt,
            writtenNotice: writtenNoticeOf(
              body.notifiedOn,
              { subject: principal.subject, name: accessOfficerName(principal) },
              now,
            ),
          })
          .where(eq(accessRequests.id, current.id))
          .returning();
        if (!updated) throw new Error('The written notice was not recorded');
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: updated.resolvedPersonId,
          kind: 'notified',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
          details: {
            channel: 'written',
            notifiedOn: body.notifiedOn,
            windowEndsAt: windowEndsAt.toISOString(),
          },
          eventData: {
            channel: 'written',
            notifiedOn: body.notifiedOn,
            windowEndsAt: windowEndsAt.toISOString(),
          },
        });
        return notFoundIfInvisible(await officerRecord(tx, updated.id));
      },
    );
    await this.workflows.signal(requestId, 'notified');
    return this.view(recorded);
  }

  /**
   * The access officer records the decision served in writing on a declarant who has no account
   * (spec 10 decision 2, as the notice of the request was: the decision is communicated to both
   * parties, and a declarant with no account cannot be told online): the day it was served, not
   * in the future and not before the decision (400 at `notifiedOn`). Recorded on the request
   * with the `decision-notified` register entry and event (channel `written`, the access officer
   * its actor). Only on a decided request (409 `not-under-decision` before, `request-closed`
   * for a withdrawn or unidentified one), once (409 `declarant-notified`), and not for a
   * declarant with an account (409: told online).
   */
  async recordDecisionWrittenNotice(
    principal: Principal,
    requestId: string,
    body: WrittenNoticeBody,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'record a written notice');
    const now = this.clock.now();
    const recorded = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
        const decidedAt = requireDecisionAwaitingNotice(current);
        requireNoticeDay(body.notifiedOn, { at: decidedAt, what: 'the decision' }, now);
        const [updated] = await tx
          .update(accessRequests)
          .set({
            decisionWrittenNotice: writtenNoticeOf(
              body.notifiedOn,
              { subject: principal.subject, name: accessOfficerName(principal) },
              now,
            ),
          })
          .where(eq(accessRequests.id, current.id))
          .returning();
        if (!updated) throw new Error('The written notice of the decision was not recorded');
        const facts = { channel: 'written' as const, notifiedOn: body.notifiedOn };
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: updated.resolvedPersonId,
          kind: 'decision-notified',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
          details: facts,
          eventData: facts,
        });
        return notFoundIfInvisible(await officerRecord(tx, updated.id));
      },
    );
    return this.view(recorded);
  }

  /**
   * The access officer enters the representations a declarant served in writing made on paper
   * (spec 10 decision 2), on their behalf: stance, text and the letter's scans (clean uploads
   * of purpose `access-representation` the officer made, or ones attached already; 400 at
   * `attachments.<n>` otherwise). Shown to everyone who reads them as received in writing, with
   * the officer recorded as who entered them. The same window rules as the declarant's own: 409
   * `representations-closed` after it; and only on a request notified in writing (409 when the
   * declarant was notified online, and makes their own). Each save is a `representations`
   * register entry and event (`receivedInWriting`); `consent` sends the request `under-decision`
   * at once.
   */
  async enterRepresentations(
    principal: Principal,
    requestId: string,
    input: RepresentationsInput,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'enter representations received in writing');
    const context = { tenant, subject: principal.subject };
    const before = notFoundIfInvisible(
      await withTenant(this.db, context, (tx) => officerRecord(tx, requestId)),
    );
    requireWrittenWindowOpen(before.row, this.clock.now());
    const attachments = await cleanAttachments(
      this.documents,
      tenant,
      input.attachments,
      principal.subject,
      before.representations?.attachments ?? [],
    );
    await linkUploads(this.documents, tenant, input.attachments);

    const { saved, released } = await withTenant(this.db, context, async (tx) => {
      const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
      const now = this.clock.now();
      requireWrittenWindowOpen(current, now);
      const [previous] = await tx
        .select()
        .from(representations)
        .where(eq(representations.requestId, current.id))
        .for('update');
      const values = {
        personId: current.resolvedPersonId,
        stance: input.stance,
        text: input.text,
        attachments,
        receivedInWriting: true,
        recordedBy: principal.subject,
        recordedByName: accessOfficerName(principal),
      };
      await tx
        .insert(representations)
        .values({ requestId: current.id, tenant, ...values, submittedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: representations.requestId,
          set: { ...values, updatedAt: now },
        });
      if (input.stance === 'consent') {
        await tx
          .update(accessRequests)
          .set({ status: 'under-decision' })
          .where(eq(accessRequests.id, current.id));
      }
      await this.register.record(tx, {
        tenant,
        subjectKind: 'access-request',
        subjectId: current.id,
        reference: current.reference,
        personId: current.resolvedPersonId,
        kind: 'representations',
        actor: { subject: principal.subject, name: principal.name },
        at: now,
        details: {
          stance: input.stance,
          attachments: attachments.length,
          amended: previous !== undefined,
          receivedInWriting: true,
        },
        eventData: { receivedInWriting: true },
      });
      return {
        saved: notFoundIfInvisible(await officerRecord(tx, current.id)),
        released: releasedUploads(previous?.attachments ?? [], input.attachments),
      };
    });

    await releaseUploads(this.documents, this.logger, tenant, released);
    if (input.stance === 'consent') await this.workflows.signal(requestId, 'consented');
    return this.view(saved);
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
          { subject: principal.subject, name: accessOfficerName(principal) },
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

  /** The roster record `recordId` of the Commission, onboarded or not; 400 otherwise. */
  private async rosterRecord(tenant: string, recordId: string): Promise<RosterRecordFacts> {
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
    return record;
  }

  private async view(found: OfficerRecord): Promise<OfficerRequestView> {
    const [formK, windowDays] = await Promise.all([
      openFormK(this.cipher, found.row),
      found.row.notifiedAt === null
        ? representationWindowDays(this.directory, found.row.tenant)
        : null,
    ]);
    return toOfficerRequestView(
      found.row,
      formK,
      officerTimeline(found.entries),
      found.representations,
      windowDays,
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

/**
 * A request resolved to an officer with no account, not yet notified: what a written notice is
 * recorded on.
 */
function requireAwaitingNotice(row: AccessRequestRow): void {
  requireOpenRequest(row);
  if (row.notifiedAt !== null) {
    throw problem('declarant-notified', 'The declarant is notified of this request already.');
  }
  if (row.resolvedRosterRecordId === null || row.status === 'pending-applicant-verification') {
    throw conflict('Identify the officer the request names before recording a notice.');
  }
  if (row.resolvedPersonId !== null) {
    throw conflict('The declarant has an account: they are notified online.');
  }
}

/**
 * A decided request whose declarant has no account and has not been served the decision in
 * writing yet: what a written notice of the decision is recorded on. Its decision's time.
 */
function requireDecisionAwaitingNotice(row: AccessRequestRow): Date {
  if (row.status === 'withdrawn' || row.status === 'cannot-identify') {
    throw problem('request-closed', 'The request is closed.');
  }
  if (row.decision === null) {
    throw problem('not-under-decision', 'The request is not decided yet.');
  }
  if (row.decisionWrittenNotice !== null) {
    throw problem('declarant-notified', 'The declarant is told this decision already.');
  }
  if (row.resolvedPersonId !== null) {
    throw conflict('The declarant has an account: they are told the decision online.');
  }
  return new Date(row.decision.decidedAt);
}

/**
 * A request notified in writing whose window for representations is open at `now`: what the
 * access officer enters representations received in writing on.
 */
function requireWrittenWindowOpen(row: AccessRequestRow, now: Date): void {
  requireOpenRequest(row);
  if (row.notifiedAt !== null && row.writtenNotice === null) {
    throw conflict('The declarant was notified online: they make their own representations.');
  }
  if (!windowOpen(row, now)) {
    throw problem(
      'representations-closed',
      'The window for representations on this request is closed (or not open yet).',
    );
  }
}

/** 409 for a decided or closed request. */
function requireOpenRequest(row: AccessRequestRow): void {
  if (row.status === 'granted' || row.status === 'partially-granted' || row.status === 'denied') {
    throw problem('request-decided', 'The request is decided, and a decision is final.');
  }
  if (row.status === 'withdrawn' || row.status === 'cannot-identify') {
    throw problem('request-closed', 'The request is closed.');
  }
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

function leaQueueItem(row: LeaRequestRow, now: Date): QueueItem {
  return {
    kind: 'lea',
    id: row.id,
    reference: row.reference,
    applicantOrAgency: row.agencyName,
    officerSought: row.officerSought.name,
    resolvedName: row.resolvedName,
    resolvedFileNumber: null,
    status: row.status,
    submittedAt: row.receivedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    windowEndsAt: null,
    late: !isLeaClosed(row.status) && now.getTime() > row.deadlineAt.getTime(),
    closedAt: row.decision?.decidedAt ?? row.closedAt?.toISOString() ?? null,
  };
}

/** Whether a request is decided or closed: nothing changes it but its package. */
function isClosed(status: AccessRequestStatus): boolean {
  return (CLOSED_STATUSES as readonly AccessRequestStatus[]).includes(status);
}

/** Whether a law enforcement request is decided or withdrawn: no longer open. */
function isLeaClosed(status: LeaRequestStatus): boolean {
  return !(LEA_OPEN_STATUSES as readonly LeaRequestStatus[]).includes(status);
}

const FORM_K_QUEUE: QueueColumns = {
  closed: sql<boolean>`(${accessRequests.status} in (${sql.join(
    CLOSED_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  )}))`,
  deadline: accessRequests.decisionDeadlineAt,
  id: accessRequests.id,
};

const LEA_QUEUE: QueueColumns = {
  closed: sql<boolean>`(${leaRequests.status} not in (${sql.join(
    LEA_OPEN_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  )}))`,
  deadline: leaRequests.deadlineAt,
  id: leaRequests.id,
};

/** `queueOrder` for rows of both kinds, merged in memory. */
function compareQueueEntries(
  a: { item: QueueItem; closed: boolean },
  b: { item: QueueItem; closed: boolean },
): number {
  if (a.closed !== b.closed) return a.closed ? 1 : -1;
  const byDeadline = new Date(a.item.deadlineAt).getTime() - new Date(b.item.deadlineAt).getTime();
  if (byDeadline !== 0) return a.closed ? -byDeadline : byDeadline;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/**
 * Requests past their decision deadline and neither decided nor closed (`late`), or the others.
 * The same rule as `QueueItem.late`.
 */
function lateCondition(
  { closed, deadline }: QueueColumns,
  late: boolean,
  now: Date,
): SQL | undefined {
  return late ? and(not(closed), lt(deadline, now)) : or(closed, gte(deadline, now));
}

/**
 * The officer's search of Form K requests (`text` LIKE-escaped): the reference or the identified
 * officer's personnel file number by their beginning, the applicant's name, the officer Part II
 * names or the identified officer's name by any part (case-insensitive).
 */
function formKSearch(text: string): SQL | undefined {
  return or(
    ilike(accessRequests.reference, `${text}%`),
    ilike(accessRequests.resolvedFileNumber, `${text}%`),
    ilike(accessRequests.applicantName, `%${text}%`),
    ilike(sql`${accessRequests.officerSought}->>'name'`, `%${text}%`),
    ilike(accessRequests.resolvedName, `%${text}%`),
  );
}

/**
 * The same search of law enforcement requests: the reference by its beginning, the agency's
 * name, the officer sought or the identified officer's name by any part.
 */
function leaSearch(text: string): SQL | undefined {
  return or(
    ilike(leaRequests.reference, `${text}%`),
    ilike(leaRequests.agencyName, `%${text}%`),
    ilike(sql`${leaRequests.officerSought}->>'name'`, `%${text}%`),
    ilike(leaRequests.resolvedName, `%${text}%`),
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
