import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { HttpNotificationsClient } from '../../src/notifications/http-notifications-client.js';
import {
  NotificationsRejected,
  NotificationsUnavailable,
  type ReminderMessage,
} from '../../src/notifications/notifications-client.js';

/**
 * The notifications client: requests conform to the notifications contract (checked here), and
 * each answer maps to an outcome or an error the reminder activity acts on.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve(
  '@adili/schemas/internal/notifications.yaml',
);
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'notifications.yaml');

function expectConforming(schema: string, body: unknown): void {
  const validate = ajv.getSchema(`notifications.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
}

const MESSAGE: ReminderMessage = {
  channel: 'sms',
  personId: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
  tenant: 'psc',
  params: {
    type: 'biennial',
    commissionName: 'Public Service Commission',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    daysLeft: 30,
    portalUrl: 'http://localhost:3010',
  },
};

const message = (status: 'sent' | 'failed', error: string | null = null) => ({
  id: '01a0e950-c833-75dd-bee2-465ead0dc3f4',
  channel: 'sms',
  template: 'obligation-reminder-sms',
  status,
  error,
  providerMessageId: null,
  createdAt: '2027-12-01T09:12:00.000Z',
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientAnswering(...responses: (Response | Error)[]) {
  const requests: { body: unknown; authorization: string | null }[] = [];
  let tokens = 0;
  let invalidated = 0;
  const client = new HttpNotificationsClient({
    notificationsUrl: 'http://notifications.test/',
    tokens: {
      token: () => Promise.resolve(`token-${String(++tokens)}`),
      invalidate: () => {
        invalidated += 1;
      },
    },
    fetch: async (input: string | URL | Request) => {
      const request = input as Request;
      requests.push({
        body: await request.json(),
        authorization: request.headers.get('authorization'),
      });
      const next = responses.shift() ?? new Error('no more answers');
      return next instanceof Error ? Promise.reject(next) : next;
    },
  });
  return { client, requests, invalidated: () => invalidated };
}

describe('HttpNotificationsClient', () => {
  it('sends the reminder template to the person, and reads back the message id', async () => {
    const { client, requests } = clientAnswering(json(message('sent'), 201));

    await expect(client.sendReminder(MESSAGE)).resolves.toEqual({
      status: 'sent',
      messageId: '01a0e950-c833-75dd-bee2-465ead0dc3f4',
    });

    const [request] = requests;
    expect(request?.body).toEqual({
      channel: 'sms',
      recipient: { kind: 'person', personId: MESSAGE.personId },
      template: 'obligation-reminder-sms',
      params: MESSAGE.params,
      locale: 'en',
      tenant: 'psc',
    });
    expectConforming('SendMessage', request?.body);
    expect(request?.authorization).toBe('Bearer token-1');
  });

  it('uses the email template for email', async () => {
    const { client, requests } = clientAnswering(json(message('sent'), 201));

    await client.sendReminder({ ...MESSAGE, channel: 'email' });

    expect(requests[0]?.body).toMatchObject({
      channel: 'email',
      template: 'obligation-reminder-email',
    });
  });

  it('reports a failed message with its reason', async () => {
    const { client } = clientAnswering(json(message('failed', 'no-contact'), 201));

    await expect(client.sendReminder(MESSAGE)).resolves.toEqual({
      status: 'failed',
      error: 'no-contact',
    });
  });

  it('retries once with a fresh token after a 401', async () => {
    const { client, requests, invalidated } = clientAnswering(
      json({ status: 401 }, 401),
      json(message('sent'), 201),
    );

    await expect(client.sendReminder(MESSAGE)).resolves.toMatchObject({ status: 'sent' });
    expect(invalidated()).toBe(1);
    expect(requests.map((r) => r.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('is rejected on a 400 and unavailable on anything else unexpected', async () => {
    await expect(
      clientAnswering(json({ status: 400 }, 400)).client.sendReminder(MESSAGE),
    ).rejects.toBeInstanceOf(NotificationsRejected);
    await expect(
      clientAnswering(json({ status: 503 }, 503)).client.sendReminder(MESSAGE),
    ).rejects.toBeInstanceOf(NotificationsUnavailable);
    await expect(
      clientAnswering(new TypeError('fetch failed')).client.sendReminder(MESSAGE),
    ).rejects.toBeInstanceOf(NotificationsUnavailable);
  });
});
