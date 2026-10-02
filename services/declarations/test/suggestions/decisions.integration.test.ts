import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  filingObligations,
  rosterSnapshots,
  suggestions,
} from '../../src/db/schema.js';
import type { Declaration, SectionEnvelope } from '../../src/drafts/representation.js';
import type { Suggestion, SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';
import { registryCheckFixtures } from '../support/registry-checks.js';
import { ardhisasa, brs, kra, ntsa } from '../fixtures/registry-results.js';
import { household, SPOUSE_ID, spouse } from '../fixtures/sections.js';

/**
 * Spec 05b S4 and S5 over HTTP, with the lookup workflow on the suite's Temporal worker and a fake
 * integration-gateway: the declarant accepts a suggestion, as it came or as they edited it, into
 * a new item or onto the item it matches, through the section save with `If-Match`; or dismisses
 * it. Checking a registry again supersedes only what is still `new`, and what the declarant has
 * decided does not come back as new.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, sub: personId, roles: ['declarant'] });
const achieng = declarant(ACHIENG);
const otieno = declarant(OTIENO);
const reviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };

const OFFICER_ID = '27451863';
const SPOUSE_NATIONAL_ID = '31877402';

const ACCEPT = '/v1/declarations/{declarationId}/suggestions/{suggestionId}/accept';
const DISMISS = '/v1/declarations/{declarationId}/suggestions/{suggestionId}/dismiss';

interface Acceptance {
  suggestion: Suggestion;
  itemId: string;
  etag: string;
}

let api: DeclarationsApi;
const { givenOfficerNationalId, checked, eventsOf } = registryCheckFixtures(() => api);

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await api.asPlatform((tx) =>
    tx.insert(commissionRefs).values({
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
    }),
  );
});

/** Achieng's draft; the registries know her by OFFICER_ID. */
async function givenDraft(): Promise<Declaration> {
  const record = rosterRecord('psc', { personId: ACHIENG, fullName: 'Achieng Wambui Otieno' });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant: 'psc',
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: record.appointmentDate,
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
    achieng,
  );
  expect(response.statusCode).toBe(201);
  const draft = response.json<Declaration>();
  await givenOfficerNationalId(ACHIENG, draft.id, OFFICER_ID);
  return draft;
}

function givenOfficerRegistries() {
  api.gateway.given('kra', OFFICER_ID, kra.found);
  api.gateway.given('ntsa', OFFICER_ID, ntsa.found);
  api.gateway.given('brs', OFFICER_ID, brs.found);
  api.gateway.given('ardhisasa', OFFICER_ID, ardhisasa.found);
}

/** The draft's current ETag, as the portal holds it after a read. */
async function etagOf(declarationId: string): Promise<string> {
  const response = await api.request('GET', `/v1/declarations/${declarationId}`, achieng);
  return String(response.headers.etag);
}

async function section(declarationId: string, key: string): Promise<SectionEnvelope> {
  const response = await api.request(
    'GET',
    `/v1/declarations/${declarationId}/sections/${key}`,
    achieng,
  );
  expect(response.statusCode).toBe(200);
  return response.json<SectionEnvelope>();
}

async function save(declarationId: string, key: string, body: unknown): Promise<void> {
  const response = await api.request(
    'PUT',
    `/v1/declarations/${declarationId}/sections/${key}`,
    achieng,
    {
      headers: { 'if-match': await etagOf(declarationId) },
      body,
    },
  );
  expect(response.statusCode, response.body).toBe(200);
}

/** Saves the officer's statement with a car whose registration NTSA also holds. */
async function givenDeclaredCar(declarationId: string): Promise<string> {
  const carId = randomUUID();
  await save(declarationId, 'statement:officer', {
    incomeNil: true,
    income: [],
    assetsNil: false,
    assets: [
      {
        id: carId,
        type: 'vehicle',
        description: 'Family car',
        details: { registration: 'kca-123a' },
        value: { kesCents: 150_000_000 },
        location: { inKenya: true, county: '047' },
        joint: { isJoint: false },
        change: { changed: false },
      },
    ],
    liabilitiesNil: true,
    liabilities: [],
  });
  return carId;
}

function accept(
  declarationId: string,
  suggestionId: string,
  body: unknown,
  { ifMatch, caller = achieng }: { ifMatch?: string | null; caller?: Caller } = {},
) {
  return api.request(
    'POST',
    `/v1/declarations/${declarationId}/suggestions/${suggestionId}/accept`,
    caller,
    { headers: ifMatch === null || ifMatch === undefined ? {} : { 'if-match': ifMatch }, body },
  );
}

/** Accepts at the draft's current version, expecting it to go through. */
async function accepted(
  declarationId: string,
  suggestion: Suggestion,
  body: Record<string, unknown> = {},
): Promise<Acceptance> {
  const response = await accept(
    declarationId,
    suggestion.id,
    { fields: suggestion.fields, applyToItemId: null, ...body },
    { ifMatch: await etagOf(declarationId) },
  );
  expect(response.statusCode, response.body).toBe(200);
  const result = response.json<Acceptance>();
  expect(contractErrors(responseBody(ACCEPT, 'post', 200), result)).toEqual([]);
  expect(response.headers.etag).toBe(result.etag);
  return result;
}

function dismiss(
  declarationId: string,
  suggestionId: string,
  body?: unknown,
  caller: Caller = achieng,
) {
  return api.request(
    'POST',
    `/v1/declarations/${declarationId}/suggestions/${suggestionId}/dismiss`,
    caller,
    body === undefined ? {} : { body },
  );
}

function bySource(sets: SuggestionSet[]): Record<string, SuggestionSet> {
  return Object.fromEntries(sets.map((set) => [set.source, set]));
}

/** The suggestion of `itemType` in the set, the nth of them. */
function suggestionOf(set: SuggestionSet | undefined, itemType: string, nth = 0): Suggestion {
  const found = set?.suggestions.filter((each) => each.itemType === itemType)[nth];
  if (!found) throw new Error(`No ${itemType} #${String(nth)} in ${JSON.stringify(set)}`);
  return found;
}

type Item = Record<string, unknown> & { id: string };

function itemsOf(envelope: SectionEnvelope, list: 'assets' | 'income'): Item[] {
  return envelope.contents[list] as Item[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('accepting a suggestion (S4)', () => {
  it('adds the vehicle as it came through the section save, marked with its source', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    const before = Number(JSON.parse(await etagOf(draft.id)));

    const result = await accepted(draft.id, fielder);

    expect(result.etag).toBe(`"${String(before + 1)}"`);
    expect(result.suggestion).toMatchObject({
      id: fielder.id,
      status: 'accepted',
      acceptedItemId: result.itemId,
    });
    const officer = await section(draft.id, 'statement:officer');
    expect(officer.draftVersion).toBe(before + 1);
    expect(itemsOf(officer, 'assets')).toEqual([
      {
        id: result.itemId,
        type: 'vehicle',
        description: 'Toyota Fielder',
        details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
        location: { inKenya: true },
        joint: { isJoint: false },
        change: { changed: false },
        source: {
          kind: 'ntsa',
          suggestionId: fielder.id,
          verificationResultId: ntsa.found.resultId,
          at: expect.stringMatching(ISO) as unknown,
        },
      },
    ]);
    // The value is the declarant's to give: the item asks for it.
    expect(officer.completeness).toBe('incomplete');
  });

  it('records the save and the acceptance, identifiers only', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');

    const result = await accepted(draft.id, fielder);

    const saved = await eventsOf('declaration.section-saved.v1');
    expect(saved.map((event) => event.data)).toContainEqual({
      declarationId: draft.id,
      sectionKey: 'statement:officer',
      draftVersion: Number(JSON.parse(result.etag)),
      sectionsChanged: [],
    });
    const acceptances = await eventsOf('declaration.suggestion-accepted.v1');
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]).toMatchObject({
      tenant: 'psc',
      subject: draft.id,
      data: {
        declarationId: draft.id,
        suggestionId: fielder.id,
        setId: set?.id,
        source: 'ntsa',
        sectionKey: 'statement:officer',
        itemId: result.itemId,
        applied: false,
      },
    });
    const published = JSON.stringify([...saved, ...acceptances]);
    for (const personal of ['KCA 123A', 'Toyota', OFFICER_ID]) {
      expect(published).not.toContain(personal);
    }
  });

  it('adds the fields as the declarant edited them', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');

    const result = await accepted(draft.id, fielder, {
      fields: { ...fielder.fields, description: 'The school-run car', year: 2017 },
    });

    const [item] = itemsOf(await section(draft.id, 'statement:officer'), 'assets');
    expect(item).toMatchObject({
      id: result.itemId,
      description: 'The school-run car',
      details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2017' },
    });
  });

  it('fills only the empty fields of the item it matches, keeping what the declarant typed', async () => {
    const draft = await givenDraft();
    const carId = await givenDeclaredCar(draft.id);
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    expect(fielder.matchItemId).toBe(carId);

    const result = await accepted(draft.id, fielder, { applyToItemId: carId });

    expect(result.itemId).toBe(carId);
    expect(result.suggestion.acceptedItemId).toBe(carId);
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toEqual([
      {
        id: carId,
        type: 'vehicle',
        description: 'Family car',
        details: { registration: 'kca-123a', makeModel: 'Toyota Fielder, 2016' },
        value: { kesCents: 150_000_000 },
        location: { inKenya: true, county: '047' },
        joint: { isJoint: false },
        change: { changed: false },
        source: expect.objectContaining({ kind: 'ntsa', suggestionId: fielder.id }) as unknown,
      },
    ]);
    const [event] = await eventsOf('declaration.suggestion-accepted.v1');
    expect(event?.data).toMatchObject({ itemId: carId, applied: true });
  });

  it("overwrites the matching item's fields when the declarant asks", async () => {
    const draft = await givenDraft();
    const carId = await givenDeclaredCar(draft.id);
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');

    await accepted(draft.id, fielder, { applyToItemId: carId, overwrite: true });

    const [item] = itemsOf(await section(draft.id, 'statement:officer'), 'assets');
    expect(item).toMatchObject({
      id: carId,
      description: 'Toyota Fielder',
      details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
      // Values are never the registry's.
      value: { kesCents: 150_000_000 },
    });
  });

  it('places each kind of suggestion where declaration.v1 has it', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const sets = bySource(await checked(draft.id, achieng, 'officer', ['kra', 'brs', 'ardhisasa']));

    const plot = await accepted(draft.id, suggestionOf(sets.ardhisasa, 'land'));
    const shares = await accepted(draft.id, suggestionOf(sets.brs, 'shareholding'));
    const directorship = await accepted(draft.id, suggestionOf(sets.brs, 'directorship'));
    const income = await accepted(draft.id, suggestionOf(sets.kra, 'income-hint'));

    const officer = await section(draft.id, 'statement:officer');
    expect(itemsOf(officer, 'assets')).toEqual([
      expect.objectContaining({
        id: plot.itemId,
        type: 'land',
        description: 'Land in Uasin Gishu',
        details: { parcelNumber: 'Uasin Gishu/Kimumu/2231', size: '0.2 ha' },
        location: { inKenya: true, county: '027' },
        source: expect.objectContaining({ kind: 'ardhisasa' }) as unknown,
      }),
      expect.objectContaining({
        id: shares.itemId,
        type: 'shareholding',
        description: 'Shares in Rift Valley Agrovet Ltd',
        details: { issuer: 'Rift Valley Agrovet Ltd', quantityOrPercent: '500 shares' },
        source: expect.objectContaining({ kind: 'brs' }) as unknown,
      }),
    ]);
    // A hint to check the salary, never KRA's figure.
    expect(itemsOf(officer, 'income')).toEqual([
      {
        id: income.itemId,
        type: 'salary-emoluments',
        location: { inKenya: true },
        change: { changed: false },
        source: expect.objectContaining({ kind: 'kra' }) as unknown,
      },
    ]);
    expect(officer.contents).toMatchObject({ incomeNil: false, assetsNil: false });
    // The officer's directorship is a paragraph 9 registrable interest; remuneration is theirs to say.
    const other = await section(draft.id, 'other');
    expect(other.contents.registrableInterests).toMatchObject({
      directorships: [
        {
          id: directorship.itemId,
          company: 'Kimumu Transporters Limited',
          role: 'Director',
          source: expect.objectContaining({ kind: 'brs' }) as unknown,
        },
      ],
    });
  });

  it("refuses the officer's KRA PIN, which declaration.v1 has no field for (400), and leaves it new", async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['kra']);
    const pin = suggestionOf(set, 'bio-tax');

    const response = await accept(
      draft.id,
      pin.id,
      { fields: pin.fields, applyToItemId: null },
      { ifMatch: await etagOf(draft.id) },
    );

    expect(response.statusCode).toBe(400);
    expect(contractErrors(responseBody(ACCEPT, 'post', 400), response.json())).toEqual([]);
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(suggestions).where(eq(suggestions.id, pin.id)),
    );
    expect(row?.status).toBe('new');
  });

  it("puts a spouse's KRA PIN on the spouse in Household", async () => {
    const draft = await givenDraft();
    const contents = household();
    contents.spouses.items = [spouse({ nationalId: SPOUSE_NATIONAL_ID })];
    await save(draft.id, 'household', contents);
    api.gateway.given('kra', SPOUSE_NATIONAL_ID, kra.found);
    const [set] = await checked(draft.id, achieng, `spouse:${SPOUSE_ID}`, ['kra']);

    const result = await accepted(draft.id, suggestionOf(set, 'bio-tax'));

    expect(result.itemId).toBe(SPOUSE_ID);
    const saved = await section(draft.id, 'household');
    expect(saved.contents.spouses).toMatchObject({
      items: [{ id: SPOUSE_ID, nationalId: SPOUSE_NATIONAL_ID, kraPin: 'A005231876K' }],
    });
  });

  it('answers 409 when the draft changed since the ETag sent, and changes nothing', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    const stale = await etagOf(draft.id);
    await givenDeclaredCar(draft.id);

    const response = await accept(
      draft.id,
      fielder.id,
      { fields: fielder.fields, applyToItemId: null },
      { ifMatch: stale },
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'draft-version-mismatch' });
    expect(contractErrors(responseBody(ACCEPT, 'post', 409), response.json())).toEqual([]);
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toHaveLength(1);
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(suggestions).where(eq(suggestions.id, fielder.id)),
    );
    expect(row).toMatchObject({ status: 'new', acceptedItemId: null });
    expect(await eventsOf('declaration.suggestion-accepted.v1')).toEqual([]);
  });

  it('answers 428 without If-Match', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');

    const response = await accept(draft.id, fielder.id, {
      fields: fielder.fields,
      applyToItemId: null,
    });

    expect(response.statusCode).toBe(428);
  });

  it('answers 409 not-new for a suggestion accepted or dismissed already', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    const dmax = suggestionOf(set, 'vehicle', 1);
    await accepted(draft.id, fielder);
    expect((await dismiss(draft.id, dmax.id)).statusCode).toBe(200);

    for (const decided of [fielder, dmax]) {
      const response = await accept(
        draft.id,
        decided.id,
        { fields: decided.fields, applyToItemId: null },
        { ifMatch: await etagOf(draft.id) },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'not-new' });
      expect(contractErrors(responseBody(ACCEPT, 'post', 409), response.json())).toEqual([]);
    }
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toHaveLength(1);
  });

  it.each([
    ['no fields', () => ({ applyToItemId: null })],
    [
      'an item that is not in the section',
      (fielder: Suggestion) => ({ fields: fielder.fields, applyToItemId: randomUUID() }),
    ],
    [
      'a value that does not fit the item',
      () => ({ fields: { registration: 'K'.repeat(40) }, applyToItemId: null }),
    ],
  ])('refuses %s (400)', async (_, bodyFor) => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');

    const response = await accept(draft.id, fielder.id, bodyFor(fielder), {
      ifMatch: await etagOf(draft.id),
    });

    expect(response.statusCode).toBe(400);
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toEqual([]);
  });

  it('refuses to apply a suggestion to an item of another type (400)', async () => {
    const draft = await givenDraft();
    const carId = await givenDeclaredCar(draft.id);
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ardhisasa']);
    const plot = suggestionOf(set, 'land');

    const response = await accept(
      draft.id,
      plot.id,
      { fields: plot.fields, applyToItemId: carId },
      { ifMatch: await etagOf(draft.id) },
    );

    expect(response.statusCode).toBe(400);
  });

  it('answers 404 to another declarant, to staff and for an unknown suggestion', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    const ifMatch = await etagOf(draft.id);
    const body = { fields: fielder.fields, applyToItemId: null };

    for (const caller of [otieno, reviewer]) {
      expect((await accept(draft.id, fielder.id, body, { ifMatch, caller })).statusCode).toBe(404);
      expect((await dismiss(draft.id, fielder.id, {}, caller)).statusCode).toBe(404);
    }
    expect((await accept(draft.id, randomUUID(), body, { ifMatch })).statusCode).toBe(404);
    expect((await accept(draft.id, 'not-a-uuid', body, { ifMatch })).statusCode).toBe(404);
    expect((await dismiss(draft.id, randomUUID())).statusCode).toBe(404);
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toEqual([]);
  });
});

describe('dismissing, and checking again (S5)', () => {
  it('records the dismissal with its reason, announcing it with identifiers only', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const dmax = suggestionOf(set, 'vehicle', 1);

    const response = await dismiss(draft.id, dmax.id, { reason: 'Sold to my brother in 2025' });

    expect(response.statusCode).toBe(200);
    const dismissed = response.json<Suggestion>();
    expect(contractErrors(responseBody(DISMISS, 'post', 200), dismissed)).toEqual([]);
    expect(dismissed).toMatchObject({ id: dmax.id, status: 'dismissed', acceptedItemId: null });
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(suggestions).where(eq(suggestions.id, dmax.id)),
    );
    expect(row).toMatchObject({ status: 'dismissed', reason: 'Sold to my brother in 2025' });
    const events = await eventsOf('declaration.suggestion-dismissed.v1');
    expect(events.map((event) => event.data)).toEqual([
      { declarationId: draft.id, suggestionId: dmax.id, setId: set?.id, source: 'ntsa' },
    ]);
    expect(JSON.stringify(events)).not.toContain('brother');
    // Nothing in the draft changes.
    expect(itemsOf(await section(draft.id, 'statement:officer'), 'assets')).toEqual([]);
  });

  it('dismisses without a reason, and again without effect', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const dmax = suggestionOf(set, 'vehicle', 1);

    expect((await dismiss(draft.id, dmax.id)).statusCode).toBe(200);
    const again = await dismiss(draft.id, dmax.id, { reason: 'Not mine' });

    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'dismissed' });
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(suggestions).where(eq(suggestions.id, dmax.id)),
    );
    expect(row?.reason).toBeNull();
    expect(await eventsOf('declaration.suggestion-dismissed.v1')).toHaveLength(1);
  });

  it('refuses to dismiss an accepted suggestion (409 not-new), or with an overlong reason (400)', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const [set] = await checked(draft.id, achieng, 'officer', ['ntsa']);
    const fielder = suggestionOf(set, 'vehicle');
    const dmax = suggestionOf(set, 'vehicle', 1);
    await accepted(draft.id, fielder);

    const response = await dismiss(draft.id, fielder.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'not-new' });
    expect(contractErrors(responseBody(DISMISS, 'post', 409), response.json())).toEqual([]);
    expect((await dismiss(draft.id, dmax.id, { reason: 'x'.repeat(201) })).statusCode).toBe(400);
  });

  it('supersedes only the new suggestions on a re-check; accepted and dismissed are kept and do not come back as new', async () => {
    const draft = await givenDraft();
    const thirdCar = {
      registrationNumber: 'KDE 001M',
      make: 'Mazda',
      model: 'Demio',
      yearOfManufacture: 2018,
      registeredOn: '2024-02-10',
    };
    api.gateway.given('ntsa', OFFICER_ID, ntsa.found, {
      ...ntsa.found,
      resultId: randomUUID(),
      vehicles: [...ntsa.found.vehicles, thirdCar],
    });
    api.gateway.given('ardhisasa', OFFICER_ID, ardhisasa.found);
    const first = bySource(await checked(draft.id, achieng, 'officer', ['ntsa', 'ardhisasa']));
    const fielder = suggestionOf(first.ntsa, 'vehicle');
    const dmax = suggestionOf(first.ntsa, 'vehicle', 1);
    const { itemId } = await accepted(draft.id, fielder);
    await dismiss(draft.id, dmax.id, { reason: 'Sold' });

    const sets = await checked(draft.id, achieng, 'officer', ['ntsa', 'ardhisasa']);

    const earlier = (id: string | undefined) => sets.find((set) => set.id === id);
    const later = (source: string) =>
      sets.find((set) => set.source === source && set.id !== first[source]?.id);
    expect(earlier(first.ntsa?.id)?.suggestions.map((each) => [each.id, each.status])).toEqual([
      [fielder.id, 'accepted'],
      [dmax.id, 'dismissed'],
    ]);
    expect(earlier(first.ntsa?.id)?.suggestions[0]?.acceptedItemId).toBe(itemId);
    expect(earlier(first.ardhisasa?.id)?.suggestions.map((each) => each.status)).toEqual([
      'superseded',
      'superseded',
    ]);
    // The cars the declarant decided on come back superseded; only the new one is new.
    expect(
      later('ntsa')?.suggestions.map((each) => [each.fields.registration, each.status]),
    ).toEqual([
      ['KCA 123A', 'superseded'],
      ['KDA 456X', 'superseded'],
      ['KDE 001M', 'new'],
    ]);
    expect(later('ardhisasa')?.suggestions.map((each) => each.status)).toEqual(['new', 'new']);
    // Only what is offered as new is announced as ready.
    const ready = await eventsOf('declaration.suggestions-ready.v1');
    expect(ready.find((event) => event.data.setId === later('ntsa')?.id)?.data).toMatchObject({
      count: 1,
    });
  });
});
