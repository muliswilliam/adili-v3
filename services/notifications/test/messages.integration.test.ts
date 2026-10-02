import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FakePersonContacts } from '../src/contacts/fake-person-contacts.js';
import { ContactLookupError } from '../src/contacts/person-contacts.js';
import { messages } from '../src/db/schema.js';
import { FakeMessageSender } from '../src/messages/fake-message-sender.js';
import { DeliveryError } from '../src/messages/message-sender.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** Drives `/internal/v1/messages` over HTTP against real Postgres with fake providers. */
describe('internal messages API', () => {
  const email = new FakeMessageSender('email');
  const sms = new FakeMessageSender('sms');
  const directory = new FakePersonContacts();
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ email, sms, contacts: directory });
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  beforeEach(() => {
    email.reset();
    sms.reset();
    directory.reset();
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

  describe('recipient by person (S20)', () => {
    // The contacts cache lives as long as the app, so every test uses its own person.
    let seq = 0;
    const newPerson = () => `0199a8f0-5555-7000-8000-${String(++seq).padStart(12, '0')}`;

    const reminderParams = {
      type: 'biennial',
      commissionName: 'Public Service Commission',
      statementDate: '2027-11-01',
      dueDate: '2027-12-31',
      daysLeft: 30,
      portalUrl: 'https://portal.adili.go.ke',
    };
    const reminder = (channel: 'sms' | 'email', personId: string) => ({
      channel,
      recipient: { kind: 'person', personId },
      template: `obligation-reminder-${channel}`,
      params: reminderParams,
      tenant: 'psc',
    });

    it('sends the SMS to the phone the directory has verified', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

      const response = await send(reminder('sms', personId));

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        channel: 'sms',
        template: 'obligation-reminder-sms',
        status: 'sent',
        error: null,
        providerMessageId: 'fake-sms-1',
      });
      expect(sms.sent).toEqual([
        {
          to: '+254712345678',
          text: 'Adili: your biennial declaration for Public Service Commission is due on 31 December 2027 (30 days). Sign in at https://portal.adili.go.ke',
        },
      ]);
      expect(directory.lookups).toEqual([{ personId, tenant: 'psc' }]);
    });

    it('sends the email to the verified address', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

      const response = await send(reminder('email', personId));

      expect(response.json()).toMatchObject({
        status: 'sent',
        template: 'obligation-reminder-email',
      });
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]?.to).toBe('wanjiku@example.go.ke');
      expect(email.sent[0]?.subject).toBe(
        'Reminder: your biennial declaration is due on 31 December 2027',
      );
      expect(email.sent[0]?.text).toContain('Public Service Commission');
      expect(email.sent[0]?.html).toContain('https://portal.adili.go.ke');
      expect(sms.sent).toHaveLength(0);
    });

    it('records the person and the hash of the contact used', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'Wanjiku.Kamau@example.go.ke', phone: null });

      const byPerson = (await send(reminder('email', personId))).json<{ id: string }>();
      const byAddress = (await send(onboardingEmail)).json<{ id: string }>();

      const [personRow] = await t.db.select().from(messages).where(eq(messages.id, byPerson.id));
      const [addressRow] = await t.db.select().from(messages).where(eq(messages.id, byAddress.id));
      expect(personRow).toMatchObject({ recipientPersonId: personId, tenant: 'psc' });
      expect(personRow?.recipientHash).toBe(addressRow?.recipientHash);
      expect(addressRow?.recipientPersonId).toBeNull();
    });

    it('reports failed with no-contact when the person has no contact for the channel', async () => {
      const personId = newPerson();
      directory.set(personId, { email: null, phone: '+254712345678' });

      const response = await send(reminder('email', personId));

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        status: 'failed',
        error: 'no-contact',
        providerMessageId: null,
      });
      expect(email.sent).toHaveLength(0);
      const { id } = response.json<{ id: string }>();
      const [row] = await t.db.select().from(messages).where(eq(messages.id, id));
      expect(row).toMatchObject({
        status: 'failed',
        error: 'no-contact',
        recipientPersonId: personId,
        recipientHash: null,
      });
    });

    it('reports failed with no-contact for a person the directory does not know', async () => {
      const response = await send(reminder('sms', newPerson()));

      expect(response.json()).toMatchObject({ status: 'failed', error: 'no-contact' });
      expect(sms.sent).toHaveLength(0);
    });

    it('reports failed with contact-lookup-failed when the directory cannot answer, and does not cache it', async () => {
      const personId = newPerson();
      directory.set(personId, { email: null, phone: '+254712345678' });
      directory.failNext(new ContactLookupError('directory answered 503'));

      const failed = await send(reminder('sms', personId));
      const retried = await send(reminder('sms', personId));

      expect(failed.statusCode).toBe(201);
      expect(failed.json()).toMatchObject({ status: 'failed', error: 'contact-lookup-failed' });
      expect(retried.json()).toMatchObject({ status: 'sent', error: null });
      expect(directory.lookups).toEqual([
        { personId, tenant: 'psc' },
        { personId, tenant: 'psc' },
      ]);
    });

    it('gives up on a stalled contact lookup within the send budget', async () => {
      directory.hangNext();
      const started = Date.now();

      const response = await send(reminder('sms', newPerson()));

      // CONTACT_LOOKUP_TIMEOUT_MS is 500 in vitest.integration.config.ts.
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(response.json()).toMatchObject({ status: 'failed', error: 'contact-lookup-failed' });
      expect(sms.sent).toHaveLength(0);
    });

    it('looks a person up once for the SMS and the email of one reminder', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

      await send(reminder('sms', personId));
      await send(reminder('email', personId));

      expect(directory.lookups).toEqual([{ personId, tenant: 'psc' }]);
      expect(sms.sent).toHaveLength(1);
      expect(email.sent).toHaveLength(1);
    });

    it('validates params before looking anyone up', async () => {
      const response = await send({
        ...reminder('sms', newPerson()),
        params: { ...reminderParams, daysLeft: -3, dueDate: '31/12/2027' },
      });

      expect(response.statusCode).toBe(400);
      const paths = response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
      expect(paths).toEqual(
        expect.arrayContaining(['params.daysLeft', 'params.dueDate']) as string[],
      );
      expect(directory.lookups).toHaveLength(0);
    });

    it('requires the tenant the reminder is for, and looks no one up without it', async () => {
      const response = await send({ ...reminder('sms', newPerson()), tenant: undefined });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errors: [{ path: 'tenant' }] });
      expect(directory.lookups).toHaveLength(0);
    });

    it('reports no-contact for a person not onboarded at the tenant named', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' }, 'tsc');

      const response = await send(reminder('sms', personId));

      expect(response.json()).toMatchObject({ status: 'failed', error: 'no-contact' });
      expect(directory.lookups).toEqual([{ personId, tenant: 'psc' }]);
      expect(sms.sent).toHaveLength(0);
    });

    it('sends once for requests with the same Idempotency-Key, replaying the message', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abcd' };

      const first = await send(reminder('sms', personId), headers);
      const retry = await send(reminder('sms', personId), headers);

      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect(sms.sent).toHaveLength(1);
    });

    it('does not replay a failed contact lookup: a retry with the same key looks up and sends', async () => {
      const personId = newPerson();
      directory.set(personId, { email: null, phone: '+254712345678' });
      directory.failNext(new ContactLookupError('directory answered 503'));
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abcf' };

      const failed = await send(reminder('sms', personId), headers);
      const retried = await send(reminder('sms', personId), headers);
      const replayed = await send(reminder('sms', personId), headers);

      expect(failed.json()).toMatchObject({ status: 'failed', error: 'contact-lookup-failed' });
      expect(retried.headers['idempotent-replayed']).toBeUndefined();
      expect(retried.json()).toMatchObject({ status: 'sent', error: null });
      expect(replayed.headers['idempotent-replayed']).toBe('true');
      expect(replayed.json()).toEqual(retried.json());
      expect(sms.sent).toHaveLength(1);
    });

    it('does not replay a provider failure: a retry with the same key sends', async () => {
      const personId = newPerson();
      directory.set(personId, { email: null, phone: '+254712345678' });
      sms.fail(new DeliveryError('provider-error', 'gateway answered 502'));
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abd0' };

      const failed = await send(reminder('sms', personId), headers);
      sms.reset();
      const retried = await send(reminder('sms', personId), headers);

      expect(failed.json()).toMatchObject({ status: 'failed', error: 'provider-error' });
      expect(retried.headers['idempotent-replayed']).toBeUndefined();
      expect(retried.json()).toMatchObject({ status: 'sent' });
      expect(sms.sent).toHaveLength(1);
    });

    it('replays a provider timeout under the same key: the first message may have gone out', async () => {
      const personId = newPerson();
      directory.set(personId, { email: null, phone: '+254712345678' });
      sms.hang();
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abd2' };

      const timedOut = await send(reminder('sms', personId), headers);
      sms.reset();
      const retry = await send(reminder('sms', personId), headers);

      expect(timedOut.json()).toMatchObject({ status: 'failed', error: 'timeout' });
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(timedOut.json());
      expect(sms.sent).toHaveLength(0);
    });

    it('replays a lasting failure (no-contact) under the same key', async () => {
      const personId = newPerson();
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abd1' };

      const first = await send(reminder('sms', personId), headers);
      const retry = await send(reminder('sms', personId), headers);

      expect(first.json()).toMatchObject({ status: 'failed', error: 'no-contact' });
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
    });

    it('refuses an Idempotency-Key reused for another message', async () => {
      const personId = newPerson();
      directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });
      const headers = { ...auth, 'idempotency-key': '0199a8f0-5555-7000-8000-00000000abce' };

      await send(reminder('sms', personId), headers);
      const other = await send(reminder('email', personId), headers);

      expect(other.statusCode).toBe(422);
      expect(email.sent).toHaveLength(0);
    });

    it('refuses a malformed tenant, and platform for a person, before looking anyone up', async () => {
      const malformed = await send({ ...reminder('sms', newPerson()), tenant: 'PSC Kenya' });
      const platform = await send({ ...reminder('sms', newPerson()), tenant: 'platform' });

      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ errors: [{ path: 'tenant' }] });
      expect(platform.statusCode).toBe(400);
      expect(platform.json()).toMatchObject({ errors: [{ path: 'tenant' }] });
      expect(directory.lookups).toHaveLength(0);
    });

    it('rejects a person id that is not a UUID', async () => {
      const response = await send(reminder('sms', 'OFR-0000417-4'));

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errors: [{ path: 'recipient.personId' }] });
    });

    describe('acknowledgement of a submitted declaration', () => {
      const acknowledgementParams = {
        reference: 'DCB-PSC-2027-0000001-1',
        type: 'biennial',
        version: 1,
        commissionName: 'Public Service Commission',
        statementDate: '2027-11-01',
        verificationCode: 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
        portalUrl: 'https://portal.adili.go.ke/declarations',
      };
      const acknowledgement = (channel: 'sms' | 'email', personId: string) => ({
        channel,
        recipient: { kind: 'person', personId },
        template: `acknowledgement-${channel}`,
        params: acknowledgementParams,
        tenant: 'psc',
      });

      it('emails the verified address a link to the slip, with no attachment', async () => {
        const personId = newPerson();
        directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

        const response = await send(acknowledgement('email', personId));

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
          channel: 'email',
          template: 'acknowledgement-email',
          status: 'sent',
          error: null,
        });
        expect(email.sent).toHaveLength(1);
        const sent = email.sent[0];
        expect(sent?.to).toBe('wanjiku@example.go.ke');
        expect(sent?.subject).toBe('Declaration DCB-PSC-2027-0000001-1 received');
        for (const value of [
          'DCB-PSC-2027-0000001-1',
          'biennial',
          'Public Service Commission',
          '1 November 2027',
          'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
          'https://portal.adili.go.ke/declarations',
        ]) {
          expect(sent?.text).toContain(value);
          expect(sent?.html).toContain(value);
        }
        expect(Object.keys(sent ?? {}).sort()).toEqual(['html', 'subject', 'text', 'to']);
        expect(directory.lookups).toEqual([{ personId, tenant: 'psc' }]);
      });

      it('texts the verified phone the reference and verification code', async () => {
        const personId = newPerson();
        directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

        const response = await send(acknowledgement('sms', personId));

        expect(response.json()).toMatchObject({
          template: 'acknowledgement-sms',
          status: 'sent',
        });
        expect(sms.sent).toEqual([
          {
            to: '+254712345678',
            text: 'Adili: declaration DCB-PSC-2027-0000001-1 received. Verification code ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K. Slip in Adili Online.',
          },
        ]);
      });

      it('rejects a reference with a wrong check character before looking anyone up', async () => {
        const response = await send({
          ...acknowledgement('sms', newPerson()),
          params: { ...acknowledgementParams, reference: 'DCB-PSC-2027-0000001-2' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ errors: [{ path: 'params.reference' }] });
        expect(directory.lookups).toHaveLength(0);
      });
    });

    describe('clarification issued and reminder', () => {
      const portalUrl =
        'https://portal.adili.go.ke/clarifications/0199a8f0-6666-7000-8000-000000000001';
      const issuedParams = {
        reference: 'CLR-PSC-2028-0000451-1',
        commissionName: 'Public Service Commission',
        dueDate: '2028-09-30',
        portalUrl,
      };
      const clarification = (
        notice: 'issued' | 'reminder',
        channel: 'sms' | 'email',
        personId: string,
      ) => ({
        channel,
        recipient: { kind: 'person', personId },
        template: `clarification-${notice}-${channel}`,
        params: notice === 'reminder' ? { ...issuedParams, daysLeft: 10 } : issuedParams,
        tenant: 'psc',
      });

      it.each([
        ['issued', 'Clarification request CLR-PSC-2028-0000451-1'],
        [
          'reminder',
          'Reminder: clarification request CLR-PSC-2028-0000451-1 is due on 30 September 2028',
        ],
      ] as const)(
        'emails the %s notice to the verified address, with no letter attached',
        async (notice, subject) => {
          const personId = newPerson();
          directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

          const response = await send(clarification(notice, 'email', personId));

          expect(response.statusCode).toBe(201);
          expect(response.json()).toMatchObject({
            channel: 'email',
            template: `clarification-${notice}-email`,
            status: 'sent',
            error: null,
          });
          expect(email.sent).toHaveLength(1);
          const sent = email.sent[0];
          expect(sent?.to).toBe('wanjiku@example.go.ke');
          expect(sent?.subject).toBe(subject);
          for (const value of [
            'CLR-PSC-2028-0000451-1',
            'Public Service Commission',
            '30 September 2028',
            portalUrl,
          ]) {
            expect(sent?.text).toContain(value);
            expect(sent?.html).toContain(value);
          }
          expect(Object.keys(sent ?? {}).sort()).toEqual(['html', 'subject', 'text', 'to']);
          expect(sms.sent).toHaveLength(0);
          expect(directory.lookups).toEqual([{ personId, tenant: 'psc' }]);
        },
      );

      it.each([
        [
          'issued',
          `Adili: Public Service Commission has sent you clarification request CLR-PSC-2028-0000451-1. Respond by 30 September 2028 at ${portalUrl}`,
        ],
        [
          'reminder',
          `Adili: clarification request CLR-PSC-2028-0000451-1 is due on 30 September 2028 (10 days). Respond at ${portalUrl}`,
        ],
      ] as const)('texts the %s notice to the verified phone', async (notice, text) => {
        const personId = newPerson();
        directory.set(personId, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });

        const response = await send(clarification(notice, 'sms', personId));

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
          template: `clarification-${notice}-sms`,
          status: 'sent',
        });
        expect(sms.sent).toEqual([{ to: '+254712345678', text }]);
        expect(email.sent).toHaveLength(0);
      });

      it('rejects a reminder without days left before looking anyone up', async () => {
        const response = await send({
          ...clarification('reminder', 'sms', newPerson()),
          params: issuedParams,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ errors: [{ path: 'params.daysLeft' }] });
        expect(directory.lookups).toHaveLength(0);
      });
    });
  });
});
