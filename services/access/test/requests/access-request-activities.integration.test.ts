import { randomUUID } from 'node:crypto';

import { ACCESS_OFFICER } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import { AccessRequestActivities } from '../../src/requests/activities.js';
import {
  accessRequestWorkflowId,
  type AccessRequestWorkflowInput,
} from '../../src/requests/contract.js';
import type { AccessRequestRow } from '../../src/requests/representation.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
import { givenCommissions, rowOf, submitRequest } from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';

/**
 * `AccessRequestWorkflow`'s activities against the database and the fakes, run directly (the
 * workflow's timing is tested with time-skipping in access-request-workflow.test.ts): the
 * reminders to the access officers and the end of the window (S5), and the resolution's notice.
 */
describe('AccessRequestWorkflow activities (S3, S5)', () => {
  let api: AccessApi;
  let activities: AccessRequestActivities;

  beforeAll(async () => {
    api = await startAccessApi();
    activities = api.app.get(AccessRequestActivities);
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** A received request whose own workflow is stopped, so only the test runs its activities. */
  async function received(): Promise<AccessRequestWorkflowInput> {
    givenCommissions(api, NOW);
    api.directory.givenStaff(
      'psc',
      ACCESS_OFFICER,
      { subject: 'officer-psc', email: 'access.officer@psc.go.ke' },
      { subject: 'officer-psc-2', email: 'second.officer@psc.go.ke' },
    );
    const { id } = await submitRequest(api);
    await api.endWorkflows([accessRequestWorkflowId(id)]);
    return { tenant: 'psc', requestId: id, submittedAt: NOW };
  }

  async function update(id: string, values: Partial<AccessRequestRow>): Promise<void> {
    await api.asPlatform((tx) =>
      tx.update(accessRequests).set(values).where(eq(accessRequests.id, id)),
    );
  }

  describe('remindOfficer', () => {
    it('S5: day 5, unresolved: the request becomes officer-unresolved and each access officer is asked by email to identify the officer', async () => {
      const input = await received();
      api.clock.set('2027-03-09T09:00:00.000Z');

      const outcome = await activities.remindOfficer({ ...input, day: 5 });

      expect(outcome).toBe('sent');
      expect((await rowOf(api, input.requestId)).status).toBe('officer-unresolved');
      const { reference } = await rowOf(api, input.requestId);
      expect(api.notifications.sent).toEqual([
        {
          channel: 'email',
          recipient: { kind: 'address', to: 'access.officer@psc.go.ke' },
          template: 'access-officer-reminder-email',
          params: {
            reference,
            commissionName: 'Public Service Commission',
            task: 'identify-officer',
            dueDate: '2027-04-03',
            daysLeft: 25,
            signInUrl: `http://localhost:3020/access/requests/${input.requestId}`,
          },
          tenant: 'psc',
          idempotencyKey: expect.any(String) as unknown,
        },
        expect.objectContaining({ recipient: { kind: 'address', to: 'second.officer@psc.go.ke' } }),
      ]);
      expect(api.directory.calls).toContainEqual({ method: 'staffWithRole', slug: 'psc' });
    });

    it('a retried reminder is not sent twice', async () => {
      const input = await received();

      await activities.remindOfficer({ ...input, day: 5 });
      await activities.remindOfficer({ ...input, day: 5 });

      expect(api.notifications.sent).toHaveLength(2);
    });

    it('day 5, resolved already: no reminder, the status stays', async () => {
      const input = await received();
      await update(input.requestId, { resolvedRosterRecordId: randomUUID() });

      expect(await activities.remindOfficer({ ...input, day: 5 })).toBe('skipped');
      expect((await rowOf(api, input.requestId)).status).toBe('submitted');
      expect(api.notifications.sent).toEqual([]);
    });

    it('S5: days 20 and 28 remind of the deadline: to decide once the declarant is notified, to identify the officer while not', async () => {
      const input = await received();
      api.clock.set('2027-03-24T09:00:00.000Z');
      await activities.remindOfficer({ ...input, day: 20 });
      await update(input.requestId, {
        status: 'under-decision',
        resolvedRosterRecordId: randomUUID(),
      });
      api.clock.set('2027-04-01T09:00:00.000Z');

      await activities.remindOfficer({ ...input, day: 28 });

      const sent = api.notifications.sent.filter(
        (message) =>
          message.recipient.kind === 'address' && message.recipient.to.startsWith('access'),
      );
      expect(sent.map((message) => [message.params.task, message.params.daysLeft])).toEqual([
        ['identify-officer', 10],
        ['decide', 2],
      ]);
    });

    it.each(['withdrawn', 'cannot-identify', 'granted'] as const)(
      'a %s request gets no reminder',
      async (status) => {
        const input = await received();
        await update(input.requestId, { status });

        expect(await activities.remindOfficer({ ...input, day: 20 })).toBe('skipped');
        expect(api.notifications.sent).toEqual([]);
      },
    );

    it('a request that is not there is missing', async () => {
      givenCommissions(api, NOW);
      const input = { tenant: 'psc', requestId: randomUUID(), submittedAt: NOW };

      expect(await activities.remindOfficer({ ...input, day: 5 })).toBe('missing');
      expect(await activities.closeWindow(input)).toBe('missing');
      expect(await activities.resolution(input)).toEqual({ outcome: 'missing' });
    });
  });

  describe('closeWindow', () => {
    it('S5: at the end of the window the request goes under decision; once only', async () => {
      const input = await received();
      await update(input.requestId, { status: 'awaiting-representations' });

      expect(await activities.closeWindow(input)).toBe('under-decision');
      expect((await rowOf(api, input.requestId)).status).toBe('under-decision');
      expect(await activities.closeWindow(input)).toBe('unchanged');
    });

    it('leaves a withdrawn request withdrawn', async () => {
      const input = await received();
      await update(input.requestId, { status: 'withdrawn' });

      expect(await activities.closeWindow(input)).toBe('unchanged');
      expect((await rowOf(api, input.requestId)).status).toBe('withdrawn');
    });
  });

  describe('resolution', () => {
    it('S3: notifies once: a repeated run records no second entry and sends nothing twice', async () => {
      const input = await received();
      const personId = randomUUID();
      await update(input.requestId, {
        resolvedRosterRecordId: randomUUID(),
        resolvedPersonId: personId,
      });

      const first = await activities.resolution(input);
      api.clock.set('2027-03-06T09:00:00.000Z');
      const second = await activities.resolution(input);

      expect(first).toEqual({ outcome: 'notified', windowEndsAt: '2027-03-11T09:00:00.000Z' });
      expect(second).toEqual(first);
      expect(await api.events('access.request.notified.v1')).toHaveLength(1);
      expect(api.notifications.sent).toHaveLength(2);
    });

    it('a request with no resolution behind the signal is unresolved; a withdrawn one withdrawn', async () => {
      const input = await received();

      expect(await activities.resolution(input)).toEqual({ outcome: 'unresolved' });
      await update(input.requestId, { status: 'withdrawn' });
      expect(await activities.resolution(input)).toEqual({ outcome: 'withdrawn' });
      expect(api.notifications.sent).toEqual([]);
    });
  });
});
