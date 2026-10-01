import { Controller, Inject, Logger } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { DATABASE, switchTenant } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { DOCUMENT_DOWNLOADED } from '@adili/events/contracts';
import { documentDownloadedDataSchema } from '@adili/events/contracts/schemas';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AccessDatabase } from '../db/database.js';
import { AccessRegister } from '../register/access-register.js';
import { systemContext } from '../system-context.js';
import { accessRequests } from './schema.js';

/** Inbox consumer of the downloads registered. */
const DOWNLOADS_CONSUMER = 'access.package-downloaded';

/** The documents subject of a Form K grant's package: `access-request:<request id>`. */
const ACCESS_REQUEST_SUBJECT = /^access-request:(?<id>[0-9a-f-]{36})$/;

/**
 * Each download of a grant's package (S7): documents hands the applicant a link with their own
 * token and emits `document.downloaded.v1`; the access register records it as `downloaded`, with
 * the applicant as actor, once per event (inbox), in the request's Commission. Law enforcement
 * packages (`lea-request:`) join with #264; other documents are not the register's.
 */
@Controller()
export class DownloadsConsumer {
  private readonly logger = new Logger(DownloadsConsumer.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly register: AccessRegister,
  ) {}

  /** Resolves to false for an event registered already or not about a Form K package. */
  @OnEvent(DOCUMENT_DOWNLOADED)
  async downloaded(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = documentDownloadedDataSchema.parse(event.data);
    const requestId = ACCESS_REQUEST_SUBJECT.exec(data.subjectRef)?.groups?.id;
    if (data.documentType !== 'access-package' || requestId === undefined) return false;
    if (!z.uuid().safeParse(requestId).success) return false;

    return consumeOnce(this.db, DOWNLOADS_CONSUMER, event, async (tx) => {
      await switchTenant(tx, systemContext(data.issuerTenant));
      const [found] = await tx
        .select()
        .from(accessRequests)
        .where(
          and(
            eq(accessRequests.id, requestId),
            eq(accessRequests.packageDocumentId, data.documentId),
          ),
        );
      if (!found) {
        this.logger.warn(
          { requestId, documentId: data.documentId },
          'Download of a package no request of the Commission holds',
        );
        return;
      }
      const byApplicant = data.downloadedBy === found.applicantSubject;
      await this.register.record(tx, {
        tenant: found.tenant,
        subjectKind: 'access-request',
        subjectId: found.id,
        reference: found.reference,
        personId: found.resolvedPersonId,
        kind: 'downloaded',
        actor: { subject: data.downloadedBy, name: byApplicant ? found.applicantName : null },
        at: new Date(data.downloadedAt),
        details: { documentId: data.documentId },
        eventData: { documentId: data.documentId },
      });
    });
  }
}
