import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import { declaration, statement } from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { givenWorkedCase } from '../support/determinations.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { givenIssuedClarification } from '../support/referrals.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * Spec 09 #220 over HTTP: the reporting service reads a batch of a Commission's clarifications
 * for Form M section 4: the officer asked (name, designation, file number) and the kinds of
 * requirement asked for, never the request's content. Service tokens with `review:internal`,
 * acting for the Commission; another Commission's clarifications are left out.
 */

const DETAILS = '/internal/v1/review/clarifications/details';

const REPORTING: Caller = { sub: 'service-account-reporting', scopes: ['review:internal'] };
const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
const reviewerT: Caller = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };

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

/** A worked case of the Commission and a clarification issued on it. */
async function givenClarification(
  tenant: 'psc' | 'tsc',
  status: 'overdue' | 'draft' = 'overdue',
): Promise<{ clarificationId: string; reference: string; personnelFileNumber: string }> {
  const version = submittedVersion({
    tenant,
    declarantName: 'Peter Mwangi',
    document: declaration([statement('officer')]),
  });
  api.declarations.given(version);
  const caseId = await givenWorkedCase(api, version, [tenant === 'psc' ? reviewerA : reviewerT]);
  const reference = `CLR-${tenant.toUpperCase()}-2027-0000001-3`;
  const { clarificationId } = await givenIssuedClarification(api, {
    tenant,
    caseId,
    personId: version.personId,
    reference,
    status,
  });
  return { clarificationId, reference, personnelFileNumber: version.personnelFileNumber };
}

function details(clarificationIds: string[], caller = REPORTING, tenant = 'psc') {
  return api.send('POST', DETAILS, caller, { clarificationIds }, { 'x-acting-tenant': tenant });
}

describe('clarification details (Form M section 4)', () => {
  it('gives the officer and the kinds of requirement, never the content, leaving out others', async () => {
    const issued = await givenClarification('psc');
    const drafted = await givenClarification('psc', 'draft');
    const theirs = await givenClarification('tsc');

    const response = await details([
      issued.clarificationId,
      drafted.clarificationId,
      theirs.clarificationId,
      randomUUID(),
    ]);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ items: { clarificationId: string }[] }>();
    expect(contractErrors(okResponse(DETAILS, 'post'), body)).toEqual([]);
    const byId = new Map(body.items.map((item) => [item.clarificationId, item]));
    expect([...byId.keys()].sort()).toEqual(
      [issued.clarificationId, drafted.clarificationId].sort(),
    );
    expect(byId.get(issued.clarificationId)).toEqual({
      clarificationId: issued.clarificationId,
      reference: issued.reference,
      name: 'Peter Mwangi',
      designation: 'Deputy Director',
      identifier: issued.personnelFileNumber,
      requirementLabels: ['Explain the discrepancy or inconsistency'],
    });
    expect(byId.get(drafted.clarificationId)).toMatchObject({ reference: null });
    // The request's content stays in review.
    expect(response.body).not.toContain('vehicle');
  });

  it('records the read as the calling service, naming the clarifications read', async () => {
    const issued = await givenClarification('psc');

    await details([issued.clarificationId, randomUUID()]);

    const rows = await api.asPlatform((tx) => tx.select().from(outbox));
    const audits = rows
      .filter((row) => row.eventType === 'audit.read.v1')
      .map((row) => row.envelope.data as { action: string; resource: { ids?: string[] } });
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: 'review.clarifications.details.read',
        resource: expect.objectContaining({ ids: [issued.clarificationId] }) as unknown,
      }),
    );
  });

  it('takes 1 to 1,000 ids, and refuses user tokens', async () => {
    const ids = (count: number) => Array.from({ length: count }, () => randomUUID());

    for (const clarificationIds of [[], ids(1_001), ['not-a-uuid']]) {
      expect((await details(clarificationIds)).statusCode).toBe(400);
    }
    expect((await details(ids(1_000))).statusCode).toBe(200);
    expect((await details(ids(1), reviewerA)).statusCode).toBe(403);
  });
});
