import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, declarationVersions, outbox } from '../../src/db/schema.js';
import type {
  InternalPreviousVersion,
  InternalVersionDocument,
} from '../../src/service-reads/representation.js';
import type { SubmissionResult } from '../../src/submission/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import {
  ASSET,
  ASSET_SOURCE,
  DUE_DATE,
  DUE_DAY,
  INCOME,
  INCOME_SOURCE,
  LIABILITY,
  STATEMENT_DATE,
  submissionFixtures,
} from '../support/submission.js';
import { registryCheckFixtures } from '../support/registry-checks.js';
import { ntsa } from '../fixtures/registry-results.js';

/**
 * Spec 07a #155 over HTTP: the review service reads a submitted version as filed (decrypted, with
 * the declarant's name, file number, due date and attachments), naming the reviewer it reads for
 * and the case, and looks up the person's latest earlier version. Service tokens with
 * `declarations:internal`, acting for the Commission; anything of another is 404.
 */

const DOCUMENT = '/internal/v1/declarations/{declarationId}/versions/{version}/document';
const PREVIOUS = '/internal/v1/declarations/previous-version';

const ACHIENG = randomUUID();
const CASE = randomUUID();

/** The review service's account (client credentials). */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'declarations:internal',
};
/** A service account without the declarations scope. */
const DIRECTORY: Caller = {
  sub: 'service-account-directory',
  azp: 'directory',
  scope: 'documents:internal',
};

let api: DeclarationsApi;
const { declarant, steppedUp, givenObligation, completeDraft, sourceItems, save, section, submit } =
  submissionFixtures(() => api);
const { givenOfficerNationalId, checked } = registryCheckFixtures(() => api);

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

interface Submitted {
  declarationId: string;
  versionIds: string[];
  reference: string;
}

/** Achieng's complete draft, submitted as version 1. */
async function submitted(): Promise<Submitted> {
  const draft = await completeDraft(ACHIENG);
  const response = await submit(draft.id, steppedUp(ACHIENG));
  expect(response.statusCode, response.body).toBe(201);
  return {
    declarationId: draft.id,
    versionIds: await versionIds(draft.id),
    reference: response.json<SubmissionResult>().version.reference,
  };
}

/** Amends the declaration and submits it again: version 2. */
async function amendedOnce({ declarationId }: Submitted): Promise<string[]> {
  const amended = await api.request(
    'POST',
    `/v1/declarations/${declarationId}/amend`,
    declarant(ACHIENG),
  );
  expect(amended.statusCode, amended.body).toBe(200);
  const resubmitted = await submit(declarationId, steppedUp(ACHIENG));
  expect(resubmitted.statusCode, resubmitted.body).toBe(201);
  return versionIds(declarationId);
}

async function versionIds(declarationId: string): Promise<string[]> {
  const rows = await api.asPlatform((tx) =>
    tx
      .select({ id: declarationVersions.id, version: declarationVersions.version })
      .from(declarationVersions)
      .where(eq(declarationVersions.declarationId, declarationId)),
  );
  return rows.sort((a, b) => a.version - b.version).map((row) => row.id);
}

function readDocument(
  declarationId: string,
  {
    version = 1,
    tenant = 'psc',
    caller = REVIEW,
    subject = 'reviewer-a',
    caseId = CASE,
  }: {
    version?: number;
    tenant?: string;
    caller?: Caller;
    subject?: string | null;
    caseId?: string | null;
  } = {},
) {
  const headers: Record<string, string> = { 'x-acting-tenant': tenant };
  if (subject !== null) headers['x-acting-subject'] = subject;
  if (caseId !== null) headers['x-review-case'] = caseId;
  return api.request(
    'GET',
    `/internal/v1/declarations/${declarationId}/versions/${String(version)}/document`,
    caller,
    { headers },
  );
}

function previous(personId: string, beforeVersionId: string, tenant = 'psc') {
  return api.request(
    'GET',
    `${PREVIOUS}?personId=${personId}&beforeVersionId=${beforeVersionId}`,
    REVIEW,
    { headers: { 'x-acting-tenant': tenant } },
  );
}

async function auditReads() {
  const rows = await api.asPlatform((tx) => tx.select().from(outbox));
  return rows.filter((row) => row.eventType === 'audit.read.v1').map((row) => row.envelope);
}

describe('version document (S16)', () => {
  it('gives the version as filed, with the declarant, file number, due date and attachments', async () => {
    const filed = await submitted();

    const response = await readDocument(filed.declarationId);

    expect(response.statusCode, response.body).toBe(200);
    const read = response.json<InternalVersionDocument>();
    expect(contractErrors(okResponse(DOCUMENT, 'get'), read)).toEqual([]);
    expect(read).toMatchObject({
      declarationId: filed.declarationId,
      versionId: filed.versionIds[0],
      version: 1,
      personId: ACHIENG,
      reference: filed.reference,
      type: 'biennial',
      statementDate: STATEMENT_DATE,
      late: false,
      dueDate: DUE_DATE,
      declarantName: 'Achieng Wambui Otieno',
      personnelFileNumber: `PSC/2015/${ACHIENG.slice(0, 4)}`,
      reportingEntityId: null,
    });
    expect(read.rosterRecordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(read.document).toMatchObject({ schemaVersion: 'declaration.v1' });
    expect(read.attachments).toEqual([]);
  });

  it("carries each item's source as the declarant saved it, and none on an item typed in (05b)", async () => {
    const draft = await completeDraft(ACHIENG);
    await sourceItems(ACHIENG, draft.id);
    const filed = await submit(draft.id, steppedUp(ACHIENG));
    expect(filed.statusCode, filed.body).toBe(201);

    const response = await readDocument(draft.id);

    expect(response.statusCode, response.body).toBe(200);
    const read = response.json<InternalVersionDocument>();
    expect(contractErrors(okResponse(DOCUMENT, 'get'), read)).toEqual([]);
    const [officer] = read.document.statements as {
      income: Record<string, unknown>[];
      assets: Record<string, unknown>[];
      liabilities: Record<string, unknown>[];
    }[];
    // As saved, nothing added or reshaped.
    expect(officer?.income).toEqual([{ ...INCOME, source: INCOME_SOURCE }]);
    expect(officer?.assets).toEqual([{ ...ASSET, source: ASSET_SOURCE }]);
    expect(officer?.liabilities).toEqual([LIABILITY]);
    expect(officer?.liabilities[0]).not.toHaveProperty('source');
  });

  it("carries an accepted suggestion's source and nothing else of the suggestion (05b S7)", async () => {
    const draft = await completeDraft(ACHIENG);
    await givenOfficerNationalId(ACHIENG, draft.id, '27451863');
    api.gateway.given('ntsa', '27451863', ntsa.found);
    const [set] = await checked(draft.id, declarant(ACHIENG), 'officer', ['ntsa']);
    const fielder = set?.suggestions[0];
    if (!fielder) throw new Error('No suggestion');
    const etag = (await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG)))
      .headers.etag;
    const accepted = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/suggestions/${fielder.id}/accept`,
      declarant(ACHIENG),
      {
        headers: { 'if-match': String(etag) },
        body: { fields: fielder.fields, applyToItemId: null },
      },
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    const { itemId } = accepted.json<{ itemId: string }>();
    // The declarant gives the car's value, which the registry never does.
    const statement = await section(ACHIENG, draft.id, 'statement:officer');
    await save(ACHIENG, draft.id, 'statement:officer', {
      ...statement,
      assets: (statement.assets as { id: string }[]).map((item) =>
        item.id === itemId ? { ...item, value: { kesCents: 90_000_000 } } : item,
      ),
    });
    const filed = await submit(draft.id, steppedUp(ACHIENG));
    expect(filed.statusCode, filed.body).toBe(201);

    const response = await readDocument(draft.id);

    expect(response.statusCode, response.body).toBe(200);
    const read = response.json<InternalVersionDocument>();
    const [officer] = read.document.statements as { assets: Record<string, unknown>[] }[];
    expect(officer?.assets.find((item) => item.id === itemId)).toMatchObject({
      type: 'vehicle',
      details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
      source: {
        kind: 'ntsa',
        suggestionId: fielder.id,
        verificationResultId: ntsa.found.resultId,
        at: expect.any(String) as unknown,
      },
    });
    // What the registry said beyond the accepted fields, and the suggestion left alone, stay out.
    const document = JSON.stringify(read.document);
    for (const suggestionData of [
      '2019-03-14',
      'registeredOn',
      'sourceRef',
      'matchKeys',
      'KDA 456X',
    ]) {
      expect(document).not.toContain(suggestionData);
    }
  });

  it('records the read with the reviewer it is for and the case as its legal basis', async () => {
    const filed = await submitted();

    await readDocument(filed.declarationId);

    const audits = await auditReads();
    expect(audits).toContainEqual(
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          action: 'declaration.version-document.read',
          legalBasis: `review-case:${CASE}`,
          resource: expect.objectContaining({ subjectPersonId: ACHIENG }) as unknown,
          actor: expect.objectContaining({
            clientId: 'review',
            onBehalfOf: 'reviewer-a',
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(JSON.stringify(audits)).not.toContain('Achieng');
  });

  it('needs the acting subject: 400 without it; the case is optional (triage reads for none)', async () => {
    const filed = await submitted();

    expect((await readDocument(filed.declarationId, { subject: null })).statusCode).toBe(400);
    expect((await readDocument(filed.declarationId, { caseId: null })).statusCode).toBe(200);
    expect((await readDocument(filed.declarationId, { caseId: 'not-a-uuid' })).statusCode).toBe(
      400,
    );
  });

  it("is 404 for another Commission's or an unknown version, and refuses other tokens", async () => {
    const filed = await submitted();

    expect((await readDocument(filed.declarationId, { tenant: 'tsc' })).statusCode).toBe(404);
    expect((await readDocument(filed.declarationId, { version: 2 })).statusCode).toBe(404);
    expect((await readDocument(randomUUID())).statusCode).toBe(404);
    expect((await readDocument(filed.declarationId, { caller: DIRECTORY })).statusCode).toBe(403);
    expect(
      (await readDocument(filed.declarationId, { caller: declarant(ACHIENG) })).statusCode,
    ).toBe(403);
  });
});

describe('previous version', () => {
  it("gives the person's latest earlier version at the Commission, and 404 for a first", async () => {
    const filed = await submitted();
    const [v1, v2] = await amendedOnce(filed);
    if (!v1 || !v2) throw new Error('two versions expected');

    const response = await previous(ACHIENG, v2);

    expect(response.statusCode, response.body).toBe(200);
    const found = response.json<InternalPreviousVersion>();
    expect(contractErrors(okResponse(PREVIOUS, 'get'), found)).toEqual([]);
    expect(found).toMatchObject({
      declarationId: filed.declarationId,
      versionId: v1,
      version: 1,
      statementDate: STATEMENT_DATE,
    });
    expect((await previous(ACHIENG, v1)).statusCode).toBe(404);
  });

  it("is 404 for another Commission's version and for another person", async () => {
    const filed = await submitted();
    const [, v2] = await amendedOnce(filed);
    if (!v2) throw new Error('two versions expected');

    expect((await previous(ACHIENG, v2, 'tsc')).statusCode).toBe(404);
    expect((await previous(randomUUID(), v2)).statusCode).toBe(404);
  });

  it('never gives a discarded declaration, a draft or an amendment in progress', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const discarded = await completeDraft(ACHIENG, obligationId);
    const discarding = await api.request(
      'DELETE',
      `/v1/declarations/${discarded.id}`,
      declarant(ACHIENG),
    );
    expect(discarding.statusCode, discarding.body).toBe(204);
    const draft = await completeDraft(ACHIENG, obligationId);
    const filed = await submit(draft.id, steppedUp(ACHIENG));
    expect(filed.statusCode, filed.body).toBe(201);
    const [v1] = await versionIds(draft.id);
    if (!v1) throw new Error('a version expected');
    const amending = await api.request(
      'POST',
      `/v1/declarations/${draft.id}/amend`,
      declarant(ACHIENG),
    );
    expect(amending.statusCode, amending.body).toBe(200);

    expect((await previous(ACHIENG, v1)).statusCode).toBe(404);
  });
});
