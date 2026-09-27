import { describe, expect, it } from 'vitest';

import { initials, navFor } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows Commissions under Platform to platform admins and EACC staff', () => {
    for (const role of ['platform-admin', 'eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([['Platform', ['Commissions']]]);
    }
    expect(navFor(['platform-admin'])[0]?.items[0]?.to).toBe('/commissions');
  });

  it('shows the Roster under Commission to reporting officers and commission admins', () => {
    for (const role of ['reporting-officer', 'commission-admin']) {
      expect(labels([role])).toEqual([['Commission', ['Roster']]]);
    }
    expect(navFor(['reporting-officer'])[0]?.items[0]?.to).toBe('/roster');
  });

  it('leaves out destinations that are not built yet', () => {
    expect(navFor(['reviewer', 'supervisor', 'access-officer'])).toEqual([]);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two names', () => {
    expect(initials('Juma Omondi')).toBe('JO');
    expect(initials('  amina  ')).toBe('A');
    expect(initials('Dr. Paul Odhiambo')).toBe('DP');
  });
});
