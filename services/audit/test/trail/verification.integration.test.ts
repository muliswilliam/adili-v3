import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chainDayOf } from '../../src/trail/chain.js';
import { ChainVerifier } from '../../src/trail/verifier.js';
import { type AuditApi, startAuditApi } from '../support/audit-api.js';
import { caseRead, freshTenant, submitted } from '../support/events.js';

let api: AuditApi;
let verifier: ChainVerifier;
const today = chainDayOf(new Date());

beforeAll(async () => {
  api = await startAuditApi();
  verifier = api.app.get(ChainVerifier);
});

afterAll(async () => {
  await api.close();
});

async function chainOfFive(): Promise<string> {
  const tenant = freshTenant();
  for (let at = 0; at < 5; at += 1) {
    await api.deliver(at % 2 === 0 ? caseRead(tenant) : submitted(tenant));
  }
  return tenant;
}

const where = (tenant: string, seq: number) =>
  `where tenant = '${tenant}' and chain_day = '${today}' and seq = ${String(seq)}`;

describe('chain verification (tamper detection)', () => {
  it('finds an untouched chain intact', async () => {
    const tenant = await chainOfFive();
    expect(await verifier.verify(tenant, today)).toMatchObject({
      status: 'intact',
      events: 5,
      problems: [],
      anchor: { status: 'none' },
    });
  });

  it('finds an empty day intact and empty', async () => {
    expect(await verifier.verify(freshTenant(), today)).toMatchObject({
      status: 'intact',
      events: 0,
      merkleRoot: null,
    });
  });

  it('finds an edited event', async () => {
    const tenant = await chainOfFive();
    await api.tamper(
      `update audit_events set envelope = jsonb_set(envelope, '{data,action}', '"something.else"') ${where(tenant, 3)}`,
    );
    const result = await verifier.verify(tenant, today);
    expect(result.status).toBe('tampered');
    expect(result.problems).toContainEqual({ kind: 'hash-mismatch', seq: 3 });
  });

  it('finds a filtered column changed apart from its event', async () => {
    const tenant = await chainOfFive();
    await api.tamper(`update audit_events set actor_id = 'someone-else' ${where(tenant, 2)}`);
    expect((await verifier.verify(tenant, today)).problems).toEqual([
      { kind: 'record-mismatch', seq: 2 },
    ]);
  });

  it.each([
    ['occurred_at', "occurred_at = occurred_at - interval '1 day'"],
    ['source', "source = 'adili/elsewhere'"],
    ['recorded_at', "recorded_at = recorded_at - interval '2 days'"],
  ])('finds %s changed apart from its event', async (_column, change) => {
    const tenant = await chainOfFive();
    await api.tamper(`update audit_events set ${change} ${where(tenant, 4)}`);
    expect((await verifier.verify(tenant, today)).problems).toEqual([
      { kind: 'record-mismatch', seq: 4 },
    ]);
  });

  it('finds an event removed from the middle', async () => {
    const tenant = await chainOfFive();
    await api.tamper(`delete from audit_events ${where(tenant, 3)}`);
    const result = await verifier.verify(tenant, today);
    expect(result.problems).toEqual([
      { kind: 'missing-event', seq: 3 },
      { kind: 'broken-link', seq: 4 },
    ]);
  });

  it('finds the last events removed', async () => {
    const tenant = await chainOfFive();
    await api.tamper(
      `delete from audit_events where tenant = '${tenant}' and chain_day = '${today}' and seq > 3`,
    );
    expect((await verifier.verify(tenant, today)).problems).toEqual([
      { kind: 'missing-event', seq: null },
    ]);
  });

  it('finds a chain rewritten from an event on, against its head', async () => {
    const tenant = await chainOfFive();
    // Recomputing every later hash hides an edit from the links, not from the head.
    await api.tamper(`update audit_events set hash = 'x' ${where(tenant, 5)}`);
    const result = await verifier.verify(tenant, today);
    expect(result.problems).toEqual([
      { kind: 'hash-mismatch', seq: 5 },
      { kind: 'head-mismatch', seq: null },
    ]);
  });
});
