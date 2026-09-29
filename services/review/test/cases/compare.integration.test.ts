import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { VersionComparison } from '../../src/cases/comparison.js';
import { outbox } from '../../src/db/schema.js';
import {
  asset,
  declaration,
  income,
  revalued,
  SPOUSE,
  statement,
} from '../fixtures/declarations.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S10 at the HTTP seam: the comparison of a case's current version with the person's previous
 * submitted version at the Commission, both pulled fresh from declarations and paired by the
 * rules engine's matcher. None for a first declaration.
 */
describe('compare case versions', () => {
  let api: ReviewApi;

  const reviewer: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const comparePath = '/v1/review/cases/{caseId}/compare';

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

  const salary = income({ description: 'Salary', amount: { kesCents: 480_000_000 } });
  const land = asset({ description: 'Plot in Kisumu', value: { kesCents: 1_000_000_000 } });
  const car = asset({
    type: 'vehicle',
    description: 'Toyota Prado',
    value: { kesCents: 200_000_000 },
  });
  const flat = asset({
    type: 'building',
    description: 'Apartment in Kilimani',
    value: { kesCents: 900_000_000 },
    change: { changed: true, kind: 'acquisition' },
  });
  const spouseAccount = asset({
    type: 'bank-account',
    description: 'Savings account',
    value: { kesCents: 0 },
  });

  /** Version 1 and version 2 of one declaration, submitted a month apart. */
  function twoVersions(tenant = 'psc'): { first: StoredVersion; second: StoredVersion } {
    const first = submittedVersion({
      tenant,
      submittedAt: '2027-12-15T09:30:00.000Z',
      document: declaration([
        statement('officer', { income: [salary], assets: [land, car] }),
        statement(SPOUSE, { assets: [spouseAccount] }),
      ]),
    });
    const second = submittedVersion({
      tenant,
      declarationId: first.declarationId,
      personId: first.personId,
      reference: first.reference,
      version: 2,
      submittedAt: '2028-01-20T08:00:00.000Z',
      document: declaration([
        statement('officer', {
          income: [revalued(salary, 480_000_000)],
          assets: [
            { ...revalued(land, 1_300_000_000), change: { changed: true, kind: 'value-change' } },
            flat,
          ],
        }),
        statement(SPOUSE, { assets: [revalued(spouseAccount, 5_000_000)] }),
      ]),
    });
    return { first, second };
  }

  /** Runs the processing workflow's steps for a version, as the worker would; returns the case. */
  async function processed(version: StoredVersion, tenant = 'psc'): Promise<string> {
    const input = {
      tenant,
      declarationId: version.declarationId,
      versionId: version.versionId,
      version: version.version,
    };
    const facts = await api.activities.pullVersion(input);
    if (!facts) throw new Error('version not pulled');
    const previous = await api.activities.pullPreviousVersion({
      tenant,
      personId: facts.personId,
      versionId: version.versionId,
    });
    const flags = await api.activities.runRules({ input, facts, previous });
    const { caseId } = await api.activities.upsertCase({ input, facts, flags });
    return caseId;
  }

  async function amendedCase(tenant = 'psc'): Promise<{ caseId: string; first: StoredVersion }> {
    const { first, second } = twoVersions(tenant);
    api.declarations.given(first, second);
    await processed(first, tenant);
    const caseId = await processed(second, tenant);
    api.declarations.reads.length = 0;
    return { caseId, first };
  }

  const compare = (caseId: string, caller: Caller) =>
    api.get(`/v1/review/cases/${caseId}/compare`, caller);

  it('S10: a two-version case compares matched items with deltas and unmatched items, read fresh and audited as the caller', async () => {
    const { caseId, first } = await amendedCase();

    const response = await compare(caseId, reviewer);

    expect(response.statusCode).toBe(200);
    const body = response.json<VersionComparison>();
    expect(contractErrors(okResponse(comparePath, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      previousVersion: 1,
      currentVersion: 2,
      statements: [
        {
          personKey: 'officer',
          personName: 'James Otieno',
          matched: [
            {
              category: 'income',
              type: 'salary-emoluments',
              description: 'Salary',
              previousCents: 480_000_000,
              currentCents: 480_000_000,
              deltaCents: 0,
              deltaPercent: 0,
              flaggedByDeclarant: false,
            },
            {
              category: 'assets',
              type: 'land',
              description: 'Plot in Kisumu',
              previousCents: 1_000_000_000,
              currentCents: 1_300_000_000,
              deltaCents: 300_000_000,
              deltaPercent: 30,
              flaggedByDeclarant: true,
            },
          ],
          onlyPrevious: [
            {
              itemId: car.id,
              category: 'assets',
              type: 'vehicle',
              description: 'Toyota Prado',
              valueCents: 200_000_000,
              flaggedByDeclarant: false,
            },
          ],
          onlyCurrent: [
            {
              itemId: flat.id,
              category: 'assets',
              type: 'building',
              description: 'Apartment in Kilimani',
              valueCents: 900_000_000,
              flaggedByDeclarant: true,
            },
          ],
        },
        {
          personKey: SPOUSE,
          personName: 'Grace Otieno',
          matched: [
            {
              category: 'assets',
              type: 'bank-account',
              description: 'Savings account',
              previousCents: 0,
              currentCents: 5_000_000,
              deltaCents: 5_000_000,
              // Up from nothing has no percentage.
              deltaPercent: null,
              flaggedByDeclarant: false,
            },
          ],
          onlyPrevious: [],
          onlyCurrent: [],
        },
      ],
    });

    // Both versions were pulled for this call, as the reviewer, for this case (audited there).
    expect(api.declarations.reads).toEqual([
      {
        declarationId: first.declarationId,
        version: 2,
        tenant: 'psc',
        actingSubject: 'reviewer-a',
        caseId,
      },
      {
        declarationId: first.declarationId,
        version: 1,
        tenant: 'psc',
        actingSubject: 'reviewer-a',
        caseId,
      },
    ]);

    // Every call reads again: nothing is cached.
    const again = await compare(caseId, {
      ...reviewer,
      sub: 'supervisor-s',
      roles: ['supervisor'],
    });
    expect(again.statusCode).toBe(200);
    expect(api.declarations.reads).toHaveLength(4);
    expect(api.declarations.reads.at(-1)).toMatchObject({ actingSubject: 'supervisor-s', caseId });
  });

  it('S10: a single-version case has nothing to compare: 409 no-previous-version', async () => {
    const only = submittedVersion({
      tenant: 'psc',
      document: declaration([statement('officer', { income: [salary], assets: [land] })]),
    });
    api.declarations.given(only);
    const caseId = await processed(only);
    api.declarations.reads.length = 0;

    const response = await compare(caseId, reviewer);

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ type: 'no-previous-version', status: 409 });
    expect(api.declarations.reads).toEqual([]);
  });

  it("S10: only the Commission's reviewers and supervisors compare; everyone else gets 404", async () => {
    const { caseId } = await amendedCase();

    const outsiders: Caller[] = [
      { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] },
      { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] },
      { sub: 'declarant', tenant: null, roles: ['declarant'], personId: randomUUID() },
      { sub: 'helpdesk', tenant: 'psc', roles: ['helpdesk'] },
      { sub: 'admin', tenant: 'psc', roles: ['commission-admin'] },
      { sub: 'platform', tenant: 'platform', roles: ['platform-admin'] },
      { sub: 'eacc', tenant: 'eacc', roles: ['eacc-analyst'] },
    ];
    for (const caller of outsiders) {
      const response = await compare(caseId, caller);
      expect(response.statusCode, caller.sub).toBe(404);
    }
    expect((await compare(randomUUID(), reviewer)).statusCode).toBe(404);
    expect((await compare('not-a-case', reviewer)).statusCode).toBe(404);
    expect(api.declarations.reads).toEqual([]);
  });

  it('S10: declarations unavailable: 502, and nothing is recorded', async () => {
    const { caseId } = await amendedCase();
    const eventsBefore = await api.db.select().from(outbox);
    api.declarations.failReads(1);

    const response = await compare(caseId, reviewer);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ type: 'declarations-unavailable' });
    expect(await api.db.select().from(outbox)).toHaveLength(eventsBefore.length);
  });
});
