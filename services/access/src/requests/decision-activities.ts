import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE, withTenant } from '@adili/data-access';
import { and, eq, isNull } from 'drizzle-orm';

import { invariantBroken } from '../activity-failures.js';
import { Clock, nairobiDate } from '../clock.js';
import type { AccessDatabase } from '../db/database.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { issueGrantDocument } from '../grant-documents.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { AccessRegister } from '../register/access-register.js';
import { ReviewClient } from '../review/review-client.js';
import { accessRegister } from '../register/schema.js';
import { systemContext } from '../system-context.js';
import type {
  AccessRequestWorkflowInput,
  DecisionNoticesOutcome,
  PackageOutcome,
} from './contract.js';
import { applicantRequestsUrl, declarantNoticesUrl } from './links.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests, DECIDED_STATUSES, type DecidedStatus } from './schema.js';
import { CHANNELS, load, messageKey, send } from './workflow-support.js';

/** The owning record documents keeps a request's package under (one per type and subject). */
export function packageSubjectRef(requestId: string): string {
  return `access-request:${requestId}`;
}

/**
 * The activities of `AccessRequestWorkflow` once the access officer has decided (S6, S7), hosted
 * by the access worker beside `AccessRequestActivities`. Every public method is an activity named
 * after it; each reads the request before acting and is safe to retry: messages carry an
 * idempotency key per request and message, the package one per request, and the register
 * entries are written once. An unreachable service propagates, so Temporal retries; a refusal
 * by declarations or documents, or a request not in the state its step needs, fails the step
 * without retrying (activity-retry.ts).
 */
@Injectable()
export class DecisionActivities {
  private readonly logger = new Logger(DecisionActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly declarations: DeclarationsClient,
    private readonly review: ReviewClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Tells both parties the decision (S6), by email and SMS, as person recipients: the applicant
   * and the declarant, each with the outcome; the reasons, grounds and scope wait behind
   * sign-in.
   */
  async decisionNotices({
    tenant,
    requestId,
  }: AccessRequestWorkflowInput): Promise<DecisionNoticesOutcome> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return 'missing';
    const outcome = decidedStatusOf(found);
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, found, {
        channel,
        recipient: { kind: 'person', personId: found.applicantPersonId },
        template: `access-decision-applicant-${channel}`,
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          outcome,
          signInUrl: applicantRequestsUrl(),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `decision-applicant:${channel}`),
      });
    }
    if (found.resolvedPersonId !== null) {
      for (const channel of CHANNELS) {
        await send(this.notifications, this.logger, found, {
          channel,
          recipient: { kind: 'person', personId: found.resolvedPersonId },
          template: `access-decision-declarant-${channel}`,
          params: {
            reference: found.reference,
            commissionName: found.commissionName,
            outcome,
            signInUrl: declarantNoticesUrl(),
          },
          tenant,
          idempotencyKey: messageKey(requestId, `decision-declarant:${channel}`),
        });
      }
    }
    return outcome === 'denied' ? 'denied' : 'granted';
  }

  /**
   * Issues a grant's package, once (S6): declarations renders the disclosure of exactly the
   * granted scope for the declarant (legal basis Act s.36(1), the grant's `ARQ` reference, the
   * deciding officer and the applicant as recipient, audited there), with the clarifications
   * review discloses for it when the grant includes them, and documents issues it as the
   * applicant's Confidential `access-package`, watermarked with their name, the reference and
   * the date, downloadable by them for the Commission's download window in force now. A scope
   * that holds nothing (no declaration in it, or a declarant with no account) gets the nil letter
   * instead, alike (decision 1). The calls run in this one activity, so no disclosure enters the
   * workflow's history; only the document's ids are kept. The request records it with the
   * `package-issued` register entry and its event.
   */
  async issuePackage({ tenant, requestId }: AccessRequestWorkflowInput): Promise<PackageOutcome> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return { outcome: 'missing' };
    if (found.downloadExpiresAt !== null) {
      return { outcome: 'issued', downloadExpiresAt: found.downloadExpiresAt.toISOString() };
    }
    const { decision, resolvedPersonId } = found;
    const scope = decision?.grantedScope;
    if (decidedStatusOf(found) === 'denied' || !decision || !scope) {
      throw invariantBroken('The request has no grant to issue a package for');
    }

    if (found.resolvedName === null) throw invariantBroken('The request resolved no declarant');
    const deps = {
      declarations: this.declarations,
      review: this.review,
      documents: this.documents,
      directory: this.directory,
      clock: this.clock,
      logger: this.logger,
    };
    const { kind, issued } = await issueGrantDocument(deps, {
      tenant,
      requestId,
      reference: found.reference,
      legalBasis: 'act-s36-1',
      // A declarant served in writing who has still not onboarded has filed nothing on Adili.
      personId: resolvedPersonId,
      declarantName: found.resolvedName,
      scope,
      decidedBy: decision.decidedBy.subject,
      grantedAt: decision.decidedAt,
      recipientSubject: found.applicantSubject,
      recipientPersonId: found.applicantPersonId,
      recipient: { name: found.applicantName, organisation: null },
      watermarkName: found.applicantName,
      subjectRef: packageSubjectRef(requestId),
    });
    const { downloadExpiresAt } = issued;

    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [recorded] = await tx
        .update(accessRequests)
        .set({
          packageKind: kind,
          packageDocumentId: issued.id,
          packageVerificationId: issued.verificationId,
          packageIssuedAt: issued.issuedAt,
          downloadExpiresAt,
          packageFailedAt: null,
        })
        .where(and(eq(accessRequests.id, requestId), isNull(accessRequests.packageDocumentId)))
        .returning();
      if (!recorded) return;
      await this.register.record(tx, {
        tenant,
        subjectKind: 'access-request',
        subjectId: requestId,
        reference: recorded.reference,
        personId: recorded.resolvedPersonId,
        kind: 'package-issued',
        actor: null,
        at: issued.issuedAt,
        details: {
          documentId: issued.id,
          downloadExpiresAt: downloadExpiresAt.toISOString(),
          packageKind: kind,
        },
        eventData: { documentId: issued.id, downloadExpiresAt: downloadExpiresAt.toISOString() },
      });
    });
    return { outcome: 'issued', downloadExpiresAt: downloadExpiresAt.toISOString() };
  }

  /**
   * Records that issuing the grant's package failed after its retries (or was refused), so the
   * parties see it failed rather than being prepared, until an operator issues it.
   */
  async packageFailed({ tenant, requestId }: AccessRequestWorkflowInput): Promise<void> {
    await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(accessRequests)
        .set({ packageFailedAt: this.clock.now() })
        .where(and(eq(accessRequests.id, requestId), isNull(accessRequests.packageDocumentId))),
    );
    this.logger.error({ requestId }, 'The grant document could not be issued');
  }

  /**
   * Tells the applicant their package is ready (S6), with the last day they can download it; the
   * download itself is theirs, in the portal, with their own token.
   */
  async packageReady({
    tenant,
    requestId,
  }: AccessRequestWorkflowInput): Promise<'sent' | 'missing'> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (found.downloadExpiresAt === null) throw invariantBroken('The request has no package');
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, found, {
        channel,
        recipient: { kind: 'person', personId: found.applicantPersonId },
        template: `access-package-ready-${channel}`,
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          downloadUntil: lastDay(found.downloadExpiresAt),
          signInUrl: applicantRequestsUrl(),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `package-ready:${channel}`),
      });
    }
    return 'sent';
  }

  /**
   * At the end of the package's download window (S7): the register records it `expired`, once,
   * at the instant the window closed. Documents refuses downloads from then on (410).
   */
  async expirePackage({
    tenant,
    requestId,
  }: AccessRequestWorkflowInput): Promise<'expired' | 'missing'> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [found] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, requestId))
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
            eq(accessRegister.subjectKind, 'access-request'),
            eq(accessRegister.subjectId, requestId),
            eq(accessRegister.kind, 'expired'),
          ),
        );
      if (expired) return 'expired';
      await this.register.record(tx, {
        tenant,
        subjectKind: 'access-request',
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

function isDecided(status: string): status is DecidedStatus {
  return (DECIDED_STATUSES as readonly string[]).includes(status);
}

/** The decided status of a request the workflow was told is decided. */
function decidedStatusOf(row: AccessRequestRow): DecidedStatus {
  if (!isDecided(row.status) || row.decision === null) {
    throw invariantBroken('The request is not decided');
  }
  return row.status;
}

/** The last civil day (Nairobi) before `expiresAt`, the instant downloads stop. */
function lastDay(expiresAt: Date): string {
  return nairobiDate(new Date(expiresAt.getTime() - 1));
}
