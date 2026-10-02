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
  removeTenantRoute,
  saveGatePolicy,
  saveRoute,
  saveTenantBudget,
} from './ai-policy.server';
import { createDirectoryClient } from './directory/client';

const admin = () => mockAiGatewayClient('Amina Wanjiru', ['platform-admin']);

const COMMISSIONS = [
  { slug: 'demo', name: 'Demo Commission' },
  { slug: 'jsc', name: 'Judicial Service Commission' },
  { slug: 'psc', name: 'Public Service Commission' },
  { slug: 'tsc', name: 'Teachers Service Commission' },
  // Unknown to the gateway: no rules, no budget, no jobs.
  { slug: 'nacada', name: 'National Authority for the Campaign Against Alcohol' },
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
    expect(psc?.gate[0]).toEqual({
      dataClass: 'synthetic',
      providerClass: 'external',
      allowed: true,
      rule: expect.objectContaining({ approvalRef: 'EACC/AI/2026/014' }) as unknown,
    });
    expect(psc?.routed).toEqual(['external']);
    expect(psc?.usage).toMatchObject({ monthlyTokens: 3_000_000, tokensUsed: 1_926_400 });
    expect(tenants.find((tenant) => tenant.slug === 'tsc')?.gate[0]).toMatchObject({
      allowed: false,
      rule: { approvalRef: 'TSC resolution 12/2026' },
    });
    // Unknown to the gateway: the default gate and budget, nothing used.
    const nacada = tenants.find((tenant) => tenant.slug === 'nacada');
    expect(
      nacada?.gate.map((cell) => [cell.dataClass, cell.providerClass, cell.allowed, cell.rule]),
    ).toEqual([
      ['synthetic', 'external', false, null],
      ['synthetic', 'self-hosted', true, null],
      ['restricted', 'external', false, null],
      ['restricted', 'self-hosted', true, null],
      ['highly-confidential', 'external', false, null],
      ['highly-confidential', 'self-hosted', true, null],
    ]);
    expect(nacada?.usage).toMatchObject({
      tenant: 'nacada',
      monthlyTokens: 1_000_000,
      perMinute: 60,
      tokensUsed: 0,
      jobs: 0,
    });
    expect(routing.ok && routing.data.map((route) => route.task)).toContain('explain-flags');
  });

  it('follows the cursor to the last directory page', async () => {
    const { client, cursors } = directory(3);
    const result = await loadAiPolicyOverview(admin(), client);
    expect(result.ok && result.data.tenants).toHaveLength(5);
    expect(cursors).toEqual([null, '3']);
  });

  it('keeps routing parameters as plain values', async () => {
    const result = await loadAiPolicyOverview(admin(), directory().client);
    if (!result.ok || !result.data.routing.ok) throw new Error('not ok');
    expect(result.data.routing.data[0]?.params).toEqual({
      maxOutputTokens: 4_000,
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
  it('allows external providers with the approval reference, audited by name', async () => {
    expect(mockTenantAiStatus('tsc').enabled).toBe(false);
    const result = await saveGatePolicy(
      admin(),
      'tsc',
      [
        { dataClass: 'synthetic', providerClass: 'external', allowed: true },
        { dataClass: 'highly-confidential', providerClass: 'external', allowed: true },
      ],
      'EACC/AI/2026/022',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.rules).toEqual([
      expect.objectContaining({
        dataClass: 'synthetic',
        providerClass: 'external',
        allowed: true,
        approvalRef: 'EACC/AI/2026/022',
        changedByName: 'Amina Wanjiru',
      }),
      expect.objectContaining({ dataClass: 'highly-confidential', allowed: true }),
    ]);
    // The Commission's own status line follows: TSC's declarations are highly confidential.
    expect(mockTenantAiStatus('tsc')).toEqual({
      enabled: true,
      providerClass: 'external',
      provider: 'anthropic',
      dataClasses: ['synthetic', 'highly-confidential'],
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
    // Nothing is routed to a self-hosted provider, so PSC's synthetic data has nowhere to go.
    expect(mockTenantAiStatus('psc')).toEqual({
      enabled: false,
      providerClass: 'external',
      provider: 'anthropic',
      dataClasses: [],
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
      error: { kind: 'problem', problem: { status: 400 } },
    });
    expect(mockTenantAiStatus('tsc').enabled).toBe(false);
  });

  it('stores none of the changes when one is invalid', async () => {
    const result = await saveGatePolicy(
      admin(),
      'psc',
      [
        { dataClass: 'synthetic', providerClass: 'external', allowed: false },
        { dataClass: 'synthetic', providerClass: 'external', allowed: true },
      ],
      'EACC/AI/2026/031',
    );
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 400 } } });
    expect(mockTenantAiStatus('psc').dataClasses).toEqual(['synthetic']);
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
    const read = await admin().GET('/v1/ai/tenants/{tenant}/usage', {
      params: { path: { tenant: 'jsc' } },
    });
    expect(read.data).toMatchObject({ monthlyTokens: 2_000_000, tokensUsed: 862_300 });
  });

  it('is a 400 for a limit under 1 a minute', async () => {
    const result = await saveTenantBudget(admin(), 'jsc', { monthlyTokens: 0, perMinute: 0 });
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 400 } } });
  });
});

describe('S2 routing changes', () => {
  const route = {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    params: { maxOutputTokens: 2_000 },
    approvalRef: 'EACC/AI/2026/040',
  };

  it('routes a task for every Commission and for one, and removes the one', async () => {
    const all = await saveRoute(admin(), null, 'explain-flags', route);
    expect(all).toMatchObject({ ok: true, data: { tenant: null, model: 'claude-sonnet-5' } });
    const one = await saveRoute(admin(), 'jsc', 'explain-flags', route);
    expect(one).toMatchObject({ ok: true, data: { tenant: 'jsc', providerClass: 'external' } });

    const listed = await admin().GET('/v1/ai/routing');
    expect(listed.data).toContainEqual(
      expect.objectContaining({ tenant: 'jsc', task: 'explain-flags' }),
    );

    expect(await removeTenantRoute(admin(), 'jsc', 'explain-flags', 'EACC/AI/2026/041')).toEqual({
      ok: true,
      data: null,
    });
    const again = await removeTenantRoute(admin(), 'jsc', 'explain-flags', 'EACC/AI/2026/041');
    expect(again).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('is a 400 for a provider the gateway cannot reach', async () => {
    const result = await saveRoute(admin(), null, 'explain-flags', { ...route, provider: 'other' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
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
