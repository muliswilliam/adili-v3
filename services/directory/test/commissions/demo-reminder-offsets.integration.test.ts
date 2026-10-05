import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventPublisher } from '@adili/events';

import { useDemoPolicy, useDemoReminderOffsets } from '../../src/commissions/demo-seed.js';
import type { TenantPolicyHistory } from '../../src/commissions/policy-representation.js';
import { outbox } from '../../src/db/schema.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/**
 * The reminder demo (#92, local only): a policy version with short reminder offsets for a demo
 * Commission, so a declarant onboarded today is reminded at once. The product never changes
 * offsets (spec 04: only the start date is editable); this is the dev script's seam.
 */

let api: DirectoryApi;
const events = new EventPublisher({ service: 'directory', rabbitmqUrl: 'amqp://unused' });

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [{ slug: 'psc', name: 'Public Service Commission' }]);
});

async function history(): Promise<TenantPolicyHistory> {
  const response = await api.get('/v1/commissions/psc/policy', {
    sub: 'platform-1',
    tenant: 'platform',
    roles: ['platform-admin'],
  });
  return response.json<TenantPolicyHistory>();
}

describe('useDemoReminderOffsets', () => {
  it('puts a version with the offsets in force, keeping the rest, and announces it', async () => {
    const before = (await history()).current;

    await useDemoReminderOffsets(api.db, events, { tenant: 'psc', reminderOffsetsDays: [29, 7] });

    const { current, previous } = await history();
    expect(current).toMatchObject({
      version: 2,
      reminderOffsetsDays: [29, 7],
      obligationsStartDate: before.obligationsStartDate,
      initialDueAfterAppointmentDays: before.initialDueAfterAppointmentDays,
      createdBy: 'system:demo-seed',
    });
    expect(previous.map((version) => version.reminderOffsetsDays)).toEqual([[30, 14, 7]]);
    const announced = (await api.db.select().from(outbox)).filter(
      (row) => row.eventType === 'directory.policy.changed.v1',
    );
    expect(announced.map((row) => row.envelope.data)).toEqual([
      { policyVersionId: current.id, version: 2 },
    ]);
  });

  it('moves the obligations-start date back when asked, so a recent appointment owes an initial', async () => {
    await useDemoReminderOffsets(api.db, events, {
      tenant: 'psc',
      reminderOffsetsDays: [29, 7],
      obligationsStartDate: '2026-09-01',
    });

    expect((await history()).current).toMatchObject({
      version: 2,
      reminderOffsetsDays: [29, 7],
      obligationsStartDate: '2026-09-01',
    });
  });

  it('changes nothing when the offsets are in force already', async () => {
    await useDemoReminderOffsets(api.db, events, { tenant: 'psc', reminderOffsetsDays: [29, 7] });
    await useDemoReminderOffsets(api.db, events, { tenant: 'psc', reminderOffsetsDays: [29, 7] });

    expect((await history()).current.version).toBe(2);
  });
});

describe('useDemoPolicy', () => {
  const demo = {
    tenant: 'psc',
    biennial: { statementDate: '06-30', dueDate: '12-31' },
    obligationsStartDate: '2024-06-30',
    reminderOffsetsDays: [30, 14, 7, 1],
  };

  it('moves the biennial dates, the start date and the offsets in one version', async () => {
    expect(await useDemoPolicy(api.db, events, demo)).toBe(true);

    expect((await history()).current).toMatchObject({
      version: 2,
      biennial: demo.biennial,
      obligationsStartDate: '2024-06-30',
      reminderOffsetsDays: [30, 14, 7, 1],
      createdByName: 'Demo policy',
    });
  });

  it('changes nothing the second time', async () => {
    await useDemoPolicy(api.db, events, demo);

    expect(await useDemoPolicy(api.db, events, demo)).toBe(false);
    expect((await history()).current.version).toBe(2);
  });
});
