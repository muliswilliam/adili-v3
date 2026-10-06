import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, filingObligations, rosterSnapshots } from '../../src/db/schema.js';
import type { Declaration, SectionEnvelope } from '../../src/drafts/representation.js';
import { CHILD_ID, household, SPOUSE_ID } from '../fixtures/sections.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';
import { DUE_DAY, STATEMENT_DATE, submissionFixtures } from '../support/submission.js';

/**
 * Story 4 (#612) over HTTP: a declarant who has declared before starts a new declaration with the
 * spouses and children of their last one, as declared in its version in force. The household is
 * offered, not confirmed: it starts `not-started`, so the declarant must look at it and save it
 * before submitting, and that save sets up the statements.
 */

const ACHIENG = randomUUID();
const FINAL_DATE = '2028-03-31';
const NIL = { incomeNil: true, assetsNil: true, liabilitiesNil: true };

let api: DeclarationsApi;
const { declarant, steppedUp, completeDraft, save, section, submit, started } = submissionFixtures(
  () => api,
);

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

/** Achieng's biennial of 2027, submitted with Grace as her spouse and Faith as her child. */
async function submittedWithHousehold(): Promise<Declaration> {
  const draft = await completeDraft(ACHIENG);
  const bio = await section(ACHIENG, draft.id, 'bio');
  await save(ACHIENG, draft.id, 'bio', { ...bio, maritalStatus: 'married' });
  await save(ACHIENG, draft.id, 'household', household());
  for (const key of [`statement:spouse:${SPOUSE_ID}`, `statement:child:${CHILD_ID}`]) {
    await save(ACHIENG, draft.id, key, { ...(await section(ACHIENG, draft.id, key)), ...NIL });
  }
  const response = await submit(draft.id, steppedUp(ACHIENG));
  expect(response.statusCode).toBe(201);
  return draft;
}

/** Achieng's final declaration on leaving office (in March 2028 unless said), with the Commission. */
async function givenFinal({
  tenant = 'psc',
  statementDate = FINAL_DATE,
}: { tenant?: string; statementDate?: string } = {}): Promise<string> {
  const record = rosterRecord(tenant, {
    personId: ACHIENG,
    fullName: 'Achieng Wambui Otieno',
    personnelFileNumber: 'PSC/2015/0042',
    appointmentDate: '2015-01-05',
  });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant,
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: '2015-01-05',
      personId: ACHIENG,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant,
      rosterRecordId: record.id,
      personId: ACHIENG,
      type: 'final',
      cycleKey: `final:${statementDate}`,
      statementDate,
      dueDate: statementDate,
      status: 'due',
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  return obligationId;
}

async function householdOf(id: string): Promise<SectionEnvelope> {
  const response = await api.request(
    'GET',
    `/v1/declarations/${id}/sections/household`,
    declarant(ACHIENG),
  );
  expect(response.statusCode).toBe(200);
  return response.json<SectionEnvelope>();
}

describe('household carried over from the previous declaration (story 4)', () => {
  it('offers the spouses and children of the last declaration, to be confirmed', async () => {
    await submittedWithHousehold();
    const final = await started(ACHIENG, await givenFinal());

    const envelope = await householdOf(final.id);
    const previous = household();
    expect(envelope).toMatchObject({
      completeness: 'not-started',
      carriedOverFrom: { statementDate: STATEMENT_DATE },
      contents: {
        spouses: { none: false, items: previous.spouses.items },
        children: { none: false, items: previous.children.items },
      },
    });
    // Offered, not yet confirmed: nobody's statement is set up until the household is saved.
    expect(final.sections.map((s) => s.key)).not.toContain(`statement:spouse:${SPOUSE_ID}`);
  });

  it('sets up the carried people statements once the declarant confirms the household', async () => {
    await submittedWithHousehold();
    const final = await started(ACHIENG, await givenFinal());
    const { contents } = await householdOf(final.id);

    await save(ACHIENG, final.id, 'household', contents);

    const confirmed = await householdOf(final.id);
    expect(confirmed.completeness).not.toBe('not-started');
    expect(confirmed.carriedOverFrom).toEqual({ statementDate: STATEMENT_DATE });
    const keys = (
      await api.request('GET', `/v1/declarations/${final.id}`, declarant(ACHIENG))
    ).json<Declaration>().sections;
    expect(keys.map((s) => s.key)).toEqual(
      expect.arrayContaining([`statement:spouse:${SPOUSE_ID}`, `statement:child:${CHILD_ID}`]),
    );
  });

  it('starts an empty household for a declarant with no earlier declaration', async () => {
    const draft = await started(ACHIENG, await givenFinal());

    const envelope = await householdOf(draft.id);
    expect(envelope.contents).toEqual({
      spouses: { none: false, items: [] },
      children: { none: false, items: [] },
    });
    expect(envelope).not.toHaveProperty('carriedOverFrom');
  });

  it('carries nobody over from a declaration that listed nobody', async () => {
    const draft = await completeDraft(ACHIENG);
    expect((await submit(draft.id, steppedUp(ACHIENG))).statusCode).toBe(201);
    const final = await started(ACHIENG, await givenFinal());

    const envelope = await householdOf(final.id);
    expect(envelope.contents).toEqual({
      spouses: { none: false, items: [] },
      children: { none: false, items: [] },
    });
    expect(envelope).not.toHaveProperty('carriedOverFrom');
  });

  it('carries nothing into a declaration as at an earlier date than the last one', async () => {
    await submittedWithHousehold();
    const earlier = await started(ACHIENG, await givenFinal({ statementDate: '2026-03-31' }));

    expect(await householdOf(earlier.id)).not.toHaveProperty('carriedOverFrom');
  });

  it("carries nothing from another Commission's records", async () => {
    await submittedWithHousehold();
    await api.asPlatform((tx) =>
      tx
        .insert(commissionRefs)
        .values({ slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' }),
    );
    const elsewhere = await started(ACHIENG, await givenFinal({ tenant: 'tsc' }));

    const envelope = await householdOf(elsewhere.id);
    expect(envelope.contents).toEqual({
      spouses: { none: false, items: [] },
      children: { none: false, items: [] },
    });
    expect(envelope).not.toHaveProperty('carriedOverFrom');
  });
});
