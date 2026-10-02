import { randomUUID } from 'node:crypto';

import { ACCESS_CERTIFIED_COPY_ISSUED } from '@adili/events/contracts';
import { accessCertifiedCopyIssuedDataSchema } from '@adili/events/contracts/schemas';
import { APPLICANT, DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TRANSACTION_OPEN } from '../../src/activity-retry.js';
import { accessRegister } from '../../src/db/schema.js';
import type { VersionDocument } from '../../src/declarations/declarations-client.js';
import { CertifiedCopyIssuance } from '../../src/self-access/certified-copy-issuance.js';
import { certifiedCopyWorkflowId } from '../../src/self-access/contract.js';
import type { CertifiedCopy } from '../../src/self-access/representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';

const NOW = '2027-05-10T07:30:00.000Z';
const DECLARATION_ID = '0199c000-0000-7000-8000-000000000d01';
const DECLARATION_REFERENCE = 'DCI-PSC-2026-0000001-7';

/** Anne Njeri Mutua, a declarant of the PSC, signed in to the portal. */
const anne = {
  sub: 'declarant-anne',
  roles: [DECLARANT],
  tenant: 'psc',
  personId: randomUUID(),
  name: 'Anne Njeri Mutua',
} satisfies Caller;

/** Another declarant. */
const otieno = {
  sub: 'declarant-otieno',
  roles: [DECLARANT],
  tenant: 'psc',
  personId: randomUUID(),
  name: 'Otieno Wekesa',
} satisfies Caller;

/** Version 1 of Anne's initial declaration, as declarations renders it in full. */
function versionOne(): VersionDocument {
  return {
    declarationId: DECLARATION_ID,
    versionId: randomUUID(),
    version: 1,
    personId: anne.personId,
    reference: DECLARATION_REFERENCE,
    type: 'initial',
    statementDate: '2026-12-31',
    submittedAt: '2027-01-15T09:12:00.000Z',
    canonicalSha256: 'a'.repeat(64),
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    declarantName: 'Anne Njeri Mutua',
    document: { schemaVersion: 'declaration.v1', type: 'initial' },
  };
}

/**
 * Certified copies (S13, Administrative Mechanism 32): the declarant asks for a copy of a
 * submitted version; declarations renders it in full (faked) and documents issues it as their
 * Restricted `certified-copy`, which only they may download (documents' rule, #258); the copy is
 * registered `self-access`. Another person sees none of it.
 */
describe('Certified copies (S13)', () => {
  let api: AccessApi;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function given(): void {
    api.clock.set(NOW);
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.declarations.givenFullDocument(versionOne());
  }

  const ask = (
    caller: Caller = anne,
    body: unknown = { commission: 'psc', declarationId: DECLARATION_ID, version: 1 },
  ) => api.send('POST', '/v1/me/certified-copies', caller, body);

  const copyOf = async (id: string, caller: Caller = anne): Promise<CertifiedCopy> => {
    const response = await api.get(`/v1/me/certified-copies/${id}`, caller);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<CertifiedCopy>();
  };

  const untilSettled = (id: string, caller: Caller = anne) =>
    api.eventually(async () => {
      const copy = await copyOf(id, caller);
      return copy.status === 'pending' ? undefined : copy;
    });

  it('S13: the declarant asks for version 1; it is issued as their Restricted certified copy from the full document and registered self-access', async () => {
    given();

    const response = await ask();

    expect(response.statusCode, response.body).toBe(202);
    const pending = response.json<CertifiedCopy>();
    expect(contractErrors(okResponse('/v1/me/certified-copies', 'post', 202), pending)).toEqual([]);
    expect(pending).toMatchObject({
      commission: { slug: 'psc', name: 'Public Service Commission' },
      declarationId: DECLARATION_ID,
      version: 1,
      status: 'pending',
      reference: null,
      documentId: null,
      requestedAt: NOW,
    });

    const issued = await untilSettled(pending.id);
    expect(issued).toMatchObject({
      status: 'issued',
      reference: DECLARATION_REFERENCE,
      verificationId: 'ADL-TEST-1',
      issuedAt: NOW,
    });
    expect(issued.documentId).toEqual(expect.any(String));
    expect(
      contractErrors(okResponse('/v1/me/certified-copies/{copyId}', 'get', 200), issued),
    ).toEqual([]);

    // The version in full, read for Anne at the PSC and audited there with her as recipient.
    expect(api.declarations.fullDocumentCalls).toEqual([
      {
        tenant: 'psc',
        declarationId: DECLARATION_ID,
        version: 1,
        personId: anne.personId,
        actingSubject: anne.sub,
        recipient: anne.sub,
      },
    ]);
    // Issued as her Restricted certified copy: she alone may download it; no watermark, no window.
    const { document, ...full } = versionOne();
    expect(api.documents.issued).toEqual([
      {
        tenant: 'psc',
        type: 'certified-copy',
        templateVersion: 1,
        subjectRef: `certified-copy:${pending.id}`,
        subjectPersonId: anne.personId,
        payload: {
          commission: full.commission,
          declarantName: full.declarantName,
          reference: full.reference,
          version: 1,
          type: 'initial',
          statementDate: full.statementDate,
          submittedAt: full.submittedAt,
          document,
        },
        idempotencyKey: expect.any(String) as unknown,
      },
    ]);

    // Registered self-access (Administrative Mechanism 32), with its event.
    const entries = await api.asPlatform((tx) =>
      tx.select().from(accessRegister).where(eq(accessRegister.subjectId, pending.id)),
    );
    expect(entries).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        subjectKind: 'self-access',
        kind: 'self-access',
        legalBasis: 'self-access',
        personId: anne.personId,
        reference: null,
        actor: anne.sub,
        actorName: anne.name,
      }),
    ]);
    const [event] = await api.events(ACCESS_CERTIFIED_COPY_ISSUED);
    expect(event).toMatchObject({ tenant: 'psc', subject: pending.id });
    const data = accessCertifiedCopyIssuedDataSchema.parse(event?.data);
    expect(data).toMatchObject({
      declarationId: DECLARATION_ID,
      version: 1,
      documentId: issued.documentId,
      applicationId: null,
      personId: anne.personId,
    });
    // Identifiers only: no names or references of the declaration in the event.
    expect(JSON.stringify(event)).not.toContain('Anne');
    expect(JSON.stringify(event)).not.toContain(DECLARATION_REFERENCE);

    // Anne is told it is ready, by email and SMS, with the code to check it.
    await api.eventually(() => api.notifications.sent.length === 2);
    expect(api.notifications.sent).toEqual(
      ['email', 'sms'].map((channel) => ({
        channel,
        recipient: { kind: 'person', personId: anne.personId },
        template: `certified-copy-ready-${channel}`,
        params: {
          reference: DECLARATION_REFERENCE,
          version: 1,
          commissionName: 'Public Service Commission',
          verificationCode: 'ADL-TEST-1',
          signInUrl: 'http://localhost:3010/access/certified-copies',
        },
        tenant: 'psc',
        idempotencyKey: expect.any(String) as unknown,
      })),
    );
  });

  it('S13: asking again for the same version returns the same copy, issued once', async () => {
    given();
    const first = (await ask()).json<CertifiedCopy>();
    await untilSettled(first.id);

    const again = await ask();

    expect(again.statusCode, again.body).toBe(202);
    expect(again.json<CertifiedCopy>()).toMatchObject({ id: first.id, status: 'issued' });
    expect(api.documents.issued).toHaveLength(1);
    const list = await api.get('/v1/me/certified-copies', anne);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<CertifiedCopy[]>().map((copy) => copy.id)).toEqual([first.id]);
    expect(contractErrors(okResponse('/v1/me/certified-copies', 'get', 200), list.json())).toEqual(
      [],
    );
  });

  it("S13: another person sees nothing of Anne's copy (404), and asking for her version is 404 at once, with nothing ordered", async () => {
    given();
    const mine = (await ask()).json<CertifiedCopy>();
    await untilSettled(mine.id);

    expect((await api.get(`/v1/me/certified-copies/${mine.id}`, otieno)).statusCode).toBe(404);
    expect((await api.get('/v1/me/certified-copies', otieno)).json()).toEqual([]);

    // Declarations lists no such version of Otieno's at the PSC: 404, as if it did not exist.
    const theirs = await ask(otieno);
    expect(theirs.statusCode, theirs.body).toBe(404);
    expect(api.declarations.personVersionsCalls.at(-1)).toEqual({
      tenant: 'psc',
      personId: otieno.personId,
    });
    expect((await api.get('/v1/me/certified-copies', otieno)).json()).toEqual([]);
    expect(api.declarations.fullDocumentCalls).toHaveLength(1);
    expect(api.documents.issued).toHaveLength(1);
    expect(await api.events(ACCESS_CERTIFIED_COPY_ISSUED)).toHaveLength(1);
  });

  it('S13: a version number the declarant never submitted is 404, and declarations unreachable is 503, nothing ordered', async () => {
    given();
    const other = await ask(anne, { commission: 'psc', declarationId: DECLARATION_ID, version: 2 });
    expect(other.statusCode).toBe(404);

    api.declarations.failCalls(1, 'personVersions');
    const down = await ask();
    expect(down.statusCode).toBe(503);
    expect((await api.get('/v1/me/certified-copies', anne)).json()).toEqual([]);
  });

  it('S13: a failed copy is tried again when asked again', async () => {
    given();
    api.declarations.withholdFullDocuments();
    const first = (await ask()).json<CertifiedCopy>();
    expect(await untilSettled(first.id)).toMatchObject({ status: 'failed' });

    api.declarations.withholdFullDocuments(false);
    const again = await ask();

    expect(again.statusCode, again.body).toBe(202);
    expect(again.json<CertifiedCopy>()).toMatchObject({ id: first.id, status: 'pending' });
    expect(await untilSettled(first.id)).toMatchObject({ status: 'issued' });
  });

  it('S13: a failed copy ordered again is issued, even when its workflow runs before the order commits', async () => {
    given();
    api.declarations.withholdFullDocuments();
    const first = (await ask()).json<CertifiedCopy>();
    expect(await untilSettled(first.id)).toMatchObject({ status: 'failed' });
    api.declarations.withholdFullDocuments(false);

    // The order of it again stays open while the new run's first activity runs: the copy is
    // still `failed` to every other transaction until it commits.
    await api.asTenant({ tenant: 'psc', subject: anne.sub }, async (tx) => {
      const copy = await api.app.get(CertifiedCopyIssuance).order(tx, {
        tenant: 'psc',
        commissionName: 'Public Service Commission',
        personId: anne.personId,
        declarationId: DECLARATION_ID,
        version: 1,
        requestedBy: { subject: anne.sub, name: anne.name },
        applicationId: null,
        at: new Date(NOW),
      });
      expect(copy).toMatchObject({ id: first.id, status: 'pending' });
      const run = api.temporal.workflow.getHandle(certifiedCopyWorkflowId(copy.id));
      const pending = await api.eventually(async () => {
        const activity = (await run.describe()).raw.pendingActivities?.[0];
        return activity && (activity.attempt ?? 0) >= 2 ? activity : undefined;
      });
      expect(pending.lastFailure?.applicationFailureInfo?.type).toBe(TRANSACTION_OPEN);
    });

    expect(await untilSettled(first.id)).toMatchObject({ status: 'issued' });
    expect(api.documents.issued).toHaveLength(1);
  });

  it('S13: issuing refused by documents (not retried): the copy is recorded failed, and can be ordered again', async () => {
    given();
    api.documents.refuseCalls(1);

    const copy = (await ask()).json<CertifiedCopy>();

    expect(await untilSettled(copy.id)).toMatchObject({ status: 'failed' });
    expect(api.documents.issued).toHaveLength(0);
    const again = await ask();
    expect(again.json<CertifiedCopy>()).toMatchObject({ id: copy.id, status: 'pending' });
    expect(await untilSettled(copy.id)).toMatchObject({ status: 'issued' });
  });

  it('S13: declarations and documents outages delay the copy, never lose it', async () => {
    given();
    api.declarations.failCalls(1, 'fullDocument');
    api.documents.failCalls(1);

    const copy = (await ask()).json<CertifiedCopy>();

    expect(await untilSettled(copy.id)).toMatchObject({ status: 'issued' });
    expect(api.documents.issued).toHaveLength(1);
  });

  describe('refusals', () => {
    it('S16: only a declarant asks for or reads certified copies (403 otherwise)', async () => {
      given();
      const applicant = { sub: 'applicant', roles: [APPLICANT], personId: randomUUID() };
      expect((await ask(applicant)).statusCode).toBe(403);
      expect((await api.get('/v1/me/certified-copies', applicant)).statusCode).toBe(403);
    });

    it('400 for a body that is not a version of a declaration', async () => {
      given();
      const response = await ask(anne, { commission: 'psc', declarationId: 'x', version: 0 });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual([
        'declarationId',
        'version',
      ]);
    });

    it('404 for a Commission the directory does not know, 503 when it cannot be reached', async () => {
      given();
      const unknown = await ask(anne, {
        commission: 'nope',
        declarationId: DECLARATION_ID,
        version: 1,
      });
      expect(unknown.statusCode).toBe(404);

      api.directory.failCalls(1);
      const down = await ask();
      expect(down.statusCode).toBe(503);
      expect((await api.get('/v1/me/certified-copies', anne)).json()).toEqual([]);
    });

    it('404 for a copy id that is not a copy of theirs, 400 for one that is not a UUID', async () => {
      expect((await api.get(`/v1/me/certified-copies/${randomUUID()}`, anne)).statusCode).toBe(404);
      expect((await api.get('/v1/me/certified-copies/nope', anne)).statusCode).toBe(400);
    });
  });
});
