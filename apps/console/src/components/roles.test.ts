import { describe, expect, it } from 'vitest';

import { organisationOf } from './organisation';
import { platformRoles, roleLabel, seniorRoleLabel } from './roles';

describe('seniorRoleLabel', () => {
  it('names the most senior console role and ignores the rest', () => {
    expect(seniorRoleLabel(['default-roles-adili', 'platform-admin'])).toBe(
      'Platform administrator',
    );
    expect(seniorRoleLabel(['reviewer', 'supervisor'])).toBe('Supervisor');
    expect(seniorRoleLabel(['declarant'])).toBeNull();
  });
});

describe('roleLabel', () => {
  it.each([
    ['reporting-officer', 'Reporting officer'],
    ['platform-admin', 'Platform administrator'],
    ['eacc-analyst', 'EACC analyst'],
    ['commission-admin', 'Commission administrator'],
    ['reviewer', 'Reviewer'],
  ])('%s reads "%s"', (role, label) => {
    expect(roleLabel(role)).toBe(label);
  });

  it('turns an unknown role into sentence case rather than showing its slug', () => {
    expect(roleLabel('records-clerk')).toBe('Records clerk');
    expect(roleLabel('new_role')).toBe('New role');
  });
});

describe('platformRoles', () => {
  it("hides Keycloak's built-in roles", () => {
    expect(
      platformRoles(['default-roles-adili', 'offline_access', 'uma_authorization', 'reviewer']),
    ).toEqual(['reviewer']);
  });
});

describe('organisationOf (spec 01 story 28)', () => {
  it('names the Commission when the directory returned it', () => {
    expect(organisationOf('psc', 'Public Service Commission')).toEqual({
      kind: 'commission',
      key: 'psc',
      name: 'Public Service Commission',
    });
  });

  it('falls back to the tenant key when the lookup failed', () => {
    expect(organisationOf('psc', null)).toEqual({ kind: 'key-only', key: 'psc' });
  });

  it('shows platform staff as the platform team, not a Commission', () => {
    expect(organisationOf('platform', null)).toEqual({ kind: 'platform', key: 'platform' });
  });

  it('says so when the account has no tenant', () => {
    expect(organisationOf(null, null)).toEqual({ kind: 'none' });
  });
});
