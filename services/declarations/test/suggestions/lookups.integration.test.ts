import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  filingObligations,
  outbox,
  rosterSnapshots,
  suggestionConsents,
  suggestions,
  suggestionSets,
} from '../../src/db/schema.js';
import type { Declaration } from '../../src/drafts/representation.js';
import { RegistryLookupSteps } from '../../src/suggestions/registry-lookup-steps.js';
import type { Suggestion, SuggestionSet } from '../../src/suggestions/representation.js';
import { contractErrors, okResponse, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';
import { unavailable } from '../support/fake-integration-gateway.js';
import { registryCheckFixtures } from '../support/registry-checks.js';
import { DUE_DAY, submissionFixtures } from '../support/submission.js';
import { ardhisasa, brs, kra, ntsa } from '../fixtures/registry-results.js';
import { CHILD_ID, household, SPOUSE_ID, spouse } from '../fixtures/sections.js';

/**
 * Spec 05b S1, S2, S7 and S9 over HTTP, with the lookup workflow on the suite's Temporal worker
 * and a fake integration-gateway: the declarant consents and checks registries for a person of
 * their household; each registry is asked with the declarant's request as legal basis and the
 * declaration as case; the answers become encrypted suggestion sets, matched against the items
 * already declared; unavailable registries and persons without a national ID are handled; the
 * sets are the declarant's alone and go with the draft.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, sub: personId, roles: ['declarant'] });
const achieng = declarant(ACHIENG);
const otieno = declarant(OTIENO);
const reviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };

const OFFICER_ID = '27451863';
const SPOUSE_NATIONAL_ID = '31877402';
const CONSENT = { requested: true, textVersion: 'registry-consent-v1' };
const ALL = ['kra', 'ntsa', 'brs', 'ardhisasa'] as const;

const LOOKUPS = '/v1/declarations/{declarationId}/suggestions/lookups';
const LIST = '/v1/declarations/{declarationId}/suggestions';

let api: DeclarationsApi;
const filing = submissionFixtures(() => api);
const { givenOfficerNationalId } = registryCheckFixtures(() => api);

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

/** A draft of the person's, the directory giving the officer's national ID (or none). */
async function givenDraft(
  personId = ACHIENG,
  caller: Caller = achieng,
  { nationalId = OFFICER_ID }: { nationalId?: string | null } = {},
): Promise<Declaration> {
  const record = rosterRecord('psc', { personId, fullName: 'Achieng Wambui Otieno' });
  api.directory.givenRecords([record]);
  if (nationalId !== null) api.directory.givenNationalId('psc', personId, nationalId);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId: record.id,
      tenant: 'psc',
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      state: 'onboarded',
      appointmentDate: record.appointmentDate,
      personId,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant: 'psc',
      rosterRecordId: record.id,
      personId,
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
  const response = await api.request('POST', `/v1/obligations/${obligationId}/declaration`, caller);
  expect(response.statusCode).toBe(201);
  return response.json<Declaration>();
}

/** Saves the household: a spouse with a national ID, a child (under 18) without one. */
async function givenHousehold(draft: Declaration): Promise<number> {
  const contents = household();
  contents.spouses.items = [spouse({ nationalId: SPOUSE_NATIONAL_ID })];
  const response = await api.request(
    'PUT',
    `/v1/declarations/${draft.id}/sections/household`,
    achieng,
    { headers: { 'if-match': `"${String(draft.draftVersion)}"` }, body: contents },
  );
  expect(response.statusCode).toBe(200);
  return Number(JSON.parse(String(response.headers.etag)));
}

/** Saves the officer's statement with a car whose registration NTSA also holds. */
async function givenDeclaredCar(draft: Declaration, version: number): Promise<string> {
  const carId = randomUUID();
  const response = await api.request(
    'PUT',
    `/v1/declarations/${draft.id}/sections/statement:officer`,
    achieng,
    {
      headers: { 'if-match': `"${String(version)}"` },
      body: {
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
      },
    },
  );
  expect(response.statusCode).toBe(200);
  return carId;
}

function requestLookups(
  declarationId: string,
  body: unknown,
  { caller = achieng, key = randomUUID() }: { caller?: Caller; key?: string } = {},
) {
  return api.request('POST', `/v1/declarations/${declarationId}/suggestions/lookups`, caller, {
    headers: { 'idempotency-key': key },
    body,
  });
}

function list(declarationId: string, query = '', caller: Caller = achieng) {
  return api.request('GET', `/v1/declarations/${declarationId}/suggestions${query}`, caller);
}

/** The sets once no lookup is pending any more (the workflow has recorded every answer). */
async function settled(declarationId: string, query = ''): Promise<SuggestionSet[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const response = await list(declarationId, query);
    expect(response.statusCode).toBe(200);
    const sets = response.json<SuggestionSet[]>();
    expect(contractErrors(okResponse(LIST, 'get'), sets)).toEqual([]);
    if (sets.every((set) => set.status !== 'pending')) return sets;
    if (Date.now() > deadline) throw new Error(`Still pending: ${JSON.stringify(sets)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function bySource(sets: SuggestionSet[]): Record<string, SuggestionSet> {
  return Object.fromEntries(sets.map((set) => [set.source, set]));
}

async function eventsOf(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
  return rows.map((row) => row.envelope);
}

function givenOfficerRegistries() {
  api.gateway.given('kra', OFFICER_ID, kra.found);
  api.gateway.given('ntsa', OFFICER_ID, ntsa.found);
  api.gateway.given('brs', OFFICER_ID, brs.found);
  api.gateway.given('ardhisasa', OFFICER_ID, ardhisasa.found);
}

describe('checking registries for the officer (S1)', () => {
  it('asks each registry with the legal basis and case, and answers ready sets of mapped suggestions', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();

    const response = await requestLookups(draft.id, {
      personKey: 'officer',
      systems: [...ALL],
      consent: CONSENT,
    });

    expect(response.statusCode).toBe(202);
    const started = response.json<SuggestionSet[]>();
    expect(contractErrors(responseBody(LOOKUPS, 'post', 202), started)).toEqual([]);
    expect(started.map((set) => set.source).sort()).toEqual([...ALL].sort());
    expect(started.every((set) => set.personKey === 'officer')).toBe(true);

    const sets = bySource(await settled(draft.id));
    expect(api.gateway.calls).toHaveLength(4);
    for (const call of api.gateway.calls) {
      expect(call).toMatchObject({
        tenant: 'psc',
        nationalId: OFFICER_ID,
        legalBasis: 'declarant-request',
        caseRef: draft.id,
        subjectPersonId: ACHIENG,
      });
    }
    expect(Object.values(sets).map((set) => set.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
    expect(sets.ntsa?.verificationResultId).toBe(ntsa.found.resultId);
    expect(sets.ntsa?.readyAt).not.toBeNull();
    expect(sets.ntsa?.suggestions.map((each) => [each.itemType, each.fields])).toEqual([
      [
        'vehicle',
        {
          description: 'Toyota Fielder',
          registration: 'KCA 123A',
          make: 'Toyota',
          model: 'Fielder',
          year: 2016,
        },
      ],
      [
        'vehicle',
        {
          description: 'Isuzu D-Max',
          registration: 'KDA 456X',
          make: 'Isuzu',
          model: 'D-Max',
          year: 2021,
        },
      ],
    ]);
    expect(sets.ntsa?.suggestions[0]).toMatchObject({
      setId: sets.ntsa?.id,
      personKey: 'officer',
      sectionKey: 'statement:officer',
      sourceRef: { registration: 'KCA 123A', registeredOn: '2019-03-14' },
      confidence: null,
      matchItemId: null,
      status: 'new',
      acceptedItemId: null,
    });
    expect(sets.kra?.suggestions.map((each) => [each.sectionKey, each.itemType])).toEqual([
      ['bio', 'bio-tax'],
      ['statement:officer', 'income-hint'],
    ]);
    expect(sets.brs?.suggestions.map((each) => each.itemType)).toEqual([
      'shareholding',
      'directorship',
      'shareholding',
      'directorship',
    ]);
    expect(sets.ardhisasa?.suggestions.every((each) => each.itemType === 'land')).toBe(true);
  });

  it('records the consent and announces the request and each ready set, identifiers only', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();

    await requestLookups(draft.id, { personKey: 'officer', systems: [...ALL], consent: CONSENT });
    const sets = await settled(draft.id);

    const [consent] = await api.asPerson(ACHIENG, (tx) => tx.select().from(suggestionConsents));
    expect(consent).toMatchObject({
      declarationId: draft.id,
      personKey: 'officer',
      consentedBy: ACHIENG,
      textVersion: 'registry-consent-v1',
      systems: [...ALL],
    });
    const requested = await eventsOf('declaration.lookup-requested.v1');
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      tenant: 'psc',
      subject: draft.id,
      data: {
        declarationId: draft.id,
        personKey: 'officer',
        systems: [...ALL],
        consentId: consent?.id,
      },
    });
    const ready = await eventsOf('declaration.suggestions-ready.v1');
    expect(ready.map((event) => event.data).sort(bySetId)).toEqual(
      sets
        .map((set) => ({
          declarationId: draft.id,
          setId: set.id,
          source: set.source,
          count: set.suggestions.filter((each) => each.status === 'new').length,
        }))
        .sort(bySetId),
    );
    const published = JSON.stringify([...requested, ...ready]);
    for (const personal of [OFFICER_ID, 'KCA 123A', 'A005231876K', 'Rift Valley']) {
      expect(published).not.toContain(personal);
    }
  });

  it('keeps what the registries said encrypted at rest', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();

    await requestLookups(draft.id, { personKey: 'officer', systems: [...ALL], consent: CONSENT });
    await settled(draft.id);

    const rows = await api.asPerson(ACHIENG, (tx) => tx.select().from(suggestions));
    expect(rows.length).toBeGreaterThan(0);
    const stored = JSON.stringify(
      rows.map((row) => ({ ...row, ciphertext: row.ciphertext.toString('latin1') })),
    );
    for (const personal of ['KCA 123A', 'Toyota', 'A005231876K', 'Rift Valley', 'Uasin']) {
      expect(stored).not.toContain(personal);
    }
    expect(
      api.cipher.calls.filter((call) => call.operation === 'encrypt').map((c) => c.recordId),
    ).toEqual(expect.arrayContaining(rows.map((row) => `${draft.id}/suggestions/${row.id}`)));
  });

  it('offers to apply a suggestion to the item whose identifier it shares', async () => {
    const draft = await givenDraft();
    const carId = await givenDeclaredCar(draft, draft.draftVersion);
    givenOfficerRegistries();

    await requestLookups(draft.id, { personKey: 'officer', systems: ['ntsa'], consent: CONSENT });
    const [set] = await settled(draft.id);

    expect(set?.suggestions.map((each) => each.matchItemId)).toEqual([carId, null]);
  });

  it('runs a repeated request once (Idempotency-Key)', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const key = randomUUID();
    const body = { personKey: 'officer', systems: ['kra'], consent: CONSENT };

    const first = await requestLookups(draft.id, body, { key });
    await settled(draft.id);
    const again = await requestLookups(draft.id, body, { key });

    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual(first.json());
    expect(api.gateway.calls).toHaveLength(1);
  });

  it('supersedes the earlier new suggestions of a registry checked again', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    const body = { personKey: 'officer', systems: ['ntsa'], consent: CONSENT };

    await requestLookups(draft.id, body);
    const [first] = await settled(draft.id);
    await requestLookups(draft.id, body);
    const sets = await settled(draft.id);

    expect(sets).toHaveLength(2);
    const earlier = sets.find((set) => set.id === first?.id);
    const later = sets.find((set) => set.id !== first?.id);
    expect(earlier?.suggestions.map((each) => each.status)).toEqual(['superseded', 'superseded']);
    expect(later?.suggestions.map((each) => each.status)).toEqual(['new', 'new']);
  });
});

describe('who can be checked, and registries that do not answer (S2)', () => {
  it('refuses a child without a national ID (no-id) and asks nothing', async () => {
    const draft = await givenDraft();
    await givenHousehold(draft);

    const response = await requestLookups(draft.id, {
      personKey: `child:${CHILD_ID}`,
      systems: [...ALL],
      consent: CONSENT,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'no-id' });
    expect(contractErrors(responseBody(LOOKUPS, 'post', 400), response.json())).toEqual([]);
    expect(api.gateway.calls).toEqual([]);
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(suggestionSets))).toEqual([]);
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(suggestionConsents))).toEqual([]);
  });

  it('marks every registry no-id for a declarant the directory gives no national ID', async () => {
    const draft = await givenDraft(ACHIENG, achieng, { nationalId: null });
    givenOfficerRegistries();

    const response = await requestLookups(draft.id, {
      personKey: 'officer',
      systems: [...ALL],
      consent: CONSENT,
    });

    expect(response.statusCode).toBe(202);
    const sets = await settled(draft.id);
    expect(sets.map((set) => [set.source, set.status, set.suggestions])).toEqual(
      ['kra', 'ntsa', 'brs', 'ardhisasa'].map((source) => [source, 'no-id', []]),
    );
    expect(sets.every((set) => set.readyAt === null)).toBe(true);
    expect(api.directory.nationalIdReads).toHaveLength(4);
    expect(api.gateway.calls).toEqual([]);
    expect(await eventsOf('declaration.suggestions-ready.v1')).toEqual([]);
  });

  it("looks a spouse up by the national ID in Household, into the spouse's sections", async () => {
    const draft = await givenDraft();
    await givenHousehold(draft);
    api.gateway.given('kra', SPOUSE_NATIONAL_ID, kra.found);
    api.gateway.given('ntsa', SPOUSE_NATIONAL_ID, ntsa.found);

    const personKey = `spouse:${SPOUSE_ID}`;
    const response = await requestLookups(draft.id, {
      personKey,
      systems: ['kra', 'ntsa'],
      consent: CONSENT,
    });

    expect(response.statusCode).toBe(202);
    const sets = bySource(await settled(draft.id));
    expect(api.gateway.calls.map((call) => call.nationalId)).toEqual([
      SPOUSE_NATIONAL_ID,
      SPOUSE_NATIONAL_ID,
    ]);
    expect(api.directory.nationalIdReads).toEqual([]);
    expect(sets.ntsa?.suggestions.map((each) => each.sectionKey)).toEqual([
      `statement:${personKey}`,
      `statement:${personKey}`,
    ]);
    expect(sets.kra?.suggestions.map((each) => [each.sectionKey, each.itemType])).toEqual([
      ['household', 'bio-tax'],
      [`statement:${personKey}`, 'income-hint'],
    ]);
  });

  it('marks a registry that never answers unavailable after its retries, the others ready', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    api.gateway.given('ardhisasa', OFFICER_ID, unavailable('ardhisasa'));
    api.gateway.given('brs', OFFICER_ID, 'down');

    await requestLookups(draft.id, { personKey: 'officer', systems: [...ALL], consent: CONSENT });
    const sets = bySource(await settled(draft.id));

    expect(sets.kra?.status).toBe('ready');
    expect(sets.ntsa?.status).toBe('ready');
    expect(sets.ardhisasa).toMatchObject({ status: 'unavailable', readyAt: null, suggestions: [] });
    expect(sets.brs).toMatchObject({ status: 'unavailable', suggestions: [] });
    expect(api.gateway.callsTo('ardhisasa')).toHaveLength(3);
    expect(api.gateway.callsTo('brs')).toHaveLength(3);
    expect(api.gateway.callsTo('kra')).toHaveLength(1);
    expect(await eventsOf('declaration.suggestions-ready.v1')).toHaveLength(2);
  });

  it('records the answer of a registry that comes back on a retry', async () => {
    const draft = await givenDraft();
    api.gateway.given('ntsa', OFFICER_ID, unavailable('ntsa'), ntsa.found);

    await requestLookups(draft.id, { personKey: 'officer', systems: ['ntsa'], consent: CONSENT });
    const [set] = await settled(draft.id);

    expect(set).toMatchObject({ status: 'ready', verificationResultId: ntsa.found.resultId });
    expect(set?.suggestions).toHaveLength(2);
    expect(api.gateway.callsTo('ntsa')).toHaveLength(2);
  });
});

describe('consent and who may check (S9)', () => {
  it.each([
    ['no consent', undefined],
    ['consent not requested', { requested: false, textVersion: 'registry-consent-v1' }],
    ['no consent text version', { requested: true }],
  ])('refuses a lookup with %s (consent-required) and asks nothing', async (_, consent) => {
    const draft = await givenDraft();

    const response = await requestLookups(draft.id, {
      personKey: 'officer',
      systems: ['kra'],
      ...(consent === undefined ? {} : { consent }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'consent-required' });
    expect(api.gateway.calls).toEqual([]);
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(suggestionConsents))).toEqual([]);
  });

  it.each([
    ['no systems', { personKey: 'officer', systems: [], consent: CONSENT }],
    ['an unknown registry', { personKey: 'officer', systems: ['iprs'], consent: CONSENT }],
    [
      'a person not in the household',
      { personKey: `spouse:${randomUUID()}`, systems: ['kra'], consent: CONSENT },
    ],
    ['a malformed person key', { personKey: 'neighbour', systems: ['kra'], consent: CONSENT }],
  ])('refuses %s (400)', async (_, body) => {
    const draft = await givenDraft();

    const response = await requestLookups(draft.id, body);

    expect(response.statusCode).toBe(400);
    expect(api.gateway.calls).toEqual([]);
  });

  it('answers 404 to another declarant and to staff, on the lookups and the list', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    await requestLookups(draft.id, { personKey: 'officer', systems: ['kra'], consent: CONSENT });
    await settled(draft.id);

    const body = { personKey: 'officer', systems: ['kra'], consent: CONSENT };
    for (const caller of [otieno, reviewer]) {
      expect((await requestLookups(draft.id, body, { caller })).statusCode).toBe(404);
      expect((await list(draft.id, '', caller)).statusCode).toBe(404);
    }
    expect((await list(randomUUID())).statusCode).toBe(404);
    expect((await list('not-a-uuid')).statusCode).toBe(404);
    expect(api.gateway.calls).toHaveLength(1);
  });

  it("lists the declarant's sets narrowed to a person or a section", async () => {
    const draft = await givenDraft();
    await givenHousehold(draft);
    givenOfficerRegistries();
    api.gateway.given('ntsa', SPOUSE_NATIONAL_ID, ntsa.found);
    await requestLookups(draft.id, { personKey: 'officer', systems: ['kra'], consent: CONSENT });
    await requestLookups(draft.id, {
      personKey: `spouse:${SPOUSE_ID}`,
      systems: ['ntsa'],
      consent: CONSENT,
    });
    await settled(draft.id);

    const spouses = await settled(draft.id, `?personKey=spouse:${SPOUSE_ID}`);
    expect(spouses.map((set) => set.source)).toEqual(['ntsa']);
    const bio = await settled(draft.id, '?sectionKey=bio');
    expect(bio.map((set) => [set.source, set.suggestions.map((each) => each.itemType)])).toEqual([
      ['kra', ['bio-tax']],
    ]);
  });

  it('audits each read of the suggestions, which hold registry records (ADR-008)', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    await requestLookups(draft.id, { personKey: 'officer', systems: ['kra'], consent: CONSENT });
    await settled(draft.id);
    const suggestionReads = async () =>
      (await eventsOf('audit.read.v1')).filter(
        (event) => event.data.action === 'declaration.suggestions.read',
      );
    const before = (await suggestionReads()).length;

    expect((await list(draft.id)).statusCode).toBe(200);

    const reads = await suggestionReads();
    expect(before).toBeGreaterThan(0);
    expect(reads).toHaveLength(before + 1);
    expect(reads.at(-1)?.data).toMatchObject({
      action: 'declaration.suggestions.read',
      resource: { type: 'declaration', params: { declarationId: draft.id } },
    });
  });
});

describe('suggestions go with the draft (S7)', () => {
  it('deletes the sets and suggestions when the draft is discarded, keeping the consent', async () => {
    const draft = await givenDraft();
    givenOfficerRegistries();
    await requestLookups(draft.id, { personKey: 'officer', systems: [...ALL], consent: CONSENT });
    await settled(draft.id);

    const response = await api.request('DELETE', `/v1/declarations/${draft.id}`, achieng);

    expect(response.statusCode).toBe(204);
    await api.asPerson(ACHIENG, async (tx) => {
      expect(await tx.select().from(suggestions)).toEqual([]);
      expect(await tx.select().from(suggestionSets)).toEqual([]);
      // The record of the legal basis the lookups were made on (ADR-008).
      expect(await tx.select().from(suggestionConsents)).toMatchObject([
        { declarationId: draft.id, personKey: 'officer', textVersion: 'registry-consent-v1' },
      ]);
    });
  });
});

describe('suggestions expire with the draft once it is submitted (S7)', () => {
  /** Achieng's complete draft, the officer checked at NTSA; the draft and a suggestion. */
  async function givenCheckedDraft(): Promise<{ draft: Declaration; suggestion: Suggestion }> {
    api.clock.setToday(DUE_DAY);
    const draft = await filing.completeDraft(ACHIENG);
    await givenOfficerNationalId(ACHIENG, draft.id, OFFICER_ID);
    givenOfficerRegistries();
    return { draft, suggestion: await checkedAtNtsa(draft.id) };
  }

  /** The officer checked at NTSA; the first suggestion of the ready set. */
  async function checkedAtNtsa(declarationId: string): Promise<Suggestion> {
    const response = await requestLookups(declarationId, {
      personKey: 'officer',
      systems: ['ntsa'],
      consent: CONSENT,
    });
    expect(response.statusCode, response.body).toBe(202);
    const [suggestion] = (await settled(declarationId)).flatMap((set) => set.suggestions);
    if (!suggestion) throw new Error('NTSA suggested nothing');
    return suggestion;
  }

  /**
   * Nothing is listed, an old suggestion is not found to accept or dismiss, no suggestion row is
   * left; the consents stay, the record of the legal basis.
   */
  async function expectExpired(declarationId: string, suggestion: Suggestion): Promise<void> {
    const listed = await list(declarationId);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);
    const etag = String(
      (await api.request('GET', `/v1/declarations/${declarationId}`, achieng)).headers.etag,
    );
    const accept = await api.request(
      'POST',
      `/v1/declarations/${declarationId}/suggestions/${suggestion.id}/accept`,
      achieng,
      { headers: { 'if-match': etag }, body: { fields: suggestion.fields, applyToItemId: null } },
    );
    expect(accept.statusCode).toBe(404);
    const dismiss = await api.request(
      'POST',
      `/v1/declarations/${declarationId}/suggestions/${suggestion.id}/dismiss`,
      achieng,
    );
    expect(dismiss.statusCode).toBe(404);
    await api.asPerson(ACHIENG, async (tx) => {
      expect(await tx.select().from(suggestions)).toEqual([]);
      expect(await tx.select().from(suggestionSets)).toEqual([]);
      const consents = await tx.select().from(suggestionConsents);
      expect(consents.length).toBeGreaterThan(0);
      expect(consents.every((consent) => consent.declarationId === declarationId)).toBe(true);
    });
  }

  function amend(declarationId: string, action: 'amend' | 'amend/discard') {
    return api.request(
      'POST',
      `/v1/declarations/${declarationId}/${action}`,
      filing.declarant(ACHIENG),
    );
  }

  it('deletes them when the declaration is submitted', async () => {
    const { draft, suggestion } = await givenCheckedDraft();

    const response = await filing.submit(draft.id, filing.steppedUp(ACHIENG));

    expect(response.statusCode, response.body).toBe(201);
    await expectExpired(draft.id, suggestion);
  });

  it("deletes an amendment's when it is submitted, and when it is discarded", async () => {
    const { draft } = await givenCheckedDraft();
    expect((await filing.submit(draft.id, filing.steppedUp(ACHIENG))).statusCode).toBe(201);

    expect((await amend(draft.id, 'amend')).statusCode).toBe(200);
    const resubmitted = await checkedAtNtsa(draft.id);
    expect((await filing.submit(draft.id, filing.steppedUp(ACHIENG))).statusCode).toBe(201);
    await expectExpired(draft.id, resubmitted);

    expect((await amend(draft.id, 'amend')).statusCode).toBe(200);
    const discarded = await checkedAtNtsa(draft.id);
    expect((await amend(draft.id, 'amend/discard')).statusCode).toBe(200);
    await expectExpired(draft.id, discarded);
  });

  it('lets a lookup that finishes after the submit record nothing, quietly', async () => {
    const { draft, suggestion } = await givenCheckedDraft();
    expect((await filing.submit(draft.id, filing.steppedUp(ACHIENG))).statusCode).toBe(201);
    const ref = {
      tenant: 'psc',
      declarationId: draft.id,
      personId: ACHIENG,
      subject: ACHIENG,
      personKey: 'officer' as const,
      setId: suggestion.setId,
    };
    const steps = api.app.get(RegistryLookupSteps);

    await expect(steps.lookup({ ...ref, system: 'ntsa', final: true })).resolves.toBe('recorded');
    await expect(steps.fail(ref)).resolves.toBeUndefined();

    await api.asPerson(ACHIENG, async (tx) => {
      expect(await tx.select().from(suggestions)).toEqual([]);
      expect(await tx.select().from(suggestionSets)).toEqual([]);
    });
    expect(await eventsOf('declaration.suggestions-ready.v1')).toHaveLength(1);
  });
});

function bySetId(a: unknown, b: unknown): number {
  const id = (value: unknown) => String((value as { setId?: string }).setId);
  return id(a).localeCompare(id(b));
}
