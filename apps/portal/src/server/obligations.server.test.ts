import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';

import { mockDeclarationsFetch } from './declarations/mock.server';
import type { paths } from './declarations/schema.gen';
import { asDeclarant, loadMyObligations, loadObligation } from './obligations.server';

/** An unsigned token carrying just the claims the mock reads. */
function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.`;
}

function client(
  accessToken: string,
  send: (request: Request) => Promise<Response> = mockDeclarationsFetch,
) {
  return createClient<paths>({
    baseUrl: 'http://declarations.test',
    headers: { authorization: `Bearer ${accessToken}` },
    fetch: send,
  });
}

const declarant = token({
  preferred_username: 'declarant',
  person_id: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
  realm_access: { roles: ['declarant'] },
});
const twoCommissions = token({
  preferred_username: 'OFR-0000417-4',
  person_id: '8d7f3a90-2b1c-4e5d-a6f7-9081a2b3c4d5',
  realm_access: { roles: ['declarant'] },
});
const reviewer = token({ preferred_username: 'reviewer', realm_access: { roles: ['reviewer'] } });

const failing = () =>
  Promise.resolve(
    new Response(JSON.stringify({ type: 'about:blank', title: 'Boom', status: 500 }), {
      status: 500,
      headers: { 'content-type': 'application/problem+json' },
    }),
  );
const unreachable = () => Promise.reject(new TypeError('fetch failed'));

describe('loadMyObligations', () => {
  // S14: a person with records at two Commissions gets two groups.
  it('returns the obligations grouped by Commission', async () => {
    const result = await loadMyObligations(client(twoCommissions));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.groups.map((group) => group.commission.slug)).toEqual(['psc', 'npsc']);
    expect(result.groups[0]?.obligations[0]).toMatchObject({
      type: 'final',
      status: 'overdue',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    });
  });

  it('returns one group for a declarant at one Commission', async () => {
    const result = await loadMyObligations(client(declarant));

    expect(result.status === 'ok' && result.groups.map((group) => group.commission.slug)).toEqual([
      'tsc',
    ]);
  });

  // S14: a token without a person_id is not a declarant's.
  it('reports not-declarant when the service answers 404', async () => {
    expect(await loadMyObligations(client(reviewer))).toEqual({ status: 'not-declarant' });
  });

  it('reports unavailable when the service fails or cannot be reached', async () => {
    expect(await loadMyObligations(client(declarant, failing))).toEqual({
      status: 'unavailable',
    });
    expect(await loadMyObligations(client(declarant, unreachable))).toEqual({
      status: 'unavailable',
    });
  });
});

describe('loadObligation', () => {
  // S17: one obligation with its reminder history.
  it('returns an obligation of the caller with its reminders', async () => {
    const mine = await loadMyObligations(client(twoCommissions));
    const final = mine.status === 'ok' ? mine.groups[0]?.obligations[0] : undefined;
    if (!final) throw new Error('no obligation in the fixtures');

    const result = await loadObligation(client(twoCommissions), final.id);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.obligation.id).toBe(final.id);
    expect(result.obligation.reminders.map((reminder) => reminder.outcome)).toEqual([
      'sent',
      'failed',
    ]);
  });

  // S17: another person's obligation is not found.
  it('reports not-found for an obligation of another person', async () => {
    const mine = await loadMyObligations(client(twoCommissions));
    const theirs = mine.status === 'ok' ? mine.groups[0]?.obligations[0] : undefined;
    if (!theirs) throw new Error('no obligation in the fixtures');

    expect(await loadObligation(client(declarant), theirs.id)).toEqual({ status: 'not-found' });
  });

  it('reports unavailable when the service fails or cannot be reached', async () => {
    const id = '0192f1a0-0000-7000-8000-000000000000';
    expect(await loadObligation(client(declarant, failing), id)).toEqual({
      status: 'unavailable',
    });
    expect(await loadObligation(client(declarant, unreachable), id)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('asDeclarant', () => {
  it('answers unauthenticated without calling the service when there is no session', async () => {
    const send = vi.fn(mockDeclarationsFetch);
    const work = vi.fn(loadMyObligations);

    const result = await asDeclarant(null, (accessToken) => client(accessToken, send), work);

    expect(result).toEqual({ status: 'unauthenticated' });
    expect(work).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('calls the service as the session user', async () => {
    const result = await asDeclarant({ accessToken: declarant }, client, loadMyObligations);

    expect(result.status).toBe('ok');
  });
});
