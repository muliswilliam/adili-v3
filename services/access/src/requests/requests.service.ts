import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, switchTenant, withPerson, withTenant } from '@adili/data-access';
import type { AccessRequestReceivedData } from '@adili/events/contracts';
import { validateFormK } from '@adili/forms';
import { allocateReference, ARQ } from '@adili/numbering';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { applicantPersonId } from '../access.js';
import { addDays, Clock, nairobiYear } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import {
  type ApplicantIdentityStatus,
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';
import { badRequest, directoryUnavailable, problem } from '../problems.js';
import { AccessRegister, type RegisterRow } from '../register/access-register.js';
import { openFormK, sealFormK, withoutMeta } from './form-k.js';
import { type AccessRequest, type AccessRequestRow, toAccessRequest } from './representation.js';
import { type AccessRequestStatus, accessRequests } from './schema.js';
import { applicantTimeline, registerEntriesOf } from './timeline.js';

/** Statuses a request can be withdrawn from: every one before a decision (S8). */
const WITHDRAWABLE: readonly AccessRequestStatus[] = [
  'submitted',
  'pending-applicant-verification',
  'officer-unresolved',
  'awaiting-representations',
  'under-decision',
];

/** Decided: a decision is final, so the request can no longer be withdrawn. */
const DECIDED: readonly AccessRequestStatus[] = ['granted', 'partially-granted', 'denied'];

/**
 * Form K access requests (spec 10, Act s.36(1), Regs r.22): what applicants file, read and
 * withdraw. An applicant reads only their own (row-level security on `applicant_person_id`);
 * anyone else's is 404, as if it did not exist.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly cipher: FieldCipher,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Receives a Form K (S2): validates it against `form-k.v1` (400 with the paths at fault),
   * allocates its `ARQ` reference at receipt (the acknowledgement is the legal act of receipt)
   * and stores it with the encrypted document, the `received` register entry and its event, all
   * in one transaction of the Commission's context. The request is `submitted`, or
   * `pending-applicant-verification` while the directory holds the applicant's identity as
   * pending (a passport holder no access officer has verified yet). The acknowledgement goes out
   * from the event (`AcknowledgementService`), so it is sent even if this process dies now.
   */
  async submit(principal: Principal, body: unknown): Promise<AccessRequest> {
    const personId = applicantPersonId(principal);
    const validated = validateFormK(body);
    if (!validated.ok) {
      throw badRequest('The document is not a valid Form K.', validated.errors);
    }
    const formK = withoutMeta(validated.value);
    const commission = await this.commission(formK.responsibleCommission);
    const identityStatus = await this.identityStatus(personId, commission.slug);

    const id = uuidv7();
    const now = this.clock.now();
    const decisionDeadlineAt = addDays(now, config.ACCESS_DECISION_DAYS);
    // Sealed before the transaction: the reference counter stays locked only for the inserts.
    const sealed = await sealFormK(this.cipher, commission.slug, id, formK);
    const applicant = { subject: principal.subject, name: formK.partI.name };

    const { row, entry } = await withTenant(
      this.db,
      { tenant: commission.slug, subject: principal.subject },
      async (tx) => {
        const reference = await allocateReference(tx, ARQ, {
          issuer: commission.issuerCode,
          period: nairobiYear(now),
        });
        const [inserted] = await tx
          .insert(accessRequests)
          .values({
            id,
            tenant: commission.slug,
            commissionName: commission.name,
            reference,
            applicantPersonId: personId,
            applicantSubject: principal.subject,
            applicantName: formK.partI.name,
            applicantIdentityStatus: identityStatus,
            ...sealed,
            officerSought: {
              name: formK.partII.name,
              entity: formK.partII.entity,
              workStation: formK.partII.workStation,
              ...(formK.partII.personnelFileNumber === undefined
                ? {}
                : { personnelFileNumber: formK.partII.personnelFileNumber }),
            },
            scope: formK.scope,
            status: identityStatus === 'verified' ? 'submitted' : 'pending-applicant-verification',
            submittedAt: now,
            decisionDeadlineAt,
          })
          .returning();
        if (!inserted) throw new Error('The access request was not written');
        const eventData = {
          decisionDeadlineAt: decisionDeadlineAt.toISOString(),
        } satisfies Pick<AccessRequestReceivedData, 'decisionDeadlineAt'>;
        const received = await this.register.record(tx, {
          tenant: commission.slug,
          subjectKind: 'access-request',
          subjectId: id,
          reference,
          personId: null,
          kind: 'received',
          actor: applicant,
          at: now,
          eventData,
        });
        return { row: inserted, entry: received };
      },
    );

    return toAccessRequest(
      row,
      { ...formK, meta: { reference: row.reference, submittedAt: row.submittedAt.toISOString() } },
      applicantTimeline([entry], principal.subject),
    );
  }

  /** The applicant's own requests, latest first. */
  async list(principal: Principal): Promise<AccessRequest[]> {
    const personId = applicantPersonId(principal);
    const { rows, entries } = await withPerson(
      this.db,
      { personId, subject: principal.subject },
      async (tx) => {
        const own = await tx
          .select()
          .from(accessRequests)
          .where(eq(accessRequests.applicantPersonId, personId))
          .orderBy(desc(accessRequests.submittedAt), desc(accessRequests.id));
        return {
          rows: own,
          entries: await registerEntriesOf(
            tx,
            own.map((row) => row.id),
          ),
        };
      },
    );
    return Promise.all(rows.map((row) => this.applicantView(row, entries.get(row.id) ?? [])));
  }

  /** One of the applicant's own requests; 404 for anyone else's, or none. */
  async get(principal: Principal, requestId: string): Promise<AccessRequest> {
    const personId = applicantPersonId(principal);
    const found = await withPerson(
      this.db,
      { personId, subject: principal.subject },
      async (tx) => {
        const row = await ownRequest(tx, personId, requestId);
        if (!row) return null;
        return { row, entries: (await registerEntriesOf(tx, [row.id])).get(row.id) ?? [] };
      },
    );
    const { row, entries } = notFoundIfInvisible(found);
    return this.applicantView(row, entries);
  }

  /**
   * The applicant withdraws their request before a decision (S8): `withdrawn`, with its register
   * entry and event, in the Commission's context. Decided: 409 `request-decided` (a decision is
   * final); closed already (withdrawn, or the officer named could not be identified): 409
   * `request-closed`.
   */
  async withdraw(principal: Principal, requestId: string): Promise<AccessRequest> {
    const personId = applicantPersonId(principal);
    const now = this.clock.now();
    const { row, entries } = await withPerson(
      this.db,
      { personId, subject: principal.subject },
      async (tx) => {
        // The applicant's own request, found through the person axis; the withdrawal is then
        // recorded in the Commission's context, where the request and its register belong.
        const own = notFoundIfInvisible(await ownRequest(tx, personId, requestId));
        await switchTenant(tx, { tenant: own.tenant, subject: principal.subject });
        const [locked] = await tx
          .select()
          .from(accessRequests)
          .where(eq(accessRequests.id, own.id))
          .for('update');
        const current = notFoundIfInvisible(locked);
        if (DECIDED.includes(current.status)) {
          throw problem('request-decided', 'The request is decided, and a decision is final.');
        }
        if (!WITHDRAWABLE.includes(current.status)) {
          throw problem('request-closed', 'The request is closed already.');
        }
        const [updated] = await tx
          .update(accessRequests)
          .set({ status: 'withdrawn' })
          .where(eq(accessRequests.id, current.id))
          .returning();
        if (!updated) throw new Error('The access request was not withdrawn');
        await this.register.record(tx, {
          tenant: updated.tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: updated.resolvedPersonId,
          kind: 'withdrawn',
          actor: { subject: principal.subject, name: updated.applicantName },
          at: now,
        });
        return {
          row: updated,
          entries: (await registerEntriesOf(tx, [updated.id])).get(updated.id) ?? [],
        };
      },
    );
    return this.applicantView(row, entries);
  }

  private async applicantView(
    row: AccessRequestRow,
    entries: readonly RegisterRow[],
  ): Promise<AccessRequest> {
    const formK = await openFormK(this.cipher, row);
    return toAccessRequest(row, formK, applicantTimeline(entries, row.applicantSubject));
  }

  /** The Responsible Commission Form K names; 400 at `responsibleCommission` when there is none. */
  private async commission(slug: string): Promise<CommissionFacts> {
    const unknown = () =>
      badRequest('The document is not a valid Form K.', [
        { path: 'responsibleCommission', message: 'is not a Responsible Commission' },
      ]);
    if (slug === PLATFORM_TENANT) throw unknown();
    try {
      const commission = await this.directory.findCommission(slug);
      if (commission === null) throw unknown();
      return commission;
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
  }

  /**
   * The applicant's identity status as the directory holds it now (not as the token says: a
   * verification counts at once). An account with no applicant person behind it has not
   * finished onboarding: 403 `no-applicant-record`.
   */
  private async identityStatus(personId: string, tenant: string): Promise<ApplicantIdentityStatus> {
    let applicant;
    try {
      applicant = await this.directory.applicant(personId, tenant);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (applicant === null) {
      throw problem('no-applicant-record', 'The account has no applicant record.');
    }
    return applicant.identityStatus;
  }
}

/** The applicant's own request `requestId`, as their person context sees it. */
async function ownRequest(
  tx: AccessTransaction,
  personId: string,
  requestId: string,
): Promise<AccessRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(accessRequests)
    .where(and(eq(accessRequests.id, requestId), eq(accessRequests.applicantPersonId, personId)));
  return row;
}
