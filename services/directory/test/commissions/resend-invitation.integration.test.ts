import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import {
  IdentityUnavailable,
  IdentityUserNotFound,
} from '../../src/identity/identity-provisioning.js';
import { componentSchema, contractErrors } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import {
  ACTIVATION,
  givenActivated,
  givenOfficer,
  givenTsc,
  officerOf,
  PLATFORM_ADMIN,
  type Problem,
} from '../support/reporting-officers.js';

/** Spec 01 scenario S12: resending the reporting officer's activation email over HTTP. */
const OFFICER = {
  name: 'Fatuma Wanjiru',
  email: 'fatuma.wanjiru@tsc.go.ke',
  phone: '+254712345678',
};

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenTsc(api);
});

const resend = ({
  caller = PLATFORM_ADMIN,
  slug = 'tsc',
}: { caller?: Caller; slug?: string } = {}) =>
  api.post(`/v1/commissions/${slug}/reporting-officer/resend-invitation`, undefined, caller, {
    idempotencyKey: null,
  });

const emails = () => api.identity.calls('sendActivationEmail');

const expectProblem = (
  response: Awaited<ReturnType<typeof resend>>,
  status: number,
  type: string,
) => {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = response.json<Problem>();
  expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
  expect(problem.type).toBe(type);
};

describe('S12 resend', () => {
  it('sends one more activation email to an invited officer (202)', async () => {
    const { userId } = await givenOfficer(api, OFFICER);
    const before = await officerOf(api);

    const response = await resend();

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
    expect(emails()).toEqual([
      { operation: 'sendActivationEmail', userId, options: ACTIVATION },
      { operation: 'sendActivationEmail', userId, options: ACTIVATION },
    ]);
    expect(await officerOf(api)).toEqual(before);
  });

  it('records no event: nothing changed state', async () => {
    await givenOfficer(api, OFFICER);
    const events = (await api.db.select().from(outbox)).length;

    await resend();
    await resend();

    expect((await api.db.select().from(outbox)).length).toBe(events);
    expect(emails()).toHaveLength(3);
  });

  it('refuses an activated officer (409) without sending an email', async () => {
    const { assignmentId } = await givenOfficer(api, OFFICER);
    await givenActivated(api, assignmentId);

    const response = await resend();

    expectProblem(response, 409, 'reporting-officer-activated');
    expect(emails()).toHaveLength(1);
  });

  it('sends to the new officer after a replacement', async () => {
    await givenOfficer(api, OFFICER);
    const second = await givenOfficer(api, { ...OFFICER, email: 'brian.otieno@tsc.go.ke' });

    expect((await resend()).statusCode).toBe(202);

    expect(emails().at(-1)?.userId).toBe(second.userId);
  });
});

describe('S12 refusals and failures', () => {
  it('answers 404 when the Commission has no reporting officer', async () => {
    expectProblem(await resend(), 404, 'reporting-officer-not-assigned');
    expect(api.identity.calls()).toEqual([]);
  });

  it('answers 404 for a Commission that does not exist', async () => {
    const response = await resend({ slug: 'nope' });

    expect(response.statusCode).toBe(404);
    expect(api.identity.calls()).toEqual([]);
  });

  it('answers 502 when the identity provider fails, and can be retried', async () => {
    await givenOfficer(api, OFFICER);
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('Keycloak timed out'));

    const failed = await resend();

    expectProblem(failed, 502, 'identity-unavailable');
    expect(failed.json<Problem>().detail).not.toContain('timed out');
    expect((await resend()).statusCode).toBe(202);
  });

  it('answers 409 when the officer account no longer exists in Keycloak', async () => {
    const { userId } = await givenOfficer(api, OFFICER);
    api.identity.failNext('sendActivationEmail', new IdentityUserNotFound(userId));

    expectProblem(await resend(), 409, 'reporting-officer-account-missing');
  });

  it.each([
    ['eacc-supervisor', { tenant: 'eacc', roles: ['eacc-supervisor'] }],
    ['a reporting officer of the tenant', { tenant: 'tsc', roles: ['reporting-officer'] }],
    ['a token without roles', { tenant: 'platform', roles: [] }],
  ])('refuses %s (403)', async (_who, caller: Caller) => {
    await givenOfficer(api, OFFICER);

    const response = await resend({ caller });

    expect(response.statusCode).toBe(403);
    expect(emails()).toHaveLength(1);
  });
});
