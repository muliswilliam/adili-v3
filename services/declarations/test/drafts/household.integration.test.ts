import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  declarationSections,
  filingObligations,
  rosterSnapshots,
} from '../../src/db/schema.js';
import { liveSections } from '../../src/drafts/repository.js';
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
import { incomeItem } from '../fixtures/sections.js';

/**
 * Spec 05 S5 and S6 over HTTP: a household save sets up a financial statement for each spouse and
 * each child under eighteen on the statement date, archives the statement of anyone taken out
 * (kept until discard, left out of completeness) and restores it when they come back; marital
 * status in bio decides whether a spouse, or an explicit "none", is needed.
 */

const ACHIENG = randomUUID();
const achieng: Caller = { personId: ACHIENG, roles: ['declarant'] };
const STATEMENT_DATE = '2027-11-01';

const GRACE = randomUUID();
const PETER = randomUUID();
const FAITH = randomUUID();
const BRIAN = randomUUID();
const MERCY = randomUUID();

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
      dueDate: STATEMENT_DATE,
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

function getDraft(id: string) {
  return api.request('GET', `/v1/declarations/${id}`, achieng);
}

function getSection(id: string, key: string) {
  return api.request('GET', `/v1/declarations/${id}/sections/${key}`, achieng);
}

/** Saves at the draft's current version, as the portal does after reading it. */
async function save(id: string, key: string, body: unknown) {
  const version = String((await getDraft(id)).headers.etag);
  return api.request('PUT', `/v1/declarations/${id}/sections/${key}`, achieng, {
    headers: { 'if-match': version },
    body,
  });
}

function spouse(id: string, firstName: string, extra: Record<string, unknown> = {}) {
  return { id, name: { surname: 'Otieno', firstName }, separated: false, ...extra };
}

function child(id: string, firstName: string, dateOfBirth: string) {
  return { id, name: { surname: 'Otieno', firstName }, dateOfBirth };
}

/** Two spouses (Peter separated) and three children, Mercy eighteen on the statement date. */
function household() {
  return {
    spouses: {
      none: false,
      items: [
        spouse(GRACE, 'Grace'),
        spouse(PETER, 'Peter', { separated: true, separationDate: '2024-06-30' }),
      ],
    },
    children: {
      none: false,
      items: [
        child(FAITH, 'Faith', '2012-05-10'),
        child(BRIAN, 'Brian', '2015-01-20'),
        // The client's say on inclusion is ignored: it is derived from the date of birth.
        { ...child(MERCY, 'Mercy', '2009-11-01'), includedAtStatementDate: true },
      ],
    },
  };
}

async function bioWith(id: string, maritalStatus: string) {
  const prefilled = (await getSection(id, 'bio')).json<SectionEnvelope>().contents;
  return {
    ...prefilled,
    birth: { date: '1980-04-02', place: 'Kisumu' },
    maritalStatus,
    address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
    employment: { ...(prefilled.employment as object), nature: 'permanent' },
  };
}

const SAVE_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/put/responses/200/content/application~1json/schema';
const SECTION_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/get/responses/200/content/application~1json/schema';

describe('household statements (S5)', () => {
  it('creates a statement for each spouse and each child under eighteen on the statement date', async () => {
    const draft = await started();

    const response = await save(draft.id, 'household', household());

    expect(response.statusCode).toBe(200);
    const saved = response.json<SectionSaveResult>();
    expect(contractErrors(SAVE_BODY, saved)).toEqual([]);
    expect(saved.sectionsChanged).toEqual(
      expect.arrayContaining([
        { key: `statement:spouse:${GRACE}`, action: 'created' },
        { key: `statement:spouse:${PETER}`, action: 'created' },
        { key: `statement:child:${FAITH}`, action: 'created' },
        { key: `statement:child:${BRIAN}`, action: 'created' },
      ]),
    );
    expect(saved.sectionsChanged).toHaveLength(4);
    expect(saved.notIncluded).toEqual([
      { personKey: `child:${MERCY}`, reason: 'over-18-at-statement-date' },
    ]);

    const sections = (await getDraft(draft.id)).json<Declaration>().sections;
    expect(sections.map(({ key, personName }) => ({ key, personName }))).toEqual([
      { key: 'bio', personName: null },
      { key: 'household', personName: null },
      { key: 'statement:officer', personName: 'Achieng Wambui Otieno' },
      { key: `statement:spouse:${GRACE}`, personName: 'Grace Otieno' },
      { key: `statement:spouse:${PETER}`, personName: 'Peter Otieno' },
      { key: `statement:child:${FAITH}`, personName: 'Faith Otieno' },
      { key: `statement:child:${BRIAN}`, personName: 'Brian Otieno' },
      { key: 'other', personName: null },
    ]);
    expect(sections.find((s) => s.key === `statement:spouse:${PETER}`)).toMatchObject({
      completeness: 'not-started',
      counts: { income: 0, assets: 0, liabilities: 0 },
    });

    const peter = (await getSection(draft.id, `statement:spouse:${PETER}`)).json<SectionEnvelope>();
    expect(peter.contents).toEqual({
      personKey: `spouse:${PETER}`,
      personName: { surname: 'Otieno', firstName: 'Peter' },
      statementDate: STATEMENT_DATE,
      incomePeriod: { from: '2025-11-01', to: STATEMENT_DATE },
      incomeNil: false,
      income: [],
      assetsNil: false,
      assets: [],
      liabilitiesNil: false,
      liabilities: [],
    });

    const stored = await getSection(draft.id, 'household');
    expect(contractErrors(SECTION_BODY, stored.json())).toEqual([]);
    const householdEnvelope = stored.json<SectionEnvelope>();
    expect(householdEnvelope.notIncluded).toEqual([
      { personKey: `child:${MERCY}`, reason: 'over-18-at-statement-date' },
    ]);
    const children = (householdEnvelope.contents.children as { items: Record<string, unknown>[] })
      .items;
    expect(children.map((c) => [c.id, c.includedAtStatementDate])).toEqual([
      [FAITH, true],
      [BRIAN, true],
      [MERCY, false],
    ]);
  });

  it('archives the statement of a spouse taken out, keeps it, and leaves it out of completeness', async () => {
    const draft = await started();
    await save(draft.id, 'household', household());
    const grace = (await getSection(draft.id, `statement:spouse:${GRACE}`)).json<SectionEnvelope>();
    await save(draft.id, `statement:spouse:${GRACE}`, {
      ...grace.contents,
      income: [incomeItem()],
      assetsNil: true,
      liabilitiesNil: true,
    });
    const withoutGrace = household();
    withoutGrace.spouses.items = withoutGrace.spouses.items.filter((s) => s.id !== GRACE);

    const response = await save(draft.id, 'household', withoutGrace);

    expect(response.statusCode).toBe(200);
    expect(response.json<SectionSaveResult>().sectionsChanged).toEqual([
      { key: `statement:spouse:${GRACE}`, action: 'archived' },
    ]);
    const listed = (await getDraft(draft.id)).json<Declaration>().sections;
    expect(listed.find((s) => s.key === `statement:spouse:${GRACE}`)).toMatchObject({
      completeness: 'archived',
      personName: 'Grace Otieno',
    });
    // Kept: still readable, contents intact, until the draft is discarded.
    const archived = (
      await getSection(draft.id, `statement:spouse:${GRACE}`)
    ).json<SectionEnvelope>();
    expect(archived).toMatchObject({ completeness: 'archived', issues: [] });
    expect(archived.contents.income).toEqual([incomeItem()]);
    // Not editable while archived.
    const edit = await save(draft.id, `statement:spouse:${GRACE}`, archived.contents);
    expect(edit.statusCode).toBe(409);
    expect(edit.json<{ type: string }>().type).toContain('section-archived');
    // Completeness and the summary read the live sections: the archived one is not among them.
    const live = await api.asPerson(ACHIENG, (tx) => liveSections(tx, draft.id));
    expect(live.map((row) => row.sectionKey)).toEqual([
      'bio',
      'household',
      'statement:officer',
      `statement:spouse:${PETER}`,
      `statement:child:${FAITH}`,
      `statement:child:${BRIAN}`,
      'other',
    ]);
    const rows = await api.asPerson(ACHIENG, (tx) => tx.select().from(declarationSections));
    expect(rows).toHaveLength(8);
  });

  it('restores an archived statement, contents intact, when the person comes back', async () => {
    const draft = await started();
    await save(draft.id, 'household', household());
    const grace = (await getSection(draft.id, `statement:spouse:${GRACE}`)).json<SectionEnvelope>();
    await save(draft.id, `statement:spouse:${GRACE}`, {
      ...grace.contents,
      income: [incomeItem()],
      assetsNil: true,
      liabilitiesNil: true,
    });
    const withoutGrace = household();
    withoutGrace.spouses.items = withoutGrace.spouses.items.filter((s) => s.id !== GRACE);
    await save(draft.id, 'household', withoutGrace);

    const response = await save(draft.id, 'household', household());

    expect(response.json<SectionSaveResult>().sectionsChanged).toEqual([
      { key: `statement:spouse:${GRACE}`, action: 'restored' },
    ]);
    const restored = (
      await getSection(draft.id, `statement:spouse:${GRACE}`)
    ).json<SectionEnvelope>();
    expect(restored.completeness).toBe('complete');
    expect(restored.contents.income).toEqual([incomeItem()]);
  });

  it("archives a child's statement once their date of birth makes them eighteen on the statement date", async () => {
    const draft = await started();
    await save(draft.id, 'household', household());
    const older = household();
    older.children.items[0] = child(FAITH, 'Faith', '2008-01-01');

    const response = await save(draft.id, 'household', older);

    const saved = response.json<SectionSaveResult>();
    expect(saved.sectionsChanged).toEqual([
      { key: `statement:child:${FAITH}`, action: 'archived' },
    ]);
    expect(saved.notIncluded).toEqual([
      { personKey: `child:${FAITH}`, reason: 'over-18-at-statement-date' },
      { personKey: `child:${MERCY}`, reason: 'over-18-at-statement-date' },
    ]);
  });

  it("keeps the name on a statement in step with the household's", async () => {
    const draft = await started();
    await save(draft.id, 'household', household());
    const renamed = household();
    renamed.spouses.items[0] = spouse(GRACE, 'Gracie');

    const response = await save(draft.id, 'household', renamed);

    expect(response.json<SectionSaveResult>().sectionsChanged).toEqual([]);
    const grace = (await getSection(draft.id, `statement:spouse:${GRACE}`)).json<SectionEnvelope>();
    expect(grace.contents.personName).toEqual({ surname: 'Otieno', firstName: 'Gracie' });
  });

  it('refuses a person listed twice', async () => {
    const draft = await started();
    const twice = household();
    twice.spouses.items.push(spouse(GRACE, 'Grace'));

    const response = await save(draft.id, 'household', twice);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'spouses.items.2.id' }] });
  });
});

describe('marital status against spouses (S6)', () => {
  it('blocks single with a spouse listed, with a message on each side', async () => {
    const draft = await started();
    await save(draft.id, 'household', {
      spouses: { none: false, items: [spouse(GRACE, 'Grace')] },
      children: { none: true, items: [] },
    });

    const response = await save(draft.id, 'bio', await bioWith(draft.id, 'single'));

    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [{ path: '/maritalStatus', code: 'spouse-conflicts-with-marital-status' }],
    });
    const householdSection = (await getSection(draft.id, 'household')).json<SectionEnvelope>();
    expect(householdSection.completeness).toBe('incomplete');
    expect(householdSection.issues).toEqual([
      expect.objectContaining({
        path: '/spouses/items',
        code: 'spouse-conflicts-with-marital-status',
      }),
    ]);
  });

  it('leaves married with no spouse and no explicit "none" incomplete', async () => {
    const draft = await started();
    await save(draft.id, 'bio', await bioWith(draft.id, 'married'));

    const response = await save(draft.id, 'household', {
      spouses: { none: false, items: [] },
      children: { none: true, items: [] },
    });

    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [{ path: '/spouses', code: 'spouse-required' }],
    });
  });

  it('completes married with an explicit "none"', async () => {
    const draft = await started();
    await save(draft.id, 'bio', await bioWith(draft.id, 'married'));

    const response = await save(draft.id, 'household', {
      spouses: { none: true, items: [] },
      children: { none: true, items: [] },
    });

    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'complete',
      issues: [],
      sectionsChanged: [],
    });
    const bio = (await getSection(draft.id, 'bio')).json<SectionEnvelope>();
    expect(bio.completeness).toBe('complete');
  });
});
