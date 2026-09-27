import { describe, expect, it } from 'vitest';

import { initials, navFor, roleLabel } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows Commissions under Platform to platform admins and EACC staff', () => {
    for (const role of ['platform-admin', 'eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([['Platform', ['Commissions']]]);
    }
    expect(navFor(['platform-admin'])[0]?.items[0]?.to).toBe('/commissions');
  });

  it('leaves out destinations that are not built yet', () => {
    expect(navFor(['reviewer', 'supervisor', 'reporting-officer'])).toEqual([]);
  });
});

describe('roleLabel', () => {
  it('names the most senior console role and ignores Keycloak defaults', () => {
    expect(roleLabel(['default-roles-adili', 'platform-admin'])).toBe('Platform administrator');
    expect(roleLabel(['reviewer', 'supervisor'])).toBe('Supervisor');
    expect(roleLabel(['declarant'])).toBeNull();
  });
});

describe('initials', () => {
  it('takes the first letter of the first two names', () => {
    expect(initials('Juma Omondi')).toBe('JO');
    expect(initials('  amina  ')).toBe('A');
    expect(initials('Dr. Paul Odhiambo')).toBe('DP');
  });
});
