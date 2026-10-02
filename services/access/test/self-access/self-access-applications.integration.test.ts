import { randomUUID } from 'node:crypto';

import { ACCESS_CERTIFIED_COPY_ISSUED } from '@adili/events/contracts';
import { accessCertifiedCopyIssuedDataSchema } from '@adili/events/contracts/schemas';
import { DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRegister, selfAccessApplications } from '../../src/db/schema.js';
import type { VersionDocument } from '../../src/declarations/declarations-client.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { AccessHistoryEntry } from '../../src/history/representation.js';
import type { RosterCandidates } from '../../src/requests/officer-representation.js';
import type {
  DeclarantVersions,
  SelfAccessApplicationDetail,
  SelfAccessPage,
} from '../../src/self-access/application-representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { callers, declarantOf } from '../support/requests.js';

const NOW = '2027-05-10T07:30:00.000Z';
const DEADLINE = '2027-05-24T07:30:00.000Z';
const DECLARATION_ID = '0199c000-0000-7000-8000-000000000d01';
const DECLARATION_REFERENCE = 'DCI-PSC-2026-0000001-7';
const ID_NUMBER = '23456789';

const { officer, supervisor, tscOfficer, eacc } = callers;

const APPLICATIONS = '/v1/commissions/{slug}/access/self-access';
const APPLICATION = '/v1/access/self-access/{applicationId}';

/**
 * Written self-access applications (spec 10 slice #302, Administrative Mechanism 32): Anne Njeri
 * Mutua cannot use the portal, so her representative Joseph Kiprono applies in writing at the
 * PSC for a certified copy of her declaration. The access officer finds her on the roster, checks
 * Joseph's identity and written authority (both uploads), chooses the version and records it; the
 * copy is issued as the portal's are (declarations and documents faked), due 14 days from
 * receipt, registered `self-access` naming Joseph and shown in Anne's access history; then the
 * officer marks it collected.
 */
describe('Written self-access applications (#303)', () => {
  let api: AccessApi;
  let anne: RosterCandidateFacts;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Version 1 of Anne's initial declaration, superseded by version 2. */
  function version(n: number, submittedAt: string): VersionDocument {
    if (anne.personId === null) throw new Error('Anne is onboarded');
    return {
      declarationId: DECLARATION_ID,
      versionId: randomUUID(),
      version: n,
      personId: anne.personId,
      reference: DECLARATION_REFERENCE,
      type: 'initial',
      statementDate: '2026-12-31',
      submittedAt,
      canonicalSha256: 'a'.repeat(64),
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      declarantName: 'Anne Njeri Mutua',
      document: { schemaVersion: 'declaration.v1', type: 'initial' },
    };
  }

  function given(): void {
    api.clock.set(NOW);
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.givenCommission('tsc', 'Teachers Service Commission');
    anne = api.directory.givenRosterRecord('psc', {
      personnelFileNumber: 'PF-2011-004512',
      fullName: 'Anne Njeri Mutua',
    });
    api.declarations.givenFullDocument(version(1, '2027-01-15T09:12:00.000Z'));
    api.declarations.givenFullDocument(version(2, '2027-03-02T10:00:00.000Z'));
  }

  /** Joseph's written authority and ID, as the officer uploaded them. */
  function proofs(uploadedBy = officer.sub) {
    const authority = api.documents.givenUpload('psc', {
      uploadedBy,
      fileName: 'authority-letter.pdf',
    });
    const id = api.documents.givenUpload('psc', { uploadedBy, fileName: 'joseph-id.jpg' });
    return { authority, id };
  }

  function application(overrides: Record<string, unknown> = {}) {
    const { authority, id } = proofs();
    return {
      rosterRecordId: anne.id,
      declarationId: DECLARATION_ID,
      version: 1,
      identityNote: "Joseph's national ID seen against him; Anne's signed authority checked.",
      representative: {
        name: 'Joseph Kiprono',
        idNumber: ID_NUMBER,
        authorityUploadId: authority.id,
        idUploadId: id.id,
      },
      deliveryMethod: 'collection',
      ...overrides,
    };
  }

  const record = (body: unknown, caller: Caller = officer, slug = 'psc') =>
    api.send('POST', `/v1/commissions/${slug}/access/self-access`, caller, body, {
      'idempotency-key': randomUUID(),
    });

  const detailOf = async (id: string): Promise<SelfAccessApplicationDetail> => {
    const response = await api.get(`/v1/access/self-access/${id}`, officer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SelfAccessApplicationDetail>();
  };

  const untilIssued = (id: string) =>
    api.eventually(async () => {
      const found = await detailOf(id);
      return found.status === 'issued' ? found : undefined;
    });

  const deliver = (id: string, caller: Caller = officer) =>
    api.send('POST', `/v1/access/self-access/${id}/delivered`, caller, {});

  it('S13: the officer finds the declarant on the roster and lists the versions a copy can be of', async () => {
    given();

    const search = await api.get(
      '/v1/commissions/psc/access/self-access/declarants?q=anne',
      officer,
    );
    expect(search.statusCode, search.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/commissions/{slug}/access/self-access/declarants', 'get', 200),
        search.json(),
      ),
    ).toEqual([]);
    expect(search.json<RosterCandidates>().items).toEqual([
      expect.objectContaining({ id: anne.id, fullName: 'Anne Njeri Mutua', onboarded: true }),
    ]);

    const response = await api.get(
      `/v1/commissions/psc/access/self-access/declarants/${anne.id}/versions`,
      officer,
    );
    expect(response.statusCode, response.body).toBe(200);
    const versions = response.json<DeclarantVersions>();
    expect(
      contractErrors(
        okResponse(
          '/v1/commissions/{slug}/access/self-access/declarants/{rosterRecordId}/versions',
          'get',
          200,
        ),
        versions,
      ),
    ).toEqual([]);
    expect(versions).toEqual({
      declarant: {
        rosterRecordId: anne.id,
        personnelFileNumber: 'PF-2011-004512',
        fullName: 'Anne Njeri Mutua',
        onboarded: true,
      },
      versions: [
        expect.objectContaining({
          version: 2,
          reference: DECLARATION_REFERENCE,
          superseded: false,
        }),
        expect.objectContaining({ version: 1, superseded: true }),
      ],
    });
    expect(api.declarations.personVersionsCalls).toEqual([
      { tenant: 'psc', personId: anne.personId },
    ]);

    // A record not onboarded has no declarations; one the PSC does not have is 404.
    const notOnboarded = api.directory.givenRosterRecord('psc', { personId: null });
    const none = await api.get(
      `/v1/commissions/psc/access/self-access/declarants/${notOnboarded.id}/versions`,
      officer,
    );
    expect(none.json<DeclarantVersions>()).toMatchObject({
      declarant: { onboarded: false },
      versions: [],
    });
    const unknown = await api.get(
      `/v1/commissions/psc/access/self-access/declarants/${randomUUID()}/versions`,
      officer,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it("S13: a representative's application is recorded, its certified copy issued as Anne's, registered self-access naming him and shown in her history", async () => {
    given();
    const body = application();

    const response = await record(body);

    expect(response.statusCode, response.body).toBe(201);
    const recorded = response.json<SelfAccessApplicationDetail>();
    expect(contractErrors(okResponse(APPLICATIONS, 'post', 201), recorded)).toEqual([]);
    expect(recorded).toMatchObject({
      status: 'recorded',
      declarant: {
        rosterRecordId: anne.id,
        fullName: 'Anne Njeri Mutua',
        personnelFileNumber: 'PF-2011-004512',
      },
      declarationId: DECLARATION_ID,
      version: 1,
      declarationReference: DECLARATION_REFERENCE,
      representative: {
        name: 'Joseph Kiprono',
        idNumber: ID_NUMBER,
        authority: {
          uploadId: body.representative.authorityUploadId,
          fileName: 'authority-letter.pdf',
        },
        identification: { uploadId: body.representative.idUploadId, fileName: 'joseph-id.jpg' },
      },
      deliveryMethod: 'collection',
      receivedAt: NOW,
      deadlineAt: DEADLINE,
      late: false,
      deliveredAt: null,
      recordedBy: 'Peter Access',
      recordedByCaller: true,
      certifiedCopy: { status: 'pending', declarationId: DECLARATION_ID, version: 1 },
    });
    // The proofs are linked, kept from documents' orphan sweep.
    expect(api.documents.linked).toEqual([
      body.representative.authorityUploadId,
      body.representative.idUploadId,
    ]);
    // Joseph's ID number is stored encrypted only.
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(selfAccessApplications).where(eq(selfAccessApplications.id, recorded.id)),
    );
    expect(row?.representativeIdCiphertext).toEqual(expect.any(String));
    expect(JSON.stringify(row)).not.toContain(ID_NUMBER);

    const issued = await untilIssued(recorded.id);
    expect(issued.certifiedCopy).toMatchObject({
      status: 'issued',
      reference: DECLARATION_REFERENCE,
      verificationId: 'ADL-TEST-1',
    });
    expect(contractErrors(okResponse(APPLICATION, 'get', 200), issued)).toEqual([]);

    // Read in full for Anne with the officer as who asked and Joseph, who collects it, as
    // recipient; issued as her Restricted copy.
    expect(api.declarations.fullDocumentCalls).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        version: 1,
        personId: anne.personId,
        actingSubject: officer.sub,
        recipient: 'Joseph Kiprono',
      }),
    ]);
    expect(api.documents.issued).toEqual([
      expect.objectContaining({
        type: 'certified-copy',
        subjectRef: `certified-copy:${issued.certifiedCopy.id}`,
        subjectPersonId: anne.personId,
        // The recording officer may download it to hand it over; no other officer may.
        additionalDownloaders: [officer.sub],
      }),
    ]);
    // Another access officer of the PSC reads the application but is not the one named on it.
    const colleague = await api.get(`/v1/access/self-access/${recorded.id}`, {
      ...officer,
      sub: 'access-officer-2',
      name: 'Grace Access',
    });
    expect(colleague.json<SelfAccessApplicationDetail>().recordedByCaller).toBe(false);

    // Registered self-access, with the officer acting and Joseph named; its event carries ids only.
    const entries = await api.asPlatform((tx) =>
      tx.select().from(accessRegister).where(eq(accessRegister.subjectId, issued.certifiedCopy.id)),
    );
    expect(entries).toEqual([
      expect.objectContaining({
        subjectKind: 'self-access',
        kind: 'self-access',
        legalBasis: 'self-access',
        personId: anne.personId,
        actor: officer.sub,
        actorName: 'Peter Access',
        details: expect.objectContaining({
          applicationId: recorded.id,
          representativeName: 'Joseph Kiprono',
        }) as unknown,
      }),
    ]);
    const [event] = await api.events(ACCESS_CERTIFIED_COPY_ISSUED);
    expect(accessCertifiedCopyIssuedDataSchema.parse(event?.data)).toMatchObject({
      applicationId: recorded.id,
      personId: anne.personId,
    });
    expect(JSON.stringify(event)).not.toContain('Joseph');
    expect(JSON.stringify(event)).not.toContain(ID_NUMBER);

    // Anne sees it in Who accessed my declaration, with Joseph named and no staff name.
    const history = await api.get('/v1/me/access-history', declarantOf(anne));
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json<AccessHistoryEntry[]>()).toEqual([
      expect.objectContaining({
        kind: 'self-access',
        actor: null,
        reference: DECLARATION_REFERENCE,
        certifiedCopy: expect.objectContaining({
          id: issued.certifiedCopy.id,
          representativeName: 'Joseph Kiprono',
        }) as unknown,
      }),
    ]);
    // And among her certified copies.
    const copies = await api.get('/v1/me/certified-copies', declarantOf(anne));
    expect(copies.json<{ id: string }[]>().map((copy) => copy.id)).toEqual([
      issued.certifiedCopy.id,
    ]);
  });

  it('S13: the declarant applying in person needs no representative; the register names none', async () => {
    given();

    const response = await record(
      application({ representative: null, version: 2, deliveryMethod: 'dispatch' }),
    );

    expect(response.statusCode, response.body).toBe(201);
    const recorded = response.json<SelfAccessApplicationDetail>();
    expect(recorded).toMatchObject({
      representative: null,
      deliveryMethod: 'dispatch',
      version: 2,
    });
    const issued = await untilIssued(recorded.id);
    const [entry] = await api.asPlatform((tx) =>
      tx.select().from(accessRegister).where(eq(accessRegister.subjectId, issued.certifiedCopy.id)),
    );
    expect(entry?.details).toMatchObject({ applicationId: recorded.id, representativeName: null });
    expect(api.documents.linked).toEqual([]);
    // Recording it is a write: its audit record, in its transaction (ADR-008), ids only.
    expect(await api.events('access.self-access-application.recorded.v1')).toEqual([
      expect.objectContaining({
        subject: recorded.id,
        tenant: 'psc',
        data: {
          applicationId: recorded.id,
          certifiedCopyId: issued.certifiedCopy.id,
          tenant: 'psc',
          personId: anne.personId,
          deliveryMethod: 'dispatch',
          actor: officer.sub,
          at: expect.any(String) as unknown,
          declarationId: recorded.declarationId,
          version: 2,
          byRepresentative: false,
        },
      }),
    ]);
    // Declarations audits the read as handed to Anne herself, asked by the officer.
    expect(api.declarations.fullDocumentCalls).toEqual([
      expect.objectContaining({
        personId: anne.personId,
        actingSubject: officer.sub,
        recipient: `person:${anne.personId}`,
      }),
    ]);
  });

  it('S13: the issued copy is marked collected once; not before it is issued', async () => {
    given();
    // Documents down at first: the copy waits for the activity's retry, a second later.
    api.documents.failCalls(1);
    const recorded = (
      await record(application({ representative: null }))
    ).json<SelfAccessApplicationDetail>();

    const early = await deliver(recorded.id);
    expect(early.statusCode, early.body).toBe(409);
    expect(early.json<{ detail: string }>().detail).toContain('not issued yet');
    await untilIssued(recorded.id);

    api.clock.set('2027-05-12T08:00:00.000Z');
    const marked = await deliver(recorded.id);
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json<SelfAccessApplicationDetail>()).toMatchObject({
      status: 'delivered',
      deliveredAt: '2027-05-12T08:00:00.000Z',
    });
    expect(
      contractErrors(okResponse(`${APPLICATION}/delivered`, 'post', 200), marked.json()),
    ).toEqual([]);

    const again = await deliver(recorded.id);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ detail: string }>().detail).toContain('collected');
    // Marking it delivered is a write: its audit record, once (ADR-008).
    expect(await api.events('access.self-access-application.delivered.v1')).toEqual([
      expect.objectContaining({
        subject: recorded.id,
        data: expect.objectContaining({
          applicationId: recorded.id,
          deliveryMethod: 'collection',
          actor: officer.sub,
          at: '2027-05-12T08:00:00.000Z',
        }) as unknown,
      }),
    ]);
  });

  it('S13: the list shows each application with its 14-day deadline, earliest first, late only when not issued in time', async () => {
    given();
    const first = (await record(application())).json<SelfAccessApplicationDetail>();
    await untilIssued(first.id);
    api.clock.set('2027-05-11T07:30:00.000Z');
    const second = (
      await record(application({ representative: null, version: 2 }))
    ).json<SelfAccessApplicationDetail>();
    await untilIssued(second.id);

    // Long after both deadlines: issued in time, so neither is late.
    api.clock.set('2027-07-01T00:00:00.000Z');
    const before = (await api.events('audit.read.v1')).length;
    const response = await api.get('/v1/commissions/psc/access/self-access', supervisor);

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<SelfAccessPage>();
    expect(contractErrors(okResponse(APPLICATIONS, 'get', 200), page)).toEqual([]);
    expect(page.items.map((item) => [item.id, item.deadlineAt, item.late])).toEqual([
      [first.id, DEADLINE, false],
      [second.id, '2027-05-25T07:30:00.000Z', false],
    ]);
    expect(page.items[0]?.representative).not.toHaveProperty('idNumber');
    // It returns declarant names: audited, naming the applications served (ADR-008).
    expect((await api.events('audit.read.v1')).slice(before)).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          action: 'access.self-access.listed',
          resource: expect.objectContaining({
            type: 'self-access-application',
            ids: [first.id, second.id],
          }) as unknown,
        }) as unknown,
      }),
    ]);

    const firstPage = await api.get('/v1/commissions/psc/access/self-access?limit=1', officer);
    const { nextCursor } = firstPage.json<SelfAccessPage>();
    expect(nextCursor).toEqual(expect.any(String));
    const rest = await api.get(
      `/v1/commissions/psc/access/self-access?limit=1&cursor=${nextCursor ?? ''}`,
      officer,
    );
    expect(rest.json<SelfAccessPage>().items.map((item) => item.id)).toEqual([second.id]);

    const issued = await api.get('/v1/commissions/psc/access/self-access?status=recorded', officer);
    expect(issued.json<SelfAccessPage>().items).toEqual([]);
  });

  it('S13: the list puts applications still to hand over first, earliest deadline first, then the delivered ones, latest deadline first', async () => {
    given();
    const recordOn = async (at: string) => {
      api.clock.set(at);
      const recorded = (
        await record(application({ representative: null }))
      ).json<SelfAccessApplicationDetail>();
      await untilIssued(recorded.id);
      return recorded.id;
    };
    const oldest = await recordOn('2027-05-10T07:30:00.000Z');
    const older = await recordOn('2027-05-11T07:30:00.000Z');
    const newer = await recordOn('2027-05-12T07:30:00.000Z');
    const newest = await recordOn('2027-05-13T07:30:00.000Z');
    expect((await deliver(oldest)).statusCode).toBe(200);
    expect((await deliver(newer)).statusCode).toBe(200);

    const all = await api.get('/v1/commissions/psc/access/self-access', officer);
    expect(all.json<SelfAccessPage>().items.map((item) => item.id)).toEqual([
      older,
      newest,
      newer,
      oldest,
    ]);

    // Page by page, across the open and the delivered ones.
    const seen: string[] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const response = await api.get(
        `/v1/commissions/psc/access/self-access?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        officer,
      );
      const page: SelfAccessPage = response.json<SelfAccessPage>();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([older, newest, newer, oldest]);
  });

  describe('refusals', () => {
    it('400 for a roster record the Commission does not have or that has not onboarded', async () => {
      given();
      const notOnboarded = api.directory.givenRosterRecord('psc', { personId: null });
      const elsewhere = api.directory.givenRosterRecord('tsc');

      for (const rosterRecordId of [notOnboarded.id, elsewhere.id, randomUUID()]) {
        const response = await record(application({ rosterRecordId }));
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json<{ errors: { path: string }[] }>().errors).toEqual([
          expect.objectContaining({ path: 'rosterRecordId' }),
        ]);
      }
      expect(await rows()).toEqual([]);
    });

    it('400 at version for a version that is not one Anne submitted at the PSC', async () => {
      given();

      const response = await record(application({ version: 3 }));

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json<{ errors: { path: string }[] }>().errors).toEqual([
        expect.objectContaining({ path: 'version' }),
      ]);
    });

    it("400 at the upload for proofs that are not the officer's clean access-representation uploads", async () => {
      given();
      const someoneElses = api.documents.givenUpload('psc', { uploadedBy: 'declarant-x' });
      const otherPurpose = api.documents.givenUpload('psc', {
        uploadedBy: officer.sub,
        purpose: 'declaration-attachment',
      });
      const unclean = api.documents.givenUpload('psc', { uploadedBy: officer.sub, clean: false });

      for (const [authority, id, message] of [
        [someoneElses.id, otherPurpose.id, ['is not an upload of yours', 'is not an upload for']],
        [unclean.id, randomUUID(), ['is not clean', 'is not an upload of yours']],
      ] as const) {
        const response = await record(
          application({
            representative: {
              name: 'Joseph Kiprono',
              idNumber: ID_NUMBER,
              authorityUploadId: authority,
              idUploadId: id,
            },
          }),
        );
        expect(response.statusCode, response.body).toBe(400);
        const errors = response.json<{ errors: { path: string; message: string }[] }>().errors;
        expect(errors).toEqual([
          {
            path: 'representative.authorityUploadId',
            message: expect.stringContaining(message[0]) as unknown,
          },
          {
            path: 'representative.idUploadId',
            message: expect.stringContaining(message[1]) as unknown,
          },
        ]);
      }
      expect(api.documents.linked).toEqual([]);
      expect(await rows()).toEqual([]);
    });

    it('400 for a body without the identity check, with one upload for both proofs, or with unknown keys', async () => {
      given();
      const { authority } = proofs();
      const paths = async (body: unknown) =>
        (await record(body)).json<{ errors: { path: string }[] }>().errors.map((e) => e.path);

      expect(await paths(application({ identityNote: ' ' }))).toEqual(['identityNote']);
      expect(
        await paths(
          application({
            representative: {
              name: 'Joseph Kiprono',
              idNumber: ID_NUMBER,
              authorityUploadId: authority.id,
              idUploadId: authority.id,
            },
          }),
        ),
      ).toEqual(['representative.idUploadId']);
      expect(await paths(application({ deliveryMethod: 'courier', note: 'x' }))).toEqual(
        expect.arrayContaining(['deliveryMethod']),
      );
    });

    it('requires an Idempotency-Key to record', async () => {
      given();
      const response = await api.send(
        'POST',
        '/v1/commissions/psc/access/self-access',
        officer,
        application(),
      );
      expect(response.statusCode).toBe(400);
    });

    it('S16: the supervisor reads but does not act (403); other Commissions, EACC and declarants see nothing', async () => {
      given();
      const recorded = (await record(application())).json<SelfAccessApplicationDetail>();
      await untilIssued(recorded.id);

      expect((await record(application(), supervisor)).statusCode).toBe(403);
      expect(
        (await api.get('/v1/commissions/psc/access/self-access/declarants?q=anne', supervisor))
          .statusCode,
      ).toBe(403);
      expect((await deliver(recorded.id, supervisor)).statusCode).toBe(403);
      expect((await api.get(`/v1/access/self-access/${recorded.id}`, supervisor)).statusCode).toBe(
        200,
      );

      for (const caller of [tscOfficer, eacc] as Caller[]) {
        expect((await record(application(), caller)).statusCode).toBe(404);
        expect((await api.get('/v1/commissions/psc/access/self-access', caller)).statusCode).toBe(
          404,
        );
        expect((await api.get(`/v1/access/self-access/${recorded.id}`, caller)).statusCode).toBe(
          404,
        );
        expect((await deliver(recorded.id, caller)).statusCode).toBe(404);
      }
      const declarant = { sub: 'd', roles: [DECLARANT], tenant: 'psc', personId: randomUUID() };
      expect((await api.get('/v1/commissions/psc/access/self-access', declarant)).statusCode).toBe(
        403,
      );
    });

    it('503 with nothing recorded when the directory, declarations or the key service is down', async () => {
      given();

      api.directory.failCalls(1);
      expect((await record(application())).statusCode).toBe(503);
      api.declarations.failCalls(1);
      expect((await record(application())).statusCode).toBe(503);
      api.cipher.unavailable = true;
      try {
        expect((await record(application())).statusCode).toBe(503);
      } finally {
        api.cipher.unavailable = false;
      }

      expect(await rows()).toEqual([]);
      expect(api.documents.linked).toEqual([]);
    });
  });

  const rows = () => api.asPlatform((tx) => tx.select().from(selfAccessApplications));
});
