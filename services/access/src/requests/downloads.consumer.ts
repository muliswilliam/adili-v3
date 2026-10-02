import { Controller, Inject, Logger } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { DATABASE, switchTenant } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { DOCUMENT_DOWNLOADED } from '@adili/events/contracts';
import { documentDownloadedDataSchema } from '@adili/events/contracts/schemas';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { leaRequests } from '../lea/schema.js';
import { AccessRegister, type RegisterEntryBase } from '../register/access-register.js';
import { systemContext } from '../system-context.js';
import { accessRequests } from './schema.js';

/** Inbox consumer of the downloads registered. */
const DOWNLOADS_CONSUMER = 'access.package-downloaded';

/**
 * The documents subject of a grant's package: `access-request:<request id>` (Form K) or
 * `lea-request:<request id>` (law enforcement).
 */
const PACKAGE_SUBJECT = /^(?<kind>access-request|lea-request):(?<id>[0-9a-f-]{36})$/;

/** The register entry of a download, without its time and actor. */
type DownloadedEntry = Omit<RegisterEntryBase, 'at' | 'actor' | 'details'> & {
  subjectKind: 'access-request' | 'lea-request';
  /** The recipient's account and name: the actor's name when they downloaded it themselves. */
  recipient: { subject: string; name: string };
};

/**
 * Each download of a grant's package (S7, S11): documents hands the recipient (the applicant, or
 * the law enforcement officer) a link with their own token and emits `document.downloaded.v1`;
 * the access register records it as `downloaded`, with the recipient as actor, once per event
 * (inbox), in the request's Commission. Other documents are not the register's.
 */
@Controller()
export class DownloadsConsumer {
  private readonly logger = new Logger(DownloadsConsumer.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly register: AccessRegister,
  ) {}

  /** Resolves to false for an event registered already or not about a package. */
  @OnEvent(DOCUMENT_DOWNLOADED)
  async downloaded(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = documentDownloadedDataSchema.parse(event.data);
    const subject = PACKAGE_SUBJECT.exec(data.subjectRef)?.groups;
    if (data.documentType !== 'access-package' || subject?.id === undefined) return false;
    const requestId = subject.id;
    if (!z.uuid().safeParse(requestId).success) return false;
    const kind = subject.kind === 'lea-request' ? 'lea-request' : 'access-request';

    return consumeOnce(this.db, DOWNLOADS_CONSUMER, event, async (tx) => {
      await switchTenant(tx, systemContext(data.issuerTenant));
      const found =
        kind === 'lea-request'
          ? await leaDownload(tx, requestId, data.documentId)
          : await formKDownload(tx, requestId, data.documentId);
      if (!found) {
        this.logger.warn(
          { requestId, documentId: data.documentId },
          'Download of a package no request of the Commission holds',
        );
        return;
      }
      const { recipient, ...entry } = found;
      const byRecipient = data.downloadedBy === recipient.subject;
      await this.register.record(tx, {
        ...entry,
        kind: 'downloaded',
        actor: { subject: data.downloadedBy, name: byRecipient ? recipient.name : null },
        at: new Date(data.downloadedAt),
        details: { documentId: data.documentId },
        eventData: { documentId: data.documentId },
      });
    });
  }
}

async function formKDownload(
  tx: AccessTransaction,
  requestId: string,
  documentId: string,
): Promise<DownloadedEntry | undefined> {
  const [found] = await tx
    .select()
    .from(accessRequests)
    .where(and(eq(accessRequests.id, requestId), eq(accessRequests.packageDocumentId, documentId)));
  if (!found) return undefined;
  return {
    tenant: found.tenant,
    subjectKind: 'access-request',
    subjectId: found.id,
    reference: found.reference,
    personId: found.resolvedPersonId,
    recipient: { subject: found.applicantSubject, name: found.applicantName },
  };
}

async function leaDownload(
  tx: AccessTransaction,
  requestId: string,
  documentId: string,
): Promise<DownloadedEntry | undefined> {
  const [found] = await tx
    .select()
    .from(leaRequests)
    .where(and(eq(leaRequests.id, requestId), eq(leaRequests.packageDocumentId, documentId)));
  if (!found) return undefined;
  return {
    tenant: found.tenant,
    subjectKind: 'lea-request',
    subjectId: found.id,
    reference: found.reference,
    personId: found.resolvedPersonId,
    recipient: { subject: found.officerSubject, name: found.officerName },
  };
}
