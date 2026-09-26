import { randomInt } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, requireEnv, type TestApp } from './support/test-app.js';

/**
 * S20 through the real adapters: SMTP into Mailpit and the SMS gateway mock
 * (`pnpm infra:up`, `pnpm --filter @adili/mocks dev`). See vitest.stack.config.ts.
 */
const MAILPIT_URL = requireEnv('TEST_MAILPIT_URL');
const SMS_GATEWAY_URL = requireEnv('SMS_GATEWAY_URL');

interface MailpitSearch {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

describe('delivery through Mailpit and the SMS mock', () => {
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp();
    auth = { authorization: `Bearer ${await t.token()}` };
  });

  afterAll(async () => {
    await t.close();
  });

  const send = (payload: object) =>
    t.app.inject({ method: 'POST', url: '/internal/v1/messages', headers: auth, payload });

  it('delivers a rendered onboarding email to Mailpit', async () => {
    const to = `s20-${Date.now()}@example.go.ke`;

    const response = await send({
      channel: 'email',
      recipient: { kind: 'address', to },
      template: 'onboarding-otp-email',
      params: {
        code: '582014',
        commissionName: 'Teachers Service Commission',
        expiresInMinutes: 10,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: 'sent', error: null });
    const search = await getJson<MailpitSearch>(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    expect(search.messages).toHaveLength(1);
    expect(search.messages[0]?.Subject).toBe('Your Adili code: 582014');
    const message = await getJson<{ Text: string; HTML: string; From: { Address: string } }>(
      `${MAILPIT_URL}/api/v1/message/${search.messages[0]?.ID}`,
    );
    expect(message.From.Address).toBe('no-reply@adili.go.ke');
    expect(message.Text).toContain('with Teachers Service Commission');
    expect(message.Text).toContain('It expires in 10 minutes.');
    expect(message.HTML).toContain('<p>Your Adili Online code is 582014.</p>');
  });

  it('delivers a rendered login SMS to the SMS mock', async () => {
    const to = `+2547${randomInt(10_000_000, 99_999_999)}`;

    const response = await send({
      channel: 'sms',
      recipient: { kind: 'address', to },
      template: 'login-otp-sms',
      params: { code: '904417', expiresInMinutes: 5 },
    });

    expect(response.statusCode).toBe(201);
    const sent = response.json<{ status: string; providerMessageId: string }>();
    expect(sent.status).toBe('sent');
    const inbox = await getJson<{ message_id: string; sender_id: string; message: string }[]>(
      `${SMS_GATEWAY_URL}?to=${encodeURIComponent(to)}`,
    );
    expect(inbox).toEqual([
      expect.objectContaining({
        message_id: sent.providerMessageId,
        sender_id: 'ADILI',
        message: 'Adili: your sign-in code is 904417. It expires in 5 minutes. Do not share it.',
      }),
    ]);
  });

  it('records a number the gateway refuses as failed', async () => {
    const response = await send({
      channel: 'sms',
      recipient: { kind: 'address', to: '+447700900123' },
      template: 'login-otp-sms',
      params: { code: '904417', expiresInMinutes: 5 },
    });

    expect(response.json()).toMatchObject({ status: 'failed', error: 'rejected-recipient' });
  });
});

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return (await response.json()) as T;
}
