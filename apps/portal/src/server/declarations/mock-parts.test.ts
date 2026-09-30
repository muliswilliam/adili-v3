import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { listDeclarations, startDeclaration } from '../declarations.server';
import { loadMyObligations } from '../obligations.server';
import { declarationsMock, MOCK_OBLIGATIONS, resetDeclarationsMock } from './mock.server';
import type { paths } from './schema.gen';
import type { Obligation } from './types';

/** An unsigned token carrying just the claims the mock reads. */
function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.`;
}

const accessToken = token({
  preferred_username: 'declarant',
  person_id: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
  realm_access: { roles: ['declarant'] },
});

/** An obligation only the real service knows. */
const REAL: Obligation = {
  id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7eff',
  commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  type: 'initial',
  cycleKey: 'initial:2026-09-02',
  statementDate: '2026-09-02',
  dueDate: '2026-10-02',
  status: 'due',
  cancelReason: null,
  remindersSent: 0,
  policyVersion: 1,
  createdAt: '2026-09-02T06:00:00Z',
};

/** The real declarations service: knows REAL, and records what reached it. */
function realService() {
  const seen: string[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    seen.push(`${request.method} ${path} ${request.headers.get('authorization') ?? ''}`);
    if (request.method === 'GET' && path === `/v1/obligations/${REAL.id}`) {
      return Promise.resolve(Response.json({ ...REAL, reminders: [], declarant: null }));
    }
    if (request.method === 'GET' && path === '/v1/me/obligations') {
      return Promise.resolve(
        Response.json({ groups: [{ commission: REAL.commission, obligations: [REAL] }] }),
      );
    }
    return Promise.resolve(Response.json({ status: 404 }, { status: 404 }));
  };
  return { seen, fetch };
}

function client(send: (request: Request, init?: RequestInit) => Promise<Response>) {
  return createClient<paths>({
    baseUrl: 'http://declarations.test',
    headers: { authorization: `Bearer ${accessToken}` },
    fetch: send,
  });
}

beforeEach(() => {
  resetDeclarationsMock();
});

describe('declarationsMock (OBLIGATIONS_MOCK, DECLARATIONS_MOCK)', () => {
  it('starts a mocked draft for a real obligation, the obligations from the real service', async () => {
    const real = realService();
    const api = client(declarationsMock({ obligations: false, declarations: true }, real.fetch));

    const obligations = await loadMyObligations(api);
    const started = await startDeclaration(api, REAL.id);
    const listed = await listDeclarations(api);

    expect(obligations).toMatchObject({
      status: 'ok',
      groups: [{ obligations: [{ id: REAL.id }] }],
    });
    expect(started).toMatchObject({
      status: 'started',
      created: true,
      declaration: { obligationId: REAL.id, type: 'initial', commission: { slug: 'psc' } },
    });
    expect(listed).toMatchObject({ status: 'ok', declarations: [{ obligationId: REAL.id }] });
    // The real service answered the obligation reads, with the caller's token; never the drafts.
    expect(real.seen).toEqual([
      `GET /v1/me/obligations Bearer ${accessToken}`,
      `GET /v1/obligations/${REAL.id} Bearer ${accessToken}`,
    ]);
  });

  it('answers 404 to a start for an obligation the real service does not show', async () => {
    const api = client(
      declarationsMock({ obligations: false, declarations: true }, realService().fetch),
    );

    expect(await startDeclaration(api, MOCK_OBLIGATIONS.biennial)).toEqual({ status: 'not-found' });
  });

  it('sends the drafts to the real service when only the obligations are mocked', async () => {
    const real = realService();
    const api = client(declarationsMock({ obligations: true, declarations: false }, real.fetch));

    const obligations = await loadMyObligations(api);
    await listDeclarations(api);

    expect(obligations.status).toBe('ok');
    expect(real.seen).toEqual([`GET /v1/me/declarations Bearer ${accessToken}`]);
  });
});
