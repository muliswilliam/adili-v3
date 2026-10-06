import { randomUUID } from 'node:crypto';

import type { AssetItem, IncomeItem, LiabilityItem } from '@adili/forms';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commissionRefs, filingObligations, rosterSnapshots } from '../../src/db/schema.js';
import type {
  Declaration,
  SectionEnvelope,
  SectionSaveResult,
} from '../../src/drafts/representation.js';
import { contractErrors } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 05 S7-S9 over HTTP, on the declarant's own financial statement (paragraph 8): items of every
 * kind round-trip unchanged with integer cents, a category is either nil or lists items (a save
 * with both is refused), a flagged change needs a kind and an explanation and then appears in
 * paragraph 9 with a reference to its item. Values stay inside the encrypted blob (S13).
 */

const ACHIENG = randomUUID();
const declarant: Caller = { personId: ACHIENG, roles: ['declarant'] };

let api: DeclarationsApi;

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
});

const SAVE_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/put/responses/200/content/application~1json/schema';
const SECTION_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/get/responses/200/content/application~1json/schema';

/** A draft started from a due biennial obligation of Achieng's (statement date 2027-11-01). */
async function started(): Promise<Declaration> {
  const record = rosterRecord('psc', {
    personId: ACHIENG,
    ofr: 'OFR-0482913-L',
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
      statementDate: '2027-11-01',
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
    declarant,
  );
  expect(response.statusCode).toBe(201);
  return response.json<Declaration>();
}

function getSection(id: string, key: string) {
  return api.request('GET', `/v1/declarations/${id}/sections/${key}`, declarant);
}

function save(id: string, key: string, body: unknown, version: number) {
  return api.request('PUT', `/v1/declarations/${id}/sections/${key}`, declarant, {
    headers: { 'if-match': `"${String(version)}"` },
    body,
  });
}

/** The declarant's own statement as stored, with `edit` applied: what a client sends back. */
async function statementWith(
  id: string,
  edit: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const read = (await getSection(id, 'statement:officer')).json<SectionEnvelope>();
  return { ...read.contents, ...edit };
}

// S7: one item of each kind the spec names. Values are distinctive so S13 can look for them.

function salary(): IncomeItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000001001',
    type: 'salary-emoluments',
    description: 'Salary from the Ministry',
    amount: { kesCents: 480_000_017 },
    location: { inKenya: true, county: '047' },
    change: { changed: false },
  };
}

function land(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002001',
    type: 'land',
    description: 'Shamba in Kitengela',
    details: { parcelNumber: 'KAJIADO/KITENGELA/48213', size: '0.5 acres' },
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

function vehicle(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002002',
    type: 'vehicle',
    description: 'Family car',
    details: { registration: 'KDQ 417M', makeModel: 'Subaru Forester' },
    value: { kesCents: 190_000_031 },
    location: { inKenya: true, county: '047' },
    joint: { isJoint: false },
    change: { changed: false },
  };
}

function foreignShares(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002003',
    type: 'shareholding',
    description: 'Shares held in London',
    details: { issuer: 'Thamesbridge Holdings plc', quantityOrPercent: '1200 shares' },
    value: { kesCents: 207_000_041, original: { currency: 'GBP', minorUnits: 1_250_053 } },
    location: { inKenya: false, country: 'GB' },
    joint: { isJoint: false },
    change: { changed: false },
  };
}

function jointBuilding(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002004',
    type: 'building',
    description: 'Maisonette in Kileleshwa',
    details: { parcelNumber: 'NAIROBI/BLOCK 72/9931' },
    value: { kesCents: 2_400_000_059 },
    location: { inKenya: true, county: '047', detail: 'Othaya Road' },
    joint: { isJoint: true, sharePercent: 50, coOwner: 'Spouse' },
    change: { changed: false },
  };
}

function mortgage(): LiabilityItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000003001',
    type: 'mortgage',
    description: 'Mortgage on the maisonette',
    creditor: 'Housing Finance Kenya',
    outstanding: { kesCents: 910_000_067 },
    location: { inKenya: true, county: '047' },
    change: { changed: false },
  };
}

function allItems() {
  return {
    incomeNil: false,
    income: [salary()],
    assetsNil: false,
    assets: [land(), vehicle(), foreignShares(), jointBuilding()],
    liabilitiesNil: false,
    liabilities: [mortgage()],
  };
}

describe('statement items (S7)', () => {
  it('round-trips income, land, vehicle, foreign shareholding, joint building and mortgage, taking no source from the client', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, allItems());

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.statusCode).toBe(200);
    expect(contractErrors(SAVE_BODY, response.json())).toEqual([]);
    expect(response.json<SectionSaveResult>()).toEqual({
      key: 'statement:officer',
      completeness: 'complete',
      draftVersion: 2,
      issues: [],
      sectionsChanged: [],
      reopenedSuggestions: [],
    });
    const read = await getSection(draft.id, 'statement:officer');
    expect(contractErrors(SECTION_BODY, read.json())).toEqual([]);
    const contents = read.json<SectionEnvelope>().contents;
    // Every item as sent, but for the land's source: the service sets sources, a client cannot.
    const landAsTyped: Partial<AssetItem> = land();
    delete landAsTyped.source;
    expect(contents).toEqual({
      ...body,
      assets: [landAsTyped, ...(body.assets as AssetItem[]).slice(1)],
    });
    // Exact integers, not floats or strings.
    expect(
      (JSON.parse(read.body) as SectionEnvelope & { contents: { assets: AssetItem[] } }).contents
        .assets[2]?.value,
    ).toEqual({
      kesCents: 207_000_041,
      original: { currency: 'GBP', minorUnits: 1_250_053 },
    });
    expect((contents.assets as AssetItem[])[0]?.source).toBeUndefined();
  });

  it('counts the items by category in the draft header, never their values', async () => {
    const draft = await started();
    await save(draft.id, 'statement:officer', await statementWith(draft.id, allItems()), 1);

    const header = (
      await api.request('GET', `/v1/declarations/${draft.id}`, declarant)
    ).json<Declaration>();

    expect(header.sections.find((section) => section.key === 'statement:officer')).toMatchObject({
      completeness: 'complete',
      counts: { income: 1, assets: 4, liabilities: 1 },
    });
  });

  it('refuses an amount that is not a whole number of cents', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, {
      ...allItems(),
      income: [{ ...salary(), amount: { kesCents: 4800.5 } }],
    });

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errors: [expect.objectContaining({ path: 'income.0.amount.kesCents' })],
    });
  });

  it('keeps the statement’s person and dates whatever the body says', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, {
      ...allItems(),
      personName: { surname: 'Someone', firstName: 'Else' },
      statementDate: '2020-01-01',
    });

    await save(draft.id, 'statement:officer', body, 1);

    const contents = (await getSection(draft.id, 'statement:officer')).json<SectionEnvelope>()
      .contents;
    expect(contents).toMatchObject({
      personKey: 'officer',
      personName: { firstName: 'Achieng', otherNames: 'Wambui', surname: 'Otieno' },
      statementDate: '2027-11-01',
    });
  });
});

describe('nil flags (S8)', () => {
  it('refuses nil assets with an asset listed, with nil-conflicts-with-items, and stores nothing', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, { ...allItems(), assetsNil: true });

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      type: 'nil-conflicts-with-items',
      status: 400,
      errors: [
        {
          path: 'assets',
          message:
            'You said there are no assets but listed some. Remove them or untick "No assets".',
        },
      ],
    });
    const read = await getSection(draft.id, 'statement:officer');
    expect(read.headers.etag).toBe('"1"');
    expect(read.json<SectionEnvelope>()).toMatchObject({
      completeness: 'not-started',
      contents: { assetsNil: false, assets: [] },
    });
  });

  it('finds a statement declared nil in every category, with no items, complete', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, {
      incomeNil: true,
      assetsNil: true,
      liabilitiesNil: true,
    });

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.statusCode).toBe(200);
    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'complete',
      issues: [],
    });
    const rows = await api.asPerson(ACHIENG, (tx) =>
      tx.execute(
        sql`select metadata from declaration_sections where declaration_id = ${draft.id} and section_key = 'statement:officer'`,
      ),
    );
    expect(rows.rows[0]?.metadata).toEqual({
      counts: { income: 0, assets: 0, liabilities: 0 },
      nil: { income: true, assets: true, liabilities: true },
    });
  });

  it('asks for items or nil where neither is given', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, { incomeNil: true, liabilitiesNil: true });

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [
        {
          sectionKey: 'statement:officer',
          path: '/assets',
          code: 'nil-or-items-required',
          message: 'Add assets or tick "No assets".',
        },
      ],
    });
  });
});

describe('changed-since-last flags (S9)', () => {
  const EXPLAINED = {
    changed: true,
    kind: 'value-change',
    explanation: 'Promoted to Principal Accountant in March 2026',
  } as const;

  it('keeps a change without an explanation incomplete, with a message on the field', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, {
      ...allItems(),
      income: [{ ...salary(), change: { changed: true, kind: 'value-change' } }],
    });

    const response = await save(draft.id, 'statement:officer', body, 1);

    expect(response.statusCode).toBe(200);
    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [
        {
          sectionKey: 'statement:officer',
          path: '/income/0/change/explanation',
          code: 'required',
          message: 'Explain what changed since your last declaration.',
        },
      ],
    });
    const other = (await getSection(draft.id, 'other')).json<SectionEnvelope>();
    expect(other.contents.materialChanges).toEqual([]);
  });

  it('puts a change with a kind and an explanation in paragraph 9, with its item', async () => {
    const draft = await started();
    const body = await statementWith(draft.id, {
      ...allItems(),
      income: [{ ...salary(), change: EXPLAINED }],
      assets: [
        land(),
        {
          ...vehicle(),
          change: { changed: true, kind: 'acquisition', explanation: 'Bought in 2026' },
        },
      ],
    });

    const saved = await save(draft.id, 'statement:officer', body, 1);

    expect(saved.json<SectionSaveResult>()).toMatchObject({ completeness: 'complete' });
    const other = await getSection(draft.id, 'other');
    expect(contractErrors(SECTION_BODY, other.json())).toEqual([]);
    expect(other.json<SectionEnvelope>().contents.materialChanges).toEqual([
      {
        personKey: 'officer',
        itemId: salary().id,
        itemDescription: 'Salary from the Ministry',
        kind: 'value-change',
        explanation: 'Promoted to Principal Accountant in March 2026',
      },
      {
        personKey: 'officer',
        itemId: vehicle().id,
        itemDescription: 'Family car',
        kind: 'acquisition',
        explanation: 'Bought in 2026',
      },
    ]);
  });

  it('composes paragraph 9 itself: what a client sends is replaced, and follows later edits', async () => {
    const draft = await started();
    await save(
      draft.id,
      'statement:officer',
      await statementWith(draft.id, {
        ...allItems(),
        income: [{ ...salary(), change: EXPLAINED }],
      }),
      1,
    );
    const other = (await getSection(draft.id, 'other')).json<SectionEnvelope>();

    const forged = await save(
      draft.id,
      'other',
      {
        ...other.contents,
        materialChanges: [{ kind: 'disposal', explanation: 'Typed by hand' }],
      },
      2,
    );

    expect(forged.statusCode).toBe(200);
    expect(forged.json<SectionSaveResult>()).toMatchObject({ completeness: 'complete' });
    expect(
      (await getSection(draft.id, 'other')).json<SectionEnvelope>().contents.materialChanges,
    ).toEqual([expect.objectContaining({ itemId: salary().id, kind: 'value-change' })]);

    await save(draft.id, 'statement:officer', await statementWith(draft.id, allItems()), 3);

    expect(
      (await getSection(draft.id, 'other')).json<SectionEnvelope>().contents.materialChanges,
    ).toEqual([]);
  });
});

describe('paragraph 9 registrable interests (S9)', () => {
  it('lists a directorship flagged as changed, and holds paragraph 9 incomplete until it is explained', async () => {
    const draft = await started();
    const other = (await getSection(draft.id, 'other')).json<SectionEnvelope>();
    const interests = other.contents.registrableInterests as Record<string, unknown>;
    const directorship = {
      company: 'Lake Basin Holdings Ltd',
      role: 'Director',
      remunerated: true,
      change: { changed: true, kind: 'acquisition' },
    };

    const unexplained = await save(
      draft.id,
      'other',
      { ...other.contents, registrableInterests: { ...interests, directorships: [directorship] } },
      1,
    );

    expect(unexplained.json<SectionSaveResult>()).toMatchObject({ completeness: 'incomplete' });
    expect(unexplained.json<SectionSaveResult>().issues.map((found) => found.path)).toEqual([
      '/registrableInterests/directorships/0/change/explanation',
    ]);

    const explained = {
      ...directorship,
      change: { ...directorship.change, explanation: 'Appointed in 2026.' },
    };
    const saved = await save(
      draft.id,
      'other',
      { ...other.contents, registrableInterests: { ...interests, directorships: [explained] } },
      2,
    );

    expect(saved.json<SectionSaveResult>()).toMatchObject({ completeness: 'complete' });
    expect(
      (await getSection(draft.id, 'other')).json<SectionEnvelope>().contents.materialChanges,
    ).toEqual([
      {
        personKey: 'officer',
        itemDescription: 'Lake Basin Holdings Ltd',
        kind: 'directorship',
        explanation: 'Appointed in 2026.',
      },
    ]);
  });
});

describe('ciphertext opacity for statement items (S13)', () => {
  const SECRETS = [
    'Salary from the Ministry',
    'Kitengela',
    'KAJIADO',
    'KDQ 417M',
    'Subaru',
    'Thamesbridge',
    'Kileleshwa',
    'Othaya',
    'Housing Finance',
    'Promoted to Principal',
    '480000017',
    '350000023',
    '190000031',
    '207000041',
    '1250053',
    '2400000059',
    '910000067',
  ];

  it('keeps every item value out of the clear columns and the ciphertext', async () => {
    const draft = await started();
    await save(
      draft.id,
      'statement:officer',
      await statementWith(draft.id, {
        ...allItems(),
        income: [
          {
            ...salary(),
            change: {
              changed: true,
              kind: 'value-change',
              explanation: 'Promoted to Principal Accountant',
            },
          },
        ],
      }),
      1,
    );
    // Paragraph 9 now holds the explanation too.
    const other = (await getSection(draft.id, 'other')).json<SectionEnvelope>();
    await save(draft.id, 'other', other.contents, 2);

    const { rows } = await api.asPerson(ACHIENG, (tx) =>
      tx.execute(
        sql`select section_key, completeness, metadata::text as metadata, envelope::text as envelope,
                   saved_version, encode(ciphertext, 'escape') as escaped, ciphertext
              from declaration_sections where declaration_id = ${draft.id}`,
      ),
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const ciphertext = row.ciphertext as Buffer;
      const stored = [
        String(row.section_key),
        String(row.completeness),
        String(row.metadata),
        String(row.envelope),
        String(row.escaped),
        ciphertext.toString('utf8'),
        ciphertext.toString('latin1'),
      ].join('\n');
      for (const secret of SECRETS) expect(stored).not.toContain(secret);
    }
    const statement = rows.find((row) => row.section_key === 'statement:officer');
    expect(JSON.parse(String(statement?.metadata))).toEqual({
      counts: { income: 1, assets: 4, liabilities: 1 },
      nil: { income: false, assets: false, liabilities: false },
    });
  });
});
