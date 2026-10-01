import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { EventEnvelope } from '@adili/events';
import { APPLICANT } from '@adili/roles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AcknowledgementConsumer } from '../../src/requests/acknowledgement.consumer.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';

const fixtures = createRequire(import.meta.url);
const COMPLETE = JSON.parse(
  readFileSync(
    fixtures.resolve('@adili/schemas/forms/fixtures/form-k.v1/valid/complete.json'),
    'utf8',
  ),
) as Record<string, unknown>;

// 01:30 on 5 March in Nairobi: the deadline's date is Nairobi's (4 April), not UTC's (3 April).
const NOW = '2027-03-04T22:30:00.000Z';

describe('Form K acknowledgement (S2)', () => {
  let api: AccessApi;
  let consumer: AcknowledgementConsumer;
  const applicant: Caller = {
    sub: 'applicant-mercy',
    roles: [APPLICANT],
    personId: randomUUID(),
    name: 'Mercy Wanjiku Kamau',
  };

  beforeAll(async () => {
    api = await startAccessApi();
    consumer = api.app.get(AcknowledgementConsumer);
    return () => api.close();
  });

  afterEach(() => api.reset());

  async function submitted(
    identityStatus: 'verified' | 'pending-verification' = 'verified',
  ): Promise<{ id: string; reference: string; event: EventEnvelope }> {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.givenApplicant(applicant.personId ?? '', identityStatus);
    api.clock.set(NOW);
    const response = await api.send('POST', '/v1/access/requests', applicant, COMPLETE, {
      'idempotency-key': randomUUID(),
    });
    expect(response.statusCode).toBe(201);
    const [event] = await api.events('access.request.received.v1');
    return {
      ...response.json<{ id: string; reference: string }>(),
      event: event as unknown as EventEnvelope,
    };
  }

  it('S2: the applicant is acknowledged by email and SMS with the reference and the decision deadline', async () => {
    const { id, reference, event } = await submitted();

    await consumer.received(event);

    const params = {
      reference,
      commissionName: 'Public Service Commission',
      decideBy: '2027-04-04',
      identityStatus: 'verified',
      signInUrl: 'http://localhost:3010/access/requests',
    };
    expect(api.notifications.sent).toEqual([
      {
        channel: 'email',
        recipient: { kind: 'person', personId: applicant.personId },
        template: 'access-acknowledgement-email',
        params,
        tenant: 'psc',
        idempotencyKey: expect.any(String) as unknown,
      },
      {
        channel: 'sms',
        recipient: { kind: 'person', personId: applicant.personId },
        template: 'access-acknowledgement-sms',
        params,
        tenant: 'psc',
        idempotencyKey: expect.any(String) as unknown,
      },
    ]);
    // Names nothing but the request and the Commission.
    expect(JSON.stringify(api.notifications.sent)).not.toMatch(/Mercy|Njeri/);
    expect(id).toBeTruthy();
  });

  it('S2: a passport applicant pending verification is told their request waits for the check', async () => {
    const { event } = await submitted('pending-verification');

    await consumer.received(event);

    expect(api.notifications.sent.map((message) => message.params.identityStatus)).toEqual([
      'pending-verification',
      'pending-verification',
    ]);
  });

  it('a redelivered event sends nothing twice', async () => {
    const { event } = await submitted();

    await consumer.received(event);
    await consumer.received(event);

    expect(api.notifications.sent).toHaveLength(2);
  });

  it('notifications down: the event fails to be retried, and the retry sends each message once', async () => {
    const { event } = await submitted();
    api.notifications.failCalls(1);

    await expect(consumer.received(event)).rejects.toThrow();
    expect(api.notifications.sent).toEqual([]);

    await consumer.received(event);
    expect(api.notifications.sent.map((message) => message.channel)).toEqual(['email', 'sms']);
  });
});
