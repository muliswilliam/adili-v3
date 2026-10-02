import { randomBytes, randomUUID } from 'node:crypto';

import { createEnvelope, type EventEnvelope } from '@adili/events';
import {
  DECLARATION_ACKNOWLEDGED,
  DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
  DOCUMENT_ISSUED,
  type DocumentIssuedData,
  VERIFICATION_CHECKED,
  type VerificationOutcome,
} from '@adili/events/contracts';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AcknowledgementPayload } from '../../src/acknowledgement/representation.js';
import { ACKNOWLEDGEMENT_DEADLINE_MS } from '../../src/declaration/acknowledgement.js';
import { commissionRefs, declarationVersions, outbox } from '../../src/db/schema.js';
import type { Acknowledgement } from '../../src/declaration/representation.js';
import type { SubmissionResult } from '../../src/submission/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { DUE_DAY, submissionFixtures } from '../support/submission.js';

/**
 * Spec 06 S11 and S12 at the declarations service's seams: the payload the documents service
 * pulls (only what the slip prints), `document.issued.v1` setting the acknowledgement on its
 * version with `declaration.acknowledged.v1` and the declarant told by email and SMS (fake
 * notifications), the declarant's view of it and the reissue once it failed, and the verified
 * count from `verification.checked.v1`. Events carry identifiers only (S20).
 */

const ACKNOWLEDGEMENT = '/v1/declarations/{declarationId}/versions/{version}/acknowledgement';
const PAYLOAD =
  '/internal/v1/declarations/{declarationId}/versions/{version}/acknowledgement-payload';

const ACHIENG = randomUUID();
const OTHER = randomUUID();

/** The documents service's account (client credentials), acting for a Commission. */
const DOCUMENTS: Caller = {
  sub: 'service-account-documents',
  azp: 'documents',
  scope: 'declarations:internal',
};
const REPORTING_OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['reporting-officer'] };

let api: DeclarationsApi;
const { declarant, steppedUp, completeDraft, submit } = submissionFixtures(() => api);

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx
      .insert(commissionRefs)
      .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
  );
  api.clock.setToday(DUE_DAY);
});

interface Submitted {
  declarationId: string;
  versionId: string;
  reference: string;
}

/** Achieng's complete draft, submitted: version 1. */
async function submitted(personId = ACHIENG): Promise<Submitted> {
  const draft = await completeDraft(personId);
  const response = await submit(draft.id, steppedUp(personId));
  expect(response.statusCode, response.body).toBe(201);
  const { version } = response.json<SubmissionResult>();
  const [row] = await api.asPlatform((tx) =>
    tx
      .select({ id: declarationVersions.id })
      .from(declarationVersions)
      .where(eq(declarationVersions.declarationId, draft.id)),
  );
  if (!row) throw new Error('no version');
  return { declarationId: draft.id, versionId: row.id, reference: version.reference };
}

function payload(
  { declarationId }: Submitted,
  {
    version = 1,
    tenant = 'psc',
    caller = DOCUMENTS,
  }: { version?: number; tenant?: string | null; caller?: Caller } = {},
) {
  return api.request(
    'GET',
    `/internal/v1/declarations/${declarationId}/versions/${String(version)}/acknowledgement-payload`,
    caller,
    { headers: tenant === null ? {} : { 'x-acting-tenant': tenant } },
  );
}

function acknowledgement({ declarationId }: Submitted, caller: Caller, version = 1) {
  return api.get(
    `/v1/declarations/${declarationId}/versions/${String(version)}/acknowledgement`,
    caller,
  );
}

function reissue({ declarationId }: Submitted, caller: Caller, version = 1) {
  return api.request(
    'POST',
    `/v1/declarations/${declarationId}/versions/${String(version)}/acknowledgement/reissue`,
    caller,
  );
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A verification id in its printed form, as the documents service allocates them. */
function verificationId(): string {
  const body = [...randomBytes(26)].map((byte) => CROCKFORD[byte % 32]).join('');
  return `ADL-${body.match(/.{1,4}/g)?.join('-') ?? ''}`;
}

/** `document.issued.v1` of the version's slip, as the documents service emits it. */
function issued(
  { versionId, reference }: Submitted,
  overrides: Partial<DocumentIssuedData> = {},
): EventEnvelope<DocumentIssuedData> {
  const issuedAt = new Date().toISOString();
  const code = overrides.verificationId ?? verificationId();
  const data: DocumentIssuedData = {
    documentId: randomUUID(),
    verificationId: code,
    verifyUrl: `http://localhost:3030/v/${code}`,
    documentType: 'acknowledgement-slip',
    templateVersion: 1,
    disclosureLevel: 'restricted',
    issuerTenant: 'psc',
    subjectRef: `declaration-version:${versionId}`,
    publicPayload: {
      type: 'acknowledgement-slip',
      issuerName: 'Public Service Commission',
      issuerCode: 'PSC',
      issuedAt,
      reference,
      version: 1,
    },
    sha256: randomBytes(32).toString('hex'),
    issuedAt,
    status: 'valid',
    ...overrides,
  };
  return createEnvelope('adili/documents', {
    type: DOCUMENT_ISSUED,
    subject: data.documentId,
    tenant: data.issuerTenant,
    data,
  });
}

function checked(id: string, outcome: VerificationOutcome): EventEnvelope {
  return createEnvelope('adili/verification-api', {
    type: VERIFICATION_CHECKED,
    subject: id,
    data: { verificationId: id, outcome },
  });
}

/** The same event as a new envelope: the documents service announcing the slip again. */
function announcedAgain(event: EventEnvelope<DocumentIssuedData>): EventEnvelope {
  return createEnvelope('adili/documents', {
    type: DOCUMENT_ISSUED,
    subject: event.data.documentId,
    tenant: event.tenant,
    data: event.data,
  });
}

async function versionRow(versionId: string) {
  const [row] = await api.asPlatform((tx) =>
    tx.select().from(declarationVersions).where(eq(declarationVersions.id, versionId)),
  );
  if (!row) throw new Error(`no version ${versionId}`);
  return row;
}

async function events(type: string): Promise<EventEnvelope[]> {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
  return rows.map((row) => row.envelope);
}

describe('the acknowledgement payload the documents service pulls', () => {
  it('serves only what the slip prints, and the declarant it is for', async () => {
    const version = await submitted();

    const response = await payload(version);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<AcknowledgementPayload>();
    expect(contractErrors(okResponse(PAYLOAD, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      declarantPersonId: ACHIENG,
      slip: {
        declarantName: 'Achieng Wambui Otieno',
        commissionName: 'Public Service Commission',
        issuerCode: 'PSC',
        declarationType: 'biennial',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        reference: version.reference,
        version: 1,
        submittedAt: expect.any(String) as string,
        late: false,
        statementCount: 1,
        itemCount: 3,
      },
    });
    // What the audit trail records of the pull: identifiers, not the payload.
    const audit = (await events('audit.read.v1')).find((event) =>
      (event.data as { action: string }).action.includes('acknowledgement'),
    );
    expect(audit).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'declaration.acknowledgement-payload.pulled',
        resource: { type: 'declaration-version', subjectPersonId: ACHIENG },
        actor: { subject: 'service-account-documents', clientId: 'documents' },
      },
    });
    expect(JSON.stringify(audit)).not.toContain('Achieng');
  });

  it("is 404 for another Commission's or an unknown version, and refuses other tokens", async () => {
    const version = await submitted();

    expect((await payload(version, { tenant: 'tsc' })).statusCode).toBe(404);
    expect((await payload(version, { version: 2 })).statusCode).toBe(404);
    expect((await payload({ ...version, declarationId: randomUUID() })).statusCode).toBe(404);
    expect((await payload(version, { tenant: null })).statusCode).toBe(400);
    expect((await payload(version, { caller: declarant(ACHIENG) })).statusCode).toBe(403);
    expect((await payload(version, { caller: REPORTING_OFFICER })).statusCode).toBe(403);
  });
});

describe('document.issued.v1 sets the acknowledgement and tells the declarant (S12)', () => {
  it('sets the slip on the version, records declaration.acknowledged.v1 and sends email and SMS', async () => {
    const version = await submitted();
    const pending = await acknowledgement(version, declarant(ACHIENG));
    expect(pending.json<Acknowledgement>()).toMatchObject({
      status: 'pending',
      documentId: null,
      verifyUrl: null,
    });

    const event = issued(version);
    await api.acknowledgementConsumers.documentIssued(event);

    const row = await versionRow(version.versionId);
    expect(row).toMatchObject({
      ackStatus: 'issued',
      ackDocumentId: event.data.documentId,
      ackVerificationId: event.data.verificationId,
      ackVerifyUrl: event.data.verifyUrl,
      ackIssuedAt: new Date(event.data.issuedAt),
    });
    const response = await acknowledgement(version, declarant(ACHIENG));
    expect(response.statusCode).toBe(200);
    const body = response.json<Acknowledgement>();
    expect(contractErrors(okResponse(ACKNOWLEDGEMENT, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      status: 'issued',
      documentId: event.data.documentId,
      verificationId: event.data.verificationId,
      verifyUrl: event.data.verifyUrl,
      issuedAt: event.data.issuedAt,
      verifiedCount: 0,
      downloadUrl: null,
    });

    const [acknowledged, ...more] = await events(DECLARATION_ACKNOWLEDGED);
    expect(more).toEqual([]);
    expect(acknowledged).toMatchObject({
      source: 'adili/declarations',
      subject: version.declarationId,
      tenant: 'psc',
      data: {
        declarationId: version.declarationId,
        versionId: version.versionId,
        documentId: event.data.documentId,
        verificationId: event.data.verificationId,
      },
    });
    // Identifiers only (S20).
    expect(Object.keys(acknowledged?.data ?? {}).sort()).toEqual([
      'declarationId',
      'documentId',
      'verificationId',
      'versionId',
    ]);

    const params = {
      reference: version.reference,
      type: 'biennial',
      version: 1,
      commissionName: 'Public Service Commission',
      statementDate: '2027-11-01',
      verificationCode: event.data.verificationId,
      portalUrl: `http://localhost:3010/declarations/${version.declarationId}/submitted`,
    };
    expect(api.notifications.acknowledgements).toEqual([
      expect.objectContaining({ channel: 'email', personId: ACHIENG, tenant: 'psc', params }),
      expect.objectContaining({ channel: 'sms', personId: ACHIENG, tenant: 'psc', params }),
    ]);
    const [email, sms] = api.notifications.acknowledgements;
    expect(email?.idempotencyKey).not.toBe(sms?.idempotencyKey);
  });

  it('handles a redelivered event once, and a slip announced again changes nothing', async () => {
    const version = await submitted();
    const event = issued(version);

    await api.acknowledgementConsumers.documentIssued(event);
    await api.acknowledgementConsumers.documentIssued(event);
    expect(api.notifications.acknowledgements).toHaveLength(2);

    // Announced again (after a reissue): the same slip, no second event, the same keys, so
    // notifications sends nothing new.
    await api.acknowledgementConsumers.documentIssued(announcedAgain(event));
    expect(await events(DECLARATION_ACKNOWLEDGED)).toHaveLength(1);
    const [email, sms, emailAgain, smsAgain] = api.notifications.acknowledgements;
    expect(emailAgain?.idempotencyKey).toBe(email?.idempotencyKey);
    expect(smsAgain?.idempotencyKey).toBe(sms?.idempotencyKey);
    expect(emailAgain?.messageId).toBe(email?.messageId);
  });

  it('tells the declarant with no database transaction open, so a slow notifications holds nothing up', async () => {
    const version = await submitted();
    const event = issued(version);
    api.notifications.answer('email', 'held', 'sent');

    const first = api.acknowledgementConsumers.documentIssued(event);
    await until(() => api.notifications.acknowledgements.length === 1);
    // The transport delivers the event again while notifications has not answered the first
    // email: nothing of the first delivery is holding the inbox, so it goes through, under the
    // same keys (notifications sends each message once).
    await expect(within(api.acknowledgementConsumers.documentIssued(event), 5_000)).resolves.toBe(
      undefined,
    );
    api.notifications.release();
    await first;

    const [held, ...rest] = api.notifications.acknowledgements;
    expect(rest.map((message) => message.channel)).toEqual(['email', 'sms', 'sms']);
    expect(rest[0]?.idempotencyKey).toBe(held?.idempotencyKey);
    expect(rest[1]?.idempotencyKey).toBe(rest[2]?.idempotencyKey);
    expect(await events(DECLARATION_ACKNOWLEDGED)).toHaveLength(1);
  });

  it('shows the slip while notifications is down, and sends once it is back', async () => {
    const version = await submitted();
    const event = issued(version);
    api.notifications.answer('email', 'unreachable', 'sent');

    await expect(api.acknowledgementConsumers.documentIssued(event)).rejects.toThrow(
      'notifications unreachable',
    );
    expect(
      (await acknowledgement(version, declarant(ACHIENG))).json<Acknowledgement>().status,
    ).toBe('issued');

    // The transport's retry: the acknowledgement is not set twice; the messages go out.
    await api.acknowledgementConsumers.documentIssued(event);
    expect(await events(DECLARATION_ACKNOWLEDGED)).toHaveLength(1);
    expect(
      api.notifications.acknowledgements.map((message) => [
        message.channel,
        message.messageId !== null,
      ]),
    ).toEqual([
      ['email', false],
      ['email', true],
      ['sms', true],
    ]);
  });

  it('does not retry a message notifications could not send', async () => {
    const version = await submitted();
    api.notifications.answer('sms', { failed: 'no-contact' });

    await api.acknowledgementConsumers.documentIssued(issued(version));

    expect(api.notifications.channels()).toEqual([]);
    expect(api.notifications.acknowledgements.map((message) => message.channel)).toEqual([
      'email',
      'sms',
    ]);
  });

  it('ignores other documents and slips of versions it does not have', async () => {
    const version = await submitted();

    await api.acknowledgementConsumers.documentIssued(
      issued(version, { documentType: 'compliance-certificate' }),
    );
    await api.acknowledgementConsumers.documentIssued(
      issued(version, { subjectRef: `declaration-version:${randomUUID()}` }),
    );

    expect((await versionRow(version.versionId)).ackStatus).toBe('pending');
    expect(await events(DECLARATION_ACKNOWLEDGED)).toEqual([]);
    expect(api.notifications.acknowledgements).toEqual([]);
  });
});

describe("the declarant's acknowledgement and the reissue (S11)", () => {
  it("is the declarant's only: another declarant and staff get 404, no token 401", async () => {
    const version = await submitted();
    await submitted(OTHER);

    for (const caller of [declarant(OTHER), REPORTING_OFFICER]) {
      expect((await acknowledgement(version, caller)).statusCode).toBe(404);
      expect((await reissue(version, caller)).statusCode).toBe(404);
    }
    expect((await acknowledgement(version, declarant(ACHIENG), 2)).statusCode).toBe(404);
    const anonymous = await api.anonymous(
      `/v1/declarations/${version.declarationId}/versions/1/acknowledgement`,
    );
    expect(anonymous.statusCode).toBe(401);
    const anonymousReissue = await api.app.inject({
      method: 'POST',
      url: `/v1/declarations/${version.declarationId}/versions/1/acknowledgement/reissue`,
    });
    expect(anonymousReissue.statusCode).toBe(401);
  });

  it('asks again once the slip failed to come, then waits it out, and refuses an issued slip', async () => {
    const version = await submitted();
    const owner = declarant(ACHIENG);

    const early = await reissue(version, owner);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: 'acknowledgement-in-progress' });

    // Nothing came in time (Gotenberg down, the message dead-lettered): stored pending, shown
    // failed.
    api.clock.advance(ACKNOWLEDGEMENT_DEADLINE_MS + 1000);
    expect((await versionRow(version.versionId)).ackStatus).toBe('pending');
    expect((await acknowledgement(version, owner)).json<Acknowledgement>().status).toBe('failed');

    const asked = await reissue(version, owner);
    expect(asked.statusCode, asked.body).toBe(202);
    expect(asked.body).toBe('');
    const [requested, ...more] = await events(DECLARATION_ACKNOWLEDGEMENT_REQUESTED);
    expect(more).toEqual([]);
    expect(requested).toMatchObject({
      subject: version.declarationId,
      tenant: 'psc',
      data: {
        declarationId: version.declarationId,
        versionId: version.versionId,
        version: 1,
        reference: version.reference,
      },
    });
    expect(Object.keys(requested?.data ?? {}).sort()).toEqual([
      'declarationId',
      'reference',
      'version',
      'versionId',
    ]);
    expect((await acknowledgement(version, owner)).json<Acknowledgement>().status).toBe('pending');

    api.clock.advance(30_000);
    const again = await reissue(version, owner);
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({
      code: 'resend-cooldown',
      retryAfterSeconds: ACKNOWLEDGEMENT_DEADLINE_MS / 1000 - 30,
    });

    // The documents service issues it this time.
    await api.acknowledgementConsumers.documentIssued(issued(version));
    expect((await acknowledgement(version, owner)).json<Acknowledgement>().status).toBe('issued');
    const late = await reissue(version, owner);
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ code: 'acknowledgement-issued' });
    expect(await events(DECLARATION_ACKNOWLEDGEMENT_REQUESTED)).toHaveLength(1);
  });
});

describe('the verified count from verification.checked.v1', () => {
  it('counts every lookup of the slip once, whatever it answered, and nothing else', async () => {
    const version = await submitted();
    const event = issued(version);
    await api.acknowledgementConsumers.documentIssued(event);
    const code = event.data.verificationId;
    const valid = checked(code, 'valid');

    await api.acknowledgementConsumers.verificationChecked(valid);
    await api.acknowledgementConsumers.verificationChecked(valid);
    await api.acknowledgementConsumers.verificationChecked(checked(code, 'valid'));
    await api.acknowledgementConsumers.verificationChecked(checked(code, 'superseded'));
    await api.acknowledgementConsumers.verificationChecked(checked(verificationId(), 'valid'));
    await api.acknowledgementConsumers.verificationChecked(checked(verificationId(), 'not-found'));

    expect((await versionRow(version.versionId)).verifiedCount).toBe(3);
    expect(
      (await acknowledgement(version, declarant(ACHIENG))).json<Acknowledgement>().verifiedCount,
    ).toBe(3);
  });
});

/** Resolves once `condition` holds, polling; fails after five seconds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** `promise`, or a rejection once `ms` have passed without it settling. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`still waiting after ${String(ms)}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
