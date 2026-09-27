import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { messages } from '../src/db/schema.js';
import { FakeMessageSender } from '../src/messages/fake-message-sender.js';
import { DeliveryError } from '../src/messages/message-sender.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** Drives `/internal/v1/messages` over HTTP against real Postgres with fake providers. */
describe('internal messages API', () => {
  const email = new FakeMessageSender('email');
  const sms = new FakeMessageSender('sms');
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ email, sms });
    auth = { authorization: `Bearer ${await t.token()}` };
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => {
    email.reset();
    sms.reset();
  });

  const send = (payload: object, headers: Record<string, string> = auth) =>
    t.app.inject({ method: 'POST', url: '/internal/v1/messages', headers, payload });

  const onboardingEmail = {
    channel: 'email',
    recipient: { kind: 'address', to: 'Wanjiku.Kamau@example.go.ke' },
    template: 'onboarding-otp-email',
    params: { code: '483920', commissionName: 'Public Service Commission', expiresInMinutes: 10 },
  };

  const loginSms = {
    channel: 'sms',
    recipient: { kind: 'address', to: '+254712345678' },
    template: 'login-otp-sms',
    params: { code: '771204', expiresInMinutes: 5 },
  };

  it('renders and sends an email, returning status sent', async () => {
    const response = await send(onboardingEmail);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      channel: 'email',
      template: 'onboarding-otp-email',
      status: 'sent',
      error: null,
      providerMessageId: 'fake-email-1',
    });
    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message?.to).toBe('Wanjiku.Kamau@example.go.ke');
    expect(message?.subject).toBe('Your Adili code: 483920');
    expect(message?.text).toContain('483920');
    expect(message?.text).toContain('Public Service Commission');
    expect(message?.text).toContain('10 minutes');
    expect(message?.html).toContain('483920');
  });

  it('renders and sends an SMS, returning status sent', async () => {
    const response = await send(loginSms);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ channel: 'sms', status: 'sent' });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe('+254712345678');
    expect(sms.sent[0]?.text).toContain('771204');
    expect(sms.sent[0]?.text).toContain('5 minutes');
    expect(email.sent).toHaveLength(0);
  });

  it('accepts the Swahili locale', async () => {
    const response = await send({ ...loginSms, locale: 'sw' });

    expect(response.statusCode).toBe(201);
    expect(sms.sent[0]?.text).toContain('771204');
  });

  it('reads a message back by id', async () => {
    const created = (await send(loginSms)).json<{ id: string; createdAt: string }>();

    const response = await t.app.inject({
      method: 'GET',
      url: `/internal/v1/messages/${created.id}`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: created.id,
      channel: 'sms',
      template: 'login-otp-sms',
      status: 'sent',
      error: null,
      providerMessageId: expect.any(String) as string,
      createdAt: created.createdAt,
    });
  });

  it('answers 404 problem details for an unknown message', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/internal/v1/messages/0199a8f0-0000-7000-8000-000000000000',
      headers: auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('hides a message from other callers', async () => {
    const { id } = (await send(loginSms)).json<{ id: string }>();
    const otherCaller = await t.token({ clientId: 'keycloak-otp' });

    const response = await t.app.inject({
      method: 'GET',
      url: `/internal/v1/messages/${id}`,
      headers: { authorization: `Bearer ${otherCaller}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('stores the recipient only as a hash', async () => {
    const { id } = (await send(onboardingEmail)).json<{ id: string }>();

    const [row] = await t.db.select().from(messages).where(eq(messages.id, id));
    expect(row?.recipientHash).toMatch(/^[0-9a-f]{64}$/);
    const serialised = await t.db.execute<{ row: string }>(
      sql`select to_jsonb(m)::text as row from ${messages} m where id = ${id}`,
    );
    expect(serialised.rows[0]?.row.toLowerCase()).not.toContain('wanjiku');
    expect(serialised.rows[0]?.row).not.toContain('483920');
  });

  it('hashes the same recipient to the same value regardless of case', async () => {
    const first = (await send(onboardingEmail)).json<{ id: string }>();
    const second = (
      await send({
        ...onboardingEmail,
        recipient: { kind: 'address', to: 'wanjiku.kamau@EXAMPLE.go.ke' },
      })
    ).json<{ id: string }>();

    const rows = await t.db
      .select({ recipientHash: messages.recipientHash })
      .from(messages)
      .where(sql`${messages.id} in (${first.id}, ${second.id})`);
    expect(rows[0]?.recipientHash).toBe(rows[1]?.recipientHash);
  });

  it.each([
    ['a phone number on the email channel', 'email', '+254712345678', 'onboarding-otp-email'],
    ['an email address on the SMS channel', 'sms', 'someone@example.go.ke', 'login-otp-sms'],
    ['a local-format phone number', 'sms', '0712345678', 'login-otp-sms'],
  ])('rejects %s as 400 problem details', async (_case, channel, to, template) => {
    const response = await send({
      channel,
      recipient: { kind: 'address', to },
      template,
      params: { code: '123456', expiresInMinutes: 5 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      errors: [{ path: 'recipient.to', message: expect.any(String) as string }],
    });
    expect([...email.sent, ...sms.sent]).toHaveLength(0);
  });

  it('rejects an unknown template as 400 problem details', async () => {
    const response = await send({ ...onboardingEmail, template: 'birthday-greeting-email' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'template' }] });
  });

  it('rejects a template registered for the other channel', async () => {
    const response = await send({ ...loginSms, template: 'login-otp-email' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'template' }] });
  });

  it('rejects params failing the template schema with their paths', async () => {
    const response = await send({ ...loginSms, params: { code: 12, extra: true } });

    expect(response.statusCode).toBe(400);
    const paths = response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['params.code', 'params.expiresInMinutes']) as string[],
    );
    expect(sms.sent).toHaveLength(0);
  });

  it('reports recipient and params errors in one response', async () => {
    const response = await send({
      ...loginSms,
      recipient: { kind: 'address', to: '0712345678' },
      params: { code: 'abc' },
    });

    expect(response.statusCode).toBe(400);
    const paths = response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'recipient.to',
        'params.code',
        'params.expiresInMinutes',
      ]) as string[],
    );
  });

  it('records a provider timeout as failed within the budget', async () => {
    sms.hang();
    const started = Date.now();

    const response = await send(loginSms);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'failed',
      error: 'timeout',
      providerMessageId: null,
    });
    const { id } = response.json<{ id: string }>();
    const [row] = await t.db.select().from(messages).where(eq(messages.id, id));
    expect(row).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('records a recipient the provider refuses as failed', async () => {
    sms.fail(new DeliveryError('rejected-recipient', 'not a Kenyan mobile number'));

    const response = await send(loginSms);

    expect(response.json()).toMatchObject({ status: 'failed', error: 'rejected-recipient' });
  });

  it('records an unexpected provider error as failed', async () => {
    email.fail(new Error('socket hang up'));

    const response = await send(onboardingEmail);

    expect(response.json()).toMatchObject({ status: 'failed', error: 'provider-error' });
  });

  it('requires a bearer token', async () => {
    const response = await send(loginSms, {});

    expect(response.statusCode).toBe(401);
  });

  it('requires the messages scope', async () => {
    const token = await t.token({ clientId: 'console', scope: 'profile email' });

    const send403 = await send(loginSms, { authorization: `Bearer ${token}` });
    const read403 = await t.app.inject({
      method: 'GET',
      url: '/internal/v1/messages/0199a8f0-0000-7000-8000-000000000000',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(send403.statusCode).toBe(403);
    expect(read403.statusCode).toBe(403);
    expect(sms.sent).toHaveLength(0);
  });
});
