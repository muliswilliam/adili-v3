import { randomUUID } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { createEnvelope, deadLetterQueue, type EventEnvelope, inbox } from '@adili/events';
import {
  DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
  DECLARATION_SUBMITTED,
  type DeclarationAcknowledgementRequestedData,
  type DeclarationSubmittedData,
  DOCUMENT_ISSUED,
  DOCUMENT_SUPERSEDED,
  type DocumentIssuedData,
  type DocumentSupersededData,
} from '@adili/events/contracts';
import { DCB, format } from '@adili/numbering/references';
import amqp from 'amqplib';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issuedDocuments, verificationRecords } from '../../src/db/schema.js';
import type { AcknowledgementPayload } from '../../src/declarations/declarations-client.js';
import { type DocumentsApi, requireEnv, startDocumentsApi } from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 06 S9 (the consumer half), S10 and S11 at the documents service's event inbox: an
 * acknowledgement slip issued on `declaration.submitted.v1` from the payload pulled by version
 * (fake declarations, real Gotenberg, OpenBao and SeaweedFS), the declaration's earlier slip
 * superseded, Gotenberg down retried then dead-lettered through RabbitMQ with nothing issued, and
 * `declaration.acknowledgement-requested.v1` issuing it (or announcing it again) later. Events
 * carry identifiers and the Restricted public payload only (S20).
 */

const VERIFY_ORIGIN = 'http://localhost:3030';
const DECLARANT = randomUUID();

interface Declaration {
  declarationId: string;
  reference: string;
}

interface Version extends Declaration {
  versionId: string;
  version: number;
}

let sequence = 0;

/** A declaration of its own reference number: a declaration's slips share it, no other's do. */
function declaration(): Declaration {
  sequence += 1;
  return {
    declarationId: randomUUID(),
    reference: format(DCB, { issuer: 'PSC', period: 2027, sequence }),
  };
}

function slipPayload(reference: string, version: number): AcknowledgementPayload {
  return {
    declarantPersonId: DECLARANT,
    slip: {
      declarantName: 'Achieng Wambui Otieno',
      commissionName: 'Public Service Commission',
      issuerCode: 'PSC',
      declarationType: 'biennial',
      statementDate: '2027-11-01',
      dueDate: '2027-12-31',
      reference,
      version,
      submittedAt: '2027-11-15T09:00:00.000Z',
      late: false,
      statementCount: 1,
      itemCount: 3,
    },
  };
}

/** A version of one declaration the fake declarations service has the payload of. */
function givenVersion(api: DocumentsApi, of: Declaration, version: number): Version {
  api.declarations.given('psc', of.declarationId, version, slipPayload(of.reference, version));
  return { ...of, versionId: randomUUID(), version };
}

function submitted({ declarationId, versionId, version, reference }: Version): EventEnvelope {
  return createEnvelope('adili/declarations', {
    type: DECLARATION_SUBMITTED,
    subject: declarationId,
    tenant: 'psc',
    data: {
      declarationId,
      versionId,
      version,
      reference,
      type: 'biennial',
      statementDate: '2027-11-01',
      obligationId: randomUUID(),
      amendment: version > 1,
      late: false,
    } satisfies DeclarationSubmittedData,
  });
}

function requested({ declarationId, versionId, version, reference }: Version): EventEnvelope {
  return createEnvelope('adili/declarations', {
    type: DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
    subject: declarationId,
    tenant: 'psc',
    data: {
      declarationId,
      versionId,
      version,
      reference,
    } satisfies DeclarationAcknowledgementRequestedData,
  });
}

async function slipOf(api: DocumentsApi, { versionId }: Version) {
  const [row] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx
      .select({ document: issuedDocuments, record: verificationRecords })
      .from(issuedDocuments)
      .innerJoin(verificationRecords, eq(verificationRecords.documentId, issuedDocuments.id))
      .where(eq(issuedDocuments.subjectRef, `declaration-version:${versionId}`)),
  );
  return row;
}

async function slips(api: DocumentsApi) {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(issuedDocuments),
  );
}

async function eventsOf<T extends Record<string, unknown>>(
  api: DocumentsApi,
  type: string,
): Promise<EventEnvelope<T>[]> {
  const events = await api.outbox();
  return events.filter((event) => event.type === type) as EventEnvelope<T>[];
}

describe('the acknowledgement consumer', () => {
  let api: DocumentsApi;

  beforeAll(async () => {
    api = await startDocumentsApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(() => {
    api.declarations.reset();
    api.renderer.up();
  });

  describe('S9 declaration.submitted.v1 issues the slip from the payload pulled by version', () => {
    it('issues it for the declarant, with the code and QR on the PDF, and announces it', async () => {
      const version = givenVersion(api, declaration(), 1);

      await api.consumers.submitted(submitted(version));

      expect(api.declarations.pulls).toEqual([
        { tenant: 'psc', declarationId: version.declarationId, version: 1 },
      ]);
      const slip = await slipOf(api, version);
      if (!slip) throw new Error('no slip issued');
      expect(slip.document).toMatchObject({
        tenant: 'psc',
        type: 'acknowledgement-slip',
        templateVersion: 1,
        disclosureLevel: 'restricted',
        subjectPersonId: DECLARANT,
        issuedBy: 'system:documents',
      });
      expect(slip.record.status).toBe('valid');

      const object = await api.s3.send(
        new GetObjectCommand({
          Bucket: requireEnv('S3_BUCKET_ISSUED'),
          Key: slip.document.objectKey,
        }),
      );
      const pdf = await (
        object.Body ?? { transformToByteArray: () => new Uint8Array() }
      ).transformToByteArray();
      const [text] = await pageTexts(pdf);
      expect(text).toContain('Achieng Wambui Otieno');
      expect(text).toContain(version.reference);
      expect(text).toContain('Version 1');
      expect(text).toContain(slip.document.verificationId);
      expect(await footerQrCodes(pdf)).toEqual([
        `${VERIFY_ORIGIN}/v/${slip.document.verificationId}`,
      ]);

      const [issued, ...more] = await eventsOf<DocumentIssuedData>(api, DOCUMENT_ISSUED);
      expect(more).toEqual([]);
      expect(issued?.data).toEqual({
        documentId: slip.document.id,
        verificationId: slip.document.verificationId,
        verifyUrl: `${VERIFY_ORIGIN}/v/${slip.document.verificationId}`,
        documentType: 'acknowledgement-slip',
        templateVersion: 1,
        disclosureLevel: 'restricted',
        issuerTenant: 'psc',
        subjectRef: `declaration-version:${version.versionId}`,
        // Restricted: reference, type, Commission, date and version; nothing about the declarant.
        publicPayload: {
          type: 'acknowledgement-slip',
          issuerName: 'Public Service Commission',
          issuerCode: 'PSC',
          issuedAt: slip.document.issuedAt.toISOString(),
          reference: version.reference,
          version: 1,
        },
        sha256: slip.document.sha256,
        issuedAt: slip.document.issuedAt.toISOString(),
        status: 'valid',
        expiresAt: null,
      });
      const outbox = JSON.stringify(await api.outbox());
      expect(outbox).not.toContain('Achieng');
      expect(outbox).not.toContain(DECLARANT);
    });

    it('handles a redelivered event once', async () => {
      const version = givenVersion(api, declaration(), 1);
      const event = submitted(version);

      await api.consumers.submitted(event);
      const before = await eventsOf(api, DOCUMENT_ISSUED);
      await api.consumers.submitted(event);

      expect(api.declarations.pulls).toHaveLength(1);
      expect(await eventsOf(api, DOCUMENT_ISSUED)).toHaveLength(before.length);
    });

    it('issues nothing, and leaves the event for the retry, when declarations is unreachable', async () => {
      const version = givenVersion(api, declaration(), 1);
      api.declarations.unavailable();
      const event = submitted(version);

      await expect(api.consumers.submitted(event)).rejects.toThrow('declarations unreachable');

      expect(await slipOf(api, version)).toBeUndefined();
      const handled = await api.db.select().from(inbox).where(eq(inbox.eventId, event.id));
      expect(handled).toEqual([]);
    });
  });

  describe('S10 a later version supersedes the earlier slip', () => {
    it('marks version 1 superseded by version 2 and announces it', async () => {
      const declared = declaration();
      const first = givenVersion(api, declared, 1);
      const second = givenVersion(api, declared, 2);

      await api.consumers.submitted(submitted(first));
      await api.consumers.submitted(submitted(second));

      const [one, two] = [await slipOf(api, first), await slipOf(api, second)];
      expect(two?.record).toMatchObject({ status: 'valid', supersededBy: null });
      expect(one?.record).toMatchObject({ status: 'superseded', supersededBy: two?.document.id });
      const superseded = await eventsOf<DocumentSupersededData>(api, DOCUMENT_SUPERSEDED);
      expect(
        superseded.filter((event) => event.data.documentId === one?.document.id),
      ).toMatchObject([
        {
          data: {
            status: 'superseded',
            supersededBy: two?.document.id,
            supersededByVerificationId: two?.document.verificationId,
          },
        },
      ]);
    });

    it('supersedes a slip issued late by the newer one already issued', async () => {
      const declared = declaration();
      const first = givenVersion(api, declared, 1);
      const second = givenVersion(api, declared, 2);

      // Version 1's slip failed and was asked for again after version 2's was issued.
      await api.consumers.submitted(submitted(second));
      await api.consumers.requested(requested(first));

      const [one, two] = [await slipOf(api, first), await slipOf(api, second)];
      expect(one?.record).toMatchObject({ status: 'superseded', supersededBy: two?.document.id });
      expect(two?.record.status).toBe('valid');
    });
  });

  describe('S11 Gotenberg down, then the reissue', () => {
    it('fails without issuing anything, and issues on the reissue once Gotenberg is back', async () => {
      const version = givenVersion(api, declaration(), 1);
      api.renderer.down();

      await expect(api.consumers.submitted(submitted(version))).rejects.toMatchObject({
        problem: { status: 502, type: 'renderer-unavailable' },
      });
      expect(await slipOf(api, version)).toBeUndefined();

      api.renderer.up();
      await api.consumers.requested(requested(version));

      const slip = await slipOf(api, version);
      expect(slip?.record.status).toBe('valid');
      expect(
        (await eventsOf<DocumentIssuedData>(api, DOCUMENT_ISSUED)).filter(
          (event) => event.data.documentId === slip?.document.id,
        ),
      ).toHaveLength(1);
    });

    it('announces a slip issued already again, issuing nothing new', async () => {
      const version = givenVersion(api, declaration(), 1);
      await api.consumers.submitted(submitted(version));
      const slip = await slipOf(api, version);
      const count = (await slips(api)).length;

      await api.consumers.requested(requested(version));

      expect((await slips(api)).length).toBe(count);
      const announced = (await eventsOf<DocumentIssuedData>(api, DOCUMENT_ISSUED)).filter(
        (event) => event.data.documentId === slip?.document.id,
      );
      expect(announced).toHaveLength(2);
      expect(announced[1]?.data).toEqual(announced[0]?.data);
    });
  });
});

describe('S11 through RabbitMQ: retried once, then dead-lettered', () => {
  let api: DocumentsApi;

  beforeAll(async () => {
    api = await startDocumentsApi({ events: true });
  });

  afterAll(async () => {
    await api.close();
  });

  it('dead-letters the submission while Gotenberg is down, and the reissue issues the slip', async () => {
    const version = givenVersion(api, declaration(), 1);
    api.renderer.down();
    const event = submitted(version);

    await api.publish(event);

    const deadLettered = await waitForDeadLetter(api, event.id);
    expect(deadLettered).toBe(true);
    // The first delivery and its one retry.
    expect(api.declarations.pulls).toHaveLength(2);
    expect(await slipOf(api, version)).toBeUndefined();

    api.renderer.up();
    await api.publish(requested(version));

    await waitFor(async () => (await slipOf(api, version))?.record.status === 'valid');
    expect(api.declarations.pulls).toHaveLength(3);
  }, 60_000);
});

/** Whether the event arrived on the suite's dead-letter queue within the time. */
async function waitForDeadLetter(api: DocumentsApi, eventId: string): Promise<boolean> {
  const connection = await amqp.connect(requireEnv('TEST_RABBITMQ_URL'));
  try {
    const channel = await connection.createChannel();
    let found = false;
    await waitFor(async () => {
      const message = await channel.get(deadLetterQueue(api.consumerService), { noAck: true });
      if (message === false) return false;
      const packet = JSON.parse(message.content.toString()) as { data: EventEnvelope };
      found = packet.data.id === eventId;
      return found;
    }, 30_000);
    return found;
  } finally {
    await connection.close();
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition not met in time');
}
