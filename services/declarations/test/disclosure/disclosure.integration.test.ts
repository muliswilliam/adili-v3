import { createHash, randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import type { DeclarationV1 } from '@adili/forms';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { versionRecordId } from '../../src/declaration/versions.js';
import { commissionRefs, declarations, declarationVersions, outbox } from '../../src/db/schema.js';
import type {
  DisclosureCounts,
  DisclosureDocument,
  FullVersionDocument,
} from '../../src/disclosure/representation.js';
import type { SubmissionResult } from '../../src/submission/representation.js';
import { contractErrors, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { DUE_DAY, submissionFixtures } from '../support/submission.js';

/**
 * Spec 10 S9 and the declarations side of S13: the scoped disclosure of an access grant returns
 * only the granted versions, household members and sections, and the full document of a version
 * goes only to its declarant's certified copy; both reads are audited with their legal basis, the
 * reference that authorises them and the recipient, and name no content.
 */

const DISCLOSURES = '/internal/v1/declarations/disclosures';
const COUNTS = '/internal/v1/declarations/disclosure-counts';
const FULL_DOCUMENT = '/internal/v1/declarations/{declarationId}/versions/{version}/full-document';

const WANJIKU = randomUUID();
const OTHER = randomUUID();
const SPOUSE = randomUUID();
const CHILD = randomUUID();

const GRANT = 'ARQ-PSC-2028-0000012-N';
const APPLICANT = 'applicant-account-7';
const ACCESS_OFFICER = 'access-officer-3';

/** The access service's account (client credentials), acting for a Commission. */
const ACCESS: Caller = {
  sub: 'service-account-access',
  azp: 'access',
  scope: 'declarations:disclosures',
};

let api: DeclarationsApi;
const { declarant, steppedUp, completeDraft, submit } = submissionFixtures(() => api);

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

/**
 * A declaration of Wanjiku's household: the officer, a spouse and a child, each with an income,
 * an asset and a liability, a material change of the spouse's and other information. Every text
 * is marked with its year and part, so a test can tell what leaked.
 */
function householdDeclaration(year: number, surname = 'Kamau'): DeclarationV1 {
  const statementDate = `${String(year)}-11-01`;
  const incomePeriod = { from: `${String(year - 2)}-11-01`, to: statementDate };
  const location = { inKenya: true, county: '047' };
  const statement = (personKey: string, who: string) => ({
    personKey,
    personName: { firstName: who, surname },
    statementDate,
    incomePeriod,
    incomeNil: false,
    income: [
      {
        id: randomUUID(),
        type: 'salary-emoluments' as const,
        description: `${who} income ${String(year)}`,
        amount: { kesCents: 100_000 },
        location,
        change: { changed: false },
      },
    ],
    assetsNil: false,
    assets: [
      {
        id: randomUUID(),
        type: 'land' as const,
        description: `${who} asset ${String(year)}`,
        value: { kesCents: 200_000 },
        location,
        joint: { isJoint: false },
        change: { changed: false },
      },
    ],
    liabilitiesNil: false,
    liabilities: [
      {
        id: randomUUID(),
        type: 'loan' as const,
        description: `${who} liability ${String(year)}`,
        creditor: `${who} creditor ${String(year)}`,
        outstanding: { kesCents: 50_000 },
        location,
        change: { changed: false },
      },
    ],
    ...(personKey === 'officer'
      ? {}
      : { knowledgeLimitation: `${who} limitation ${String(year)}` }),
  });
  return {
    schemaVersion: 'declaration.v1',
    type: 'biennial',
    statementDate,
    incomePeriod: { ...incomePeriod, fromSource: 'declared' },
    officer: {
      name: { firstName: 'Wanjiku', otherNames: 'Njeri', surname },
      birth: { date: '1979-06-12', place: `Officer birthplace ${String(year)}` },
      maritalStatus: 'married',
      address: { postal: 'P.O. Box 1-00100, Nairobi', physical: 'Kilimani, Nairobi' },
      employment: {
        designation: 'Director',
        employer: 'Ministry of Lands',
        nature: 'permanent',
        responsibleCommission: 'psc',
        personnelFileNumber: 'PSC/2009/0042',
      },
    },
    spouses: {
      none: false,
      items: [
        {
          id: SPOUSE,
          name: { firstName: 'Spouse', surname },
          nationalId: '22334455',
          separated: false,
        },
      ],
    },
    children: {
      none: false,
      items: [
        {
          id: CHILD,
          name: { firstName: 'Child', surname },
          dateOfBirth: '2010-01-01',
          includedAtStatementDate: true,
        },
      ],
    },
    statements: [
      statement('officer', 'Officer'),
      statement(`spouse:${SPOUSE}`, 'Spouse'),
      statement(`child:${CHILD}`, 'Child'),
    ],
    otherInformation: {
      materialChanges: [
        { kind: 'directorship', explanation: `Officer change ${String(year)}` },
        {
          personKey: `spouse:${SPOUSE}`,
          kind: 'acquisition',
          explanation: `Spouse change ${String(year)}`,
        },
        {
          personKey: `child:${CHILD}`,
          kind: 'acquisition',
          explanation: `Child change ${String(year)}`,
        },
      ],
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: `Other information ${String(year)}`,
    },
    attestation: {
      text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
      declaredAt: `${String(year)}-11-20T09:00:00.000Z`,
      reference: `DCB-PSC-${String(year)}-0000001-K`,
    },
  };
}

interface Seeded {
  declarationId: string;
  reference: string;
}

/**
 * A submitted declaration of the person at the Commission, its versions as given (the last in
 * force, earlier ones superseded), encrypted as a submission stores them.
 */
async function seeded(
  personId: string,
  versions: DeclarationV1[],
  { tenant = 'psc', sequence = 1 }: { tenant?: string; sequence?: number } = {},
): Promise<Seeded> {
  const [first] = versions;
  if (!first) throw new Error('no versions');
  const year = Number(first.statementDate.slice(0, 4));
  const declarationId = randomUUID();
  const reference = `DCB-${tenant.toUpperCase()}-${String(year)}-${String(sequence).padStart(7, '0')}-K`;
  // The declaration is the declarant's to write, its versions the Commission's (ADR-018).
  await api.asPerson(personId, (tx) =>
    tx.insert(declarations).values({
      id: declarationId,
      tenant,
      personId,
      obligationId: randomUUID(),
      rosterRecordId: randomUUID(),
      type: first.type,
      statementDate: first.statementDate,
      incomePeriodFrom: first.incomePeriod.from,
      incomePeriodTo: first.incomePeriod.to,
      previousStatementDateSource: 'declared',
      status: 'submitted',
      reference,
      currentVersion: versions.length,
    }),
  );
  await api.asTenant(tenant, async (tx) => {
    for (const [index, document] of versions.entries()) {
      const id = randomUUID();
      const plaintext = Buffer.from(JSON.stringify(document));
      const sealed = await api.cipher.encrypt({ tenant, recordId: versionRecordId(id), plaintext });
      const submittedAt = new Date(`${String(year)}-11-2${String(index)}T09:00:00Z`);
      await tx.insert(declarationVersions).values({
        id,
        declarationId,
        version: index + 1,
        cycleYear: year,
        tenant,
        personId,
        reference,
        snapshotCiphertext: Buffer.from(sealed.ciphertext, 'base64'),
        envelope: sealed.envelope,
        canonicalSha256: createHash('sha256').update(plaintext).digest('hex'),
        submittedAt,
        late: false,
        stepUpAcr: 'step-up',
        stepUpAuthTime: submittedAt,
        idempotencyKeyHash: createHash('sha256').update(id).digest('hex'),
        supersededAt:
          index < versions.length - 1 ? new Date(submittedAt.getTime() + 86_400_000) : null,
      });
    }
  });
  return { declarationId, reference };
}

interface Scope {
  personId?: string;
  years?: number[];
  includeSpouses?: boolean;
  includeChildren?: boolean;
  sections?: string[];
}

function disclosure(
  scope: Scope = {},
  {
    tenant = 'psc',
    caller = ACCESS,
    actingSubject = ACCESS_OFFICER,
    body,
  }: {
    tenant?: string;
    caller?: Caller;
    actingSubject?: string | null;
    body?: Record<string, unknown>;
  } = {},
) {
  return api.request('POST', DISCLOSURES, caller, {
    headers: {
      'x-acting-tenant': tenant,
      ...(actingSubject === null ? {} : { 'x-acting-subject': actingSubject }),
    },
    body: {
      personId: scope.personId ?? WANJIKU,
      grantReference: GRANT,
      legalBasis: 'act-s36-1',
      recipientSubject: APPLICANT,
      years: scope.years ?? [2027],
      includeSpouses: scope.includeSpouses ?? false,
      includeChildren: scope.includeChildren ?? false,
      sections: scope.sections ?? ['assets', 'liabilities'],
      ...body,
    },
  });
}

function fullDocument(
  { declarationId }: { declarationId: string },
  {
    version = 1,
    personId = WANJIKU,
    tenant = 'psc',
    actingSubject = `account-${WANJIKU}`,
    recipient = `account-${WANJIKU}`,
  }: {
    version?: number;
    personId?: string | null;
    tenant?: string;
    actingSubject?: string | null;
    recipient?: string | null;
  } = {},
) {
  return api.request(
    'POST',
    `/internal/v1/declarations/${declarationId}/versions/${String(version)}/full-document`,
    ACCESS,
    {
      headers: {
        'x-acting-tenant': tenant,
        ...(actingSubject === null ? {} : { 'x-acting-subject': actingSubject }),
      },
      body: {
        ...(personId === null ? {} : { personId }),
        ...(recipient === null ? {} : { recipient }),
      },
    },
  );
}

async function audited(): Promise<EventEnvelope[]> {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, 'audit.read.v1'));
  // Only the reads of this API: submitting a draft reads its sections too.
  return rows
    .map((row) => row.envelope)
    .filter((event) =>
      [
        'declaration.disclosed',
        'declaration.full-document.pulled',
        'declaration.disclosure-counted',
      ].includes((event.data as { action: string }).action),
    );
}

describe('the scoped disclosure of a grant (S9)', () => {
  it('S9: years 2027, spouses excluded, assets and liabilities: only that version, the officer and those sections', async () => {
    // 2027 amended once (version 2 in force), and a 2029 declaration outside the scope.
    const amended = householdDeclaration(2027);
    const in2027 = await seeded(WANJIKU, [householdDeclaration(2027, 'Mwangi'), amended]);
    await seeded(WANJIKU, [householdDeclaration(2029)], { sequence: 2 });

    const response = await disclosure();

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DisclosureDocument>();
    expect(contractErrors(responseBody(DISCLOSURES, 'post', 200), body)).toEqual([]);
    const officer = amended.statements[0];
    expect(body).toEqual({
      schemaVersion: 'disclosure.v1',
      grantReference: GRANT,
      personName: 'Wanjiku Njeri Kamau',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      versions: [
        {
          reference: in2027.reference,
          version: 2,
          type: 'biennial',
          statementDate: '2027-11-01',
          submittedAt: '2027-11-21T09:00:00.000Z',
          content: {
            schemaVersion: 'declaration.v1',
            type: 'biennial',
            statementDate: '2027-11-01',
            statements: [
              {
                personKey: 'officer',
                personName: officer?.personName,
                statementDate: '2027-11-01',
                incomePeriod: officer?.incomePeriod,
                assetsNil: false,
                assets: officer?.assets,
                liabilitiesNil: false,
                liabilities: officer?.liabilities,
              },
            ],
            attestation: amended.attestation,
          },
        },
      ],
    });
    // Nothing outside the scope: no other year or version, person, income, particulars or other
    // information.
    for (const outside of [
      '2029',
      'Mwangi',
      'Spouse',
      'Child',
      'income 2027',
      'birthplace',
      'Other information',
      'change 2027',
    ]) {
      expect(response.body).not.toContain(outside);
    }
  });

  it('S9: the read is audited with the grant reference, legal basis and recipient, and no content', async () => {
    const { declarationId } = await seeded(WANJIKU, [householdDeclaration(2027)]);
    // Another year's version, outside the grant: the audit does not name it.
    await seeded(WANJIKU, [householdDeclaration(2025)], { sequence: 2 });

    expect((await disclosure()).statusCode).toBe(200);

    const served = await api.asPlatform((tx) =>
      tx
        .select({ id: declarationVersions.id })
        .from(declarationVersions)
        .where(eq(declarationVersions.declarationId, declarationId)),
    );
    const [event, ...more] = await audited();
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'declaration.disclosed',
        resource: {
          type: 'declaration',
          tenant: 'psc',
          subjectPersonId: WANJIKU,
          ids: served.map((row) => row.id),
        },
        actor: {
          subject: 'service-account-access',
          clientId: 'access',
          onBehalfOf: ACCESS_OFFICER,
        },
        legalBasis: { basis: 'act-s36-1', reference: GRANT },
        recipient: APPLICANT,
        request: { method: 'POST', route: DISCLOSURES },
      },
    });
    expect(JSON.stringify(event)).not.toContain('Wanjiku');
    expect(JSON.stringify(event)).not.toContain('asset');
  });

  it('includes the granted household members and sections, and only those', async () => {
    const document = householdDeclaration(2027);
    await seeded(WANJIKU, [document]);

    const response = await disclosure({
      includeSpouses: true,
      sections: ['bio', 'income', 'other'],
    });

    expect(response.statusCode, response.body).toBe(200);
    const [version] = response.json<DisclosureDocument>().versions;
    const content = version?.content as Partial<DeclarationV1>;
    expect(Object.keys(content).sort()).toEqual([
      'attestation',
      'incomePeriod',
      'officer',
      'otherInformation',
      'schemaVersion',
      'spouses',
      'statementDate',
      'statements',
      'type',
    ]);
    expect(content.officer).toEqual(document.officer);
    // The spouse as declared, but for the national ID, which never leaves (data minimisation).
    expect(content.spouses).toEqual({
      none: false,
      items: [{ id: SPOUSE, name: { firstName: 'Spouse', surname: 'Kamau' }, separated: false }],
    });
    expect(response.body).not.toContain('22334455');
    expect(content.statements?.map((statement) => statement.personKey)).toEqual([
      'officer',
      `spouse:${SPOUSE}`,
    ]);
    expect(Object.keys(content.statements?.[1] ?? {}).sort()).toEqual([
      'income',
      'incomeNil',
      'incomePeriod',
      'knowledgeLimitation',
      'personKey',
      'personName',
      'statementDate',
    ]);
    expect(content.otherInformation?.materialChanges.map((change) => change.explanation)).toEqual([
      'Officer change 2027',
      'Spouse change 2027',
    ]);
    expect(response.body).not.toContain('Child');
    expect(response.body).not.toContain('asset 2027');
    expect(response.body).not.toContain('liability 2027');
  });

  it('lists the granted years in force by statement date, leaving out a year with none', async () => {
    const in2029 = await seeded(WANJIKU, [householdDeclaration(2029, 'Mwangi')], { sequence: 2 });
    const in2027 = await seeded(WANJIKU, [householdDeclaration(2027)]);

    const response = await disclosure({ years: [2029, 2027, 2031], sections: ['bio'] });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DisclosureDocument>();
    expect(body.versions.map((version) => version.reference)).toEqual([
      in2027.reference,
      in2029.reference,
    ]);
    // Named as in the latest disclosed version.
    expect(body.personName).toBe('Wanjiku Njeri Mwangi');
    expect(body.versions[0]?.content).not.toHaveProperty('statements');
  });

  it("S9: is 404 for another person's versions, another Commission's, or none in the granted years", async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);
    await seeded(OTHER, [householdDeclaration(2029)], { tenant: 'tsc' });

    expect((await disclosure({ personId: OTHER })).statusCode).toBe(404);
    expect((await disclosure({ personId: OTHER, years: [2029] })).statusCode).toBe(404);
    expect((await disclosure({}, { tenant: 'tsc' })).statusCode).toBe(404);
    expect((await disclosure({ years: [2029] })).statusCode).toBe(404);
    expect((await disclosure({ personId: randomUUID() })).statusCode).toBe(404);
    expect(await audited()).toEqual([]);
  });

  it('is 400 for an invalid scope or reference, a mismatched legal basis or no acting subject', async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);

    const invalid = [
      await disclosure({ sections: [] }),
      await disclosure({ years: [] }),
      await disclosure({ sections: ['household'] }),
      await disclosure({}, { body: { legalBasis: 'act-s36-2' } }),
      await disclosure({}, { body: { grantReference: 'DCB-PSC-2027-0000001-K' } }),
      await disclosure({}, { body: { grantReference: 'ARQ-PSC-2028-0000012-5' } }),
      await disclosure({}, { body: { tenant: 'psc' } }),
      await disclosure({}, { actingSubject: null }),
    ];

    expect(invalid.map((response) => response.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400,
    ]);
    expect(await audited()).toEqual([]);
  });

  it('takes a law-enforcement grant under s.36(2)', async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);

    const response = await disclosure(
      {},
      { body: { grantReference: 'LEA-PSC-2028-0000004-9', legalBasis: 'act-s36-2' } },
    );

    expect(response.statusCode, response.body).toBe(200);
    const [event] = await audited();
    expect(event?.data).toMatchObject({
      legalBasis: { basis: 'act-s36-2', reference: 'LEA-PSC-2028-0000004-9' },
      recipient: APPLICANT,
    });
  });

  it('refuses any token but a service with declarations:disclosures', async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);

    const officer: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['access-officer'] };
    expect((await disclosure({}, { caller: officer })).statusCode).toBe(403);
    expect((await disclosure({}, { caller: declarant(WANJIKU) })).statusCode).toBe(403);
    expect(
      (await disclosure({}, { caller: { ...ACCESS, scope: 'documents:internal' } })).statusCode,
    ).toBe(403);
    // The documents and review services read declarations for Commission staff, never this.
    expect(
      (await disclosure({}, { caller: { ...ACCESS, scope: 'declarations:internal' } })).statusCode,
    ).toBe(403);
  });
});

function counts(
  scope: Scope = {},
  {
    tenant = 'psc',
    caller = ACCESS,
    actingSubject = ACCESS_OFFICER,
    body,
  }: {
    tenant?: string;
    caller?: Caller;
    actingSubject?: string | null;
    body?: Record<string, unknown>;
  } = {},
) {
  return api.request('POST', COUNTS, caller, {
    headers: {
      'x-acting-tenant': tenant,
      ...(actingSubject === null ? {} : { 'x-acting-subject': actingSubject }),
    },
    body: {
      personId: scope.personId ?? WANJIKU,
      grantReference: GRANT,
      legalBasis: 'act-s36-1',
      years: scope.years ?? [2027],
      includeSpouses: scope.includeSpouses ?? false,
      includeChildren: scope.includeChildren ?? false,
      sections: scope.sections ?? ['assets', 'liabilities'],
      ...body,
    },
  });
}

describe('the counts of a scope, before the decision (decision 1)', () => {
  it('counts per year, section and included household member kind, only within the scope', async () => {
    // 2027 amended once (version 2 in force), a 2029 declaration outside the scope.
    const in2027 = await seeded(WANJIKU, [
      householdDeclaration(2027, 'Mwangi'),
      householdDeclaration(2027),
    ]);
    await seeded(WANJIKU, [householdDeclaration(2029)], { sequence: 2 });

    const response = await counts({
      years: [2027, 2026],
      includeSpouses: true,
      sections: ['bio', 'income', 'other'],
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DisclosureCounts>();
    expect(contractErrors(responseBody(COUNTS, 'post', 200), body)).toEqual([]);
    expect(body).toEqual({
      years: [
        {
          year: 2026,
          declarations: 0,
          declarationReferences: [],
          sections: { bio: 0, income: 0, other: 0 },
          spouses: 0,
          children: null,
        },
        {
          year: 2027,
          declarations: 1,
          declarationReferences: [in2027.reference],
          // The officer and the spouse; their two incomes, never the child's; the officer's
          // and the spouse's material changes and the written statement.
          sections: { bio: 2, income: 2, other: 3 },
          spouses: 1,
          children: null,
        },
      ],
    });
    // Counts only: no name, text or amount of the declarations.
    for (const content of ['Wanjiku', 'Kamau', 'Mwangi', 'income 2027', 'change', '100000']) {
      expect(response.body).not.toContain(content);
    }
  });

  it('counts a household member kind only when it is included', async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);

    const response = await counts({ includeChildren: true, sections: ['liabilities'] });

    expect(response.json<DisclosureCounts>().years).toEqual([
      expect.objectContaining({ sections: { liabilities: 2 }, spouses: null, children: 1 }),
    ]);
  });

  it('counts zero, rather than 404, for none in scope, another person or another Commission', async () => {
    await seeded(WANJIKU, [householdDeclaration(2027)]);
    await seeded(OTHER, [householdDeclaration(2029)], { tenant: 'tsc' });

    for (const response of [
      await counts({ years: [2029] }),
      await counts({ personId: OTHER, years: [2029] }),
      await counts({}, { tenant: 'tsc' }),
    ]) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<DisclosureCounts>().years.every((year) => year.declarations === 0)).toBe(
        true,
      );
    }
  });

  it('is audited with the request reference, legal basis and the officer as recipient, and no content', async () => {
    const { declarationId } = await seeded(WANJIKU, [householdDeclaration(2027)]);

    expect((await counts()).statusCode).toBe(200);

    const [served] = await api.asPlatform((tx) =>
      tx
        .select({ id: declarationVersions.id })
        .from(declarationVersions)
        .where(eq(declarationVersions.declarationId, declarationId)),
    );
    const [event, ...more] = await audited();
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'declaration.disclosure-counted',
        resource: { type: 'declaration', subjectPersonId: WANJIKU, ids: [served?.id] },
        actor: { subject: 'service-account-access', onBehalfOf: ACCESS_OFFICER },
        legalBasis: { basis: 'act-s36-1', reference: GRANT },
        recipient: ACCESS_OFFICER,
        request: { method: 'POST', route: COUNTS },
      },
    });
    expect(JSON.stringify(event)).not.toContain('Wanjiku');
  });

  it('is 400 for an invalid scope, a mismatched legal basis or no acting subject, and 403 for others', async () => {
    const invalid = [
      await counts({ sections: [] }),
      await counts({}, { body: { legalBasis: 'act-s36-2' } }),
      await counts({}, { body: { recipientSubject: APPLICANT } }),
      await counts({}, { actingSubject: null }),
    ];
    expect(invalid.map((response) => response.statusCode)).toEqual([400, 400, 400, 400]);
    const officer: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['access-officer'] };
    expect((await counts({}, { caller: officer })).statusCode).toBe(403);
    expect(
      (await counts({}, { caller: { ...ACCESS, scope: 'declarations:internal' } })).statusCode,
    ).toBe(403);
    expect(await audited()).toEqual([]);
  });
});

describe("the full document of a version for the declarant's certified copy (S13)", () => {
  /** Wanjiku's 2027 biennial, submitted through the API: version 1. */
  async function submitted(): Promise<{ declarationId: string; reference: string }> {
    api.clock.setToday(DUE_DAY);
    const draft = await completeDraft(WANJIKU);
    const response = await submit(draft.id, steppedUp(WANJIKU));
    expect(response.statusCode, response.body).toBe(201);
    return {
      declarationId: draft.id,
      reference: response.json<SubmissionResult>().version.reference,
    };
  }

  it('S13: serves the version in full to its declarant, audited as self-access', async () => {
    const version = await submitted();

    const response = await fullDocument(version);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<FullVersionDocument>();
    expect(contractErrors(responseBody(FULL_DOCUMENT, 'post', 200), body)).toEqual([]);
    const [row] = await api.asPlatform((tx) =>
      tx
        .select()
        .from(declarationVersions)
        .where(eq(declarationVersions.declarationId, version.declarationId)),
    );
    expect(body).toMatchObject({
      declarationId: version.declarationId,
      versionId: row?.id,
      version: 1,
      personId: WANJIKU,
      reference: version.reference,
      type: 'biennial',
      statementDate: '2027-11-01',
      canonicalSha256: row?.canonicalSha256,
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      declarantName: 'Achieng Wambui Otieno',
      document: {
        schemaVersion: 'declaration.v1',
        attestation: { reference: version.reference },
      },
    });
    // The very document submitted: its canonical hash is the version's.
    expect((body.document as unknown as DeclarationV1).statements[0]?.assets[0]?.description).toBe(
      'Shamba in Kitengela',
    );

    const [event, ...more] = await audited();
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'declaration.full-document.pulled',
        resource: {
          type: 'declaration-version',
          params: { declarationId: version.declarationId, version: '1' },
          subjectPersonId: WANJIKU,
          ids: [row?.id],
        },
        actor: { subject: 'service-account-access', onBehalfOf: `account-${WANJIKU}` },
        legalBasis: { basis: 'self-access', reference: null },
        recipient: `account-${WANJIKU}`,
      },
    });
    expect(JSON.stringify(event)).not.toContain('Shamba');
  });

  it('names the representative as recipient of a copy an access officer recorded for them, the officer as actor', async () => {
    const version = await submitted();

    const response = await fullDocument(version, {
      actingSubject: ACCESS_OFFICER,
      recipient: 'Peter Kamau',
    });

    expect(response.statusCode, response.body).toBe(200);
    const [event, ...more] = await audited();
    expect(more).toEqual([]);
    expect(event?.data).toMatchObject({
      action: 'declaration.full-document.pulled',
      resource: { subjectPersonId: WANJIKU },
      actor: { subject: 'service-account-access', onBehalfOf: ACCESS_OFFICER },
      legalBasis: { basis: 'self-access', reference: null },
      recipient: 'Peter Kamau',
      request: { method: 'POST' },
    });
  });

  it("S13: is 404 for another person, another Commission's or an unknown version", async () => {
    const version = await submitted();

    expect((await fullDocument(version, { personId: OTHER })).statusCode).toBe(404);
    expect((await fullDocument(version, { tenant: 'tsc' })).statusCode).toBe(404);
    expect((await fullDocument(version, { version: 2 })).statusCode).toBe(404);
    expect((await fullDocument({ declarationId: randomUUID() })).statusCode).toBe(404);
    expect(await audited()).toEqual([]);
  });

  it('is 400 without the declarant, the recipient or the acting subject', async () => {
    const version = await submitted();

    expect((await fullDocument(version, { personId: null })).statusCode).toBe(400);
    expect((await fullDocument(version, { personId: 'not-a-uuid' })).statusCode).toBe(400);
    expect((await fullDocument(version, { actingSubject: null })).statusCode).toBe(400);
    expect((await fullDocument(version, { recipient: null })).statusCode).toBe(400);
    expect((await fullDocument(version, { recipient: ' ' })).statusCode).toBe(400);
  });

  it('refuses a service token without declarations:disclosures', async () => {
    const version = await submitted();

    const reviewToken: Caller = {
      sub: 'service-account-review',
      azp: 'review',
      scope: 'declarations:internal',
    };
    const response = await api.request(
      'POST',
      `/internal/v1/declarations/${version.declarationId}/versions/1/full-document`,
      reviewToken,
      {
        headers: { 'x-acting-tenant': 'psc', 'x-acting-subject': 'someone' },
        body: { personId: WANJIKU, recipient: 'someone' },
      },
    );
    expect(response.statusCode).toBe(403);
    expect(await audited()).toEqual([]);
  });
});
