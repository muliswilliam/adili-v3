import type { Principal } from '@adili/api-kit';
import { describe, expect, it } from 'vitest';

import { recordsReadContext } from '../../src/roster/records/access.js';

/**
 * Who reads roster records, decided in the service (decision 16): the `platform` RLS context of
 * national readers would let EACC through, so the policy itself must refuse them.
 */
function principal(tenant: string, roles: string[], scopes: string[] = []): Principal {
  return { subject: 'sub-1', tenant, roles, scopes, clientId: null, name: null, issuedAt: null };
}

function refusal(caller: Principal, slug: string): number | undefined {
  try {
    recordsReadContext(caller, slug);
    return undefined;
  } catch (error) {
    return (error as { getStatus(): number }).getStatus();
  }
}

describe('recordsReadContext', () => {
  it.each([
    ['reporting-officer', ['reporting-officer']],
    ['commission-admin', ['commission-admin']],
  ])("gives a %s their own Commission's records in its context", (_role, roles) => {
    expect(recordsReadContext(principal('psc', roles), 'psc')).toEqual({
      tenant: 'psc',
      subject: 'sub-1',
    });
  });

  it("hides another Commission's records (404)", () => {
    expect(refusal(principal('psc', ['reporting-officer']), 'tsc')).toBe(404);
  });

  it('gives a platform admin every Commission in the platform context', () => {
    expect(recordsReadContext(principal('platform', ['platform-admin']), 'tsc')).toEqual({
      tenant: 'platform',
      subject: 'sub-1',
    });
  });

  it.each([['eacc-analyst'], ['eacc-supervisor']])(
    'refuses %s (403) although they see every Commission',
    (role) => {
      expect(refusal(principal('eacc', [role]), 'psc')).toBe(403);
    },
  );

  it('refuses an HR system with roster:write (403)', () => {
    expect(refusal(principal('psc', [], ['roster:write']), 'psc')).toBe(403);
  });

  it('refuses other staff of the Commission (403)', () => {
    expect(refusal(principal('psc', ['reviewer']), 'psc')).toBe(403);
  });
});
