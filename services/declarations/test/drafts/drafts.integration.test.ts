import { randomUUID } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  declarationSections,
  declarations,
  filingObligations,
  obligationDrafts,
  outbox,
  rosterSnapshots,
} from '../../src/db/schema.js';
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
import type { PulledRosterRecord } from '../../src/directory/directory-client.js';
import { rosterRecord } from '../support/fake-directory.js';
import { assetItem, incomeItem } from '../fixtures/sections.js';

/**
 * Spec 05 S1-S4, S13 and S22 over HTTP: a declarant starts a draft from a filing obligation (type,
 * dates and income period derived, bio pre-filled from the roster record through the directory),
 * reads it and saves sections under If-Match; contents are encrypted with the Commission's key
 * (`FakeCipher`) and nothing but identifiers reaches the outbox.
 */

const ACHIENG = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, roles: ['declarant'] });
const reviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };

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

interface ObligationSetup {
  personId?: string;
  type?: 'initial' | 'biennial' | 'final';
  statementDate?: string;
  status?: 'upcoming' | 'due' | 'overdue' | 'filed' | 'cancelled';
  appointmentDate?: string;
  /** What else the roster record says (spec 05b HR fields). */
  roster?: Partial<PulledRosterRecord>;
}

/** An onboarded PSC declarant's roster record (in the directory) and one obligation of theirs. */
async function givenObligation({
  personId = ACHIENG,
  type = 'biennial',
  statementDate = '2027-11-01',
  status = 'due',
  appointmentDate = '2015-01-05',
  roster = {},
}: ObligationSetup = {}): Promise<{ obligationId: string; rosterRecordId: string }> {
  const record = rosterRecord('psc', {
    personId,
    ofr: 'OFR-0482913-L',
    fullName: 'Achieng Wambui Otieno',
    personnelFileNumber: 'PSC/2015/0042',
    designation: 'Senior Accountant',
    reportingEntity: { id: randomUUID(), name: 'Ministry of Health' },
    appointmentDate,
    ...roster,
  });
  api.directory.givenRecords([record]);
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx
      .insert(rosterSnapshots)
      .values({
        rosterRecordId: record.id,
        tenant: 'psc',
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        state: 'onboarded',
        appointmentDate,
        personId,
        sourceUpdatedAt: new Date(),
      })
      .onConflictDoNothing();
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant: 'psc',
      rosterRecordId: record.id,
      personId,
      type,
      cycleKey: type === 'biennial' ? 'biennial:2027' : `${type}:${statementDate}`,
      statementDate,
      dueDate: statementDate,
      status,
      cancelReason: status === 'cancelled' ? 'superseded' : null,
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  return { obligationId, rosterRecordId: record.id };
}

function start(obligationId: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('POST', `/v1/obligations/${obligationId}/declaration`, caller);
}

function getSection(id: string, key: string, caller: Caller = declarant(ACHIENG)) {
  return api.request('GET', `/v1/declarations/${id}/sections/${key}`, caller);
}

function save(
  id: string,
  key: string,
  body: unknown,
  ifMatch: string | undefined,
  caller: Caller = declarant(ACHIENG),
) {
  return api.request('PUT', `/v1/declarations/${id}/sections/${key}`, caller, {
    headers: ifMatch === undefined ? {} : { 'if-match': ifMatch },
    body,
  });
}

async function started(setup: ObligationSetup = {}): Promise<Declaration> {
  const { obligationId } = await givenObligation(setup);
  const response = await start(obligationId, declarant(setup.personId ?? ACHIENG));
  expect(response.statusCode).toBe(201);
  return response.json<Declaration>();
}

/** Bio with every field the declarant enters; the locked fields as pre-filled. */
function fullBio(prefilled: Record<string, unknown>) {
  const employment = prefilled.employment as Record<string, unknown>;
  return {
    ...prefilled,
    birth: { date: '1980-04-02', place: 'Kisumu' },
    maritalStatus: 'single',
    address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
    employment: { ...employment, nature: 'permanent' },
  };
}

async function bioContents(id: string): Promise<Record<string, unknown>> {
  return (await getSection(id, 'bio')).json<SectionEnvelope>().contents;
}

const DECLARATION_BODY = (status: 200 | 201) =>
  `/paths/~1v1~1obligations~1{id}~1declaration/post/responses/${String(status)}/content/application~1json/schema`;
const SECTION_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/get/responses/200/content/application~1json/schema';
const SAVE_BODY =
  '/paths/~1v1~1declarations~1{declarationId}~1sections~1{sectionKey}/put/responses/200/content/application~1json/schema';

describe('starting a draft (S1)', () => {
  it('derives a biennial from the obligation, pre-fills bio from the roster and records the start', async () => {
    const { obligationId } = await givenObligation();

    const response = await start(obligationId);

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"1"');
    const draft = response.json<Declaration>();
    expect(contractErrors(DECLARATION_BODY(201), draft)).toEqual([]);
    expect(draft).toMatchObject({
      obligationId,
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      type: 'biennial',
      statementDate: '2027-11-01',
      incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
      status: 'draft',
      schemaVersion: 'declaration.v1',
      draftVersion: 1,
      lastSection: null,
    });
    expect(draft.sections).toEqual([
      { key: 'bio', completeness: 'not-started', updatedAt: null, personName: null },
      {
        key: 'household',
        completeness: 'not-started',
        updatedAt: null,
        personName: null,
        counts: { spouses: 0, children: 0 },
      },
      {
        key: 'statement:officer',
        completeness: 'not-started',
        updatedAt: null,
        personName: 'Achieng Wambui Otieno',
        counts: { income: 0, assets: 0, liabilities: 0 },
      },
      {
        key: 'other',
        completeness: 'not-started',
        updatedAt: null,
        personName: null,
        counts: { directorships: 0, memberships: 0, pendingCases: 0 },
      },
    ]);

    const bio = await getSection(draft.id, 'bio');
    expect(bio.statusCode).toBe(200);
    expect(contractErrors(SECTION_BODY, bio.json())).toEqual([]);
    expect(bio.json<SectionEnvelope>()).toEqual({
      key: 'bio',
      completeness: 'not-started',
      contents: {
        name: { firstName: 'Achieng', otherNames: 'Wambui', surname: 'Otieno' },
        employment: {
          designation: 'Senior Accountant',
          employer: 'Ministry of Health',
          responsibleCommission: 'psc',
          personnelFileNumber: 'PSC/2015/0042',
          appointmentDate: '2015-01-05',
        },
      },
      issues: [],
      prefilledFields: ['/employment/appointmentDate'],
      draftVersion: 1,
    });

    const statement = (await getSection(draft.id, 'statement:officer')).json<SectionEnvelope>();
    expect(statement.contents).toEqual({
      personKey: 'officer',
      personName: { firstName: 'Achieng', otherNames: 'Wambui', surname: 'Otieno' },
      statementDate: '2027-11-01',
      incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
      incomeNil: false,
      income: [],
      assetsNil: false,
      assets: [],
      liabilitiesNil: false,
      liabilities: [],
    });

    const started = await api.db
      .select({ type: outbox.eventType, envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'declaration.draft-started.v1'));
    expect(started).toHaveLength(1);
    expect(started[0]?.envelope).toMatchObject({
      subject: draft.id,
      tenant: 'psc',
      data: { declarationId: draft.id, obligationId, type: 'biennial' },
    });
  });

  it('returns the same draft when started again', async () => {
    const { obligationId } = await givenObligation();
    const first = (await start(obligationId)).json<Declaration>();

    const again = await start(obligationId);

    expect(again.statusCode).toBe(200);
    expect(contractErrors(DECLARATION_BODY(200), again.json())).toEqual([]);
    expect(again.json<Declaration>().id).toBe(first.id);
    const events = await api.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, 'declaration.draft-started.v1'));
    expect(events).toHaveLength(1);
  });

  it('starts one draft when two starts race', async () => {
    const { obligationId } = await givenObligation();

    const [a, b] = await Promise.all([start(obligationId), start(obligationId)]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json<Declaration>().id).toBe(b.json<Declaration>().id);
  });

  it('reads the draft back with its version as the ETag', async () => {
    const draft = await started();

    const response = await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG));

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.json()).toEqual(draft);
  });
});

describe('income periods by type (S2)', () => {
  it('gives an initial the year ending on the appointment date', async () => {
    const draft = await started({
      type: 'initial',
      statementDate: '2027-06-20',
      appointmentDate: '2027-06-20',
    });

    expect(draft.type).toBe('initial');
    expect(draft.incomePeriod).toEqual({
      from: '2026-06-20',
      to: '2027-06-20',
      fromSource: 'assumed',
    });
  });

  it('runs a final from the previous statement date on Adili to the exit date', async () => {
    await api.asPerson(ACHIENG, (tx) =>
      tx.insert(declarations).values({
        id: randomUUID(),
        tenant: 'psc',
        personId: ACHIENG,
        obligationId: randomUUID(),
        rosterRecordId: randomUUID(),
        type: 'biennial',
        statementDate: '2027-11-01',
        incomePeriodFrom: '2025-11-01',
        incomePeriodTo: '2027-11-01',
        previousStatementDateSource: 'assumed',
        status: 'submitted',
      }),
    );

    const draft = await started({ type: 'final', statementDate: '2028-09-15' });

    expect(draft.incomePeriod).toEqual({
      from: '2027-11-01',
      to: '2028-09-15',
      fromSource: 'declared',
    });
  });

  it('assumes two years for a final with no declaration on Adili', async () => {
    const draft = await started({ type: 'final', statementDate: '2027-09-15' });

    expect(draft.incomePeriod).toEqual({
      from: '2025-09-15',
      to: '2027-09-15',
      fromSource: 'assumed',
    });
  });
});

describe('who can start and read a draft (S3)', () => {
  it.each(['filed', 'cancelled'] as const)('refuses a %s obligation with 409', async (status) => {
    const { obligationId } = await givenObligation({ status });

    const response = await start(obligationId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: 'obligation-closed', status: 409 });
    expect(await api.asPerson(ACHIENG, (tx) => tx.select().from(declarations))).toEqual([]);
  });

  it.each(['filed', 'cancelled'] as const)(
    'refuses a %s obligation with 409 even when a draft of it is still live',
    async (status) => {
      const { obligationId } = await givenObligation();
      expect((await start(obligationId)).statusCode).toBe(201);
      await api.asPlatform((tx) =>
        tx
          .update(filingObligations)
          .set({ status, cancelReason: status === 'cancelled' ? 'superseded' : null })
          .where(eq(filingObligations.id, obligationId)),
      );

      const response = await start(obligationId);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: 'obligation-closed', status: 409 });
    },
  );

  it.each(['upcoming', 'overdue'] as const)('starts from an %s obligation', async (status) => {
    const { obligationId } = await givenObligation({ status });

    expect((await start(obligationId)).statusCode).toBe(201);
  });

  it("is 404 for another person's obligation and draft", async () => {
    const { obligationId } = await givenObligation();
    const draft = (await start(obligationId)).json<Declaration>();
    const other = declarant(OTIENO);

    expect((await start(obligationId, other)).statusCode).toBe(404);
    expect((await api.request('GET', `/v1/declarations/${draft.id}`, other)).statusCode).toBe(404);
    expect((await getSection(draft.id, 'bio', other)).statusCode).toBe(404);
    expect((await save(draft.id, 'bio', {}, '"1"', other)).statusCode).toBe(404);
  });

  it('is 404 for staff on every route', async () => {
    const { obligationId } = await givenObligation();
    const draft = (await start(obligationId)).json<Declaration>();

    expect((await start(obligationId, reviewer)).statusCode).toBe(404);
    expect((await api.request('GET', `/v1/declarations/${draft.id}`, reviewer)).statusCode).toBe(
      404,
    );
    expect((await getSection(draft.id, 'bio', reviewer)).statusCode).toBe(404);
    expect((await save(draft.id, 'bio', {}, '"1"', reviewer)).statusCode).toBe(404);
  });

  it('is 404 for an unknown obligation, declaration or section key', async () => {
    const draft = await started();

    expect((await start(randomUUID())).statusCode).toBe(404);
    expect((await start('not-a-uuid')).statusCode).toBe(404);
    expect(
      (await api.request('GET', `/v1/declarations/${randomUUID()}`, declarant(ACHIENG))).statusCode,
    ).toBe(404);
    expect((await getSection(draft.id, 'statement:spouse:unknown')).statusCode).toBe(404);
    expect((await getSection(draft.id, `statement:spouse:${randomUUID()}`)).statusCode).toBe(404);
  });
});

describe('HR fields from the roster (spec 05b S8)', () => {
  const HR_FIELDS = [
    '/employment/jobGroup',
    '/employment/appointmentDate',
    '/employment/workStation',
    '/maritalStatus',
  ];
  const LOCKED = [
    '/name/surname',
    '/name/firstName',
    '/name/otherNames',
    '/employment/responsibleCommission',
    '/employment/personnelFileNumber',
    '/employment/designation',
    '/employment/employer',
  ];

  async function bioMetadata(id: string) {
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx
        .select({ metadata: declarationSections.metadata })
        .from(declarationSections)
        .where(eq(declarationSections.declarationId, id))
        .orderBy(asc(declarationSections.sectionKey)),
    );
    return row?.metadata;
  }

  it('pre-fills job group, appointment date, work station and marital status, editable, with their source', async () => {
    const draft = await started({
      roster: { jobGroup: 'P', workStation: 'Afya House, Nairobi', maritalStatus: 'married' },
    });

    const bio = await getSection(draft.id, 'bio');

    expect(contractErrors(SECTION_BODY, bio.json())).toEqual([]);
    const envelope = bio.json<SectionEnvelope>();
    expect(envelope.contents).toMatchObject({
      maritalStatus: 'married',
      employment: {
        jobGroup: 'P',
        appointmentDate: '2015-01-05',
        workStation: 'Afya House, Nairobi',
      },
    });
    expect(envelope.prefilledFields).toEqual(HR_FIELDS);
    // Identity stays locked as before; the HR fields are not locked.
    expect(await bioMetadata(draft.id)).toEqual({
      lockedFields: LOCKED,
      prefilledFields: HR_FIELDS,
    });
  });

  it('lets the declarant change them, and then no longer calls the changed one pre-filled', async () => {
    const draft = await started({
      roster: { jobGroup: 'P', workStation: 'Afya House, Nairobi', maritalStatus: 'married' },
    });
    const bio = fullBio(await bioContents(draft.id));
    const employment = bio.employment as Record<string, unknown>;

    const response = await save(
      draft.id,
      'bio',
      { ...bio, maritalStatus: 'married', employment: { ...employment, jobGroup: 'Q' } },
      '"1"',
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors(SAVE_BODY, response.json())).toEqual([]);
    const remaining = ['/employment/appointmentDate', '/employment/workStation', '/maritalStatus'];
    expect(response.json<SectionSaveResult>().prefilledFields).toEqual(remaining);
    const read = (await getSection(draft.id, 'bio')).json<SectionEnvelope>();
    expect(read.contents).toMatchObject({ employment: { jobGroup: 'Q' } });
    expect(read.prefilledFields).toEqual(remaining);

    // Typing the roster's value back does not make it the roster's again.
    const again = await save(
      draft.id,
      'bio',
      { ...bio, maritalStatus: 'married', employment: { ...employment, jobGroup: 'P' } },
      '"2"',
    );
    expect(again.json<SectionSaveResult>().prefilledFields).toEqual(remaining);
  });

  it('leaves them empty when the roster has none', async () => {
    const draft = await started({
      roster: { jobGroup: null, workStation: null, maritalStatus: null, appointmentDate: null },
    });

    const envelope = (await getSection(draft.id, 'bio')).json<SectionEnvelope>();

    expect(envelope.contents).not.toHaveProperty('maritalStatus');
    expect(envelope.contents.employment).toEqual({
      designation: 'Senior Accountant',
      employer: 'Ministry of Health',
      responsibleCommission: 'psc',
      personnelFileNumber: 'PSC/2015/0042',
    });
    expect(envelope.prefilledFields).toEqual([]);
    expect(await bioMetadata(draft.id)).toEqual({ lockedFields: LOCKED, prefilledFields: [] });
  });

  it('still refuses a change to a locked field', async () => {
    const draft = await started({ roster: { jobGroup: 'P' } });
    const bio = fullBio(await bioContents(draft.id));
    const employment = bio.employment as Record<string, unknown>;

    const response = await save(
      draft.id,
      'bio',
      { ...bio, employment: { ...employment, designation: 'Accountant', jobGroup: 'Q' } },
      '"1"',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: 'identity-locked-field',
      errors: [{ path: 'employment.designation' }],
    });
  });
});

describe('saving a section (S4)', () => {
  it('saves bio, bumps the version and reports completeness', async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));
    api.clock.setToday('2027-10-15');

    const response = await save(draft.id, 'bio', bio, '"1"');

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(contractErrors(SAVE_BODY, response.json())).toEqual([]);
    expect(response.json<SectionSaveResult>()).toEqual({
      key: 'bio',
      completeness: 'complete',
      draftVersion: 2,
      issues: [],
      prefilledFields: ['/employment/appointmentDate'],
      sectionsChanged: [],
      reopenedSuggestions: [],
    });
    const read = await getSection(draft.id, 'bio');
    expect(read.headers.etag).toBe('"2"');
    expect(read.json<SectionEnvelope>()).toMatchObject({
      completeness: 'complete',
      contents: bio,
      draftVersion: 2,
    });
    const header = (
      await api.request('GET', `/v1/declarations/${draft.id}`, declarant(ACHIENG))
    ).json<Declaration>();
    expect(header).toMatchObject({ draftVersion: 2, lastSection: 'bio' });
    expect(header.sections[0]).toMatchObject({ key: 'bio', completeness: 'complete' });
    expect(header.sections[0]?.updatedAt).toBe('2027-10-15T09:00:00.000Z');
  });

  it('keeps what is missing as incomplete, with the issues', async () => {
    const draft = await started();
    const partial: Record<string, unknown> = fullBio(await bioContents(draft.id));
    delete partial.address;

    const response = await save(draft.id, 'bio', partial, '1');

    expect(response.statusCode).toBe(200);
    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [{ sectionKey: 'bio', path: '/address', code: 'required' }],
    });
  });

  it('refuses a stale If-Match with 412 and a missing one with 428', async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));
    await save(draft.id, 'bio', bio, '"1"');

    const stale = await save(draft.id, 'bio', bio, '"1"');
    const missing = await save(draft.id, 'bio', bio, undefined);

    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ type: 'draft-version-mismatch', status: 412 });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ type: 'if-match-required', status: 428 });
    expect((await getSection(draft.id, 'bio')).headers.etag).toBe('"2"');
  });

  it("refuses a change to the declarant's name with identity-locked-field", async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));

    const response = await save(
      draft.id,
      'bio',
      { ...bio, name: { firstName: 'Achieng', surname: 'Odhiambo' } },
      '"1"',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: 'identity-locked-field',
      errors: [{ path: 'name.surname' }],
    });
    expect((await getSection(draft.id, 'bio')).json<SectionEnvelope>()).toMatchObject({
      completeness: 'not-started',
      draftVersion: 1,
    });
  });

  it('keeps locked fields the body leaves out', async () => {
    const draft = await started();
    const bio: Record<string, unknown> = fullBio(await bioContents(draft.id));
    delete bio.name;
    const employment = { nature: 'contract' };

    const response = await save(draft.id, 'bio', { ...bio, employment }, '"1"');

    expect(response.statusCode).toBe(200);
    expect(await bioContents(draft.id)).toMatchObject({
      name: { firstName: 'Achieng', otherNames: 'Wambui', surname: 'Otieno' },
      employment: {
        designation: 'Senior Accountant',
        employer: 'Ministry of Health',
        responsibleCommission: 'psc',
        personnelFileNumber: 'PSC/2015/0042',
        nature: 'contract',
      },
    });
  });

  it('refuses a malformed body with 400 and stores nothing', async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));

    const wrongEnum = await save(draft.id, 'bio', { ...bio, maritalStatus: 'complicated' }, '"1"');
    const unknownField = await save(draft.id, 'bio', { ...bio, nickname: 'Achi' }, '"1"');
    const notAnObject = await save(draft.id, 'bio', ['bio'], '"1"');

    for (const response of [wrongEnum, unknownField, notAnObject]) {
      expect(response.statusCode).toBe(400);
    }
    expect(wrongEnum.json()).toMatchObject({ errors: [{ path: 'maritalStatus' }] });
    expect((await getSection(draft.id, 'bio')).headers.etag).toBe('"1"');
  });

  it('lets one of two saves at the same version through, atomically', async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));

    const responses = await Promise.all([
      save(draft.id, 'bio', bio, '"1"'),
      save(draft.id, 'household', { spouses: { none: true, items: [] } }, '"1"'),
      save(draft.id, 'other', { freeText: 'Nothing else' }, '"1"'),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 412, 412]);
    const [row] = await api.asPerson(ACHIENG, (tx) =>
      tx
        .select({ draftVersion: declarations.draftVersion })
        .from(declarations)
        .where(eq(declarations.id, draft.id)),
    );
    expect(row?.draftVersion).toBe(2);
    const saved = await api.asPerson(ACHIENG, (tx) =>
      tx
        .select({ key: declarationSections.sectionKey, version: declarationSections.savedVersion })
        .from(declarationSections)
        .where(sql`${declarationSections.savedVersion} = 2`),
    );
    expect(saved).toHaveLength(1);
  });

  it('marks bio and household against each other when both are saved', async () => {
    const draft = await started();
    const bio = fullBio(await bioContents(draft.id));
    await save(
      draft.id,
      'household',
      {
        spouses: {
          none: false,
          items: [
            {
              id: randomUUID(),
              name: { firstName: 'Grace', surname: 'Otieno' },
              separated: false,
            },
          ],
        },
        children: { none: true, items: [] },
      },
      '"1"',
    );

    const response = await save(draft.id, 'bio', bio, '"2"');

    expect(response.json<SectionSaveResult>()).toMatchObject({
      completeness: 'incomplete',
      issues: [{ path: '/maritalStatus', code: 'spouse-conflicts-with-marital-status' }],
    });
    const household = (await getSection(draft.id, 'household')).json<SectionEnvelope>();
    expect(household.completeness).toBe('incomplete');
    expect(household.issues).toContainEqual(
      expect.objectContaining({ code: 'spouse-conflicts-with-marital-status' }),
    );
  });

  it('serves a section just saved or started without decrypting it', async () => {
    const draft = await started();
    api.cipher.calls.length = 0;

    await getSection(draft.id, 'statement:officer');

    expect(api.cipher.calls.filter((call) => call.operation === 'decrypt')).toEqual([]);
  });
});

/** Values typed into the draft that must never appear in clear anywhere. */
const SECRETS = [
  'Achieng',
  'Wambui',
  'Otieno',
  'Kisumu',
  'Lavington',
  '40123',
  'Salary',
  'Toyota Prado',
  '480000000',
  '650000000',
];

async function savedDraft(): Promise<Declaration> {
  const draft = await started();
  const bio = fullBio(await bioContents(draft.id));
  await save(draft.id, 'bio', bio, '"1"');
  const statement = (await getSection(draft.id, 'statement:officer')).json<SectionEnvelope>();
  const response = await save(
    draft.id,
    'statement:officer',
    { ...statement.contents, income: [incomeItem()], assets: [assetItem()], liabilitiesNil: true },
    '"2"',
  );
  expect(response.statusCode).toBe(200);
  return draft;
}

describe('ciphertext opacity (S13)', () => {
  it('stores no plaintext in any column; clear columns hold keys, counts, dates and completeness', async () => {
    const draft = await savedDraft();

    const rows = await api.asPerson(ACHIENG, (tx) =>
      tx
        .select()
        .from(declarationSections)
        .where(eq(declarationSections.declarationId, draft.id))
        .orderBy(asc(declarationSections.sectionKey)),
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const stored = [
        row.ciphertext.toString('utf8'),
        row.ciphertext.toString('latin1'),
        JSON.stringify(row.envelope),
        JSON.stringify(row.metadata),
        row.sectionKey,
        row.completeness,
      ].join('\n');
      for (const secret of SECRETS) expect(stored).not.toContain(secret);
      expect(Object.keys(row.envelope).sort()).toEqual(
        ['iv', 'keyVersion', 'tag', 'tenant', 'v', 'wrappedDek'].sort(),
      );
    }
    expect(rows.find((row) => row.sectionKey === 'statement:officer')).toMatchObject({
      completeness: 'complete',
      metadata: {
        counts: { income: 1, assets: 1, liabilities: 0 },
        nil: { income: false, assets: false, liabilities: true },
      },
    });
    expect(rows.find((row) => row.sectionKey === 'bio')?.metadata).toEqual({
      lockedFields: [
        '/name/surname',
        '/name/firstName',
        '/name/otherNames',
        '/employment/responsibleCommission',
        '/employment/personnelFileNumber',
        '/employment/designation',
        '/employment/employer',
      ],
      prefilledFields: ['/employment/appointmentDate'],
    });

    const [declaration] = await api
      .asPerson(ACHIENG, (tx) => tx.execute(sql`select * from declarations where id = ${draft.id}`))
      .then((result) => result.rows);
    const clear = JSON.stringify(declaration);
    for (const secret of SECRETS) expect(clear).not.toContain(secret);

    expect(
      api.cipher.calls.filter((call) => call.operation === 'encrypt').map((call) => call.tenant),
    ).toEqual(expect.arrayContaining(['psc']));
  });

  it("keeps drafts from every transaction but the declarant's own", async () => {
    const draft = await savedDraft();

    const platform = await api.asPlatform(async (tx) => ({
      declarations: await tx.select().from(declarations),
      sections: await tx.select().from(declarationSections),
    }));
    const other = await api.asPerson(OTIENO, (tx) => tx.select().from(declarations));

    expect(platform).toEqual({ declarations: [], sections: [] });
    expect(other).toEqual([]);
    expect(
      (await api.asPerson(ACHIENG, (tx) => tx.select().from(declarations))).map((row) => row.id),
    ).toEqual([draft.id]);
  });

  it("lets no other person write a declarant's draft rows (ADR-018 decision 5)", async () => {
    const draft = await savedDraft();
    const [section] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(declarationSections).where(eq(declarationSections.declarationId, draft.id)),
    );
    const [started] = await api.asPerson(ACHIENG, (tx) => tx.select().from(obligationDrafts));
    if (!section || !started) throw new Error('the draft has no section or obligation draft');

    // Another person's updates and deletes see no rows.
    const touched = await api.asPerson(OTIENO, async (tx) => ({
      updated: await tx
        .update(declarations)
        .set({ draftVersion: 99 })
        .where(eq(declarations.id, draft.id))
        .returning(),
      deleted: await tx
        .delete(declarationSections)
        .where(eq(declarationSections.declarationId, draft.id))
        .returning(),
    }));
    expect(touched).toEqual({ updated: [], deleted: [] });

    // Their inserts into the declarant's draft are refused.
    await expect(
      api.asPerson(OTIENO, (tx) =>
        tx.insert(declarationSections).values({ ...section, sectionKey: 'statement:child:x' }),
      ),
    ).rejects.toMatchObject(RLS_REFUSED);
    await expect(
      api.asPerson(OTIENO, (tx) =>
        tx.insert(obligationDrafts).values({ ...started, obligationId: randomUUID() }),
      ),
    ).rejects.toMatchObject(RLS_REFUSED);

    // The declarant cannot hand a draft to someone else.
    await expect(
      api.asPerson(ACHIENG, (tx) =>
        tx.update(declarations).set({ personId: OTIENO }).where(eq(declarations.id, draft.id)),
      ),
    ).rejects.toMatchObject(RLS_REFUSED);

    const [kept] = await api.asPerson(ACHIENG, (tx) =>
      tx.select().from(declarations).where(eq(declarations.id, draft.id)),
    );
    expect(kept).toMatchObject({ personId: ACHIENG, draftVersion: 3 });
  });
});

/** Postgres refusing a row under row-level security (insufficient_privilege). */
const RLS_REFUSED = { cause: { code: '42501' } };

describe('events carry identifiers only (S22)', () => {
  it('writes no section content to the outbox', async () => {
    const draft = await savedDraft();
    await getSection(draft.id, 'statement:officer');

    const rows = await api.db.select().from(outbox);

    expect(rows.map((row) => row.eventType).sort()).toEqual([
      'audit.read.v1',
      'audit.read.v1',
      'audit.read.v1',
      'declaration.draft-started.v1',
      'declaration.section-saved.v1',
      'declaration.section-saved.v1',
    ]);
    const serialised = JSON.stringify(rows);
    for (const secret of SECRETS) expect(serialised).not.toContain(secret);
    const started = rows.find((row) => row.eventType === 'declaration.draft-started.v1');
    expect(Object.keys((started?.envelope as { data: object }).data).sort()).toEqual([
      'declarationId',
      'obligationId',
      'type',
    ]);
  });

  it('records each section save in the outbox with identifiers only (ADR-008)', async () => {
    const draft = await savedDraft();

    const saves = await api.db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'declaration.section-saved.v1'));

    expect(
      saves.map(({ envelope: { subject, tenant, data } }) => ({ subject, tenant, data })),
    ).toEqual([
      {
        subject: draft.id,
        tenant: draft.commission.slug,
        data: { declarationId: draft.id, sectionKey: 'bio', draftVersion: 2, sectionsChanged: [] },
      },
      {
        subject: draft.id,
        tenant: draft.commission.slug,
        data: {
          declarationId: draft.id,
          sectionKey: 'statement:officer',
          draftVersion: 3,
          sectionsChanged: [],
        },
      },
    ]);
  });

  it('a refused save records nothing', async () => {
    const draft = await started();

    expect((await save(draft.id, 'bio', {}, '"7"')).statusCode).toBe(412);

    const saves = await api.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, 'declaration.section-saved.v1'));
    expect(saves).toEqual([]);
  });
});
