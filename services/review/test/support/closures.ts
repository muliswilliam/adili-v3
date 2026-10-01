import { randomUUID } from 'node:crypto';

import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { v7 as uuidv7 } from 'uuid';

import { reviewCases } from '../../src/cases/schema.js';
import { inClosureSample } from '../../src/closures/sampling.js';
import { config } from '../../src/config.js';
import type { ReviewApi } from './review-api.js';

export type QueuedCase = typeof reviewCases.$inferInsert;

/** A 2027 cycle case received in December 2027: its six-month window closes in June 2028. */
const RECEIVED_AT = new Date('2027-12-10T09:00:00.000Z');
const WINDOW_ENDS_AT = new Date('2028-06-10T09:00:00.000Z');

/**
 * Review cases of Commission `tenant` arranged directly in the queue: low band, unassigned, no
 * open flags or clarifications, the 2027 cycle, the window closed on 10 June 2028, unless `overrides`
 * say otherwise. Returns their ids.
 */
export async function givenQueuedCases(
  api: ReviewApi,
  tenant: string,
  ids: readonly string[],
  overrides: Partial<QueuedCase> = {},
): Promise<string[]> {
  const rows: QueuedCase[] = ids.map((id, index) => ({
    id,
    tenant,
    declarationId: randomUUID(),
    currentVersionId: randomUUID(),
    currentVersion: 1,
    personId: randomUUID(),
    reference: `DCB-${tenant.toUpperCase()}-2027-${String(index + 1).padStart(7, '0')}-4`,
    type: 'biennial',
    statementDate: '2027-11-01',
    cycleYear: 2027,
    receivedAt: RECEIVED_AT,
    windowEndsAt: WINDOW_ENDS_AT,
    late: false,
    score: 0,
    band: 'low',
    status: 'unassigned',
    declarantName: 'Wanjiru Kamau',
    personnelFileNumber: `${tenant.toUpperCase()}/${String(index + 1).padStart(5, '0')}`,
    ...overrides,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    await api.asPlatform((tx) => tx.insert(reviewCases).values(rows.slice(start, start + 500)));
  }
  return [...ids];
}

/**
 * Fresh case ids the closure sample of `cycleYear` at `rate` puts in (`sampled`) or leaves out,
 * so a test knows which of its cases the sweep diverts.
 */
export function caseIds(
  count: number,
  {
    sampled,
    cycleYear = 2027,
    rate = config.CLOSURE_SAMPLE_RATE,
  }: {
    sampled: boolean;
    cycleYear?: number;
    rate?: number;
  },
): string[] {
  const ids: string[] = [];
  while (ids.length < count) {
    const id = uuidv7();
    if (inClosureSample(id, cycleYear, rate) === sampled) ids.push(id);
  }
  return ids;
}

/** The service's Temporal client, on the suite's own task queue. */
export function temporalOf(api: ReviewApi): Client {
  return api.app.get<Client>(TEMPORAL_CLIENT);
}

/** One such case, out of the sample, with `overrides`; returns its id. */
export async function givenQueuedCase(
  api: ReviewApi,
  tenant: string,
  overrides: Partial<QueuedCase> = {},
): Promise<string> {
  const [id] = caseIds(1, { sampled: false });
  if (!id) throw new Error('no case id');
  await givenQueuedCases(api, tenant, [id], overrides);
  return id;
}
