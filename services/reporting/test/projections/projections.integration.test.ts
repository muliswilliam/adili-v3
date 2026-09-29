import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  actionFacts,
  clarificationFacts,
  determinationFacts,
  inbox,
  obligationFacts,
  referralFacts,
} from '../../src/db/schema.js';
import {
  actionEvent,
  clarificationEvent,
  declarationSubmitted,
  determinationApproved,
  obligationCreated,
  obligationStatusChanged,
  referralSent,
} from '../support/events.js';
import { type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * S1 at the inbox seam: obligation, filing, clarification, action, determination and referral
 * events populate the facts, attributed to the right financial year (1 July to 30 June, keyed by
 * its start year); redelivery changes nothing; no names are stored.
 */
describe('projections (S1)', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await api.reset();
  });

  const obligation = async (obligationId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(obligationFacts).where(eq(obligationFacts.obligationId, obligationId)),
    );
    return row;
  };

  it('S1: attributes initial obligations by appointment date, biennial by cycle statement date, final by exit date', async () => {
    const cases = [
      { type: 'initial', statementDate: '2027-07-01', fy: 2027 },
      { type: 'initial', statementDate: '2028-06-30', fy: 2027 },
      { type: 'initial', statementDate: '2028-07-01', fy: 2028 },
      { type: 'biennial', statementDate: '2027-11-01', fy: 2027 },
      { type: 'final', statementDate: '2028-03-10', fy: 2027 },
      { type: 'final', statementDate: '2027-06-30', fy: 2026 },
    ] as const;
    const ids = cases.map(() => randomUUID());

    for (const [i, fixture] of cases.entries()) {
      await api.deliver(obligationCreated('psc', { ...fixture, obligationId: ids[i] }));
    }

    const rows = await api.asPlatform((tx) => tx.select().from(obligationFacts));
    expect(
      ids.map((id) => {
        const row = rows.find((found) => found.obligationId === id);
        return [row?.type, row?.statementDate, row?.fy];
      }),
    ).toEqual(cases.map(({ type, statementDate, fy }) => [type, statementDate, fy]));
    expect(rows.every((row) => row.tenant === 'psc')).toBe(true);
  });

  it('S1: a filing marks the obligation filed with its time and lateness; an amendment files nothing', async () => {
    const obligationId = randomUUID();
    await api.deliver(
      obligationCreated('psc', { obligationId, type: 'initial', statementDate: '2027-08-15' }),
    );

    await api.deliver(
      obligationStatusChanged('psc', obligationId, 'due', 'overdue', '2027-09-15T21:00:00.000Z'),
    );
    await api.deliver(
      declarationSubmitted('psc', obligationId, '2027-09-20T08:00:00.000Z', { late: true }),
    );
    await api.deliver(
      obligationStatusChanged('psc', obligationId, 'overdue', 'filed', '2027-09-20T08:00:01.000Z'),
    );
    await api.deliver(
      declarationSubmitted('psc', obligationId, '2027-10-01T08:00:00.000Z', { amendment: true }),
    );

    expect(await obligation(obligationId)).toMatchObject({
      fy: 2027,
      status: 'filed',
      filedAt: new Date('2027-09-20T08:00:00.000Z'),
      late: true,
    });
  });

  it('S1: facts converge whatever order the events arrive in; an older status never overwrites a newer one', async () => {
    const obligationId = randomUUID();

    await api.deliver(declarationSubmitted('psc', obligationId, '2027-09-01T08:00:00.000Z'));
    await api.deliver(
      obligationStatusChanged('psc', obligationId, 'due', 'filed', '2027-09-01T08:00:01.000Z'),
    );
    await api.deliver(
      obligationStatusChanged('psc', obligationId, 'upcoming', 'due', '2027-08-15T06:00:00.000Z'),
    );
    await api.deliver(
      obligationCreated('psc', { obligationId, type: 'initial', statementDate: '2027-08-15' }),
    );

    expect(await obligation(obligationId)).toMatchObject({
      type: 'initial',
      fy: 2027,
      status: 'filed',
      filedAt: new Date('2027-09-01T08:00:00.000Z'),
      late: false,
    });
  });

  it('S1: clarifications are attributed by the time they were issued in Nairobi and follow their status', async () => {
    const early = { clarificationId: randomUUID(), caseId: randomUUID() };
    // 30 June 22:30 UTC is 1 July 01:30 in Nairobi: the next financial year.
    const edge = { clarificationId: randomUUID(), caseId: randomUUID() };

    await api.deliver(clarificationEvent('psc', 'issued', early, '2027-12-01T09:00:00.000Z'));
    await api.deliver(clarificationEvent('psc', 'responded', early, '2027-12-20T09:00:00.000Z'));
    await api.deliver(clarificationEvent('psc', 'resolved', early, '2028-01-05T09:00:00.000Z'));
    await api.deliver(clarificationEvent('psc', 'issued', edge, '2028-06-30T22:30:00.000Z'));
    await api.deliver(clarificationEvent('psc', 'overdue', edge, '2028-07-31T21:00:00.000Z'));

    const rows = await api.asPlatform((tx) => tx.select().from(clarificationFacts));
    expect(rows.find((row) => row.clarificationId === early.clarificationId)).toMatchObject({
      caseId: early.caseId,
      fy: 2027,
      issuedAt: new Date('2027-12-01T09:00:00.000Z'),
      status: 'resolved',
      respondedAt: new Date('2027-12-20T09:00:00.000Z'),
      resolvedAt: new Date('2028-01-05T09:00:00.000Z'),
    });
    expect(rows.find((row) => row.clarificationId === edge.clarificationId)).toMatchObject({
      fy: 2028,
      status: 'overdue',
    });
  });

  it('S1: actions, determinations and referrals are projected with their dates and years', async () => {
    const action = {
      actionId: randomUUID(),
      subjectId: randomUUID(),
      step: 'notice-to-comply',
    } as const;
    const determination = { determinationId: randomUUID(), caseId: randomUUID() };
    const referralId = randomUUID();

    await api.deliver(actionEvent('psc', 'proposed', action, '2027-10-01T09:00:00.000Z'));
    await api.deliver(actionEvent('psc', 'approved', action, '2027-10-02T09:00:00.000Z'));
    await api.deliver(actionEvent('psc', 'issued', action, '2027-10-02T09:05:00.000Z'));
    await api.deliver(determinationApproved('psc', determination, '2028-02-01T09:00:00.000Z'));
    await api.deliver(referralSent('psc', referralId, '2028-07-02T09:00:00.000Z'));

    const [projectedAction] = await api.asPlatform((tx) => tx.select().from(actionFacts));
    expect(projectedAction).toMatchObject({
      actionId: action.actionId,
      subjectKind: 'obligation',
      subjectId: action.subjectId,
      step: 'notice-to-comply',
      status: 'issued',
      issuedAt: new Date('2027-10-02T09:05:00.000Z'),
      compliedAt: null,
    });
    const [projectedDetermination] = await api.asPlatform((tx) =>
      tx.select().from(determinationFacts),
    );
    expect(projectedDetermination).toMatchObject({
      ...determination,
      outcome: 'non-compliant',
      fy: 2027,
    });
    const [projectedReferral] = await api.asPlatform((tx) => tx.select().from(referralFacts));
    expect(projectedReferral).toMatchObject({ referralId, grounds: 'two-missed-cycles', fy: 2028 });
  });

  it('S1: a redelivered event is projected once', async () => {
    const obligationId = randomUUID();
    const created = obligationCreated('psc', {
      obligationId,
      type: 'final',
      statementDate: '2028-01-10',
    });
    const filed = declarationSubmitted('psc', obligationId, '2028-01-20T08:00:00.000Z');

    expect(await api.deliver(created)).toBe(true);
    expect(await api.deliver(filed)).toBe(true);
    const before = await obligation(obligationId);
    expect(await api.deliver(created)).toBe(false);
    expect(await api.deliver(filed)).toBe(false);

    expect(await obligation(obligationId)).toEqual(before);
    const handled = await api.db.select().from(inbox);
    expect(handled.map((row) => row.consumer).sort()).toEqual([
      'reporting.declaration.submitted.v1',
      'reporting.obligation.created.v1',
    ]);
  });

  it("S1: no names are stored, and a Commission's facts are invisible to another", async () => {
    await api.deliver(obligationCreated('psc', { type: 'initial', statementDate: '2027-08-15' }));

    const columns = await api.db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = current_schema() and table_name like '%_facts'`,
    );
    expect(columns.rows.length).toBeGreaterThan(0);
    expect(
      columns.rows.filter(({ column_name }) =>
        /name|designation|file_number|email|phone/.test(column_name),
      ),
    ).toEqual([]);

    const asTsc = await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.select().from(obligationFacts),
    );
    const asPsc = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(obligationFacts),
    );
    expect(asTsc).toEqual([]);
    expect(asPsc).toHaveLength(1);
  });

  it('S1: an event naming no Commission is refused', async () => {
    const event = obligationCreated('psc', { type: 'initial', statementDate: '2027-08-15' });
    delete event.tenant;

    await expect(api.deliver(event)).rejects.toThrow(/names no Commission/);
  });
});
