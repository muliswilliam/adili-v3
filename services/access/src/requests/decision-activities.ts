import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { DATABASE, withTenant } from '@adili/data-access';
import { and, eq, isNull } from 'drizzle-orm';

import { Clock, nairobiDate } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase } from '../db/database.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { type AccessPackagePayload, DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { AccessRegister } from '../register/access-register.js';
import { accessRegister } from '../register/schema.js';
import { systemContext } from '../system-context.js';
import type {
  AccessRequestWorkflowInput,
  DecisionNoticesOutcome,
  DecisionState,
  PackageOutcome,
} from './contract.js';
import { applicantRequestsUrl, declarantNoticesUrl } from './links.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests, DECIDED_STATUSES, type DecidedStatus } from './schema.js';
import { CHANNELS, load, messageKey, send } from './workflow-support.js';

/** The template version of the access package the service issues (documents' `access-package`). */
const ACCESS_PACKAGE_TEMPLATE_VERSION = 1;

/** The owning record documents keeps a request's package under (one per type and subject). */
export function packageSubjectRef(requestId: string): string {
  return `access-request:${requestId}`;
}

/**
 * The activities of `AccessRequestWorkflow` once the access officer has decided (S6, S7), hosted
 * by the access worker beside `AccessRequestActivities`. Every public method is an activity named
 * after it; each reads the request before acting and is safe to retry: messages carry an
 * idempotency key per request and message, the package one per request, and the register
 * entries are written once. An unreachable service propagates, so Temporal retries.
 */
@Injectable()
export class DecisionActivities {
  private readonly logger = new Logger(DecisionActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly declarations: DeclarationsClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /** Where the request stands, for a workflow that has had no signal for a while. */
  async decisionState({ tenant, requestId }: AccessRequestWorkflowInput): Promise<DecisionState> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return 'missing';
    if (isDecided(found.status)) return 'decided';
    if (found.status === 'withdrawn') return 'withdrawn';
    return 'undecided';
  }

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
   * deciding officer and the applicant as recipient, audited there), and documents issues it as
   * the applicant's Confidential `access-package`, watermarked with their name, the reference and
   * the date, downloadable by them for `PACKAGE_DOWNLOAD_DAYS`. Both calls run in this one
   * activity, so the disclosure never enters the workflow's history; only the package's ids are
   * kept. The request records the package with the `package-issued` register entry and its
   * event. A declarant with no declaration in the granted scope has nothing to disclose.
   */
  async issuePackage({ tenant, requestId }: AccessRequestWorkflowInput): Promise<PackageOutcome> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return { outcome: 'missing' };
    if (found.downloadExpiresAt !== null) {
      return { outcome: 'issued', downloadExpiresAt: found.downloadExpiresAt.toISOString() };
    }
    const { decision, resolvedPersonId } = found;
    const scope = decision?.grantedScope;
    if (decidedStatusOf(found) === 'denied' || !decision || !scope || resolvedPersonId === null) {
      throw new Error('The request has no grant to issue a package for');
    }

    const context = { requestId };
    let disclosure;
    try {
      disclosure = await this.declarations.renderDisclosure({
        personId: resolvedPersonId,
        tenant,
        officerSubject: decision.decidedBy.subject,
        grantReference: found.reference,
        legalBasis: 'act-s36-1',
        recipientSubject: found.applicantSubject,
        years: scope.years,
        includeSpouses: scope.includeSpouses,
        includeChildren: scope.includeChildren,
        sections: scope.sections,
      });
    } catch (error) {
      this.logRefusal(error, context, 'Disclosure refused by declarations');
      throw error;
    }
    if (disclosure === null) {
      this.logger.warn(context, 'Nothing to disclose in the granted scope: no package issued');
      return { outcome: 'nothing-to-disclose' };
    }

    const payload: AccessPackagePayload = {
      // Verbatim: declarations' cut of the granted scope, which documents validates strictly.
      disclosure: disclosure as unknown as AccessPackagePayload['disclosure'],
      legalBasis: 'act-s36-1',
      recipient: { name: found.applicantName, organisation: null },
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
        subjectRef: packageSubjectRef(requestId),
        subjectPersonId: found.applicantPersonId,
        payload,
        watermark: {
          recipientName: found.applicantName,
          reference: found.reference,
          date: nairobiDate(this.clock.now()),
        },
        downloadWindowDays: config.PACKAGE_DOWNLOAD_DAYS,
        idempotencyKey: messageKey(requestId, 'access-package'),
      });
    } catch (error) {
      this.logRefusal(error, context, 'Access package refused by documents');
      throw error;
    }
    const { downloadExpiresAt } = issued;
    if (downloadExpiresAt === null) {
      throw new Error('Documents issued the access package without a download window');
    }

    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [recorded] = await tx
        .update(accessRequests)
        .set({
          packageDocumentId: issued.id,
          packageVerificationId: issued.verificationId,
          packageIssuedAt: issued.issuedAt,
          downloadExpiresAt,
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
        details: { documentId: issued.id, downloadExpiresAt: downloadExpiresAt.toISOString() },
        eventData: { documentId: issued.id, downloadExpiresAt: downloadExpiresAt.toISOString() },
      });
    });
    return { outcome: 'issued', downloadExpiresAt: downloadExpiresAt.toISOString() };
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
    if (found.downloadExpiresAt === null) throw new Error('The request has no package');
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
      if (found.downloadExpiresAt === null) throw new Error('The request has no package');
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

  private logRefusal(error: unknown, context: Record<string, unknown>, message: string): void {
    if (error instanceof InternalApiRejected) {
      this.logger.error({ ...context, err: errorType(error) }, message);
    }
  }
}

function isDecided(status: string): status is DecidedStatus {
  return (DECIDED_STATUSES as readonly string[]).includes(status);
}

/** The decided status of a request the workflow was told is decided. */
function decidedStatusOf(row: AccessRequestRow): DecidedStatus {
  if (!isDecided(row.status) || row.decision === null) {
    throw new Error('The request is not decided');
  }
  return row.status;
}

/** The last civil day (Nairobi) before `expiresAt`, the instant downloads stop. */
function lastDay(expiresAt: Date): string {
  return nairobiDate(new Date(expiresAt.getTime() - 1));
}
