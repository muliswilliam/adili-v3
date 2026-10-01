import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';

import { loadDeclarantAccount } from './declarant.server';
import { mockDirectoryFetch } from './directory/mock.server';
import type { paths } from './directory/schema.gen';
import type { DeclarantProfile } from './directory/types';

/** An unsigned token carrying just the claims the mock reads. */
function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.`;
}

function client(
  accessToken: string,
  send: (request: Request) => Promise<Response> = mockDirectoryFetch,
) {
  return createClient<paths>({
    baseUrl: 'http://directory.test',
    headers: { authorization: `Bearer ${accessToken}` },
    fetch: send,
  });
}

const declarant = token({
  preferred_username: 'declarant',
  realm_access: { roles: ['declarant'] },
});

describe('loadDeclarantAccount', () => {
  it('returns the Commission, OFR and onboarded date, with contacts masked', async () => {
    const result = await loadDeclarantAccount(client(declarant));

    expect(result).toEqual({
      status: 'onboarded',
      account: {
        fullName: 'Mwangi Njoroge Kamau',
        ofr: 'OFR-0000312-7',
        commissions: [
          { slug: 'tsc', name: 'Teachers Service Commission', onboardedAt: '2026-09-26T07:42:00Z' },
        ],
        maskedEmail: 'm***@tsc.go.ke',
        maskedPhone: '07** *** 789',
      },
    });
    // The full contacts stay on the server.
    expect(JSON.stringify(result)).not.toContain('mwangi.kamau');
    expect(JSON.stringify(result)).not.toContain('712345789');
  });

  it('lists every Commission a declarant onboarded at', async () => {
    const result = await loadDeclarantAccount(
      client(
        token({ preferred_username: 'OFR-0000417-4', realm_access: { roles: ['declarant'] } }),
      ),
    );

    expect(result.status === 'onboarded' && result.account.commissions).toEqual([
      { slug: 'psc', name: 'Public Service Commission', onboardedAt: '2026-03-12T09:15:00Z' },
      {
        slug: 'npsc',
        name: 'National Police Service Commission',
        onboardedAt: '2026-09-26T10:05:00Z',
      },
    ]);
  });

  it('leaves out Commissions the declarant has exited', async () => {
    const profile: DeclarantProfile = {
      personId: '5b0c8f7e-3f5d-4d59-9a53-0d6c1f0b2a11',
      ofr: 'OFR-0000312-7',
      fullName: 'Mwangi Njoroge Kamau',
      contacts: { email: null, phone: null },
      commissions: [
        {
          slug: 'psc',
          name: 'Public Service Commission',
          personnelFileNumber: 'PSC/1',
          rosterRecordId: '3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f',
          state: 'exited',
          onboardedAt: '2025-01-10T09:00:00Z',
        },
        {
          slug: 'tsc',
          name: 'Teachers Service Commission',
          personnelFileNumber: 'TSC/999999',
          rosterRecordId: '0f8e1c52-6a7b-4c3d-8e9f-1a2b3c4d5e6f',
          state: 'onboarded',
          onboardedAt: '2026-09-26T07:42:00Z',
        },
      ],
    };
    const send = () =>
      Promise.resolve(
        new Response(JSON.stringify(profile), {
          headers: { 'content-type': 'application/json' },
        }),
      );

    const result = await loadDeclarantAccount(client(declarant, send));

    expect(result.status === 'onboarded' && result.account).toMatchObject({
      commissions: [{ slug: 'tsc' }],
      maskedEmail: null,
      maskedPhone: null,
    });
  });

  it('reports not-declarant when the directory answers 403 (no declarant role) or 404 (no person)', async () => {
    const reviewer = token({
      preferred_username: 'reviewer',
      realm_access: { roles: ['reviewer'] },
    });
    const noPerson = () =>
      Promise.resolve(
        new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        }),
      );

    expect(await loadDeclarantAccount(client(reviewer))).toEqual({ status: 'not-declarant' });
    expect(await loadDeclarantAccount(client(declarant, noPerson))).toEqual({
      status: 'not-declarant',
    });
  });

  it('reports unavailable when the directory fails or cannot be reached', async () => {
    const failing = () =>
      Promise.resolve(
        new Response(JSON.stringify({ title: 'Boom', status: 500 }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
      );
    const unreachable = () => Promise.reject(new TypeError('fetch failed'));

    expect(await loadDeclarantAccount(client(declarant, failing))).toEqual({
      status: 'unavailable',
    });
    expect(await loadDeclarantAccount(client(declarant, unreachable))).toEqual({
      status: 'unavailable',
    });
  });
});
