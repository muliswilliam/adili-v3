import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * The Commission's AI status line (spec 07c S14, S16) at the review service's seam: the
 * ai-gateway's tenant status (a fake), read by the Commission's admin only. `psc`
 * sends its cases as synthetic data (AI_SYNTHETIC_DATA_TENANTS) and has the demo seed's rule
 * letting the external provider see them; `tsc` sends highly confidential data and has no rule.
 */
describe('Commission AI status', () => {
  let api: ReviewApi;

  const pscAdmin: Caller = { sub: 'admin-p', tenant: 'psc', roles: ['commission-admin'] };
  const pscSupervisor: Caller = { sub: 'supervisor-p', tenant: 'psc', roles: ['supervisor'] };
  const tscAdmin: Caller = { sub: 'admin-t', tenant: 'tsc', roles: ['commission-admin'] };
  const pscReviewer: Caller = { sub: 'reviewer-p', tenant: 'psc', roles: ['reviewer'] };
  const platformAdmin: Caller = {
    sub: 'platform-1',
    tenant: 'platform',
    roles: ['platform-admin'],
  };

  const path = (slug: string) => `/v1/commissions/${slug}/ai-status`;
  const SCHEMA = okResponse('/v1/commissions/{slug}/ai-status', 'get');

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(() => {
    api.ai.reset();
  });

  it('is enabled for the commission admin when the gate admits their data class', async () => {
    const response = await api.get(path('psc'), pscAdmin);

    expect(response.statusCode).toBe(200);
    expect(contractErrors(SCHEMA, response.json())).toEqual([]);
    expect(response.json()).toEqual({
      enabled: true,
      providerClass: 'external',
      provider: 'anthropic',
      dataClasses: ['synthetic'],
    });
  });

  it('is not enabled where the gate keeps the Commission’s data class from the routed provider', async () => {
    // The gateway's default: external providers see no data class without a rule.
    const response = await api.get(path('tsc'), tscAdmin);

    expect(response.json()).toEqual({
      enabled: false,
      providerClass: 'external',
      dataClasses: [],
    });

    // A rule for a data class other than the Commission's does not enable its copilot.
    api.ai.givenTenantStatus('tsc', {
      enabled: true,
      providerClass: 'external',
      provider: 'anthropic',
      dataClasses: ['synthetic'],
    });
    expect((await api.get(path('tsc'), tscAdmin)).json()).toMatchObject({ enabled: false });

    api.ai.givenTenantStatus('tsc', {
      enabled: true,
      providerClass: 'self-hosted',
      provider: 'local',
      dataClasses: ['synthetic', 'restricted', 'highly-confidential'],
    });
    expect((await api.get(path('tsc'), tscAdmin)).json()).toMatchObject({
      enabled: true,
      providerClass: 'self-hosted',
    });
  });

  it('reads as missing for anyone else, other Commissions included', async () => {
    for (const [caller, slug] of [
      [tscAdmin, 'psc'],
      [pscReviewer, 'psc'],
      [pscSupervisor, 'psc'],
      [platformAdmin, 'psc'],
      [pscAdmin, 'tsc'],
    ] as const) {
      expect((await api.get(path(slug), caller)).statusCode, `${caller.sub} ${slug}`).toBe(404);
    }
  });

  it('answers 503 when the ai-gateway cannot be reached, as every copilot endpoint does', async () => {
    api.ai.failCalls(1);

    const response = await api.get(path('psc'), pscAdmin);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      type: expect.stringContaining('ai-gateway-unavailable') as string,
      status: 503,
    });
  });
});
