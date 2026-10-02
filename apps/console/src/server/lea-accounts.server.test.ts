import { describe, expect, it } from 'vitest';

import { createDirectoryClient, type LeaOfficerAccount } from './directory/client';
import {
  countOfficers,
  loadAgencies,
  loadAgencyOfficers,
  provisionOfficer,
  revokeOfficer,
} from './lea-accounts.server';

const AGENCIES = [
  { code: 'DCI', name: 'Directorate of Criminal Investigations', legalBasis: 'NPS Act, s.35' },
  { code: 'ARA', name: 'Asset Recovery Agency', legalBasis: 'POCAMLA, s.53' },
];

function officer(state: LeaOfficerAccount['state'], name = 'Insp. Jane Mwangi'): LeaOfficerAccount {
  return {
    id: crypto.randomUUID(),
    agencyCode: 'DCI',
    name,
    email: 'j.mwangi@dci.go.ke',
    phone: '+254712345678',
    state,
    invitedAt: '2026-09-01T07:00:00.000Z',
    activatedAt: state === 'invited' ? null : '2026-09-02T07:00:00.000Z',
    revokedAt: state === 'revoked' ? '2026-09-20T07:00:00.000Z' : null,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

function directory(respond: (request: Request) => Response) {
  const requests: Request[] = [];
  const client = createDirectoryClient({
    baseUrl: 'http://directory.test',
    accessToken: 't',
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Promise.resolve(respond(request));
    },
  });
  return { client, requests };
}

describe('law enforcement accounts (S11)', () => {
  it('lists the agencies with their officers counted by state', async () => {
    const { client } = directory((request) => {
      const path = new URL(request.url).pathname;
      if (path === '/v1/law-enforcement/agencies') return json(200, AGENCIES);
      if (path.endsWith('/DCI/officers')) {
        return json(200, [
          officer('activated'),
          officer('activated'),
          officer('invited'),
          officer('revoked'),
        ]);
      }
      return json(503, { type: 'about:blank', title: 'Down', status: 503 });
    });
    const result = await loadAgencies(client);
    expect(result).toEqual({
      ok: true,
      data: [
        { ...AGENCIES[0], counts: { activated: 2, invited: 1, revoked: 1 } },
        // Its officers could not be read: counts unknown, the agency still listed.
        { ...AGENCIES[1], counts: null },
      ],
    });
  });

  it('gives one agency with its officers, or 404 for a code that is not one', async () => {
    const { client } = directory((request) =>
      new URL(request.url).pathname === '/v1/law-enforcement/agencies'
        ? json(200, AGENCIES)
        : json(200, [officer('invited')]),
    );
    const found = await loadAgencyOfficers(client, 'DCI');
    expect(found.ok && found.data.agency.code).toBe('DCI');
    expect(found.ok && found.data.agencies).toHaveLength(2);
    const missing = await loadAgencyOfficers(client, 'XYZ');
    expect(missing).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('provisions with the Idempotency-Key, and revokes', async () => {
    const { client, requests } = directory((request) =>
      json(new URL(request.url).pathname.endsWith('/revoke') ? 200 : 201, officer('invited')),
    );
    const body = { name: 'Insp. Jane Mwangi', email: 'j.mwangi@dci.go.ke', phone: '+254712345678' };
    expect((await provisionOfficer(client, 'DCI', body, 'key-1')).ok).toBe(true);
    expect(requests[0]?.headers.get('idempotency-key')).toBe('key-1');
    expect(await requests[0]?.json()).toEqual(body);
    expect((await revokeOfficer(client, 'o-1')).ok).toBe(true);
    expect(new URL(requests[1]?.url ?? '').pathname).toBe(
      '/v1/law-enforcement/officers/o-1/revoke',
    );
  });

  it('counts officers by state', () => {
    expect(countOfficers([officer('invited'), officer('revoked')])).toEqual({
      invited: 1,
      activated: 0,
      revoked: 1,
    });
  });
});
