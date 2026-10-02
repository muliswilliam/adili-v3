import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import { DATABASE, type TenantContext, withTenant } from '@adili/data-access';
import type { AccessRequestReceivedData } from '@adili/events/contracts';
import { allocateReference, LEA } from '@adili/numbering';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { isLeaOfficer, LEA_TENANT, ownCommissionTenant, requireAccessOfficer } from '../access.js';
import { addDays, Clock, nairobiYear } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { decisionOf, type DecisionInput, isDecisionRejection } from '../decision.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type LeaOfficerFacts,
  type RosterRecordFacts,
} from '../directory/directory-client.js';
import { badRequest, directoryUnavailable, forbidden, problem } from '../problems.js';
import { AccessRegister, type RegisterRow } from '../register/access-register.js';
import type { RosterCandidates } from '../requests/officer-representation.js';
import { rosterCandidates } from '../requests/roster-candidates.js';
import { applicantTimeline, officerTimeline, registerEntriesOf } from '../requests/timeline.js';
import { LeaRequestWorkflows } from './lea-workflows.js';
import {
  type LeaRequest,
  type LeaRequestInput,
  type LeaRequestRow,
  toLeaRequest,
  type VerifyLeaRequestBody,
} from './representation.js';
import { type LeaProvenance, leaRequests } from './schema.js';

/** Who reads a request: the officer who filed it, or the Commission's access officer or supervisor. */
type Reader =
  { kind: 'lea-officer'; context: TenantContext } | { kind: 'commission'; context: TenantContext };

/**
 * Law enforcement requests (spec 10, Act s.36(2), Regs r.23): a provisioned officer of an agency
 * files a written request with its reason and case reference against a Commission (no Form K);
 * the Commission's access officer checks where it came from and why, identifies the officer
 * sought, and decides within fourteen days. The declarant hears of it only after a grant
 * (r.23(2)). The filing officer reads their own requests (row-level security on
 * `officer_subject` in the `lea` context); the Commission's access officer and supervisor read
 * the Commission's; anyone else gets 404.
 */
@Injectable()
export class LeaService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly register: AccessRegister,
    private readonly workflows: LeaRequestWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * Receives an officer's written request (S11): the account must be an active officer account
   * of an agency in the directory, the one the token was issued to (403 otherwise); the request
   * is stored with its `LEA` reference (allocated at receipt), the agency and the account's
   * provenance, its fourteen-day deadline, the `received` register entry and its event, in one
   * transaction of the Commission's context. `LeaRequestWorkflow` starts as its last step (503
   * `workflow-unavailable` and nothing stored when Temporal cannot be reached). Nobody is told:
   * the declarant only after a grant.
   */
  async submit(principal: Principal, input: LeaRequestInput): Promise<LeaRequest> {
    const personId = leaOfficerPersonId(principal);
    const commission = await this.commission(input.commission);
    const officer = await this.activeOfficer(principal, personId, commission.slug);

    const id = uuidv7();
    const now = this.clock.now();
    const deadlineAt = addDays(now, config.LEA_DECISION_DAYS);
    const { row, entry } = await withTenant(
      this.db,
      { tenant: commission.slug, subject: principal.subject },
      async (tx) => {
        const reference = await allocateReference(tx, LEA, {
          issuer: commission.issuerCode,
          period: nairobiYear(now),
        });
        const [inserted] = await tx
          .insert(leaRequests)
          .values({
            id,
            tenant: commission.slug,
            commissionName: commission.name,
            reference,
            officerSubject: principal.subject,
            officerPersonId: personId,
            officerName: officer.name,
            agencyCode: officer.agency.code,
            agencyName: officer.agency.name,
            provenance: provenanceOf(officer, now),
            officerSought: input.officerSought,
            reason: input.reason,
            caseReference: input.caseReference,
            scope: input.scope,
            status: 'received',
            receivedAt: now,
            deadlineAt,
          })
          .returning();
        if (!inserted) throw new Error('The law enforcement request was not written');
        const eventData = {
          decisionDeadlineAt: deadlineAt.toISOString(),
        } satisfies Pick<AccessRequestReceivedData, 'decisionDeadlineAt'>;
        const received = await this.register.record(tx, {
          tenant: commission.slug,
          subjectKind: 'lea-request',
          subjectId: id,
          reference,
          personId: null,
          kind: 'received',
          actor: { subject: principal.subject, name: officer.name },
          at: now,
          details: { agencyCode: officer.agency.code },
          eventData,
        });
        // Last, inside the transaction: a request never runs without its fourteen-day clock.
        await this.workflows.start({
          tenant: commission.slug,
          requestId: id,
          receivedAt: now.toISOString(),
          deadlineAt: deadlineAt.toISOString(),
        });
        return { row: inserted, entry: received };
      },
    );
    return toLeaRequest(row, applicantTimeline([entry], principal.subject));
  }

  /** The officer's own requests, latest first, across Commissions. */
  async list(principal: Principal): Promise<LeaRequest[]> {
    leaOfficerPersonId(principal);
    const context = { tenant: LEA_TENANT, subject: principal.subject };
    const { rows, entries } = await withTenant(this.db, context, async (tx) => {
      const own = await tx
        .select()
        .from(leaRequests)
        .where(eq(leaRequests.officerSubject, principal.subject))
        .orderBy(desc(leaRequests.receivedAt), desc(leaRequests.id));
      const ids = own.map((row) => row.id);
      return { rows: own, entries: await registerEntriesOf(tx, ids, 'lea-request') };
    });
    return rows.map((row) =>
      toLeaRequest(row, applicantTimeline(entries.get(row.id) ?? [], principal.subject)),
    );
  }

  /**
   * One request: the officer who filed it sees it with only their own name on its timeline; the
   * Commission's access officer and supervisor see it whole. Anyone else, another officer or
   * Commission and EACC included, gets 404.
   */
  async get(principal: Principal, requestId: string): Promise<LeaRequest> {
    const reader = readerOf(principal);
    const found = await withTenant(this.db, reader.context, (tx) =>
      leaRecord(tx, requestId, reader),
    );
    return this.view(notFoundIfInvisible(found), reader, principal);
  }

  /**
   * The Commission's roster records the officer sought may be, as the access officer searches
   * before verifying (by personnel file number or name; the request must be the Commission's).
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
        leaRow(tx, requestId),
      ),
    );
    return rosterCandidates(this.directory, tenant, search);
  }

  /**
   * The access officer verifies the request (S11, r.23(1)): they confirm it comes from the agency
   * account it shows and states its reason (the account is checked again against the directory:
   * still an active officer account of that agency, else 409), and identify the officer sought on
   * the Commission's roster (an onboarded record, whose declarant is told after a grant: 400 at
   * `rosterRecordId` otherwise). The request becomes `verified`, with the `verified` register
   * entry and its event. Once only: 409 `officer-resolved`; decided 409 `request-decided`;
   * withdrawn 409 `request-closed`.
   */
  async verify(
    principal: Principal,
    requestId: string,
    body: VerifyLeaRequestBody,
  ): Promise<LeaRequest> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'verify a law enforcement request');
    const context = { tenant, subject: principal.subject };

    const before = notFoundIfInvisible(
      await withTenant(this.db, context, (tx) => leaRow(tx, requestId)),
    );
    requireVerifiable(before);
    const record = await this.onboardedRecord(tenant, body.rosterRecordId);
    const officer = await this.officerAccount(before.officerPersonId, tenant);
    if (
      !isActiveAccount(officer, before.officerSubject) ||
      officer.agency.code !== before.agencyCode
    ) {
      throw problem(
        'lea-account-inactive',
        'The account this request came from is no longer an active officer account of its agency: deny the request instead.',
      );
    }

    const now = this.clock.now();
    const reader: Reader = { kind: 'commission', context };
    const verified = await withTenant(this.db, context, async (tx) => {
      const current = notFoundIfInvisible(await leaRow(tx, requestId, { lock: true }));
      requireVerifiable(current);
      const [updated] = await tx
        .update(leaRequests)
        .set({
          status: 'verified',
          resolvedRosterRecordId: record.id,
          resolvedPersonId: record.personId,
          resolvedName: record.fullName,
          verification: {
            by: principal.subject,
            byName: principal.name ?? principal.subject,
            at: now.toISOString(),
            note: body.note,
            provenance: provenanceOf(officer, now),
          },
        })
        .where(eq(leaRequests.id, current.id))
        .returning();
      if (!updated) throw new Error('The law enforcement request was not verified');
      await this.register.record(tx, {
        tenant,
        subjectKind: 'lea-request',
        subjectId: updated.id,
        reference: updated.reference,
        personId: updated.resolvedPersonId,
        kind: 'verified',
        actor: { subject: principal.subject, name: principal.name },
        at: now,
      });
      return notFoundIfInvisible(await leaRecord(tx, updated.id, reader));
    });
    return this.view(verified, reader, principal);
  }

  /**
   * The access officer decides (S11): grant, partial grant (a narrower scope) or denial, with
   * Regulation 24 grounds for what is refused and reasons always, as for Form K. A grant needs the
   * request verified (its officer identified): 409 `not-under-decision` before; a denial may come
   * at any point before a decision (an unidentifiable officer or a request from the wrong account
   * is denied). The decision is final: the request becomes `granted` (in full or in part) or
   * `denied`, with the `decided` register entry and its event; then the workflow tells the
   * agency's officer and, for a grant, the declarant, and issues the officer's package.
   */
  async decide(principal: Principal, requestId: string, input: DecisionInput): Promise<LeaRequest> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'decide a law enforcement request');
    const now = this.clock.now();
    const context = { tenant, subject: principal.subject };
    const reader: Reader = { kind: 'commission', context };
    const decided = await withTenant(this.db, context, async (tx) => {
      const current = notFoundIfInvisible(await leaRow(tx, requestId, { lock: true }));
      requireUndecided(current);
      if (input.outcome !== 'deny' && current.status !== 'verified') {
        throw problem(
          'not-under-decision',
          'The request is not verified yet: verify it, identifying the officer sought, before granting it.',
        );
      }
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
        .update(leaRequests)
        .set({ status: decision.outcome === 'deny' ? 'denied' : 'granted', decision })
        .where(eq(leaRequests.id, current.id))
        .returning();
      if (!updated) throw new Error('The law enforcement request was not decided');
      await this.register.record(tx, {
        tenant,
        subjectKind: 'lea-request',
        subjectId: updated.id,
        reference: updated.reference,
        personId: updated.resolvedPersonId,
        kind: 'decided',
        actor: { subject: principal.subject, name: principal.name },
        at: now,
        details: { outcome: decision.outcome, grantedScope: decision.grantedScope },
        eventData: { outcome: decision.outcome, grounds: decision.grounds },
      });
      return notFoundIfInvisible(await leaRecord(tx, updated.id, reader));
    });
    await this.workflows.signal(requestId, 'decided');
    return this.view(decided, reader, principal);
  }

  private view(found: LeaRecord, reader: Reader, principal: Principal): LeaRequest {
    const timeline =
      reader.kind === 'commission'
        ? officerTimeline(found.entries)
        : applicantTimeline(found.entries, principal.subject);
    return toLeaRequest(found.row, timeline);
  }

  /** The Commission the request names; 400 at `commission` when there is none. */
  private async commission(slug: string): Promise<CommissionFacts> {
    const unknown = () =>
      badRequest('No such Responsible Commission.', [
        { path: 'commission', message: 'is not a Responsible Commission' },
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
   * The officer behind the token, as the directory holds them: the person must be an officer
   * whose account the token was issued to and who is not revoked (403 otherwise).
   */
  private async activeOfficer(
    principal: Principal,
    personId: string,
    tenant: string,
  ): Promise<ActiveOfficer> {
    const officer = await this.officerAccount(personId, tenant);
    if (!isActiveAccount(officer, principal.subject)) {
      throw forbidden('The account is not an active law enforcement officer account.');
    }
    return officer;
  }

  private async officerAccount(personId: string, tenant: string): Promise<LeaOfficerFacts | null> {
    try {
      return await this.directory.leaOfficer(personId, tenant);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
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
}

/**
 * The law enforcement officer's person (token `person_id`): role `law-enforcement` on an account
 * of the `lea` tenant, linked to a directory person. 403 for any other account.
 */
function leaOfficerPersonId(principal: Principal): string {
  if (isLeaOfficer(principal) && principal.personId !== null) return principal.personId;
  throw forbidden('Only a provisioned law enforcement officer account can do this.');
}

function readerOf(principal: Principal): Reader {
  if (isLeaOfficer(principal)) {
    leaOfficerPersonId(principal);
    return { kind: 'lea-officer', context: { tenant: LEA_TENANT, subject: principal.subject } };
  }
  return {
    kind: 'commission',
    context: { tenant: ownCommissionTenant(principal), subject: principal.subject },
  };
}

/** An officer whose account is not revoked. */
type ActiveOfficer = LeaOfficerFacts & { state: LeaProvenance['accountState'] };

/** Whether `officer` is an officer whose account is the one `subject` signs in with, not revoked. */
function isActiveAccount(
  officer: LeaOfficerFacts | null,
  subject: string,
): officer is ActiveOfficer {
  return officer?.keycloakUserId === subject && officer.state !== 'revoked';
}

function provenanceOf(officer: ActiveOfficer, checkedAt: Date): LeaProvenance {
  return {
    accountState: officer.state,
    activatedAt: officer.activatedAt?.toISOString() ?? null,
    agencyLegalBasis: officer.agency.legalBasis,
    checkedAt: checkedAt.toISOString(),
  };
}

interface LeaRecord {
  row: LeaRequestRow;
  entries: RegisterRow[];
}

async function leaRecord(
  tx: AccessTransaction,
  requestId: string,
  reader: Reader,
): Promise<LeaRecord | null> {
  const row = await leaRow(tx, requestId, {
    officerSubject: reader.kind === 'lea-officer' ? reader.context.subject : undefined,
  });
  if (!row) return null;
  return {
    row,
    entries: (await registerEntriesOf(tx, [row.id], 'lea-request')).get(row.id) ?? [],
  };
}

async function leaRow(
  tx: AccessTransaction,
  requestId: string,
  { lock = false, officerSubject }: { lock?: boolean; officerSubject?: string } = {},
): Promise<LeaRequestRow | undefined> {
  const query = tx
    .select()
    .from(leaRequests)
    .where(
      and(
        eq(leaRequests.id, requestId),
        officerSubject === undefined ? undefined : eq(leaRequests.officerSubject, officerSubject),
      ),
    );
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

function requireUndecided(row: LeaRequestRow): void {
  if (row.status === 'granted' || row.status === 'denied') {
    throw problem('request-decided', 'The request is decided, and a decision is final.');
  }
  if (row.status === 'withdrawn') throw problem('request-closed', 'The request is closed.');
}

function requireVerifiable(row: LeaRequestRow): void {
  requireUndecided(row);
  if (row.status !== 'received' || row.resolvedRosterRecordId !== null) {
    throw problem('officer-resolved', 'The request is verified already.');
  }
}
