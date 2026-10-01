import { beforeEach, describe, expect, it } from 'vitest';

import {
  mockAiGatewayClient,
  mockAiGatewayFetch,
  mockTenantAiStatus,
  mockToken,
  resetAiGatewayMock,
} from './ai-gateway/mock.server';
import {
  loadAiPolicyOverview,
  loadTenantUsage,
  saveGatePolicy,
  saveTenantBudget,
} from './ai-policy.server';
import { createDirectoryClient } from './directory/client';

const admin = () => mockAiGatewayClient('Amina Wanjiru', ['platform-admin']);

const COMMISSIONS = [
  { slug: 'demo', name: 'Demo Commission' },
  { slug: 'jsc', name: 'Judicial Service Commission' },
  { slug: 'psc', name: 'Public Service Commission' },
  { slug: 'tsc', name: 'Teachers Service Commission' },
];

/** A directory answering `GET /v1/commissions` in pages of `pageSize`, recording the cursors. */
function directory(pageSize = 200, status = 200) {
  const cursors: (string | null)[] = [];
  const client = createDirectoryClient({
    baseUrl: 'http://directory.test',
    accessToken: 'token',
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (status !== 200) {
        return Promise.resolve(
          new Response(JSON.stringify({ type: 'about:blank', title: 'Down', status }), {
            status,
            headers: { 'content-type': 'application/problem+json' },
          }),
        );
      }
      const cursor = url.searchParams.get('cursor');
      cursors.push(cursor);
      const start = cursor ? Number(cursor) : 0;
      const items = COMMISSIONS.slice(start, start + pageSize).map((each) => ({
        ...each,
        id: '0199a0b4-0000-7000-8000-000000000001',
        issuerCode: each.slug.toUpperCase(),
        type: 'hosted',
        categories: [],
        status: 'active',
        policyVersion: 1,
        reportingOfficer: null,
        roster: {},
        createdAt: '2026-08-01T00:00:00Z',
      }));
      const next = start + pageSize < COMMISSIONS.length ? String(start + pageSize) : null;
      return Promise.resolve(
        new Response(JSON.stringify({ items, nextCursor: next, total: COMMISSIONS.length }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  return { client, cursors };
}

beforeEach(() => {
  resetAiGatewayMock();
});

describe('S16 loadAiPolicyOverview', () => {
  it("joins the directory's Commissions with their gate and this month's usage", async () => {
    const result = await loadAiPolicyOverview(admin(), directory().client);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { tenants, routing } = result.data;
    expect(tenants.map((tenant) => tenant.name)).toEqual(COMMISSIONS.map((each) => each.name));
    const psc = tenants.find((tenant) => tenant.slug === 'psc');
    expect(psc?.rules).toEqual([
      expect.objectContaining({
        dataClass: 'synthetic',
        providerClass: 'external',
        allowed: true,
        approvalRef: 'EACC/AI/2026/014',
      }),
    ]);
    expect(psc?.usage).toMatchObject({ monthlyTokens: 3_000_000, tokensUsed: 1_926_400 });
    // No policy at the gateway: blocked by default.
    expect(tenants.find((tenant) => tenant.slug === 'tsc')?.rules).toEqual([]);
    expect(routing.ok && routing.data.map((route) => route.task)).toContain('explain-flags');
  });

  it('follows the cursor to the last directory page', async () => {
    const { client, cursors } = directory(3);
    const result = await loadAiPolicyOverview(admin(), client);
    expect(result.ok && result.data.tenants).toHaveLength(4);
    expect(cursors).toEqual([null, '3']);
  });

  it('keeps routing parameters as plain values', async () => {
    const result = await loadAiPolicyOverview(admin(), directory().client);
    if (!result.ok || !result.data.routing.ok) throw new Error('not ok');
    expect(result.data.routing.data[0]?.params).toEqual({
      temperature: 0,
      maxTokens: 4_000,
      timeoutMs: 60_000,
    });
  });

  it("is the gateway's 403 for anyone but a platform admin", async () => {
    const result = await loadAiPolicyOverview(
      mockAiGatewayClient('Esther Chebet', ['eacc-analyst']),
      directory().client,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('fails when the directory does not answer', async () => {
    const result = await loadAiPolicyOverview(admin(), directory(200, 503).client);
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('S16 saveGatePolicy', () => {
  it('allows external providers on synthetic data with the approval reference, audited by name', async () => {
    const result = await saveGatePolicy(
      admin(),
      'tsc',
      [{ dataClass: 'synthetic', providerClass: 'external', allowed: true }],
      'EACC/AI/2026/022',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.rules).toEqual([
      expect.objectContaining({
        dataClass: 'synthetic',
        providerClass: 'external',
        allowed: true,
        approvalRef: 'EACC/AI/2026/022',
        changedBy: 'Amina Wanjiru',
      }),
    ]);
    // The Commission's own status line follows.
    expect(mockTenantAiStatus('tsc')).toEqual({
      enabled: true,
      providerClass: 'external',
      dataClasses: ['synthetic'],
    });
  });

  it('saves every changed cell, in order, with one reference', async () => {
    const result = await saveGatePolicy(
      admin(),
      'psc',
      [
        { dataClass: 'synthetic', providerClass: 'external', allowed: false },
        { dataClass: 'restricted', providerClass: 'self-hosted', allowed: true },
      ],
      'EACC/AI/2026/030',
    );
    if (!result.ok) throw new Error('not ok');
    expect(
      result.data.rules.map((rule) => [rule.dataClass, rule.allowed, rule.approvalRef]),
    ).toEqual([
      ['synthetic', false, 'EACC/AI/2026/030'],
      ['restricted', true, 'EACC/AI/2026/030'],
    ]);
    expect(mockTenantAiStatus('psc')).toEqual({
      enabled: true,
      providerClass: 'self-hosted',
      dataClasses: ['restricted'],
    });
  });

  it('is a 400 without an approval reference, and nothing is saved', async () => {
    const result = await saveGatePolicy(
      admin(),
      'tsc',
      [{ dataClass: 'synthetic', providerClass: 'external', allowed: true }],
      ' ',
    );
    expect(result).toMatchObject({
      ok: false,
      saved: 0,
      error: { kind: 'problem', problem: { status: 400 } },
    });
    expect(mockTenantAiStatus('tsc').enabled).toBe(false);
  });

  it('is a 403 for anyone but a platform admin', async () => {
    const result = await saveGatePolicy(
      mockAiGatewayClient('Daniel Kiprop', ['commission-admin']),
      'psc',
      [{ dataClass: 'synthetic', providerClass: 'external', allowed: false }],
      'EACC/AI/2026/030',
    );
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 403 } } });
    expect(mockTenantAiStatus('psc').enabled).toBe(true);
  });
});

describe('S16 tenant budget', () => {
  it('sets the monthly tokens and the per-minute limit', async () => {
    const result = await saveTenantBudget(admin(), 'jsc', {
      monthlyTokens: 2_000_000,
      perMinute: 90,
    });
    expect(result).toMatchObject({ ok: true, data: { monthlyTokens: 2_000_000, perMinute: 90 } });
    const read = await loadTenantUsage(admin(), 'jsc');
    expect(read).toMatchObject({
      ok: true,
      data: { monthlyTokens: 2_000_000, tokensUsed: 862_300 },
    });
  });

  it('is a 400 for a limit under 1 a minute', async () => {
    const result = await saveTenantBudget(admin(), 'jsc', { monthlyTokens: 0, perMinute: 0 });
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 400 } } });
  });
});

describe('mock tokens', () => {
  it('reads the realm roles from a Keycloak-shaped token', async () => {
    const response = await mockAiGatewayFetch(
      new Request('http://ai-gateway.test/v1/ai/routing', {
        headers: { authorization: `Bearer ${mockToken('Amina Wanjiru', ['platform-admin'])}` },
      }),
    );
    expect(response.status).toBe(200);
  });
});
