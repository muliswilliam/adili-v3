import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClarificationStatus } from '../../src/cases/schema.js';
import type { ClarificationDisclosure } from '../../src/clarifications/disclosure.js';
import { clarificationResponses, clarifications, outbox } from '../../src/db/schema.js';
import { declaration, SPOUSE, statement } from '../fixtures/declarations.js';
import { givenAssignedCase } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * Spec 10 decision 7 over HTTP: a Form K grant that includes clarifications discloses those
 * issued on the declarations it disclosed, cut to the granted household members and sections,
 * to service tokens with `review:disclosures` (the access client alone), acting for the
 * Commission; every read is audited with the legal basis, the grant reference, the recipient and
 * the clarifications served.
 */

const DISCLOSURES = '/internal/v1/review/clarifications/disclosures';

const ACCESS: Caller = { sub: 'service-account-access', scopes: ['review:disclosures'] };
const REPORTING: Caller = { sub: 'service-account-reporting', scopes: ['review:internal'] };
const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };

const GRANT = 'ARQ-PSC-2028-0000012-N';
const ACCESS_OFFICER = 'access-officer-psc';
const APPLICANT = 'applicant-mercy';

let api: ReviewApi;

beforeAll(async () => {
  api = await startReviewApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  api.directory.givenCommission('psc');
  api.directory.givenCommission('tsc');
});

/** A case of the declarant's declaration at `tenant`. */
async function givenCase(
  personId: string,
  tenant = 'psc',
): Promise<{ caseId: string; version: StoredVersion }> {
  const version = submittedVersion({
    tenant,
    personId,
    declarantName: 'James Otieno',
    document: declaration([statement('officer'), statement(SPOUSE)]),
  });
  api.declarations.given(version);
  const caseId = await givenAssignedCase(api, version);
  return { caseId, version };
}

let sequence = 0;

/**
 * A clarification of the case in `status`, with an item on the officer's statement and one on
 * the spouse's, as its letter put them; answered when `responded`.
 */
async function givenClarification(
  tenant: string,
  caseId: string,
  personId: string,
  status: ClarificationStatus,
): Promise<{ id: string; reference: string | null }> {
  sequence += 1;
  const id = uuidv7();
  const draft = status === 'draft';
  const reference = draft ? null : `CLR-${tenant.toUpperCase()}-2027-000000${sequence}-3`;
  const officerItem = randomUUID();
  const spouseItem = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(clarifications).values({
      id,
      tenant,
      caseId,
      personId,
      reference,
      status,
      items: [
        {
          id: officerItem,
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: null,
          requirement: 'explain-discrepancy',
          text: 'Explain the increase in the value of the plot.',
        },
        {
          id: spouseItem,
          sectionKey: `statement:${SPOUSE}`,
          personKey: SPOUSE,
          itemId: null,
          requirement: 'provide-omitted',
          text: "Provide the date of acquisition of your spouse's vehicle.",
        },
      ],
      issuedAt: draft ? null : new Date(`2027-12-${10 + sequence}T09:00:00.000Z`),
      dueAt: draft ? null : new Date('2028-01-11T09:00:00.000Z'),
      respondedAt: status === 'responded' ? new Date('2027-12-28T09:00:00.000Z') : null,
      responseLate: status === 'responded' ? false : null,
      letter: draft
        ? null
        : {
            commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
            items: [
              {
                label: 'Financial statement · James Otieno',
                requirementLabel: 'Explain the discrepancy or inconsistency',
                text: 'Explain the increase in the value of the plot.',
              },
              {
                label: 'Financial statement · Grace Otieno',
                requirementLabel: 'Provide the omitted information',
                text: "Provide the date of acquisition of your spouse's vehicle.",
              },
            ],
          },
      withdrawnReason: status === 'withdrawn' ? 'Issued in error.' : null,
      createdBy: 'reviewer-a',
    });
    if (status === 'responded') {
      await tx.insert(clarificationResponses).values({
        clarificationId: id,
        tenant,
        personId,
        items: [
          { itemId: officerItem, text: 'The plot was revalued in 2027.' },
          { itemId: spouseItem, text: 'The vehicle was bought in March 2026.' },
        ],
        attachments: [
          {
            itemId: officerItem,
            uploadId: randomUUID(),
            fileName: 'valuation-report.pdf',
            sha256: 'a'.repeat(64),
          },
          {
            itemId: spouseItem,
            uploadId: randomUUID(),
            fileName: 'logbook.jpg',
            sha256: 'b'.repeat(64),
          },
        ],
      });
    }
  });
  return { id, reference };
}

function disclose(
  body: Record<string, unknown>,
  {
    caller = ACCESS,
    tenant = 'psc',
    subject = ACCESS_OFFICER,
  }: { caller?: Caller; tenant?: string; subject?: string | null } = {},
) {
  return api.send(
    'POST',
    DISCLOSURES,
    caller,
    {
      grantReference: GRANT,
      legalBasis: 'act-s36-1',
      recipientSubject: APPLICANT,
      includeSpouses: true,
      includeChildren: false,
      sections: ['income', 'assets', 'liabilities'],
      ...body,
    },
    { 'x-acting-tenant': tenant, ...(subject === null ? {} : { 'x-acting-subject': subject }) },
  );
}

async function audited(): Promise<EventEnvelope[]> {
  const rows = await api.asPlatform((tx) =>
    tx
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'audit.read.v1')),
  );
  return rows
    .map((row) => row.envelope)
    .filter((event) => (event.data as { action: string }).action === 'clarification.disclosed');
}

describe('the clarifications a grant discloses (spec 10, decision 7)', () => {
  it('gives the issued clarifications of the disclosed declarations, as lettered and answered', async () => {
    const personId = randomUUID();
    const { caseId, version } = await givenCase(personId);
    const responded = await givenClarification('psc', caseId, personId, 'responded');
    const overdue = await givenClarification('psc', caseId, personId, 'overdue');
    await givenClarification('psc', caseId, personId, 'draft');
    await givenClarification('psc', caseId, personId, 'withdrawn');
    // Another declaration of theirs, not disclosed by the grant.
    const other = await givenCase(personId);
    await givenClarification('psc', other.caseId, personId, 'issued');

    const response = await disclose({ personId, declarationReferences: [version.reference] });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ClarificationDisclosure>();
    expect(contractErrors(okResponse(DISCLOSURES, 'post'), body)).toEqual([]);
    expect(body.grantReference).toBe(GRANT);
    expect(body.clarifications.map((each) => each.reference)).toEqual([
      responded.reference,
      overdue.reference,
    ]);
    expect(body.clarifications[0]).toEqual({
      declarationReference: version.reference,
      reference: responded.reference,
      status: 'responded',
      issuedAt: expect.any(String) as unknown,
      dueAt: '2028-01-11T09:00:00.000Z',
      respondedAt: '2027-12-28T09:00:00.000Z',
      responseLate: false,
      resolvedAt: null,
      items: [
        {
          label: 'Financial statement · James Otieno',
          requirementLabel: 'Explain the discrepancy or inconsistency',
          text: 'Explain the increase in the value of the plot.',
          response: {
            text: 'The plot was revalued in 2027.',
            attachmentNames: ['valuation-report.pdf'],
          },
        },
        {
          label: 'Financial statement · Grace Otieno',
          requirementLabel: 'Provide the omitted information',
          text: "Provide the date of acquisition of your spouse's vehicle.",
          response: {
            text: 'The vehicle was bought in March 2026.',
            attachmentNames: ['logbook.jpg'],
          },
        },
      ],
    });
    expect(body.clarifications[1]?.items.map((item) => item.response)).toEqual([null, null]);
  });

  it('cuts what the grant leaves out: no spouse, no spouse item or answer', async () => {
    const personId = randomUUID();
    const { caseId, version } = await givenCase(personId);
    await givenClarification('psc', caseId, personId, 'responded');

    const response = await disclose({
      personId,
      declarationReferences: [version.reference],
      includeSpouses: false,
    });

    expect(response.statusCode, response.body).toBe(200);
    const [only, ...more] = response.json<ClarificationDisclosure>().clarifications;
    expect(more).toEqual([]);
    expect(only?.items.map((item) => item.label)).toEqual(['Financial statement · James Otieno']);
    expect(response.body).not.toContain('logbook');
    expect(response.body).not.toContain('vehicle');

    const biodataOnly = await disclose({
      personId,
      declarationReferences: [version.reference],
      sections: ['bio'],
    });
    expect(biodataOnly.json<ClarificationDisclosure>().clarifications).toEqual([]);
  });

  it("gives nothing of another person's or another Commission's clarifications", async () => {
    const personId = randomUUID();
    const { caseId, version } = await givenCase(personId);
    await givenClarification('psc', caseId, personId, 'issued');
    const theirs = await givenCase(personId, 'tsc');
    await givenClarification('tsc', theirs.caseId, personId, 'issued');

    const someoneElse = await disclose({
      personId: randomUUID(),
      declarationReferences: [version.reference],
    });
    const otherCommission = await disclose({
      personId,
      declarationReferences: [theirs.version.reference],
    });

    expect(someoneElse.json<ClarificationDisclosure>().clarifications).toEqual([]);
    expect(otherCommission.json<ClarificationDisclosure>().clarifications).toEqual([]);
  });

  it('records the read with the legal basis, grant reference, recipient and clarifications served, and no content', async () => {
    const personId = randomUUID();
    const { caseId, version } = await givenCase(personId);
    const responded = await givenClarification('psc', caseId, personId, 'responded');
    await givenClarification('psc', caseId, personId, 'draft');

    expect(
      (await disclose({ personId, declarationReferences: [version.reference] })).statusCode,
    ).toBe(200);

    const [event, ...more] = await audited();
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'clarification.disclosed',
        resource: {
          type: 'clarification',
          tenant: 'psc',
          subjectPersonId: personId,
          ids: [responded.id],
        },
        actor: { subject: 'service-account-access', onBehalfOf: ACCESS_OFFICER },
        legalBasis: { basis: 'act-s36-1', reference: GRANT },
        recipient: APPLICANT,
        request: { method: 'POST', route: DISCLOSURES },
      },
    });
    expect(JSON.stringify(event)).not.toContain('plot');
  });

  it('refuses tokens without review:disclosures, a basis that does not go with the reference and no acting subject', async () => {
    const body = { personId: randomUUID(), declarationReferences: ['DCB-PSC-2027-0000042-7'] };

    expect((await disclose(body, { caller: REPORTING })).statusCode).toBe(403);
    expect((await disclose(body, { caller: reviewerA })).statusCode).toBe(403);
    const wrongBasis = await disclose({ ...body, legalBasis: 'act-s36-2' });
    expect(wrongBasis.statusCode).toBe(400);
    expect(wrongBasis.json()).toMatchObject({ errors: [{ path: 'legalBasis' }] });
    expect((await disclose(body, { subject: null })).statusCode).toBe(400);
    expect((await disclose({ ...body, declarationReferences: [] })).statusCode).toBe(400);
    expect((await disclose({ ...body, includeClarifications: true })).statusCode).toBe(400);
    expect(await audited()).toEqual([]);
  });
});
