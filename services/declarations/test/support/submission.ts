import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { filingObligations, rosterSnapshots } from '../../src/db/schema.js';
import type { Declaration, SectionEnvelope } from '../../src/drafts/representation.js';
import type { Caller, DeclarationsApi } from './declarations-api.js';
import { rosterRecord } from './fake-directory.js';
import { givenStoredSection } from './stored-sections.js';

/**
 * Submitting through the HTTP API as a declarant would (spec 06): a PSC biennial obligation of
 * 2027, a complete draft (one income, a joint plot, a loan abroad) and the submit with a fresh
 * step-up. Suites start the API in `beforeAll`, so the helpers take it through `api()`.
 */

export const STATEMENT_DATE = '2027-11-01';
export const DUE_DATE = '2027-12-31';
/** A day the biennial of 2027 is due and not yet overdue. */
export const DUE_DAY = '2027-11-15';

export const INCOME = {
  id: '0192f1a0-5a11-7000-8000-000000001001',
  type: 'salary-emoluments',
  description: 'Salary from the Ministry',
  amount: { kesCents: 480_000_017 },
  location: { inKenya: true, county: '047' },
  change: { changed: true, kind: 'value-change', explanation: 'Promoted in March 2026' },
};
export const ASSET = {
  id: '0192f1a0-5a11-7000-8000-000000002001',
  type: 'land',
  description: 'Shamba in Kitengela',
  details: { parcelNumber: 'KAJIADO/KITENGELA/48213' },
  value: { kesCents: 350_000_023 },
  location: { inKenya: true, county: '034' },
  joint: { isJoint: true, sharePercent: 50, coOwner: 'A brother' },
  change: { changed: false },
};
export const LIABILITY = {
  id: '0192f1a0-5a11-7000-8000-000000003001',
  type: 'loan',
  description: 'Loan for a house in Kampala',
  creditor: 'Stanbic Uganda',
  outstanding: { kesCents: 120_000_000, original: { currency: 'UGX', minorUnits: 3_400_000_000 } },
  location: { inKenya: false, country: 'UG' },
  change: { changed: true, kind: 'acquisition', explanation: 'Took the loan in 2026' },
};

/** Where the income and the plot were pre-filled from (05b `ItemSource`); the loan has none. */
export const INCOME_SOURCE = {
  kind: 'kra',
  suggestionId: '0192f1a0-5a11-7000-8000-00000000b001',
  aiJobId: '0192f1a0-5a11-7000-8000-00000000b003',
  at: '2027-10-02T08:15:00.000Z',
};
export const ASSET_SOURCE = {
  kind: 'ardhisasa',
  suggestionId: '0192f1a0-5a11-7000-8000-00000000a001',
  verificationResultId: '0192f1a0-5a11-7000-8000-00000000a002',
  at: '2027-10-02T08:15:00.000Z',
};

export function submissionFixtures(api: () => DeclarationsApi) {
  /** The declarant's token without the step-up; their account's `sub` is fixed. */
  function declarant(personId: string): Caller {
    return { sub: `account-${personId}`, personId, roles: ['declarant'] };
  }

  /** The declarant's token right after a fresh one-time code (by the service's clock). */
  function steppedUp(personId: string, secondsAgo = 0): Caller {
    return {
      ...declarant(personId),
      acr: 'step-up',
      authTime: Math.floor(api().clock.now().getTime() / 1000) - secondsAgo,
    };
  }

  /** A PSC declarant's obligation of 2027: the biennial unless another type is given. */
  async function givenObligation(
    personId: string,
    {
      status = 'due',
      type = 'biennial',
    }: { status?: 'upcoming' | 'due' | 'overdue'; type?: 'initial' | 'biennial' } = {},
  ): Promise<string> {
    const record = rosterRecord('psc', {
      personId,
      fullName: 'Achieng Wambui Otieno',
      personnelFileNumber: `PSC/2015/${personId.slice(0, 4)}`,
      designation: 'Senior Accountant',
      appointmentDate: '2015-01-05',
    });
    api().directory.givenRecords([record]);
    const obligationId = randomUUID();
    await api().asPlatform(async (tx) => {
      await tx.insert(rosterSnapshots).values({
        rosterRecordId: record.id,
        tenant: 'psc',
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        state: 'onboarded',
        appointmentDate: '2015-01-05',
        personId,
        sourceUpdatedAt: new Date(),
      });
      await tx.insert(filingObligations).values({
        id: obligationId,
        tenant: 'psc',
        rosterRecordId: record.id,
        personId,
        type,
        cycleKey: type === 'initial' ? `initial:${STATEMENT_DATE}` : 'biennial:2027',
        statementDate: STATEMENT_DATE,
        dueDate: DUE_DATE,
        status,
        policyVersionId: randomUUID(),
        policyVersion: 1,
        reminderOffsetsDays: [30, 14, 7],
      });
    });
    return obligationId;
  }

  async function started(personId: string, obligationId: string): Promise<Declaration> {
    const response = await api().request(
      'POST',
      `/v1/obligations/${obligationId}/declaration`,
      declarant(personId),
    );
    expect(response.statusCode).toBe(201);
    return response.json<Declaration>();
  }

  /** Saves at the draft's current version, as the portal does after reading it. */
  async function save(personId: string, id: string, key: string, body: unknown): Promise<void> {
    const caller = declarant(personId);
    const version = String(
      (await api().request('GET', `/v1/declarations/${id}`, caller)).headers.etag,
    );
    const response = await api().request('PUT', `/v1/declarations/${id}/sections/${key}`, caller, {
      headers: { 'if-match': version },
      body,
    });
    expect(response.statusCode).toBe(200);
  }

  async function section(personId: string, id: string, key: string) {
    const response = await api().request(
      'GET',
      `/v1/declarations/${id}/sections/${key}`,
      declarant(personId),
    );
    return response.json<SectionEnvelope>().contents;
  }

  /** A single declarant with no household, one income, one joint plot and a loan abroad. */
  async function completeDraft(personId: string, obligationId?: string): Promise<Declaration> {
    const draft = await started(personId, obligationId ?? (await givenObligation(personId)));
    const bio = await section(personId, draft.id, 'bio');
    await save(personId, draft.id, 'bio', {
      ...bio,
      birth: { date: '1980-04-02', place: 'Kisumu' },
      maritalStatus: 'single',
      address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
      employment: { ...(bio.employment as object), nature: 'permanent' },
    });
    await save(personId, draft.id, 'household', {
      spouses: { none: true, items: [] },
      children: { none: true, items: [] },
    });
    const officer = await section(personId, draft.id, 'statement:officer');
    await save(personId, draft.id, 'statement:officer', {
      ...officer,
      incomeNil: false,
      income: [INCOME],
      assetsNil: false,
      assets: [ASSET],
      liabilitiesNil: false,
      liabilities: [LIABILITY],
    });
    await save(personId, draft.id, 'other', {
      materialChanges: [],
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: '',
    });
    return draft;
  }

  /**
   * The draft's income and plot marked as pre-filled (with `source`), as accepting suggestions
   * leaves them; the loan as typed. Written into the stored section, since a save keeps the
   * sources the service set and takes none from the client.
   */
  async function sourceItems(personId: string, id: string): Promise<void> {
    await givenStoredSection(api(), personId, id, 'statement:officer', (contents) => ({
      ...contents,
      income: [{ ...INCOME, source: INCOME_SOURCE }],
      assets: [{ ...ASSET, source: ASSET_SOURCE }],
      liabilities: [LIABILITY],
    }));
  }

  function submit(id: string, caller: Caller, key: string | null = randomUUID()) {
    return api().request('POST', `/v1/declarations/${id}/submit`, caller, {
      headers: key === null ? {} : { 'idempotency-key': key },
    });
  }

  return {
    declarant,
    steppedUp,
    givenObligation,
    started,
    save,
    section,
    completeDraft,
    sourceItems,
    submit,
  };
}
