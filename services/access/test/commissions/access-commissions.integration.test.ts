import { randomUUID } from 'node:crypto';

import { ACCESS_OFFICER, APPLICANT, DECLARANT, LAW_ENFORCEMENT } from '@adili/roles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';

const COMMISSIONS = '/v1/access/commissions';

/**
 * S2, step 1 of the Form K wizard: the Responsible Commissions an applicant can address, from the
 * directory, with the declaration years each can hold for the scope step.
 */
describe('S2: Commissions an applicant can address', () => {
  let api: AccessApi;
  const applicant: Caller = { sub: 'applicant-mercy', roles: [APPLICANT], personId: randomUUID() };

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  it('S2: lists only the active Commissions, by name, with the years since each joined Adili', async () => {
    api.clock.set('2027-03-04T09:00:00.000Z');
    api.directory.givenCommission('tsc', 'Teachers Service Commission', {
      obligationsStartDate: '2026-02-10',
    });
    api.directory.givenCommission('psc', 'Public Service Commission', {
      obligationsStartDate: '2024-11-01',
    });
    api.directory.givenCommission('jsc', 'Judicial Service Commission', {
      obligationsStartDate: '2025-07-01',
      status: 'suspended',
    });

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<unknown>();
    expect(contractErrors(okResponse(COMMISSIONS, 'get'), body)).toEqual([]);
    expect(body).toEqual([
      {
        slug: 'psc',
        name: 'Public Service Commission',
        years: [2025, 2026, 2027],
        decisionDays: 30,
      },
      { slug: 'tsc', name: 'Teachers Service Commission', years: [2026, 2027], decisionDays: 30 },
    ]);
  });

  it('S2: a Commission joining later this year or after holds no years yet', async () => {
    api.clock.set('2027-03-04T09:00:00.000Z');
    api.directory.givenCommission('cpsb022', 'Kiambu County Public Service Board', {
      obligationsStartDate: '2028-01-01',
    });
    api.directory.givenCommission('npsc', 'National Police Service Commission', {
      obligationsStartDate: '2027-06-30',
    });

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      { slug: 'cpsb022', name: 'Kiambu County Public Service Board', years: [], decisionDays: 30 },
      { slug: 'npsc', name: 'National Police Service Commission', years: [2027], decisionDays: 30 },
    ]);
  });

  it("S2: the current year is Nairobi's", async () => {
    api.clock.set('2026-12-31T21:30:00.000Z');
    api.directory.givenCommission('psc', 'Public Service Commission', {
      obligationsStartDate: '2025-01-01',
    });

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.json()).toEqual([
      {
        slug: 'psc',
        name: 'Public Service Commission',
        years: [2025, 2026, 2027],
        decisionDays: 30,
      },
    ]);
  });

  it('S11: a law enforcement officer lists them too, for a written request', async () => {
    api.clock.set('2027-03-04T09:00:00.000Z');
    api.directory.givenCommission('psc', 'Public Service Commission', {
      obligationsStartDate: '2026-01-01',
    });
    const officer: Caller = {
      sub: 'lea-officer',
      tenant: 'lea',
      roles: [LAW_ENFORCEMENT],
      personId: randomUUID(),
    };

    const response = await api.get(COMMISSIONS, officer);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      { slug: 'psc', name: 'Public Service Commission', years: [2026, 2027], decisionDays: 30 },
    ]);
  });

  it('S2: only applicants and law enforcement officers list them', async () => {
    api.directory.givenCommission('psc', 'Public Service Commission');
    const others: Caller[] = [
      { sub: 'declarant-1', roles: [DECLARANT], personId: randomUUID() },
      { sub: 'officer-psc', tenant: 'psc', roles: [ACCESS_OFFICER] },
    ];

    for (const caller of others) {
      const response = await api.get(COMMISSIONS, caller);
      expect(response.statusCode, caller.sub).toBe(403);
    }
  });

  it('S2: each carries the decision period of its policy in force (decision 3)', async () => {
    api.clock.set('2027-03-04T09:00:00.000Z');
    api.directory.givenCommission('psc', 'Public Service Commission', {
      obligationsStartDate: '2026-01-01',
    });
    api.directory.givenCommission('tsc', 'Teachers Service Commission', {
      obligationsStartDate: '2026-01-01',
    });
    api.directory.givenAccessPolicy('tsc', { decisionDays: 21 });

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors(okResponse(COMMISSIONS, 'get'), response.json())).toEqual([]);
    expect(
      response.json<{ slug: string; decisionDays: number }[]>().map(({ slug, decisionDays }) => ({
        slug,
        decisionDays,
      })),
    ).toEqual([
      { slug: 'psc', decisionDays: 30 },
      { slug: 'tsc', decisionDays: 21 },
    ]);
  });

  it('S2: the directory unreachable for a policy is 503 directory-unavailable', async () => {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.failCalls(1, 'accessPolicy');

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'directory-unavailable' });
  });

  it('S2: the directory unreachable is 503 directory-unavailable', async () => {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.failCalls(1, 'listCommissions');

    const response = await api.get(COMMISSIONS, applicant);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'directory-unavailable' });
  });
});
