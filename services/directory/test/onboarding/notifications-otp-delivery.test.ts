import { ServiceTokenError } from '@adili/api-kit';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  NOTIFICATIONS_SEND_TIMEOUT_MS,
  NotificationsOtpDelivery,
} from '../../src/onboarding/otp/notifications-otp-delivery.js';
import { OtpDeliveryFailed, type OtpMessage } from '../../src/onboarding/otp/otp-delivery.js';
import { componentSchema, contractErrors } from '../support/contract.js';

/**
 * The notifications adapter against a stubbed `fetch`: the request it makes (checked against
 * notifications.yaml) and which answers count as sent.
 */

const EMAIL: OtpMessage = {
  channel: 'email',
  to: 'wanjiru.otieno@tsc.go.ke',
  code: '042917',
  commissionName: 'Teachers Service Commission',
  expiresInMinutes: 10,
  tenant: 'tsc',
};
const PHONE: OtpMessage = { ...EMAIL, channel: 'phone', to: '+254712345123' };

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

type Answer = { status: number; body?: unknown } | Error;

let calls: Call[];
let answers: Answer[];
let invalidated: number;
let tokens: string[];

const message = (status: 'sent' | 'failed') => ({
  id: '0199a000-0000-7000-8000-00000000abcd',
  channel: 'email',
  template: 'onboarding-otp-email',
  status,
  error: status === 'failed' ? 'timeout' : null,
  providerMessageId: status === 'sent' ? 'smtp-1' : null,
  createdAt: '2026-10-01T09:00:00.000Z',
});

function delivery(options: { tokenError?: Error } = {}) {
  return new NotificationsOtpDelivery({
    notificationsUrl: 'http://notifications.test/',
    tokens: {
      token: () => {
        if (options.tokenError) return Promise.reject(options.tokenError);
        return Promise.resolve(tokens.shift() ?? 'token-n');
      },
      invalidate: () => {
        invalidated += 1;
      },
    },
    fetch: async (input: string | URL | Request) => {
      const request = input as Request;
      calls.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      });
      const answer = answers.shift() ?? { status: 201, body: message('sent') };
      if (answer instanceof Error) throw answer;
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

beforeEach(() => {
  calls = [];
  answers = [];
  invalidated = 0;
  tokens = ['token-1', 'token-2'];
});

describe('NotificationsOtpDelivery', () => {
  it('sends an email code with the onboarding-otp-email template and the Commission name', async () => {
    await delivery().send(EMAIL);

    expect(calls).toEqual([
      {
        url: 'http://notifications.test/internal/v1/messages',
        method: 'POST',
        authorization: 'Bearer token-1',
        body: {
          channel: 'email',
          recipient: { kind: 'address', to: EMAIL.to },
          template: 'onboarding-otp-email',
          params: {
            code: '042917',
            commissionName: 'Teachers Service Commission',
            expiresInMinutes: 10,
          },
          locale: 'en',
          tenant: 'tsc',
        },
      },
    ]);
    expect(contractErrors(componentSchema('SendMessage'), calls[0]?.body, 'notifications')).toEqual(
      [],
    );
  });

  it('sends a phone code by SMS with the onboarding-otp-sms template', async () => {
    await delivery().send(PHONE);

    expect(calls[0]?.body).toMatchObject({
      channel: 'sms',
      recipient: { kind: 'address', to: '+254712345123' },
      template: 'onboarding-otp-sms',
    });
  });

  it('cuts a Commission name to the 120 characters the templates take', async () => {
    await delivery().send({ ...EMAIL, commissionName: 'C'.repeat(130) });

    expect(calls[0]?.body).toMatchObject({ params: { commissionName: 'C'.repeat(120) } });
  });

  it('retries once with a fresh token after a 401', async () => {
    answers = [{ status: 401, body: { type: 'unauthorized', title: 'Unauthorized', status: 401 } }];

    await delivery().send(EMAIL);

    expect(invalidated).toBe(1);
    expect(calls.map((call) => call.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it.each<[string, Answer[], RegExp]>([
    [
      'a message notifications reports failed',
      [{ status: 201, body: message('failed') }],
      /failed/,
    ],
    ['a 400', [{ status: 400, body: { type: 'x', title: 'Bad', status: 400 } }], /400/],
    ['a 503', [{ status: 503 }], /503/],
    ['a second 401', [{ status: 401 }, { status: 401 }], /401/],
    [
      'an answer that breaks the contract',
      [{ status: 201, body: { ...message('sent'), status: 'queued' } }],
      /breaks its contract/,
    ],
    ['no answer', [new TypeError('fetch failed')], /did not answer/],
  ])('fails on %s', async (_case, given, reason) => {
    answers = given;

    const sending = delivery().send(EMAIL);

    await expect(sending).rejects.toBeInstanceOf(OtpDeliveryFailed);
    await expect(sending).rejects.toThrow(reason);
  });

  it('fails without a service token', async () => {
    const sending = delivery({ tokenError: new ServiceTokenError('Keycloak is down') }).send(EMAIL);

    await expect(sending).rejects.toBeInstanceOf(OtpDeliveryFailed);
    expect(calls).toEqual([]);
  });

  it("waits just past notifications' 5 s synchronous budget", () => {
    expect(NOTIFICATIONS_SEND_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(NOTIFICATIONS_SEND_TIMEOUT_MS).toBeLessThanOrEqual(6_000);
  });
});
