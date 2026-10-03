import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { accessRequestFacts } from '../../src/db/schema.js';
import { ProjectionsConsumer } from '../../src/projections/projections.consumer.js';
import { accessEvent } from '../support/events.js';
import { type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * Form M section 5 facts at the inbox seam (#467): the access service's Form K events project
 * one row per request, attributed to the financial year it was received in, whatever order the
 * events arrive in, each event once. The outcome and grounds only: no person, no reasons.
 */
describe('access request projections (Form M section 5)', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
  });

  it('subscribes to the four Form K events reporting counts, and to no law enforcement event', () => {
    const patterns = Object.values(Object.getOwnPropertyDescriptors(ProjectionsConsumer.prototype))
      .map((descriptor) => descriptor.value as object)
      .flatMap(
        (handler) => (Reflect.getMetadata(PATTERN_METADATA, handler) as string[] | undefined) ?? [],
      );

    expect(patterns.filter((type) => /^(access|lea)\./.test(type)).sort()).toEqual([
      'access.request.cannot-identify.v1',
      'access.request.decided.v1',
      'access.request.received.v1',
      'access.request.withdrawn.v1',
    ]);
  });

  it('keeps a request in the year it was received, with the outcome and grounds of its later decision, each event once', async () => {
    const requestId = randomUUID();
    // 21:30 UTC on 30 June 2028 is 1 July in Nairobi: received in 2028/2029, decided in 2029/2030.
    const received = accessEvent('psc', 'received', { requestId, at: '2028-06-30T21:30:00Z' });
    const decided = accessEvent('psc', 'decided', {
      requestId,
      at: '2029-07-15T08:00:00Z',
      outcome: 'deny',
      grounds: ['public-interest', 'not-objectives'],
    });

    // Out of order: the decision first.
    expect(await api.deliver(decided)).toBe(true);
    expect(await api.deliver(received)).toBe(true);
    expect(await api.deliver(decided)).toBe(false);
    expect(await api.deliver(received)).toBe(false);

    const rows = await api.asPlatform((tx) => tx.select().from(accessRequestFacts));
    expect(rows).toEqual([
      {
        requestId,
        tenant: 'psc',
        fy: 2028,
        receivedAt: new Date('2028-06-30T21:30:00Z'),
        outcome: 'deny',
        grounds: ['public-interest', 'not-objectives'],
        closedAt: new Date('2029-07-15T08:00:00Z'),
        withdrawnAt: null,
      },
    ]);
  });

  it('keeps the earliest way a request closed, whatever order its closing events arrive in', async () => {
    const requestId = randomUUID();
    const denied = accessEvent('psc', 'decided', {
      requestId,
      at: '2028-02-10T08:00:00Z',
      outcome: 'deny',
      grounds: ['public-interest'],
    });
    // A later, conflicting closure (not one access produces): it must not replace the first.
    const unidentified = accessEvent('psc', 'cannot-identify', {
      requestId,
      at: '2028-02-12T08:00:00Z',
    });
    const closed = {
      outcome: 'deny',
      grounds: ['public-interest'],
      closedAt: new Date('2028-02-10T08:00:00Z'),
    };

    expect(await api.deliver(denied)).toBe(true);
    expect(await api.deliver(unidentified)).toBe(true);
    expect(await api.asPlatform((tx) => tx.select().from(accessRequestFacts))).toEqual([
      expect.objectContaining({ requestId, ...closed }),
    ]);

    await api.reset();
    expect(await api.deliver(unidentified)).toBe(true);
    expect(await api.deliver(denied)).toBe(true);
    expect(await api.asPlatform((tx) => tx.select().from(accessRequestFacts))).toEqual([
      expect.objectContaining({ requestId, ...closed }),
    ]);
  });

  it('closes a request whose officer cannot be identified, and records a withdrawal, under their Commission', async () => {
    const unidentified = randomUUID();
    const withdrawn = randomUUID();
    for (const event of [
      accessEvent('tsc', 'received', { requestId: unidentified, at: '2028-01-10T08:00:00Z' }),
      accessEvent('tsc', 'cannot-identify', {
        requestId: unidentified,
        at: '2028-01-20T08:00:00Z',
      }),
      accessEvent('tsc', 'received', { requestId: withdrawn, at: '2028-02-01T08:00:00Z' }),
      accessEvent('tsc', 'withdrawn', { requestId: withdrawn, at: '2028-02-03T08:00:00Z' }),
    ]) {
      expect(await api.deliver(event)).toBe(true);
    }

    const tsc = await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.select().from(accessRequestFacts),
    );
    expect(tsc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: unidentified,
          fy: 2027,
          outcome: 'cannot-identify',
          grounds: [],
          closedAt: new Date('2028-01-20T08:00:00Z'),
          withdrawnAt: null,
        }),
        expect.objectContaining({
          requestId: withdrawn,
          fy: 2027,
          outcome: null,
          withdrawnAt: new Date('2028-02-03T08:00:00Z'),
        }),
      ]),
    );
    const psc = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(accessRequestFacts),
    );
    expect(psc).toEqual([]);
  });
});
