import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { DATABASE, withTenant } from '@adili/data-access';
import type { AccessCertifiedCopyIssuedData } from '@adili/events/contracts';
import { and, eq } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { type CertifiedCopyPayload, DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { AccessRegister } from '../register/access-register.js';
import { declarantCertifiedCopiesUrl } from '../requests/links.js';
import { CHANNELS, messageKey, send } from '../requests/workflow-support.js';
import { systemContext } from '../system-context.js';
import type { CertifiedCopyRow } from './certified-copy-issuance.js';
import type { CertifiedCopyWorkflowInput, IssueOutcome } from './contract.js';
import { certifiedCopies, selfAccessApplications } from './schema.js';

/** The template version of the certified copy the service issues (documents' `certified-copy`). */
const CERTIFIED_COPY_TEMPLATE_VERSION = 1;

/** The owning record documents keeps a certified copy under (one per type and subject). */
export function certifiedCopySubjectRef(copyId: string): string {
  return `certified-copy:${copyId}`;
}

/**
 * The activities of `CertifiedCopyWorkflow` (S13), hosted by the access worker. Every public
 * method is an activity named after it; each reads the certified copy before acting and is safe
 * to retry: documents issues once per copy (idempotency key), the messages are sent once per copy
 * and channel, and the copy is recorded issued, with its `self-access` register entry, once. An
 * unreachable service propagates, so Temporal retries. Helpers live outside the class: every
 * method of it, private ones included, would be registered as an activity.
 */
@Injectable()
export class CertifiedCopyActivities {
  private readonly logger = new Logger(CertifiedCopyActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly declarations: DeclarationsClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Issues the certified copy, once: declarations renders the version in full for the declarant
   * (audited there as self-access, with who asked as recipient) and documents issues it as their
   * Restricted `certified-copy`, which only they may download. Both calls run in this one
   * activity, so the declaration never enters the workflow's history; only the document's ids are
   * kept. The copy is recorded `issued` with its `self-access` register entry and
   * `access.certified-copy.issued.v1`. When declarations has no such submitted version of the
   * declarant at the Commission the copy `failed` and nothing is issued.
   */
  async issueCertifiedCopy({ tenant, copyId }: CertifiedCopyWorkflowInput): Promise<IssueOutcome> {
    const copy = await load(this.db, tenant, copyId);
    if (!copy) return 'missing';
    if (copy.status === 'issued') return 'issued';
    if (copy.status === 'failed') return 'not-found';

    const context = { copyId };
    let version;
    try {
      version = await this.declarations.fullDocument({
        tenant,
        declarationId: copy.declarationId,
        version: copy.version,
        personId: copy.personId,
        actingSubject: copy.requestedBy,
      });
    } catch (error) {
      logRefusal(this.logger, error, context, 'Full document refused by declarations');
      throw error;
    }
    if (version === null) {
      this.logger.warn(context, 'No such version of the declarant: certified copy failed');
      await withTenant(this.db, systemContext(tenant), (tx) =>
        tx
          .update(certifiedCopies)
          .set({ status: 'failed', failedAt: this.clock.now() })
          .where(and(eq(certifiedCopies.id, copyId), eq(certifiedCopies.status, 'pending'))),
      );
      return 'not-found';
    }

    const payload: CertifiedCopyPayload = {
      commission: version.commission,
      declarantName: version.declarantName,
      reference: version.reference,
      version: version.version,
      type: version.type,
      statementDate: version.statementDate,
      submittedAt: version.submittedAt,
      // Verbatim: the version as filed, which documents validates against declaration.v1.
      document: version.document as unknown as CertifiedCopyPayload['document'],
    };
    let issued;
    try {
      issued = await this.documents.issue({
        tenant,
        type: 'certified-copy',
        templateVersion: CERTIFIED_COPY_TEMPLATE_VERSION,
        subjectRef: certifiedCopySubjectRef(copyId),
        subjectPersonId: copy.personId,
        payload,
        idempotencyKey: messageKey(copyId, 'certified-copy'),
      });
    } catch (error) {
      logRefusal(this.logger, error, context, 'Certified copy refused by documents');
      throw error;
    }

    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [recorded] = await tx
        .update(certifiedCopies)
        .set({
          status: 'issued',
          reference: version.reference,
          documentId: issued.id,
          verificationId: issued.verificationId,
          issuedAt: issued.issuedAt,
        })
        .where(and(eq(certifiedCopies.id, copyId), eq(certifiedCopies.status, 'pending')))
        .returning();
      if (!recorded) return;
      const representativeName = await representativeOf(tx, recorded);
      await this.register.record(tx, {
        tenant,
        subjectKind: 'self-access',
        subjectId: copyId,
        reference: null,
        personId: recorded.personId,
        kind: 'self-access',
        actor: { subject: recorded.requestedBy, name: recorded.requestedByName },
        at: issued.issuedAt,
        details: {
          declarationId: recorded.declarationId,
          version: recorded.version,
          declarationReference: version.reference,
          documentId: issued.id,
          applicationId: recorded.applicationId,
          representativeName,
        },
        eventData: {
          declarationId: recorded.declarationId,
          version: recorded.version,
          documentId: issued.id,
          applicationId: recorded.applicationId,
        } satisfies Pick<
          AccessCertifiedCopyIssuedData,
          'declarationId' | 'version' | 'documentId' | 'applicationId'
        >,
      });
    });
    return 'issued';
  }

  /**
   * Tells the declarant their certified copy is ready (S13), by email and SMS, with the
   * declaration's reference, the version and the copy's verification code; the download itself
   * is theirs, in the portal, with their own token.
   */
  async certifiedCopyReady({
    tenant,
    copyId,
  }: CertifiedCopyWorkflowInput): Promise<'sent' | 'missing'> {
    const copy = await load(this.db, tenant, copyId);
    if (!copy) return 'missing';
    const { reference, verificationId } = copy;
    if (copy.status !== 'issued' || reference === null || verificationId === null) {
      throw new Error('The certified copy is not issued');
    }
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, copy, {
        channel,
        recipient: { kind: 'person', personId: copy.personId },
        template: `certified-copy-ready-${channel}`,
        params: {
          reference,
          version: copy.version,
          commissionName: copy.commissionName,
          verificationCode: verificationId,
          signInUrl: declarantCertifiedCopiesUrl(),
        },
        tenant,
        idempotencyKey: messageKey(copyId, `certified-copy-ready:${channel}`),
      });
    }
    return 'sent';
  }
}

/** The certified copy, in its Commission's context; undefined when it is not there. */
async function load(
  db: AccessDatabase,
  tenant: string,
  copyId: string,
): Promise<CertifiedCopyRow | undefined> {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(certifiedCopies).where(eq(certifiedCopies.id, copyId)),
  );
  return found;
}

/** Who applied on the declarant's behalf, for a copy of an officer-recorded application. */
async function representativeOf(
  tx: AccessTransaction,
  copy: CertifiedCopyRow,
): Promise<string | null> {
  if (copy.applicationId === null) return null;
  const [application] = await tx
    .select({ representative: selfAccessApplications.representative })
    .from(selfAccessApplications)
    .where(eq(selfAccessApplications.id, copy.applicationId));
  return application?.representative?.name ?? null;
}

/** Logs a refusal by an upstream service (it is retried like an outage). */
function logRefusal(
  logger: Logger,
  error: unknown,
  context: Record<string, unknown>,
  message: string,
): void {
  if (error instanceof InternalApiRejected) {
    logger.error({ ...context, err: errorType(error) }, message);
  }
}
