import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE, withTenant } from '@adili/data-access';
import { ACCESS_OFFICER } from '@adili/roles';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  invariantBroken,
  requireTransactionEnded,
  rethrowAsActivityFailure,
} from '../activity-failures.js';
import { Clock, nairobiDate } from '../clock.js';
import type { AccessDatabase } from '../db/database.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { type AccessPackagePayload, DocumentsClient } from '../documents/documents-client.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { AccessRegister } from '../register/access-register.js';
import { accessRegister } from '../register/schema.js';
import { declarantNoticesUrl, leaRequestUrl, officerLeaRequestUrl } from '../requests/links.js';
import { CHANNELS, messageKey, send } from '../requests/workflow-support.js';
import { systemContext } from '../system-context.js';
import type {
  LeaBreachOutcome,
  LeaDecisionNoticeOutcome,
  LeaPackageOutcome,
  LeaReminderOutcome,
  LeaRequestState,
  LeaRequestWorkflowInput,
  LeaWithdrawnNoticeOutcome,
} from './contract.js';
import type { LeaRequestRow } from './representation.js';
import { LEA_DECIDED_STATUSES, LEA_OPEN_STATUSES, leaRequests } from './schema.js';

/** The template version of the access package the service issues (documents' `access-package`). */
const ACCESS_PACKAGE_TEMPLATE_VERSION = 1;

/** The owning record documents keeps a law enforcement request's package under. */
export function leaPackageSubjectRef(requestId: string): string {
  return `lea-request:${requestId}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activities of `LeaRequestWorkflow`, hosted by the access worker. Every public method is an
 * activity named after it (keep helpers out of this class: the worker registers every method of
 * the prototype); each reads the request before acting and is safe to retry: messages carry an
 * idempotency key per request and message, the package one per request, and the register
 * entries are written once. An unreachable service propagates, so Temporal retries; a refusal by
 * declarations or documents, or a request not in the state its step needs, fails the step without
 * retrying (activity-retry.ts); a message notifications refuses or cannot deliver is logged and
 * not retried.
 */
@Injectable()
export class LeaRequestActivities {
  private readonly logger = new Logger(LeaRequestActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly declarations: DeclarationsClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Where the request stands, once the transaction that received it has ended (retried while it
   * is open, activity-failures.ts): the workflow's first step, and its check for lost signals
   * while it waits for the decision.
   */
  async leaRequestState({
    tenant,
    requestId,
    transactionId,
  }: LeaRequestWorkflowInput): Promise<LeaRequestState> {
    await requireTransactionEnded(this.db, transactionId);
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (isDecided(found.status)) return 'decided';
    if (found.status === 'withdrawn') return 'withdrawn';
    return 'undecided';
  }

  /**
   * Day ten (S11): reminds the Commission's access officers by email of the fourteen-day
   * deadline, to verify the request (identifying the officer sought) or to decide it; the
   * request records when. A decided or closed request gets none.
   */
  async remindLeaOfficers({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<LeaReminderOutcome> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (!isOpen(found.status)) return 'skipped';

    const now = this.clock.now();
    const daysLeft = Math.min(
      366,
      Math.max(0, Math.ceil((found.deadlineAt.getTime() - now.getTime()) / DAY_MS)),
    );
    const officers = await this.directory.staffWithRole(tenant, ACCESS_OFFICER);
    for (const officer of officers) {
      await send(this.notifications, this.logger, found, {
        channel: 'email',
        recipient: { kind: 'address', to: officer.email },
        template: 'access-officer-reminder-email',
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          task: found.status === 'received' ? 'identify-officer' : 'decide',
          dueDate: nairobiDate(found.deadlineAt),
          daysLeft,
          signInUrl: officerLeaRequestUrl(requestId),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `lea-officer-reminder:${officer.subject}`),
      });
    }
    await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(leaRequests)
        .set({ remindedAt: now })
        .where(and(eq(leaRequests.id, requestId), isNull(leaRequests.remindedAt))),
    );
    return 'sent';
  }

  /**
   * The filing officer withdrew the request before its decision (user decision 5): the
   * Commission's access officers are told by email, so nobody works on it further. The declarant
   * is never told (they hear of a law enforcement request only after a grant). A request not
   * withdrawn gets none.
   */
  async leaWithdrawnNotice({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<LeaWithdrawnNoticeOutcome> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (found.status !== 'withdrawn') return 'skipped';
    const officers = await this.directory.staffWithRole(tenant, ACCESS_OFFICER);
    for (const officer of officers) {
      await send(this.notifications, this.logger, found, {
        channel: 'email',
        recipient: { kind: 'address', to: officer.email },
        template: 'lea-withdrawn-email',
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          signInUrl: officerLeaRequestUrl(requestId),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `lea-withdrawn:${officer.subject}`),
      });
    }
    return 'sent';
  }

  /**
   * At the deadline (day fourteen, S11): an undecided request is flagged as breached, once, at
   * the instant the deadline passed. The access officer can still decide it.
   */
  async flagLeaBreach({ tenant, requestId }: LeaRequestWorkflowInput): Promise<LeaBreachOutcome> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [flagged] = await tx
        .update(leaRequests)
        .set({ breachedAt: leaRequests.deadlineAt })
        .where(
          and(
            eq(leaRequests.id, requestId),
            inArray(leaRequests.status, [...LEA_OPEN_STATUSES]),
            isNull(leaRequests.breachedAt),
          ),
        )
        .returning({ id: leaRequests.id });
      if (flagged) {
        this.logger.warn({ requestId }, 'Law enforcement request undecided at its deadline');
        return 'flagged';
      }
      const [found] = await tx
        .select({ id: leaRequests.id })
        .from(leaRequests)
        .where(eq(leaRequests.id, requestId));
      return found ? 'skipped' : 'missing';
    });
  }

  /**
   * Tells the agency's officer the decision, by email and SMS (a person recipient: notifications
   * reads their official contacts from the directory). Reasons, grounds and scope wait behind
   * sign-in, in the console.
   */
  async leaDecisionNotice({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<LeaDecisionNoticeOutcome> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    const outcome = decidedStatusOf(found);
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, found, {
        channel,
        recipient: { kind: 'person', personId: found.officerPersonId },
        template: `lea-decision-${channel}`,
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          outcome,
          signInUrl: leaRequestUrl(requestId),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `lea-decision:${channel}`),
      });
    }
    return outcome;
  }

  /**
   * After a grant, and only then (r.23(2)): the declarant is told a law enforcement agency was
   * granted access, by email and SMS; the request records when, with the `notified` register
   * entry and its event, once. The case and the reason wait behind sign-in.
   */
  async notifyDeclarantOfLeaGrant({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<'notified' | 'missing'> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    const { decision, resolvedPersonId } = found;
    if (decidedStatusOf(found) !== 'granted' || decision === null || resolvedPersonId === null) {
      throw invariantBroken('The request has no grant to tell the declarant of');
    }
    const notified = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const now = this.clock.now();
      const [updated] = await tx
        .update(leaRequests)
        .set({ declarantNotifiedAt: now })
        .where(and(eq(leaRequests.id, requestId), isNull(leaRequests.declarantNotifiedAt)))
        .returning();
      if (!updated) return found;
      await this.register.record(tx, {
        tenant,
        subjectKind: 'lea-request',
        subjectId: requestId,
        reference: updated.reference,
        personId: resolvedPersonId,
        kind: 'notified',
        actor: null,
        at: now,
      });
      return updated;
    });
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, notified, {
        channel,
        recipient: { kind: 'person', personId: resolvedPersonId },
        template: `lea-grant-notice-${channel}`,
        params: {
          reference: notified.reference,
          commissionName: notified.commissionName,
          agencyName: notified.agencyName,
          grantedOn: nairobiDate(new Date(decision.decidedAt)),
          signInUrl: declarantNoticesUrl(),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `lea-grant-notice:${channel}`),
      });
    }
    return 'notified';
  }

  /**
   * Issues a grant's package, once: declarations renders the disclosure of exactly the granted
   * scope for the declarant (legal basis Act s.36(2), the grant's `LEA` reference, the deciding
   * access officer and the law enforcement officer as recipient, audited there), and documents
   * issues it as the officer's Confidential `access-package`, watermarked with their name and
   * agency, the reference and the date, downloadable by them for the Commission's download window in force now. Both
   * calls run in this one activity, so the disclosure never enters the workflow's history. The
   * request records the package with the `package-issued` register entry and its event.
   */
  async issueLeaPackage({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<LeaPackageOutcome> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return { outcome: 'missing' };
    if (found.downloadExpiresAt !== null) {
      return { outcome: 'issued', downloadExpiresAt: found.downloadExpiresAt.toISOString() };
    }
    const { decision, resolvedPersonId } = found;
    const scope = decision?.grantedScope;
    if (decidedStatusOf(found) !== 'granted' || !decision || !scope || resolvedPersonId === null) {
      throw invariantBroken('The request has no grant to issue a package for');
    }

    const context = { requestId };
    let disclosure;
    try {
      disclosure = await this.declarations.renderDisclosure({
        personId: resolvedPersonId,
        tenant,
        officerSubject: decision.decidedBy.subject,
        grantReference: found.reference,
        legalBasis: 'act-s36-2',
        recipientSubject: found.officerSubject,
        years: scope.years,
        includeSpouses: scope.includeSpouses,
        includeChildren: scope.includeChildren,
        sections: scope.sections,
      });
    } catch (error) {
      rethrowAsActivityFailure(this.logger, error, context, 'Disclosure refused by declarations');
    }
    if (disclosure === null) {
      this.logger.warn(context, 'Nothing to disclose in the granted scope: no package issued');
      return { outcome: 'nothing-to-disclose' };
    }

    const payload: AccessPackagePayload = {
      // Verbatim: declarations' cut of the granted scope, which documents validates strictly.
      disclosure: disclosure as unknown as AccessPackagePayload['disclosure'],
      legalBasis: 'act-s36-2',
      recipient: { name: found.officerName, organisation: found.agencyName },
      grantedAt: decision.decidedAt,
      scope: {
        years: scope.years,
        includeSpouses: scope.includeSpouses,
        includeChildren: scope.includeChildren,
        sections: scope.sections,
      },
    };
    let issued;
    try {
      issued = await this.documents.issue({
        tenant,
        type: 'access-package',
        templateVersion: ACCESS_PACKAGE_TEMPLATE_VERSION,
        subjectRef: leaPackageSubjectRef(requestId),
        subjectPersonId: found.officerPersonId,
        payload,
        watermark: {
          recipientName: `${found.officerName}, ${found.agencyCode}`,
          reference: found.reference,
          date: nairobiDate(this.clock.now()),
        },
        downloadWindowDays: (await this.directory.accessPolicy(tenant)).packageDownloadDays,
        idempotencyKey: messageKey(requestId, 'lea-package'),
      });
    } catch (error) {
      rethrowAsActivityFailure(this.logger, error, context, 'Access package refused by documents');
    }
    const { downloadExpiresAt } = issued;
    if (downloadExpiresAt === null) {
      throw invariantBroken('Documents issued the access package without a download window');
    }

    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [recorded] = await tx
        .update(leaRequests)
        .set({
          packageDocumentId: issued.id,
          packageVerificationId: issued.verificationId,
          packageIssuedAt: issued.issuedAt,
          downloadExpiresAt,
        })
        .where(and(eq(leaRequests.id, requestId), isNull(leaRequests.packageDocumentId)))
        .returning();
      if (!recorded) return;
      await this.register.record(tx, {
        tenant,
        subjectKind: 'lea-request',
        subjectId: requestId,
        reference: recorded.reference,
        personId: recorded.resolvedPersonId,
        kind: 'package-issued',
        actor: null,
        at: issued.issuedAt,
        details: { documentId: issued.id, downloadExpiresAt: downloadExpiresAt.toISOString() },
        eventData: { documentId: issued.id, downloadExpiresAt: downloadExpiresAt.toISOString() },
      });
    });
    return { outcome: 'issued', downloadExpiresAt: downloadExpiresAt.toISOString() };
  }

  /**
   * Tells the officer their package is ready, with the last day they can download it; the
   * download itself is theirs, in the console, with their own token.
   */
  async leaPackageReady({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<'sent' | 'missing'> {
    const found = await loadLea(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (found.downloadExpiresAt === null) throw invariantBroken('The request has no package');
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, found, {
        channel,
        recipient: { kind: 'person', personId: found.officerPersonId },
        template: `access-package-ready-${channel}`,
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          downloadUntil: nairobiDate(new Date(found.downloadExpiresAt.getTime() - 1)),
          signInUrl: leaRequestUrl(requestId),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `lea-package-ready:${channel}`),
      });
    }
    return 'sent';
  }

  /**
   * At the end of the package's download window: the register records it `expired`, once, at the
   * instant the window closed. Documents refuses downloads from then on (410).
   */
  async expireLeaPackage({
    tenant,
    requestId,
  }: LeaRequestWorkflowInput): Promise<'expired' | 'missing'> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [found] = await tx
        .select()
        .from(leaRequests)
        .where(eq(leaRequests.id, requestId))
        .for('update');
      if (!found) return 'missing';
      if (found.downloadExpiresAt === null || found.packageDocumentId === null) {
        throw invariantBroken('The request has no package');
      }
      const [expired] = await tx
        .select({ id: accessRegister.id })
        .from(accessRegister)
        .where(
          and(
            eq(accessRegister.subjectKind, 'lea-request'),
            eq(accessRegister.subjectId, requestId),
            eq(accessRegister.kind, 'expired'),
          ),
        );
      if (expired) return 'expired';
      await this.register.record(tx, {
        tenant,
        subjectKind: 'lea-request',
        subjectId: requestId,
        reference: found.reference,
        personId: found.resolvedPersonId,
        kind: 'expired',
        actor: null,
        at: found.downloadExpiresAt,
        details: { documentId: found.packageDocumentId },
        eventData: { documentId: found.packageDocumentId },
      });
      return 'expired';
    });
  }
}

/** The law enforcement request, in its Commission's context; undefined when it is not there. */
export async function loadLea(
  db: AccessDatabase,
  tenant: string,
  requestId: string,
): Promise<LeaRequestRow | undefined> {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(leaRequests).where(eq(leaRequests.id, requestId)),
  );
  return found;
}

type LeaDecidedStatus = (typeof LEA_DECIDED_STATUSES)[number];

function isDecided(status: string): status is LeaDecidedStatus {
  return (LEA_DECIDED_STATUSES as readonly string[]).includes(status);
}

function isOpen(status: string): boolean {
  return (LEA_OPEN_STATUSES as readonly string[]).includes(status);
}

/** The decided status of a request the workflow was told is decided. */
function decidedStatusOf(row: LeaRequestRow): LeaDecidedStatus {
  if (!isDecided(row.status) || row.decision === null) {
    throw invariantBroken('The law enforcement request is not decided');
  }
  return row.status;
}
