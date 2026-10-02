import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '@adili/api-kit';
import { hasValidCheckCharacter, parse } from '@adili/numbering/references';
import { DCB } from '@adili/numbering';
import type { DeclarationSectionKey } from '@adili/forms';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commissionRefs,
  declarationItems,
  declarations,
  declarationVersions,
  filingObligations,
  idempotencyKeys,
  numberingCounters,
  obligationDrafts,
  outbox,
} from '../../src/db/schema.js';
import type { Declaration, DeclarationSummary } from '../../src/drafts/representation.js';
import { storeSection } from '../../src/drafts/repository.js';
import { SectionCipher } from '../../src/drafts/section-cipher.js';
import type { SectionContents } from '../../src/drafts/sections.js';
import type { SubmissionResult } from '../../src/submission/representation.js';
import { contractErrors, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
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
 * Spec 06 S1-S6 and S21 over HTTP against Postgres, with the field cipher faked and the numbering
 * real: the submit transaction's preconditions and problem codes, the reference allocated gapless
 * in the transaction, the immutable encrypted version and its items, the obligation filed (late
 * after its due date), the events, the idempotent replay, and what forced failures leave behind.
 */

const SUBMIT = '/v1/declarations/{declarationId}/submit';
const ACHIENG = randomUUID();
const BARAKA = randomUUID();

let api: DeclarationsApi;
const { declarant, steppedUp, givenObligation, started, completeDraft, save, section, submit } =
  submissionFixtures(() => api);

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

function summary(id: string, personId: string) {
  return api.request('GET', `/v1/declarations/${id}/summary`, declarant(personId));
}

function versionsOf(declarationId: string) {
  return api.asPlatform((tx) =>
    tx
      .select()
      .from(declarationVersions)
      .where(eq(declarationVersions.declarationId, declarationId)),
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

function declarationRow(id: string, personId = ACHIENG) {
  return api.asPerson(personId, async (tx) => {
    const [row] = await tx.select().from(declarations).where(eq(declarations.id, id));
    return row;
  });
}

function events(type?: string) {
  return api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .where(type === undefined ? undefined : eq(outbox.eventType, type));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function decrypt(recordId: string, ciphertext: Buffer, envelope: unknown): Promise<string> {
  const plaintext = await api.cipher.decrypt({
    tenant: 'psc',
    recordId,
    ciphertext: ciphertext.toString('base64'),
    envelope: envelope as Parameters<typeof api.cipher.decrypt>[0]['envelope'],
  });
  return plaintext.toString('utf8');
}

describe('submitting a complete draft (S1)', () => {
  it('numbers it, stores an immutable encrypted version with its items and files the obligation', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    const before = await summary(draft.id, ACHIENG);
    expect(before.json<DeclarationSummary>()).toMatchObject({
      declaration: { dueDate: DUE_DATE },
      valid: true,
      canSubmit: true,
      cannotSubmitReason: null,
      late: false,
    });

    const tokenId = randomUUID();
    const response = await submit(draft.id, { ...steppedUp(ACHIENG), jti: tokenId });

    expect(response.statusCode).toBe(201);
    const body = response.json<SubmissionResult>();
    expect(contractErrors(responseBody(SUBMIT, 'post', 201), body)).toEqual([]);
    const reference = 'DCB-PSC-2027-0000001-1';
    expect(hasValidCheckCharacter(reference)).toBe(true);
    expect(parse(reference, [DCB])).toMatchObject({ issuer: 'PSC', period: 2027, sequence: 1 });
    expect(body.version).toMatchObject({
      version: 1,
      reference,
      late: false,
      supersededAt: null,
      acknowledgement: {
        status: 'pending',
        documentId: null,
        verificationId: null,
        verifyUrl: null,
        issuedAt: null,
        verifiedCount: 0,
        downloadUrl: null,
      },
    });
    expect(body.obligationStatus).toBe('filed');
    expect(body.declaration).toMatchObject({
      id: draft.id,
      status: 'submitted',
      reference,
      currentVersion: 1,
      amendingFromVersion: null,
    });

    // The version: the canonical document encrypted, its hash, the step-up evidence.
    const [version] = await versionsOf(draft.id);
    expect(version).toMatchObject({
      version: 1,
      cycleYear: 2027,
      tenant: 'psc',
      personId: ACHIENG,
      reference,
      late: false,
      stepUpAcr: 'step-up',
      stepUpTokenIdHash: sha256(tokenId),
      supersededAt: null,
      ackStatus: 'pending',
      verifiedCount: 0,
    });
    if (!version) throw new Error('no version');
    expect(version.submittedAt.toISOString()).toBe(body.version.submittedAt);
    const plaintext = await decrypt(
      `declaration-version:${version.id}`,
      version.snapshotCiphertext,
      version.envelope,
    );
    // Canonical: members sorted, no insignificant whitespace.
    expect(plaintext.startsWith('{"attestation":{"declaredAt":')).toBe(true);
    const document = JSON.parse(plaintext) as Record<string, unknown>;
    expect(canonicalJson(document)).toBe(plaintext);
    expect(version.canonicalSha256).toBe(sha256(plaintext));
    expect(body.version.canonicalSha256).toBe(version.canonicalSha256);
    expect(document).toMatchObject({
      schemaVersion: 'declaration.v1',
      type: 'biennial',
      statementDate: STATEMENT_DATE,
      attestation: { declaredAt: body.version.submittedAt, reference },
      statements: [{ personKey: 'officer', income: [INCOME], assets: [ASSET] }],
    });
    // No clear copy of the contents anywhere in the row.
    expect(JSON.stringify(version)).not.toContain('Kitengela');

    // The items: clear categories and locations, the description and value encrypted.
    const items = await api.asPlatform((tx) =>
      tx.select().from(declarationItems).where(eq(declarationItems.versionId, version.id)),
    );
    expect(
      items
        .map(({ category, type, personKey, inKenya, county, country, isJoint, sharePercent }) => ({
          category,
          type,
          personKey,
          inKenya,
          county,
          country,
          isJoint,
          sharePercent,
        }))
        .sort((a, b) => a.category.localeCompare(b.category)),
    ).toEqual([
      {
        category: 'asset',
        type: 'land',
        personKey: 'officer',
        inKenya: true,
        county: '034',
        country: null,
        isJoint: true,
        sharePercent: 50,
      },
      {
        category: 'income',
        type: 'salary-emoluments',
        personKey: 'officer',
        inKenya: true,
        county: '047',
        country: null,
        isJoint: false,
        sharePercent: null,
      },
      {
        category: 'liability',
        type: 'loan',
        personKey: 'officer',
        inKenya: false,
        county: null,
        country: 'UG',
        isJoint: false,
        sharePercent: null,
      },
    ]);
    const byCategory = new Map(items.map((item) => [item.category, item]));
    expect(byCategory.get('income')).toMatchObject({
      itemId: INCOME.id,
      changeKind: 'value-change',
    });
    expect(byCategory.get('asset')).toMatchObject({ itemId: ASSET.id, changeKind: null });
    expect(byCategory.get('liability')).toMatchObject({ changeKind: 'acquisition' });
    const liability = byCategory.get('liability');
    if (!liability) throw new Error('no liability');
    expect(
      await decrypt(
        `declaration-item:${liability.id}/description`,
        liability.descriptionCiphertext,
        liability.envelope.description,
      ),
    ).toBe(LIABILITY.description);
    expect(
      JSON.parse(
        await decrypt(
          `declaration-item:${liability.id}/value`,
          liability.valueCiphertext,
          liability.envelope.value,
        ),
      ),
    ).toEqual(LIABILITY.outstanding);
    expect(JSON.stringify(items)).not.toContain('Kampala');

    // The obligation is filed with the version, and no longer counted as a draft in progress.
    expect(await obligationOf(obligationId)).toMatchObject({
      status: 'filed',
      filedDeclarationId: draft.id,
      filedVersionId: version.id,
      late: false,
    });
    expect((await obligationOf(obligationId))?.filedAt?.toISOString()).toBe(
      body.version.submittedAt,
    );
    const drafts = await api.asPlatform((tx) =>
      tx.select().from(obligationDrafts).where(eq(obligationDrafts.obligationId, obligationId)),
    );
    expect(drafts).toEqual([]);

    // The events, identifiers only; the workflow told after commit.
    const recorded = await events();
    const submitted = recorded.filter((event) => event.type === 'declaration.submitted.v1');
    expect(submitted.map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: {
          declarationId: draft.id,
          versionId: version.id,
          version: 1,
          reference,
          type: 'biennial',
          statementDate: STATEMENT_DATE,
          obligationId,
          amendment: false,
          late: false,
        },
      }),
    ]);
    const changed = recorded.filter((event) => event.type === 'obligation.status-changed.v1');
    expect(changed.map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        subject: obligationId,
        tenant: 'psc',
        data: { obligationId, from: 'due', to: 'filed', reason: null },
      }),
    ]);
    const serialised = JSON.stringify(recorded);
    for (const secret of ['Achieng', 'Kitengela', 'Salary', '480000017', 'Stanbic']) {
      expect(serialised).not.toContain(secret);
    }
    expect(api.workflows.filed()).toEqual([obligationId]);

    // The summary no longer offers to submit.
    expect((await summary(draft.id, ACHIENG)).json<DeclarationSummary>()).toMatchObject({
      canSubmit: false,
      cannotSubmitReason: 'not-a-draft',
    });
  });

  it('refuses edits and a new start once submitted', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);

    const version = String(
      (await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG))).headers.etag,
    );
    const edit = await api.request(
      'PUT',
      `/v1/declarations/${draft.id}/sections/other`,
      declarant(ACHIENG),
      { headers: { 'if-match': version }, body: {} },
    );
    expect(edit.statusCode).toBe(409);
    const restart = await api.request(
      'POST',
      `/v1/obligations/${obligationId}/declaration`,
      declarant(ACHIENG),
    );
    expect(restart.statusCode).toBe(409);
  });

  it('files even when its workflow cannot be told, which the workflow heals from the row', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    api.workflows.failNext();

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(201);
    expect(api.workflows.filed()).toEqual([obligationId]);
    expect((await obligationOf(obligationId))?.status).toBe('filed');
  });
});

describe('a section saved while the submission is prepared', () => {
  it('prepares it again, and files what was saved last', async () => {
    const draft = await completeDraft(ACHIENG);
    // The items are sealed with no lock held: a save lands meanwhile, as from another tab.
    const encrypt = api.cipher.encrypt.bind(api.cipher);
    let saved = false;
    const spy = vi.spyOn(api.cipher, 'encrypt').mockImplementation(async (input) => {
      if (!saved && input.recordId.startsWith('declaration-item:')) {
        saved = true;
        const other = await section(ACHIENG, draft.id, 'other');
        await save(ACHIENG, draft.id, 'other', { ...other, freeText: 'Saved while submitting' });
      }
      return encrypt(input);
    });

    try {
      const response = await submit(draft.id, steppedUp(ACHIENG));

      expect(response.statusCode).toBe(201);
    } finally {
      spy.mockRestore();
    }
    expect(saved).toBe(true);
    const [version] = await versionsOf(draft.id);
    if (!version) throw new Error('no version');
    const document = JSON.parse(
      await decrypt(
        `declaration-version:${version.id}`,
        version.snapshotCiphertext,
        version.envelope,
      ),
    ) as { otherInformation: { freeText: string } };
    expect(document.otherInformation.freeText).toBe('Saved while submitting');
    // One version, one reference: the stale preparation wrote nothing.
    expect(await versionsOf(draft.id)).toHaveLength(1);
    expect(version.reference).toBe('DCB-PSC-2027-0000001-1');
  });
});

describe('a retried submit (S2)', () => {
  it('replays the same answer for the same Idempotency-Key and keeps one version', async () => {
    const draft = await completeDraft(ACHIENG);
    const key = randomUUID();

    const first = await submit(draft.id, steppedUp(ACHIENG), key);
    const retry = await submit(draft.id, steppedUp(ACHIENG), key);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await versionsOf(draft.id)).toHaveLength(1);
    expect(await events('declaration.submitted.v1')).toHaveLength(1);
  });

  it('still answers the same submission when the stored answer was lost', async () => {
    const draft = await completeDraft(ACHIENG);
    const key = randomUUID();
    const first = (await submit(draft.id, steppedUp(ACHIENG), key)).json<SubmissionResult>();
    await api.db.delete(idempotencyKeys);

    // Even with the step-up gone stale: the act is done, this is its answer.
    api.clock.setToday('2027-11-16');
    const retry = await submit(draft.id, declarant(ACHIENG), key);

    expect(retry.statusCode).toBe(201);
    // A day on, the slip that never came is reported failed (it may be asked for again).
    expect(retry.json<SubmissionResult>()).toEqual({
      ...first,
      version: {
        ...first.version,
        acknowledgement: { ...first.version.acknowledgement, status: 'failed' },
      },
    });
    expect(await versionsOf(draft.id)).toHaveLength(1);
    expect(await events('declaration.submitted.v1')).toHaveLength(1);
  });

  it('refuses a second submission of a submitted declaration (409 not-a-draft)', async () => {
    const draft = await completeDraft(ACHIENG);
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);

    const again = await submit(draft.id, steppedUp(ACHIENG));

    expect(again.statusCode).toBe(409);
    expect(contractErrors(responseBody(SUBMIT, 'post', 409), again.json())).toEqual([]);
    expect(again.json()).toMatchObject({ code: 'not-a-draft', status: 409 });
    expect(await versionsOf(draft.id)).toHaveLength(1);
  });

  it('refuses the same key for another request (422)', async () => {
    const draft = await completeDraft(ACHIENG);
    const key = randomUUID();
    expect((await submit(draft.id, steppedUp(ACHIENG), key)).statusCode).toBe(201);

    const other = await api.request(
      'POST',
      `/v1/declarations/${randomUUID()}/submit`,
      steppedUp(ACHIENG),
      {
        headers: { 'idempotency-key': key },
      },
    );

    expect(other.statusCode).toBe(422);
  });
});

describe('the step-up and the key (S3)', () => {
  it('refuses a token without the step-up ACR with where to step up (403)', async () => {
    const draft = await completeDraft(ACHIENG);

    const response = await submit(draft.id, declarant(ACHIENG));

    expect(response.statusCode).toBe(403);
    const problem = response.json<Record<string, unknown>>();
    expect(contractErrors(responseBody(SUBMIT, 'post', 403), problem)).toEqual([]);
    expect(problem).toMatchObject({
      type: 'step-up-required',
      code: 'step-up-required',
      status: 403,
      stepUpUrl: `http://localhost:3010/auth/step-up?returnTo=%2Fdeclarations%2F${draft.id}%2Fsummary`,
    });
  });

  it('refuses a step-up more than five minutes old, and one without auth_time', async () => {
    const draft = await completeDraft(ACHIENG);

    const stale = await submit(draft.id, steppedUp(ACHIENG, 6 * 60));
    const noTime = await submit(draft.id, { ...declarant(ACHIENG), acr: 'step-up' });
    const otherLevel = await submit(draft.id, { ...steppedUp(ACHIENG), acr: '1' });

    for (const response of [stale, noTime, otherLevel]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'step-up-required' });
    }
    // Five minutes to the second still counts.
    expect((await submit(draft.id, steppedUp(ACHIENG, 300))).statusCode).toBe(201);
  });

  it('refuses an auth_time further ahead of the clock than a minute of skew', async () => {
    const draft = await completeDraft(ACHIENG);

    const ahead = await submit(draft.id, steppedUp(ACHIENG, -61));

    expect(ahead.statusCode).toBe(403);
    expect(ahead.json()).toMatchObject({ code: 'step-up-required' });
    // A minute ahead is clock skew, and counts as fresh.
    expect((await submit(draft.id, steppedUp(ACHIENG, -60))).statusCode).toBe(201);
  });

  it('refuses a submit without an Idempotency-Key (400) and changes nothing', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);

    const response = await submit(draft.id, steppedUp(ACHIENG), null);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
    expect(await versionsOf(draft.id)).toEqual([]);
    expect((await declarationRow(draft.id))?.status).toBe('draft');
    expect((await obligationOf(obligationId))?.status).toBe('due');
  });

  it('writes nothing when refused, and submits after a fresh step-up with a new key', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    expect((await submit(draft.id, declarant(ACHIENG))).statusCode).toBe(403);

    expect(await versionsOf(draft.id)).toEqual([]);
    expect(await events('declaration.submitted.v1')).toEqual([]);
    expect((await obligationOf(obligationId))?.status).toBe('due');

    const response = await submit(draft.id, steppedUp(ACHIENG));
    expect(response.statusCode).toBe(201);
    expect(response.json<SubmissionResult>().version.reference).toBe('DCB-PSC-2027-0000001-1');
  });
});

describe('what the declaration and its obligation must be (S4)', () => {
  it('refuses an incomplete draft with what blocks it, as the summary lists it (400)', async () => {
    const draft = await started(ACHIENG, await givenObligation(ACHIENG));

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(400);
    const problem = response.json<{ code: string; blocking: unknown[] }>();
    expect(contractErrors(responseBody(SUBMIT, 'post', 400), problem)).toEqual([]);
    expect(problem.code).toBe('incomplete');
    const { blocking, cannotSubmitReason } = (
      await summary(draft.id, ACHIENG)
    ).json<DeclarationSummary>();
    expect(problem.blocking).toEqual(blocking);
    expect(problem.blocking.length).toBeGreaterThan(0);
    expect(cannotSubmitReason).toBe('incomplete');
    expect(await versionsOf(draft.id)).toEqual([]);
  });

  it('refuses before the statement date (409 before-statement-date)', async () => {
    api.clock.setToday('2027-10-15');
    const obligationId = await givenObligation(ACHIENG, { status: 'upcoming' });
    const draft = await completeDraft(ACHIENG, obligationId);
    expect((await summary(draft.id, ACHIENG)).json<DeclarationSummary>()).toMatchObject({
      valid: true,
      canSubmit: false,
      cannotSubmitReason: 'before-statement-date',
    });

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(409);
    expect(contractErrors(responseBody(SUBMIT, 'post', 409), response.json())).toEqual([]);
    expect(response.json()).toMatchObject({ code: 'before-statement-date' });
    expect(await versionsOf(draft.id)).toEqual([]);
  });

  it('refuses when the obligation was cancelled (409 obligation-cancelled)', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    await api.asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'exited-before-statement-date' })
        .where(eq(filingObligations.id, obligationId)),
    );

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'obligation-cancelled' });
    expect((await summary(draft.id, ACHIENG)).json<DeclarationSummary>().cannotSubmitReason).toBe(
      'obligation-cancelled',
    );
    expect(await versionsOf(draft.id)).toEqual([]);
  });

  it('is 404 for another declarant, staff and an unknown declaration, and 401 without a token', async () => {
    const draft = await completeDraft(ACHIENG);

    expect((await submit(draft.id, steppedUp(BARAKA))).statusCode).toBe(404);
    const staff: Caller = { tenant: 'psc', roles: ['reviewer'], acr: 'step-up', authTime: 0 };
    expect((await submit(draft.id, staff)).statusCode).toBe(404);
    expect((await submit(randomUUID(), steppedUp(ACHIENG))).statusCode).toBe(404);
    expect((await submit('not-a-uuid', steppedUp(ACHIENG))).statusCode).toBe(404);
    const anonymous = await api.app.inject({
      method: 'POST',
      url: `/v1/declarations/${draft.id}/submit`,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(await versionsOf(draft.id)).toEqual([]);
  });
});

describe('a late submission (S5)', () => {
  it('is taken after the due date, recorded late, and counted as filed late', async () => {
    const obligationId = await givenObligation(ACHIENG, { status: 'overdue' });
    const draft = await completeDraft(ACHIENG, obligationId);
    api.clock.setToday('2028-01-15');
    expect((await summary(draft.id, ACHIENG)).json<DeclarationSummary>()).toMatchObject({
      canSubmit: true,
      late: true,
    });

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(201);
    const body = response.json<SubmissionResult>();
    expect(body.version.late).toBe(true);
    expect(await obligationOf(obligationId)).toMatchObject({ status: 'filed', late: true });
    const [changed] = await events('obligation.status-changed.v1');
    expect(changed?.envelope).toMatchObject({ data: { from: 'overdue', to: 'filed' } });
    const [submitted] = await events('declaration.submitted.v1');
    expect(submitted?.envelope).toMatchObject({ data: { late: true } });

    const counts = await api.get('/v1/commissions/psc/obligations/summary?cycle=biennial:2027', {
      tenant: 'psc',
      roles: ['reporting-officer'],
    });
    expect(counts.statusCode).toBe(200);
    expect(counts.json()).toMatchObject({
      total: { filed: 1, filedLate: 1, overdue: 0 },
      byType: { biennial: { filed: 1, filedLate: 1 } },
    });
    const national = await api.get('/v1/obligations/summary?cycle=biennial:2027', {
      tenant: 'eacc',
      roles: ['eacc-analyst'],
    });
    expect(national.statusCode).toBe(200);
    expect(national.json()).toMatchObject({ totals: { filed: 1, filedLate: 1 } });
  });

  it('is not late on the due date itself', async () => {
    const obligationId = await givenObligation(ACHIENG);
    const draft = await completeDraft(ACHIENG, obligationId);
    api.clock.setToday(DUE_DATE);

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.json<SubmissionResult>().version.late).toBe(false);
    expect((await obligationOf(obligationId))?.late).toBe(false);
  });
});

describe('reference numbers (S6)', () => {
  it('gives two declarants of a Commission submitting at once consecutive numbers', async () => {
    const [achieng, baraka] = [await completeDraft(ACHIENG), await completeDraft(BARAKA)];

    const responses = await Promise.all([
      submit(achieng.id, steppedUp(ACHIENG)),
      submit(baraka.id, steppedUp(BARAKA)),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    const references = responses.map(
      (response) => response.json<SubmissionResult>().version.reference,
    );
    expect(references.map((reference) => reference.slice(0, 20)).sort()).toEqual([
      'DCB-PSC-2027-0000001',
      'DCB-PSC-2027-0000002',
    ]);
    expect(references.every(hasValidCheckCharacter)).toBe(true);
  });

  /**
   * Fails the submit transaction at a chosen statement: after the reference was allocated (the
   * items), or at its very last write (the obligation's event).
   */
  async function failing(point: 'items' | 'last-event', work: () => Promise<void>): Promise<void> {
    const table = point === 'items' ? 'declaration_items' : 'outbox';
    const when = point === 'items' ? '' : `when (new.event_type = 'obligation.status-changed.v1')`;
    await api.db.execute(
      sql.raw(`create function forced_failure() returns trigger language plpgsql as $$
        begin raise exception 'forced failure'; end $$`),
    );
    await api.db.execute(
      sql.raw(
        `create trigger forced_failure before insert on ${table} for each row ${when} execute function forced_failure()`,
      ),
    );
    try {
      await work();
    } finally {
      await api.db.execute(sql.raw(`drop trigger forced_failure on ${table}`));
      await api.db.execute(sql.raw('drop function forced_failure()'));
    }
  }

  it.each(['items', 'last-event'] as const)(
    'leaves nothing behind, and no gap, when the transaction fails (%s)',
    async (point) => {
      const obligationId = await givenObligation(ACHIENG);
      const achieng = await completeDraft(ACHIENG, obligationId);
      const baraka = await completeDraft(BARAKA);
      const key = randomUUID();

      await failing(point, async () => {
        const response = await submit(achieng.id, steppedUp(ACHIENG), key);
        expect(response.statusCode).toBe(500);
      });

      expect(await versionsOf(achieng.id)).toEqual([]);
      expect(
        await api.asPlatform((tx) => tx.select({ id: declarationItems.id }).from(declarationItems)),
      ).toEqual([]);
      expect(await declarationRow(achieng.id)).toMatchObject({
        status: 'draft',
        reference: null,
        currentVersion: null,
      });
      expect(await obligationOf(obligationId)).toMatchObject({
        status: 'due',
        filedVersionId: null,
        filedAt: null,
      });
      expect(await events('declaration.submitted.v1')).toEqual([]);
      expect(await events('obligation.status-changed.v1')).toEqual([]);
      expect(await api.db.select().from(numberingCounters)).toEqual([]);
      expect(api.workflows.filed()).toEqual([]);

      // The number went back: the next submission takes it; the failed one, retried with its
      // key (a server error is not stored), takes the next.
      const next = await submit(baraka.id, steppedUp(BARAKA));
      const retried = await submit(achieng.id, steppedUp(ACHIENG), key);
      expect(next.json<SubmissionResult>().version.reference).toBe('DCB-PSC-2027-0000001-1');
      expect(retried.statusCode).toBe(201);
      expect(retried.json<SubmissionResult>().version.reference.slice(0, 20)).toBe(
        'DCB-PSC-2027-0000002',
      );
      expect(await api.db.select().from(numberingCounters)).toEqual([
        { scheme: 'DCB', issuer: 'PSC', period: 2027, value: 2 },
      ]);
    },
  );

  it('fails without writing when the key service is down, before a number is taken', async () => {
    const draft = await completeDraft(ACHIENG);
    api.cipher.unavailable = true;
    try {
      const response = await submit(draft.id, steppedUp(ACHIENG));
      expect(response.statusCode).toBe(500);
    } finally {
      api.cipher.unavailable = false;
    }
    expect(await versionsOf(draft.id)).toEqual([]);
    expect(await api.db.select().from(numberingCounters)).toEqual([]);
  });
});

describe('versions and items are insert-only (S21)', () => {
  async function submittedVersion() {
    const draft = await completeDraft(ACHIENG);
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);
    const [version] = await versionsOf(draft.id);
    if (!version) throw new Error('no version');
    return version;
  }

  /** The error Postgres raised for `work`, run as the Commission (whose rows RLS lets it update). */
  async function refusal(work: Parameters<DeclarationsApi['asTenant']>[1]): Promise<string> {
    return refusalOf(() => api.asTenant('psc', work));
  }

  /**
   * The error Postgres raised for `work` with row-level security lifted for the tables' owner,
   * rolled back either way: no policy admits a delete, or an update of an item, so this is how
   * the triggers underneath are reached.
   */
  async function refusalWithoutRls(work: Parameters<DeclarationsApi['asTenant']>[1]) {
    return refusalOf(() =>
      api.db.transaction(async (tx) => {
        await tx.execute(sql`alter table declaration_versions no force row level security`);
        await tx.execute(sql`alter table declaration_items no force row level security`);
        await work(tx);
        tx.rollback();
      }),
    );
  }

  async function refusalOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      let cause: unknown = error;
      while (cause instanceof Error && cause.cause) cause = cause.cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== 'Rollback') return message;
    }
    throw new Error('expected the database to refuse');
  }

  it('refuses to change or delete a version, its snapshot, reference or cycle', async () => {
    const version = await submittedVersion();
    const at = and(
      eq(declarationVersions.id, version.id),
      eq(declarationVersions.cycleYear, version.cycleYear),
    );

    for (const change of [
      { snapshotCiphertext: Buffer.from('tampered') },
      { canonicalSha256: '0'.repeat(64) },
      { reference: 'DCB-PSC-2027-0000009-X' },
      { late: true },
      { cycleYear: 2029 },
    ]) {
      expect(await refusal((tx) => tx.update(declarationVersions).set(change).where(at))).toContain(
        'declaration_versions is insert-only',
      );
    }
    expect(await refusalWithoutRls((tx) => tx.delete(declarationVersions).where(at))).toContain(
      'cannot be deleted',
    );
    // Under row-level security no policy lets anyone delete one in the first place.
    expect(
      await api.asPlatform((tx) =>
        tx.delete(declarationVersions).where(at).returning({ id: declarationVersions.id }),
      ),
    ).toEqual([]);
    const [unchanged] = await versionsOf(version.declarationId);
    expect(unchanged).toEqual(version);
  });

  it('lets only supersession (once), the acknowledgement and the verified count change', async () => {
    const version = await submittedVersion();
    const at = and(
      eq(declarationVersions.id, version.id),
      eq(declarationVersions.cycleYear, version.cycleYear),
    );
    const documentId = randomUUID();

    await api.asTenant('psc', (tx) =>
      tx
        .update(declarationVersions)
        .set({
          ackStatus: 'issued',
          ackDocumentId: documentId,
          ackVerificationId: 'ADL-AAAA-BBBB-CCCC-DDDD-EEEE-FF',
          ackVerifyUrl: 'http://localhost:3030/v/ADL-AAAA-BBBB-CCCC-DDDD-EEEE-FF',
          ackIssuedAt: new Date(),
          ackRequestedAt: new Date(),
          verifiedCount: 3,
          supersededAt: new Date(),
        })
        .where(at),
    );
    expect(
      await refusal((tx) =>
        tx
          .update(declarationVersions)
          .set({ supersededAt: new Date(0) })
          .where(at),
      ),
    ).toContain('superseded_at is set once');
    const [after] = await versionsOf(version.declarationId);
    expect(after).toMatchObject({
      ackStatus: 'issued',
      ackDocumentId: documentId,
      verifiedCount: 3,
    });
    expect(after?.snapshotCiphertext).toEqual(version.snapshotCiphertext);
  });

  it('refuses to change or delete an item', async () => {
    const version = await submittedVersion();
    const at = eq(declarationItems.versionId, version.id);

    expect(
      await refusalWithoutRls((tx) => tx.update(declarationItems).set({ type: 'other' }).where(at)),
    ).toContain('declaration_items is insert-only');
    expect(await refusalWithoutRls((tx) => tx.delete(declarationItems).where(at))).toContain(
      'declaration_items is insert-only',
    );
    // Under row-level security no policy lets anyone change or delete one in the first place.
    expect(
      await api.asPlatform(async (tx) => [
        ...(await tx
          .update(declarationItems)
          .set({ type: 'other' })
          .where(at)
          .returning({ id: declarationItems.id })),
        ...(await tx.delete(declarationItems).where(at).returning({ id: declarationItems.id })),
      ]),
    ).toEqual([]);
    expect(await api.asPlatform((tx) => tx.select().from(declarationItems).where(at))).toHaveLength(
      3,
    );
  });
});

describe('the declarant only reads their versions and items (ADR-018)', () => {
  it('lets the person axis read them but not insert, change or delete one', async () => {
    const draft = await completeDraft(ACHIENG);
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);
    const [version] = await versionsOf(draft.id);
    if (!version) throw new Error('no version');
    const at = and(
      eq(declarationVersions.id, version.id),
      eq(declarationVersions.cycleYear, version.cycleYear),
    );
    const items = eq(declarationItems.versionId, version.id);

    const seen = await api.asPerson(ACHIENG, async (tx) => ({
      versions: await tx.select().from(declarationVersions).where(at),
      items: await tx.select().from(declarationItems).where(items),
    }));
    expect(seen.versions).toHaveLength(1);
    expect(seen.items).toHaveLength(3);

    const changed = await api.asPerson(ACHIENG, async (tx) => ({
      versions: await tx
        .update(declarationVersions)
        .set({ verifiedCount: 7 })
        .where(at)
        .returning({ id: declarationVersions.id }),
      deleted: await tx
        .delete(declarationItems)
        .where(items)
        .returning({ id: declarationItems.id }),
    }));
    expect(changed).toEqual({ versions: [], deleted: [] });
    const [unchanged] = await versionsOf(draft.id);
    expect(unchanged?.verifiedCount).toBe(0);

    const insert = api.asPerson(ACHIENG, (tx) =>
      tx.insert(declarationVersions).values({
        ...version,
        id: randomUUID(),
        version: version.version + 1,
      }),
    );
    let cause: unknown = await insert.then(
      () => null,
      (error: unknown) => error,
    );
    while (cause instanceof Error && cause.cause) cause = cause.cause;
    expect(cause instanceof Error ? cause.message : cause).toContain('row-level security');
  });
});

describe('changes since the last declaration, of which an initial has none', () => {
  /** A "changed" flag the portal no longer shows on an initial: no kind, no explanation. */
  const STALE = { changed: true };
  const DIRECTORSHIP = { company: 'Kitengela Farmers Ltd', role: 'Director', remunerated: false };

  /**
   * Stores sections as an older portal left them, past the save's rules, each as the draft's next
   * version (so no cached copy of the one before is read).
   */
  async function storedAsBefore(id: string, sections: [DeclarationSectionKey, object][]) {
    const declaration = await declarationRow(id);
    if (!declaration) throw new Error('no declaration');
    const cipher = api.app.get(SectionCipher);
    for (const [key, contents] of sections) {
      await api.asPerson(ACHIENG, (tx) =>
        storeSection(tx, cipher, declaration, key, contents as SectionContents, {
          now: api.clock.now(),
        }),
      );
    }
  }

  function initialDraft() {
    return givenObligation(ACHIENG, { type: 'initial' }).then((obligationId) =>
      completeDraft(ACHIENG, obligationId),
    );
  }

  /** An initial draft holding change flags an older portal let the declarant set. */
  async function staleInitialDraft() {
    const draft = await initialDraft();
    const bio = await section(ACHIENG, draft.id, 'bio');
    const officer = await section(ACHIENG, draft.id, 'statement:officer');
    const other = await section(ACHIENG, draft.id, 'other');
    await storedAsBefore(draft.id, [
      ['bio', { ...bio, maritalStatusChange: STALE }],
      ['statement:officer', { ...officer, income: [{ ...INCOME, change: STALE }] }],
      [
        'other',
        {
          ...other,
          registrableInterests: {
            ...(other.registrableInterests as object),
            directorships: [
              {
                ...DIRECTORSHIP,
                change: { changed: true, kind: 'acquisition', explanation: 'Joined the board' },
              },
            ],
          },
        },
      ],
    ]);
    return draft;
  }

  it('leaves the flags of an old initial draft out: complete, and submitted without them', async () => {
    const draft = await staleInitialDraft();

    const found = (await summary(draft.id, ACHIENG)).json<DeclarationSummary>();
    expect(found).toMatchObject({ valid: true, canSubmit: true, blocking: [] });
    expect(found.document).toMatchObject({
      type: 'initial',
      otherInformation: { materialChanges: [] },
    });
    expect(found.document.officer).not.toHaveProperty('maritalStatusChange');
    expect(await section(ACHIENG, draft.id, 'bio')).not.toHaveProperty('maritalStatusChange');
    expect(await section(ACHIENG, draft.id, 'other')).toMatchObject({ materialChanges: [] });

    const response = await submit(draft.id, steppedUp(ACHIENG));

    expect(response.statusCode).toBe(201);
    const [version] = await versionsOf(draft.id);
    if (!version) throw new Error('no version');
    const document = JSON.parse(
      await decrypt(
        `declaration-version:${version.id}`,
        version.snapshotCiphertext,
        version.envelope,
      ),
    ) as Record<string, unknown>;
    expect(document).toMatchObject({
      type: 'initial',
      statements: [
        {
          income: [{ ...INCOME, change: { changed: false } }],
          liabilities: [{ ...LIABILITY, change: { changed: false } }],
        },
      ],
      otherInformation: {
        materialChanges: [],
        registrableInterests: { directorships: [DIRECTORSHIP] },
      },
    });
    expect(document.officer).not.toHaveProperty('maritalStatusChange');
  });

  it('does not store them when an initial draft is saved with them', async () => {
    // The draft's income and loan were saved flagged as changed.
    const draft = await initialDraft();
    const bio = await section(ACHIENG, draft.id, 'bio');

    await save(ACHIENG, draft.id, 'bio', { ...bio, maritalStatusChange: STALE });

    expect(await section(ACHIENG, draft.id, 'bio')).not.toHaveProperty('maritalStatusChange');
    expect(await section(ACHIENG, draft.id, 'statement:officer')).toMatchObject({
      income: [{ ...INCOME, change: { changed: false } }],
      liabilities: [{ ...LIABILITY, change: { changed: false } }],
    });
    const read = await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG));
    expect(read.json<Declaration>().sections.map((found) => found.completeness)).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
  });

  it('still has a biennial explain a marital status change, and lists its changed items', async () => {
    const draft = await completeDraft(ACHIENG);
    const bio = await section(ACHIENG, draft.id, 'bio');
    await save(ACHIENG, draft.id, 'bio', { ...bio, maritalStatusChange: STALE });

    const found = (await summary(draft.id, ACHIENG)).json<DeclarationSummary>();

    expect(found).toMatchObject({ valid: false, canSubmit: false });
    expect(found.blocking).toContainEqual(
      expect.objectContaining({ sectionKey: 'bio', path: '/maritalStatusChange/explanation' }),
    );
    expect(found.document.otherInformation).toMatchObject({
      materialChanges: [
        { personKey: 'officer', kind: 'value-change', explanation: INCOME.change.explanation },
        { personKey: 'officer', kind: 'acquisition', explanation: LIABILITY.change.explanation },
      ],
    });
    const response = await submit(draft.id, steppedUp(ACHIENG));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'incomplete' });
  });
});
