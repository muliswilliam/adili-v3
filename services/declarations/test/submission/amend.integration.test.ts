import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  declarationAttachments,
  declarationSections,
  declarationVersions,
  filingObligations,
  outbox,
} from '../../src/db/schema.js';
import type {
  Declaration,
  DeclarationAttachment,
  DeclarationListItem,
  DeclarationSummary,
} from '../../src/drafts/representation.js';
import type {
  DeclarationVersion,
  DeclarationVersionDetail,
  SubmissionResult,
} from '../../src/submission/representation.js';
import { contractErrors, okResponse, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { upload } from '../support/fake-documents.js';
import {
  ASSET,
  DUE_DATE,
  DUE_DAY,
  INCOME,
  LIABILITY,
  STATEMENT_DATE,
  submissionFixtures,
} from '../support/submission.js';

/**
 * Spec 06 S7 and S8 over HTTP against Postgres: amending a submitted declaration until its
 * obligation's due date (by the service's clock, Africa/Nairobi) reopens the version in force as
 * editable sections; submitting it files version 2 under the same reference and supersedes
 * version 1; discarding the amendment puts the declaration back as submitted, version 1
 * untouched. The versions list and detail, and "My declarations" as the portal renders it.
 */

const AMEND = '/v1/declarations/{declarationId}/amend';
const SUBMIT = '/v1/declarations/{declarationId}/submit';
const DISCARD = '/v1/declarations/{declarationId}/amend/discard';
const VERSIONS = '/v1/declarations/{declarationId}/versions';
const VERSION = '/v1/declarations/{declarationId}/versions/{version}';
const MINE = '/v1/me/declarations';
const ACHIENG = randomUUID();
const BARAKA = randomUUID();
const REFERENCE = 'DCB-PSC-2027-0000001-1';

let api: DeclarationsApi;
const { declarant, steppedUp, givenObligation, completeDraft, save, section, submit } =
  submissionFixtures(() => api);

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
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

function amend(id: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('POST', `/v1/declarations/${id}/amend`, caller);
}

function discardAmendment(id: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('POST', `/v1/declarations/${id}/amend/discard`, caller);
}

function versions(id: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('GET', `/v1/declarations/${id}/versions`, caller);
}

function version(id: string, n: number | string, caller: Caller = declarant(ACHIENG)) {
  return api.request('GET', `/v1/declarations/${id}/versions/${String(n)}`, caller);
}

function mine(personId = ACHIENG) {
  return api.request('GET', '/v1/me/declarations', declarant(personId));
}

/** Achieng's complete biennial of 2027, submitted as version 1. */
async function submitted(): Promise<{ declaration: Declaration; obligationId: string }> {
  const obligationId = await givenObligation(ACHIENG);
  const draft = await completeDraft(ACHIENG, obligationId);
  const response = await submit(draft.id, steppedUp(ACHIENG));
  expect(response.statusCode).toBe(201);
  return { declaration: response.json<SubmissionResult>().declaration, obligationId };
}

function versionRows(declarationId: string) {
  return api.asPlatform((tx) =>
    tx
      .select()
      .from(declarationVersions)
      .where(eq(declarationVersions.declarationId, declarationId))
      .orderBy(declarationVersions.version),
  );
}

function sectionRows(declarationId: string) {
  return api.asPlatform((tx) =>
    tx
      .select({
        key: declarationSections.sectionKey,
        completeness: declarationSections.completeness,
      })
      .from(declarationSections)
      .where(eq(declarationSections.declarationId, declarationId)),
  );
}

function attachmentRows(declarationId: string) {
  return api.asPlatform((tx) =>
    tx
      .select()
      .from(declarationAttachments)
      .where(eq(declarationAttachments.declarationId, declarationId)),
  );
}

function obligationOf(obligationId: string) {
  return api.asPlatform(async (tx) => {
    const [row] = await tx
      .select()
      .from(filingObligations)
      .where(eq(filingObligations.id, obligationId));
    return row;
  });
}

function events(type: string) {
  return api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
}

/** The officer's statement as saved, with the income's amount changed. */
async function editIncome(declarationId: string, kesCents: number): Promise<void> {
  const officer = await section(ACHIENG, declarationId, 'statement:officer');
  await save(ACHIENG, declarationId, 'statement:officer', {
    ...officer,
    income: [{ ...INCOME, amount: { kesCents } }],
  });
}

describe('amending before the due date (S7)', () => {
  it('reopens version 1 as editable sections, and files version 2 under the same reference', async () => {
    const { declaration, obligationId } = await submitted();
    const v1 = (await versionRows(declaration.id))[0];
    const filedAt = (await obligationOf(obligationId))?.filedAt;

    const response = await amend(declaration.id);

    expect(response.statusCode).toBe(200);
    const amending = response.json<Declaration>();
    expect(contractErrors(responseBody(AMEND, 'post', 200), amending)).toEqual([]);
    expect(amending).toMatchObject({
      status: 'amending',
      reference: REFERENCE,
      currentVersion: 1,
      amendingFromVersion: 1,
    });
    expect(amending.draftVersion).toBeGreaterThan(declaration.draftVersion);
    expect(response.headers.etag).toBe(`"${String(amending.draftVersion)}"`);
    // The sections hold version 1's document, each complete as it was filed.
    const detail = (await version(declaration.id, 1)).json<DeclarationVersionDetail>();
    const document = detail.document as {
      officer: unknown;
      spouses: unknown;
      children: unknown;
      statements: unknown[];
      otherInformation: unknown;
    };
    expect(await section(ACHIENG, declaration.id, 'bio')).toEqual(document.officer);
    expect(await section(ACHIENG, declaration.id, 'household')).toEqual({
      spouses: document.spouses,
      children: document.children,
    });
    expect(await section(ACHIENG, declaration.id, 'statement:officer')).toEqual(
      document.statements[0],
    );
    expect(await section(ACHIENG, declaration.id, 'other')).toEqual(document.otherInformation);
    expect(amending.sections.map((s) => [s.key, s.completeness])).toEqual([
      ['bio', 'complete'],
      ['household', 'complete'],
      ['statement:officer', 'complete'],
      ['other', 'complete'],
    ]);
    const [started] = await events('declaration.amendment-started.v1');
    expect(started?.envelope).toMatchObject({
      subject: declaration.id,
      tenant: 'psc',
      data: { declarationId: declaration.id, fromVersion: 1 },
    });
    // The summary offers to submit the amendment.
    const summary = await api.request(
      'GET',
      `/v1/declarations/${declaration.id}/summary`,
      declarant(ACHIENG),
    );
    expect(summary.json<DeclarationSummary>()).toMatchObject({
      canSubmit: true,
      cannotSubmitReason: null,
    });

    await editIncome(declaration.id, 510_000_000);
    const filed = await submit(declaration.id, steppedUp(ACHIENG));

    expect(filed.statusCode).toBe(201);
    const result = filed.json<SubmissionResult>();
    expect(result.version).toMatchObject({ version: 2, reference: REFERENCE, supersededAt: null });
    expect(result.declaration).toMatchObject({
      status: 'submitted',
      reference: REFERENCE,
      currentVersion: 2,
      amendingFromVersion: null,
    });
    const [first, second] = await versionRows(declaration.id);
    expect(first?.supersededAt?.toISOString()).toBe(result.version.submittedAt);
    expect(first?.canonicalSha256).toBe(v1?.canonicalSha256);
    expect(second?.reference).toBe(REFERENCE);
    const obligation = await obligationOf(obligationId);
    expect(obligation).toMatchObject({ status: 'filed', filedVersionId: second?.id, late: false });
    expect(obligation?.filedAt).toEqual(filedAt);
    // The documents service issues version 2's slip from this, superseding version 1's (#143).
    const submittedEvents = await events('declaration.submitted.v1');
    expect(submittedEvents.map((event) => event.envelope.data)).toContainEqual(
      expect.objectContaining({
        versionId: second?.id,
        version: 2,
        reference: REFERENCE,
        amendment: true,
      }),
    );

    // Newest first; the edit is in version 2 only.
    const listed = await versions(declaration.id);
    expect(listed.statusCode).toBe(200);
    const body = listed.json<DeclarationVersion[]>();
    expect(contractErrors(okResponse(VERSIONS, 'get'), body)).toEqual([]);
    expect(body.map((v) => [v.version, v.reference, v.supersededAt])).toEqual([
      [2, REFERENCE, null],
      [1, REFERENCE, result.version.submittedAt],
    ]);
    const incomeOf = async (n: number) => {
      const read = (await version(declaration.id, n)).json<DeclarationVersionDetail>();
      const statements = read.document.statements as { income: { amount: unknown }[] }[];
      return statements[0]?.income[0]?.amount;
    };
    expect(await incomeOf(2)).toEqual({ kesCents: 510_000_000 });
    expect(await incomeOf(1)).toEqual(INCOME.amount);
  });

  it('answers the amendment in progress again for a repeated amend, starting it once', async () => {
    const { declaration } = await submitted();
    expect((await amend(declaration.id)).statusCode).toBe(200);
    await editIncome(declaration.id, 1);

    const again = await amend(declaration.id);

    expect(again.statusCode).toBe(200);
    expect(again.json<Declaration>()).toMatchObject({ status: 'amending', amendingFromVersion: 1 });
    // The edit is kept: nothing was copied again.
    const officer = await section(ACHIENG, declaration.id, 'statement:officer');
    expect((officer.income as { amount: unknown }[])[0]?.amount).toEqual({ kesCents: 1 });
    expect(await events('declaration.amendment-started.v1')).toHaveLength(1);
  });

  it('is open on the due date itself', async () => {
    const { declaration } = await submitted();
    api.clock.setToday(DUE_DATE);

    expect((await amend(declaration.id)).statusCode).toBe(200);
  });

  it('refuses a declaration never submitted (409 not-submitted)', async () => {
    const draft = await completeDraft(ACHIENG);

    const response = await amend(draft.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'not-submitted' });
    expect(contractErrors(responseBody(AMEND, 'post', 409), response.json())).toEqual([]);
  });

  it('carries attachments into the amendment and version 2', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    const deed = upload('psc', { fileName: 'title-deed.pdf' });
    api.documents.givenUploads(deed);
    const linked = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/attachments`,
      declarant(ACHIENG),
      { body: { sectionKey: 'statement:officer', itemId: ASSET.id, uploadId: deed.id } },
    );
    expect(linked.statusCode).toBe(201);
    const attachment = linked.json<DeclarationAttachment>();
    // The item's reference carries the link's id, as declaration.v1 requires, so it submits.
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);

    expect((await amend(draft.id)).statusCode).toBe(200);

    const officer = await section(ACHIENG, draft.id, 'statement:officer');
    expect((officer.assets as { attachments: unknown }[])[0]?.attachments).toEqual([
      {
        attachmentId: attachment.id,
        uploadId: deed.id,
        fileName: 'title-deed.pdf',
        sha256: deed.sha256,
      },
    ]);
    expect((await attachmentRows(draft.id)).map((row) => row.id)).toEqual([attachment.id]);
  });
});

describe('amending after the due date, and discarding an amendment (S8)', () => {
  it('refuses to amend after the due date (409 amendment-window-closed) and changes nothing', async () => {
    const { declaration } = await submitted();
    api.clock.setToday('2028-01-01');

    const response = await amend(declaration.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'amendment-window-closed' });
    expect(contractErrors(responseBody(AMEND, 'post', 409), response.json())).toEqual([]);
    const read = await api.request('GET', `/v1/declarations/${declaration.id}`, declarant(ACHIENG));
    expect(read.json<Declaration>()).toMatchObject({
      status: 'submitted',
      amendingFromVersion: null,
      draftVersion: declaration.draftVersion,
    });
    expect(await events('declaration.amendment-started.v1')).toEqual([]);
  });

  it('refuses to submit an amendment started before the due date once it has passed (409 amendment-window-closed)', async () => {
    const { declaration, obligationId } = await submitted();
    expect((await amend(declaration.id)).statusCode).toBe(200);
    const filedBefore = await obligationOf(obligationId);
    api.clock.setToday('2028-01-01');

    const response = await submit(declaration.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'amendment-window-closed' });
    expect(contractErrors(responseBody(SUBMIT, 'post', 409), response.json())).toEqual([]);
    expect((await versionRows(declaration.id)).map((row) => row.version)).toEqual([1]);
    expect(await obligationOf(obligationId)).toEqual(filedBefore);
    const read = await api.request('GET', `/v1/declarations/${declaration.id}`, declarant(ACHIENG));
    expect(read.json<Declaration>()).toMatchObject({ status: 'amending', currentVersion: 1 });
    expect(await events('declaration.submitted.v1')).toHaveLength(1);
  });

  it('puts the declaration back as submitted with version 1 untouched', async () => {
    const { declaration, obligationId } = await submitted();
    const [before] = await versionRows(declaration.id);
    const filedBefore = await obligationOf(obligationId);
    expect((await amend(declaration.id)).statusCode).toBe(200);
    await editIncome(declaration.id, 1);

    const response = await discardAmendment(declaration.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<Declaration>();
    expect(contractErrors(responseBody(DISCARD, 'post', 200), body)).toEqual([]);
    expect(body).toMatchObject({
      status: 'submitted',
      reference: REFERENCE,
      currentVersion: 1,
      amendingFromVersion: null,
    });
    expect(await versionRows(declaration.id)).toEqual([before]);
    expect(await obligationOf(obligationId)).toEqual(filedBefore);
    // The amendment's edit is gone: the sections are version 1's again.
    const officer = await section(ACHIENG, declaration.id, 'statement:officer');
    expect(officer).toMatchObject({ income: [INCOME], assets: [ASSET], liabilities: [LIABILITY] });
    expect((await sectionRows(declaration.id)).map((row) => row.completeness)).toEqual(
      expect.arrayContaining(['complete']),
    );
    const [discarded] = await events('declaration.amendment-discarded.v1');
    expect(discarded?.envelope).toMatchObject({
      subject: declaration.id,
      data: { declarationId: declaration.id, version: 1 },
    });
    // Submitted again: nothing to submit or edit until the next amend.
    const summary = await api.request(
      'GET',
      `/v1/declarations/${declaration.id}/summary`,
      declarant(ACHIENG),
    );
    expect(summary.json<DeclarationSummary>()).toMatchObject({
      canSubmit: false,
      cannotSubmitReason: 'not-a-draft',
    });
    const edit = await api.request(
      'PUT',
      `/v1/declarations/${declaration.id}/sections/other`,
      declarant(ACHIENG),
      { headers: { 'if-match': `"${String(body.draftVersion)}"` }, body: {} },
    );
    expect(edit.statusCode).toBe(409);
    expect((await submit(declaration.id, steppedUp(ACHIENG))).statusCode).toBe(409);
  });

  it('takes back what the amendment did to attachments', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    const deed = upload('psc', { fileName: 'title-deed.pdf', size: 1_204_551 });
    const payslip = upload('psc', { fileName: 'payslip.pdf' });
    api.documents.givenUploads(deed, payslip);
    const attach = (itemId: string, uploadId: string) =>
      api.request('POST', `/v1/declarations/${draft.id}/attachments`, declarant(ACHIENG), {
        body: { sectionKey: 'statement:officer', itemId, uploadId },
      });
    const linked = await attach(ASSET.id, deed.id);
    const kept = linked.json<DeclarationAttachment>();
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);
    expect((await amend(draft.id)).statusCode).toBe(200);
    // The amendment unlinks the deed and attaches a payslip.
    const unlinked = await api.request(
      'DELETE',
      `/v1/declarations/${draft.id}/attachments/${kept.id}`,
      declarant(ACHIENG),
    );
    expect(unlinked.statusCode).toBe(204);
    expect((await attach(INCOME.id, payslip.id)).statusCode).toBe(201);

    expect((await discardAmendment(draft.id)).statusCode).toBe(200);

    const rows = await attachmentRows(draft.id);
    expect(rows).toEqual([
      expect.objectContaining({
        id: kept.id,
        sectionKey: 'statement:officer',
        itemId: ASSET.id,
        uploadId: deed.id,
        sha256: deed.sha256,
        size: 1_204_551,
      }),
    ]);
    const officer = await section(ACHIENG, draft.id, 'statement:officer');
    expect((officer.income as { attachments?: unknown }[])[0]?.attachments ?? []).toEqual([]);
    expect((officer.assets as { attachments: { uploadId: string }[] }[])[0]?.attachments).toEqual([
      expect.objectContaining({ attachmentId: kept.id, uploadId: deed.id }),
    ]);
    const unlinkedEvents = await events('declaration.attachment-unlinked.v1');
    expect(unlinkedEvents.map((event) => event.envelope.data)).toContainEqual({
      declarationId: draft.id,
      uploadId: payslip.id,
    });
  });

  it('answers a declaration with no amendment in progress as it is, and refuses a draft', async () => {
    const { declaration } = await submitted();

    const submittedOnly = await discardAmendment(declaration.id);

    expect(submittedOnly.statusCode).toBe(200);
    expect(submittedOnly.json<Declaration>()).toMatchObject({
      status: 'submitted',
      draftVersion: declaration.draftVersion,
    });
    expect(await events('declaration.amendment-discarded.v1')).toEqual([]);

    const draft = await completeDraft(BARAKA);
    const response = await discardAmendment(draft.id, declarant(BARAKA));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'not-submitted' });
  });

  it('keeps the draft discard for drafts: an amendment is discarded with its own route', async () => {
    const { declaration } = await submitted();
    expect((await amend(declaration.id)).statusCode).toBe(200);

    const response = await api.request(
      'DELETE',
      `/v1/declarations/${declaration.id}`,
      declarant(ACHIENG),
    );

    expect(response.statusCode).toBe(409);
  });
});

describe('versions', () => {
  it('lists nothing for a draft, and 404s a version that does not exist', async () => {
    const draft = await completeDraft(ACHIENG);

    const listed = await versions(draft.id);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);
    expect((await version(draft.id, 1)).statusCode).toBe(404);
  });

  it("shows the owner version 1's decrypted document with its hash and acknowledgement", async () => {
    const { declaration } = await submitted();

    const response = await version(declaration.id, 1);

    expect(response.statusCode).toBe(200);
    const body = response.json<DeclarationVersionDetail>();
    expect(contractErrors(okResponse(VERSION, 'get'), body)).toEqual([]);
    const [row] = await versionRows(declaration.id);
    expect(body).toMatchObject({
      version: 1,
      reference: REFERENCE,
      late: false,
      canonicalSha256: row?.canonicalSha256,
      supersededAt: null,
      acknowledgement: { status: 'pending', documentId: null, verifiedCount: 0 },
      document: {
        schemaVersion: 'declaration.v1',
        statementDate: STATEMENT_DATE,
        attestation: { reference: REFERENCE },
      },
    });
  });

  it('is 404 for another declarant, staff, an unknown declaration or version, and 401 without a token', async () => {
    const { declaration } = await submitted();
    const staff: Caller = { tenant: 'psc', roles: ['reviewer', 'commission-admin'] };

    for (const caller of [declarant(BARAKA), staff]) {
      expect((await versions(declaration.id, caller)).statusCode).toBe(404);
      expect((await version(declaration.id, 1, caller)).statusCode).toBe(404);
      expect((await amend(declaration.id, caller)).statusCode).toBe(404);
      expect((await discardAmendment(declaration.id, caller)).statusCode).toBe(404);
    }
    expect((await versions(randomUUID())).statusCode).toBe(404);
    expect((await version(declaration.id, 2)).statusCode).toBe(404);
    expect((await version(declaration.id, 'one')).statusCode).toBe(400);
    expect((await amend('not-a-uuid')).statusCode).toBe(404);
    expect((await api.anonymous(`/v1/declarations/${declaration.id}/versions`)).statusCode).toBe(
      401,
    );
    expect((await api.anonymous(`/v1/declarations/${declaration.id}/versions/1`)).statusCode).toBe(
      401,
    );
    for (const route of ['amend', 'amend/discard']) {
      const anonymous = await api.app.inject({
        method: 'POST',
        url: `/v1/declarations/${declaration.id}/${route}`,
      });
      expect(anonymous.statusCode).toBe(401);
    }
  });
});

describe('my declarations with their versions', () => {
  it('shows each row what the list renders without further calls', async () => {
    const { declaration, obligationId } = await submitted();
    const draft = await completeDraft(BARAKA);

    const response = await mine();

    expect(response.statusCode).toBe(200);
    const body = response.json<DeclarationListItem[]>();
    expect(contractErrors(okResponse(MINE, 'get'), body)).toEqual([]);
    const [row] = await versionRows(declaration.id);
    expect(body).toEqual([
      expect.objectContaining({
        id: declaration.id,
        obligationId,
        status: 'submitted',
        dueDate: DUE_DATE,
        reference: REFERENCE,
        currentVersion: 1,
        amendingFromVersion: null,
        submittedAt: row?.submittedAt.toISOString(),
        late: false,
        amendable: true,
        acknowledgement: { status: 'pending', documentId: null, verifiedCount: 0 },
      }),
    ]);
    // A draft has none of it yet.
    expect((await mine(BARAKA)).json<DeclarationListItem[]>()).toEqual([
      expect.objectContaining({
        id: draft.id,
        status: 'draft',
        dueDate: DUE_DATE,
        reference: null,
        currentVersion: null,
        amendingFromVersion: null,
        submittedAt: null,
        late: null,
        amendable: false,
        acknowledgement: null,
      }),
    ]);
  });

  it('shows the issued slip with its verified count, an amendment in progress, and amendments closed after the due date', async () => {
    const { declaration } = await submitted();
    const [row] = await versionRows(declaration.id);
    if (!row) throw new Error('no version');
    const documentId = randomUUID();
    await api.asPlatform((tx) =>
      tx
        .update(declarationVersions)
        .set({
          ackStatus: 'issued',
          ackDocumentId: documentId,
          ackVerificationId: 'ADL-TEST',
          ackIssuedAt: new Date(),
          verifiedCount: 3,
        })
        .where(
          and(eq(declarationVersions.id, row.id), eq(declarationVersions.cycleYear, row.cycleYear)),
        ),
    );
    expect((await mine()).json<DeclarationListItem[]>()[0]).toMatchObject({
      amendable: true,
      acknowledgement: { status: 'issued', documentId, verifiedCount: 3 },
    });

    expect((await amend(declaration.id)).statusCode).toBe(200);
    expect((await mine()).json<DeclarationListItem[]>()[0]).toMatchObject({
      status: 'amending',
      currentVersion: 1,
      amendingFromVersion: 1,
      amendable: false,
      acknowledgement: { status: 'issued', documentId },
    });

    expect((await discardAmendment(declaration.id)).statusCode).toBe(200);
    api.clock.setToday('2028-01-01');
    expect((await mine()).json<DeclarationListItem[]>()[0]).toMatchObject({
      status: 'submitted',
      amendable: false,
    });
  });
});
