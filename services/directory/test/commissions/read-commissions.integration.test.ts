import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedDemoCommissions } from '../../src/commissions/demo-seed.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/** Spec 01 scenarios S14-S16: reading Commissions over HTTP against a real Postgres. */
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };
const EACC_ANALYST: Caller = { tenant: 'eacc', roles: ['eacc-analyst'] };
const EACC_SUPERVISOR: Caller = { tenant: 'eacc', roles: ['eacc-supervisor'] };
const PSC_REVIEWER: Caller = { tenant: 'psc', roles: ['reviewer'] };
const HELPDESK: Caller = { tenant: 'platform', roles: ['helpdesk'] };
const DECLARANT: Caller = { tenant: 'psc', roles: ['declarant'] };

interface Page {
  items: { slug: string; name: string; reportingOfficer: { state: string } | null }[];
  nextCursor: string | null;
  total: number;
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    {
      slug: 'psc',
      name: 'Public Service Commission',
      categories: ['act-s32-5', 'regs-r5-e', 'regs-r5-f'],
      officer: { state: 'activated', name: 'Grace Wanjiku' },
    },
    {
      slug: 'tsc',
      name: 'Teachers Service Commission',
      categories: ['act-s32-10'],
      officer: { state: 'invited' },
    },
    { slug: 'kdf', name: 'Defence Council', type: 'federated', categories: ['act-s32-11'] },
  ]);
});

async function list(caller: Caller, query = ''): Promise<Page> {
  const response = await api.get(`/v1/commissions${query}`, caller);
  expect(response.statusCode).toBe(200);
  return response.json<Page>();
}

const slugs = (page: Page) => page.items.map((item) => item.slug);

describe('S14 visibility', () => {
  it.each([
    ['platform-admin', PLATFORM_ADMIN],
    ['eacc-analyst', EACC_ANALYST],
    ['eacc-supervisor', EACC_SUPERVISOR],
  ])('lists every Commission, by name, for %s', async (_role, caller) => {
    const page = await list(caller);

    expect(slugs(page)).toEqual(['kdf', 'psc', 'tsc']);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
  });

  it('lists only their own Commission for a reviewer of psc', async () => {
    const page = await list(PSC_REVIEWER);

    expect(slugs(page)).toEqual(['psc']);
    expect(page.total).toBe(1);
    expect(page.items[0]?.reportingOfficer?.state).toBe('activated');
  });

  it('lets a reviewer of psc read psc', async () => {
    const response = await api.get('/v1/commissions/psc', PSC_REVIEWER);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: 'psc' });
  });

  it("answers 404, not 403, when a reviewer of psc asks for another tenant's Commission", async () => {
    const other = await api.get('/v1/commissions/tsc', PSC_REVIEWER);
    const missing = await api.get('/v1/commissions/nope', PLATFORM_ADMIN);

    expect(other.statusCode).toBe(404);
    expect(other.headers['content-type']).toContain('application/problem+json');
    expect(missing.statusCode).toBe(404);
  });

  it('shows nothing to staff whose token tenant is platform but who are not national readers', async () => {
    expect(slugs(await list(HELPDESK))).toEqual([]);
    expect((await api.get('/v1/commissions/psc', HELPDESK)).statusCode).toBe(404);
  });

  it('refuses declarants and role-less tokens with 403', async () => {
    for (const caller of [DECLARANT, { tenant: 'psc', roles: [] }]) {
      expect((await api.get('/v1/commissions', caller)).statusCode).toBe(403);
      expect((await api.get('/v1/commissions/psc', caller)).statusCode).toBe(403);
    }
  });
});

describe('S15 filters and pagination', () => {
  it('searches name and key case-insensitively', async () => {
    expect(slugs(await list(PLATFORM_ADMIN, '?search=teach'))).toEqual(['tsc']);
    expect(slugs(await list(PLATFORM_ADMIN, '?search=KDF'))).toEqual(['kdf']);
    expect(slugs(await list(PLATFORM_ADMIN, '?search=%25'))).toEqual([]);
  });

  it('filters by type', async () => {
    const page = await list(PLATFORM_ADMIN, '?type=federated');

    expect(slugs(page)).toEqual(['kdf']);
    expect(page.total).toBe(1);
  });

  it('filters by reporting officer state, with none meaning not assigned', async () => {
    expect(slugs(await list(PLATFORM_ADMIN, '?reportingOfficer=invited'))).toEqual(['tsc']);
    expect(slugs(await list(PLATFORM_ADMIN, '?reportingOfficer=activated'))).toEqual(['psc']);
    expect(slugs(await list(PLATFORM_ADMIN, '?reportingOfficer=none'))).toEqual(['kdf']);
  });

  it('combines filters', async () => {
    expect(slugs(await list(PLATFORM_ADMIN, '?search=commission&type=hosted'))).toEqual([
      'psc',
      'tsc',
    ]);
  });

  it('walks every Commission once with limit=1 and the returned cursors', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await list(PLATFORM_ADMIN, query);
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
      seen.push(...slugs(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(['kdf', 'psc', 'tsc']);
  });

  it('rejects an unknown cursor and invalid filters with 400 problem details', async () => {
    const cursor = await api.get('/v1/commissions?cursor=bm90LWEtY3Vyc29y', PLATFORM_ADMIN);
    const type = await api.get('/v1/commissions?type=other&limit=0', PLATFORM_ADMIN);

    expect(cursor.statusCode).toBe(400);
    expect(cursor.json()).toMatchObject({ errors: [{ path: 'cursor' }] });
    expect(type.statusCode).toBe(400);
    expect(type.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual([
      'type',
      'limit',
    ]);
  });
});

describe('S16 officer categories', () => {
  it('returns all 19 statutory categories in stable order to any staff member', async () => {
    const response = await api.get('/v1/reference/officer-categories', PSC_REVIEWER);

    expect(response.statusCode).toBe(200);
    const categories = response.json<{ code: string; citation: string; description: string }[]>();
    expect(categories.map((category) => category.code)).toEqual([
      ...Array.from({ length: 13 }, (_, index) => `act-s32-${index + 2}`),
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((paragraph) => `regs-r5-${paragraph}`),
    ]);
    expect(categories[8]).toEqual({
      code: 'act-s32-10',
      citation: 'Act s.32(10)',
      description: 'Registered teachers',
    });
    expect(categories.every((category) => category.description.length > 0)).toBe(true);
    expect(
      contractErrors(okResponse('/v1/reference/officer-categories', 'get'), categories),
    ).toEqual([]);
  });

  it('refuses declarants', async () => {
    expect((await api.get('/v1/reference/officer-categories', DECLARANT)).statusCode).toBe(403);
  });
});

describe('response shapes', () => {
  it('matches the contract for a Commission with categories and an activated officer', async () => {
    const response = await api.get('/v1/commissions/psc', PLATFORM_ADMIN);
    const body = response.json<unknown>();

    expect(contractErrors(componentSchema('Commission'), body)).toEqual([]);
    expect(body).toMatchObject({
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
      type: 'hosted',
      status: 'active',
      policyVersion: 1,
      categories: [
        { code: 'act-s32-5', citation: 'Act s.32(5)' },
        { code: 'regs-r5-e', citation: 'Regs r.5(e)' },
        { code: 'regs-r5-f', citation: 'Regs r.5(f)' },
      ],
      reportingOfficer: {
        name: 'Grace Wanjiku',
        email: 'officer@psc.go.ke',
        phone: '+254712345678',
        state: 'activated',
        invitedAt: '2026-09-20T09:00:00.000Z',
        activatedAt: '2026-09-21T10:30:00.000Z',
      },
      roster: { status: 'none', expectedDeclarants: 0, onboardedDeclarants: 0 },
    });
  });

  it('matches the contract for the list page, including Commissions without an officer', async () => {
    const response = await api.get('/v1/commissions', EACC_ANALYST);

    expect(contractErrors(okResponse('/v1/commissions', 'get'), response.json())).toEqual([]);
    expect(response.json<Page>().items[0]).toMatchObject({ slug: 'kdf', reportingOfficer: null });
  });
});

describe('demo seed', () => {
  it('creates psc and eacc with policy version 1 and can run again', async () => {
    await api.reset();

    await seedDemoCommissions(api.db);
    await seedDemoCommissions(api.db);

    const page = await list(PLATFORM_ADMIN);
    expect(page.items.map((item) => [item.slug, item.name])).toEqual([
      ['eacc', 'Ethics and Anti-Corruption Commission'],
      ['psc', 'Public Service Commission'],
    ]);
    const psc = (await api.get('/v1/commissions/psc', PSC_REVIEWER)).json<{
      policyVersion: number;
      categories: { code: string }[];
    }>();
    expect(psc.policyVersion).toBe(1);
    expect(psc.categories.map((category) => category.code)).toEqual([
      'act-s32-5',
      'regs-r5-e',
      'regs-r5-f',
    ]);
  });
});
