import { randomUUID } from 'node:crypto';

import { ATTESTATION_TEXT, type AssetItem, type IncomeItem } from '@adili/forms';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, filingObligations, rosterSnapshots } from '../../src/db/schema.js';
import type {
  Declaration,
  DeclarationSummary,
  SectionEnvelope,
} from '../../src/drafts/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 05 S11 and S12 over HTTP: the summary assembles the `declaration.v1` document from the
 * draft's live sections (archived statements left out), composes paragraph 9's material changes
 * ahead of the declarant's own registrable interests and free text, validates the document and
 * lists what blocks submission, which is not available in this slice (`canSubmit: false`).
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const achieng: Caller = { personId: ACHIENG, roles: ['declarant'] };
const STATEMENT_DATE = '2027-11-01';
const GRACE = randomUUID();
const PETER = randomUUID();

const SUMMARY_BODY = okResponse('/v1/declarations/{declarationId}/summary', 'get');

let api: DeclarationsApi;

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
});

/** A PSC declarant's biennial draft, statement date 1 November 2027. */
async function started(): Promise<Declaration> {
  const record = rosterRecord('psc', {
    personId: ACHIENG,
    fullName: 'Achieng Wambui Otieno',
    personnelFileNumber: 'PSC/2015/0042',
    designation: 'Senior Accountant',
    reportingEntity: { id: randomUUID(), name: 'Ministry of Health' },
    appointmentDate: '2015-01-05',
  });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant: 'psc',
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: '2015-01-05',
      personId: ACHIENG,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant: 'psc',
      rosterRecordId: record.id,
      personId: ACHIENG,
      type: 'biennial',
      cycleKey: 'biennial:2027',
      statementDate: STATEMENT_DATE,
      dueDate: '2027-12-31',
      status: 'due',
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  const response = await api.request(
    'POST',
    `/v1/obligations/${obligationId}/declaration`,
    achieng,
  );
  expect(response.statusCode).toBe(201);
  return response.json<Declaration>();
}

function summary(id: string, caller: Caller = achieng) {
  return api.request('GET', `/v1/declarations/${id}/summary`, caller);
}

function getSection(id: string, key: string) {
  return api.request('GET', `/v1/declarations/${id}/sections/${key}`, achieng);
}

/** Saves at the draft's current version, as the portal does after reading it. */
async function save(id: string, key: string, body: unknown) {
  const version = String(
    (await api.request('GET', `/v1/declarations/${id}`, achieng)).headers.etag,
  );
  const response = await api.request('PUT', `/v1/declarations/${id}/sections/${key}`, achieng, {
    headers: { 'if-match': version },
    body,
  });
  expect(response.statusCode).toBe(200);
  return response;
}

async function bio(id: string) {
  const prefilled = (await getSection(id, 'bio')).json<SectionEnvelope>().contents;
  return {
    ...prefilled,
    birth: { date: '1980-04-02', place: 'Kisumu' },
    maritalStatus: 'married',
    maritalStatusChange: { changed: true, explanation: 'Married Grace in 2026' },
    address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
    employment: { ...(prefilled.employment as object), nature: 'permanent' },
  };
}

function spouse(id: string, firstName: string) {
  return { id, name: { surname: 'Otieno', firstName }, separated: false };
}

function household(...spouses: ReturnType<typeof spouse>[]) {
  return { spouses: { none: false, items: spouses }, children: { none: true, items: [] } };
}

/** A salary pre-filled from KRA (05b `source`), flagged as changed since the last declaration. */
function salary(): IncomeItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000001001',
    type: 'salary-emoluments',
    description: 'Salary from the Ministry',
    amount: { kesCents: 480_000_017 },
    location: { inKenya: true, county: '047' },
    change: { changed: true, kind: 'value-change', explanation: 'Promoted in March 2026' },
    source: {
      kind: 'kra',
      suggestionId: '0192f1a0-5a11-7000-8000-00000000b001',
      aiJobId: '0192f1a0-5a11-7000-8000-00000000b003',
      at: '2027-10-02T08:15:00.000Z',
    },
  };
}

/** A plot pre-filled from Ardhisasa (05b `source`). */
function land(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002001',
    type: 'land',
    description: 'Shamba in Kitengela',
    details: { parcelNumber: 'KAJIADO/KITENGELA/48213' },
    value: { kesCents: 350_000_023 },
    location: { inKenya: true, county: '034' },
    joint: { isJoint: false },
    change: { changed: false },
    source: {
      kind: 'ardhisasa',
      suggestionId: '0192f1a0-5a11-7000-8000-00000000a001',
      verificationResultId: '0192f1a0-5a11-7000-8000-00000000a002',
      at: '2027-10-02T08:15:00.000Z',
    },
  };
}

function car(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002009',
    type: 'vehicle',
    description: 'Peter’s car',
    value: { kesCents: 90_000_000 },
    location: { inKenya: true, county: '047' },
    joint: { isJoint: false },
    change: { changed: true, kind: 'acquisition', explanation: 'Bought by Peter in 2026' },
  };
}

async function statement(id: string, personKey: string, items: Record<string, unknown>) {
  const key = `statement:${personKey}`;
  const stored = (await getSection(id, key)).json<SectionEnvelope>().contents;
  return save(id, key, { ...stored, ...items });
}

const NIL = { incomeNil: true, assetsNil: true, liabilitiesNil: true };

/** Paragraph 9 as the declarant fills it in (S11). */
function otherInformation() {
  return {
    materialChanges: [],
    registrableInterests: {
      directorships: [{ company: 'Lake Basin Holdings Ltd', role: 'Director', remunerated: false }],
      memberships: [{ entity: 'Kisumu Golf Club', kind: 'club' }],
      dualCitizenship: { holds: false, pendingApplication: true },
      pendingCases: [
        { forum: 'Milimani ELC', reference: 'ELC 214 of 2026', nature: 'Boundary dispute' },
      ],
    },
    freeText: 'I also sit on the board of my church.',
  };
}

/** Every section filled in: married to Grace, no children, the declarant's items, paragraph 9. */
async function completeDraft(): Promise<Declaration> {
  const draft = await started();
  await save(draft.id, 'bio', await bio(draft.id));
  await save(draft.id, 'household', household(spouse(GRACE, 'Grace')));
  await statement(draft.id, 'officer', {
    incomeNil: false,
    income: [salary()],
    assetsNil: false,
    assets: [land()],
    liabilitiesNil: true,
    liabilities: [],
  });
  await statement(draft.id, `spouse:${GRACE}`, NIL);
  await save(draft.id, 'other', otherInformation());
  return draft;
}

describe('summary of a complete draft (S12)', () => {
  it('finds every section complete and the document valid, with no way to submit yet', async () => {
    const draft = await completeDraft();
    api.clock.setToday('2027-10-15');

    const response = await summary(draft.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<DeclarationSummary>();
    expect(contractErrors(SUMMARY_BODY, body)).toEqual([]);
    expect(body.declaration.id).toBe(draft.id);
    expect(body.declaration.sections.map(({ key, completeness }) => [key, completeness])).toEqual([
      ['bio', 'complete'],
      ['household', 'complete'],
      ['statement:officer', 'complete'],
      [`statement:spouse:${GRACE}`, 'complete'],
      ['other', 'complete'],
    ]);
    expect(body).toMatchObject({
      valid: true,
      blocking: [],
      canSubmit: false,
      cannotSubmitReason: 'before-statement-date',
      attestationText: ATTESTATION_TEXT,
    });
    expect(body.document).toMatchObject({
      schemaVersion: 'declaration.v1',
      type: 'biennial',
      statementDate: STATEMENT_DATE,
      incomePeriod: { from: '2025-11-01', to: STATEMENT_DATE, fromSource: 'assumed' },
      officer: {
        name: { firstName: 'Achieng', otherNames: 'Wambui', surname: 'Otieno' },
        maritalStatus: 'married',
      },
      spouses: { none: false, items: [spouse(GRACE, 'Grace')] },
      children: { none: true, items: [] },
      attestation: { text: ATTESTATION_TEXT },
    });
  });

  it('says submission opens in the next release once the statement date has come', async () => {
    const draft = await completeDraft();
    api.clock.setToday(STATEMENT_DATE);

    const body = (await summary(draft.id)).json<DeclarationSummary>();

    expect(body).toMatchObject({
      canSubmit: false,
      cannotSubmitReason: 'submission-not-available',
    });
  });

  it('carries each item, 05b source included, into the document unchanged', async () => {
    const draft = await completeDraft();

    const document = (await summary(draft.id)).json<DeclarationSummary>().document as {
      statements: { personKey: string; income: IncomeItem[]; assets: AssetItem[] }[];
    };

    const officer = document.statements.find((s) => s.personKey === 'officer');
    expect(officer?.income).toEqual([salary()]);
    expect(officer?.assets).toEqual([land()]);
    expect(officer?.income[0]?.source).toEqual(salary().source);
    expect(officer?.assets[0]?.source).toEqual(land().source);
  });
});

describe('paragraph 9 in the summary (S11)', () => {
  it('renders the composed material changes, then the registrable interests and free text', async () => {
    const draft = await completeDraft();

    const document = (await summary(draft.id)).json<DeclarationSummary>().document as {
      otherInformation: Record<string, unknown>;
    };

    expect(Object.keys(document.otherInformation)).toEqual([
      'materialChanges',
      'registrableInterests',
      'freeText',
    ]);
    expect(document.otherInformation).toEqual({
      materialChanges: [
        { kind: 'marital-status', explanation: 'Married Grace in 2026' },
        {
          personKey: 'officer',
          itemId: salary().id,
          itemDescription: 'Salary from the Ministry',
          kind: 'value-change',
          explanation: 'Promoted in March 2026',
        },
      ],
      registrableInterests: otherInformation().registrableInterests,
      freeText: 'I also sit on the board of my church.',
    });
  });
});

describe('archived statements in the summary', () => {
  it('leaves out the statement of a spouse taken out of the household, and its changes', async () => {
    const draft = await completeDraft();
    await save(draft.id, 'household', household(spouse(GRACE, 'Grace'), spouse(PETER, 'Peter')));
    await statement(draft.id, `spouse:${PETER}`, {
      incomeNil: true,
      assetsNil: false,
      assets: [car()],
      liabilitiesNil: true,
    });
    await save(draft.id, 'household', household(spouse(GRACE, 'Grace')));

    const body = (await summary(draft.id)).json<DeclarationSummary>();

    const document = body.document as {
      statements: { personKey: string }[];
      otherInformation: { materialChanges: { personKey?: string }[] };
    };
    expect(document.statements.map((s) => s.personKey)).toEqual(['officer', `spouse:${GRACE}`]);
    expect(document.otherInformation.materialChanges.map((c) => c.personKey)).toEqual([
      undefined,
      'officer',
    ]);
    expect(JSON.stringify(body.document)).not.toContain('Peter');
    expect(body).toMatchObject({ valid: true, blocking: [] });
    // The draft header still lists it, as archived.
    expect(body.declaration.sections).toContainEqual(
      expect.objectContaining({ key: `statement:spouse:${PETER}`, completeness: 'archived' }),
    );
  });
});

describe('summary of an incomplete draft (S12)', () => {
  it('lists what blocks submission by section and field, with the schema’s messages', async () => {
    const draft = await started();

    const response = await summary(draft.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<DeclarationSummary>();
    expect(contractErrors(SUMMARY_BODY, body)).toEqual([]);
    expect(body.valid).toBe(false);
    expect(body.canSubmit).toBe(false);
    expect(body.blocking).toEqual(
      expect.arrayContaining([
        {
          sectionKey: 'bio',
          path: '/birth',
          code: 'required',
          message: expect.any(String) as string,
        },
        {
          sectionKey: 'bio',
          path: '/maritalStatus',
          code: 'required',
          message: expect.any(String) as string,
        },
        {
          sectionKey: 'household',
          path: '/children',
          code: 'none-or-items-required',
          message: 'Add your dependent children or tick "No dependent children".',
        },
        {
          sectionKey: 'statement:officer',
          path: '/assets',
          code: 'nil-or-items-required',
          message: 'Add assets or tick "No assets".',
        },
      ]),
    );
    expect(new Set(body.blocking.map((issue) => issue.sectionKey))).toEqual(
      new Set(['bio', 'household', 'statement:officer', 'other']),
    );
    // Sections never saved block as a whole, ahead of their fields.
    expect(body.blocking.filter((issue) => issue.code === 'section-not-started')).toEqual(
      ['bio', 'household', 'statement:officer', 'other'].map((sectionKey) => ({
        sectionKey,
        path: '',
        code: 'section-not-started',
        message: expect.any(String) as string,
      })),
    );
    const bioIssues = body.blocking.filter((issue) => issue.sectionKey === 'bio');
    expect(bioIssues.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it('blocks on paragraph 9 until it is saved, even with nothing in it to fix', async () => {
    const draft = await started();
    await save(draft.id, 'bio', await bio(draft.id));
    await save(draft.id, 'household', household(spouse(GRACE, 'Grace')));
    await statement(draft.id, 'officer', NIL);
    await statement(draft.id, `spouse:${GRACE}`, NIL);

    const body = (await summary(draft.id)).json<DeclarationSummary>();

    expect(contractErrors(SUMMARY_BODY, body)).toEqual([]);
    expect(body.declaration.sections).toContainEqual(
      expect.objectContaining({ key: 'other', completeness: 'not-started' }),
    );
    expect(body.valid).toBe(false);
    expect(body.blocking).toEqual([
      {
        sectionKey: 'other',
        path: '',
        code: 'section-not-started',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('lists one issue once, however many checks find it', async () => {
    const draft = await started();

    const { blocking } = (await summary(draft.id)).json<DeclarationSummary>();

    const keys = blocking.map((issue) => `${issue.sectionKey} ${issue.path} ${issue.code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('who can read the summary', () => {
  it('is 404 for another person, staff and an unknown or discarded draft', async () => {
    const draft = await started();

    expect((await summary(draft.id, { personId: OTIENO, roles: ['declarant'] })).statusCode).toBe(
      404,
    );
    expect((await summary(draft.id, { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(404);
    expect((await summary(randomUUID())).statusCode).toBe(404);
    expect((await summary('not-a-uuid')).statusCode).toBe(404);

    expect((await api.request('DELETE', `/v1/declarations/${draft.id}`, achieng)).statusCode).toBe(
      204,
    );
    expect((await summary(draft.id)).statusCode).toBe(404);
  });
});
