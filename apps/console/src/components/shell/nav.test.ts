import { describe, expect, it } from 'vitest';

import { activeNavHref, initials, navFor } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows Commissions under Platform to platform admins and EACC staff', () => {
    for (const role of ['platform-admin', 'eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([['Platform', ['Commissions']]]);
    }
    expect(navFor(['platform-admin'])[0]?.items[0]?.to).toBe('/commissions');
  });

  it('shows the Roster and API access under Commission to reporting officers', () => {
    expect(labels(['reporting-officer'])).toEqual([['Commission', ['Roster', 'API access']]]);
    expect(navFor(['reporting-officer'])[0]?.items.map((item) => item.to)).toEqual([
      '/roster',
      '/roster/api-access',
    ]);
  });

  it('shows commission admins the Roster but not API access, which they cannot open', () => {
    expect(labels(['commission-admin'])).toEqual([['Commission', ['Roster']]]);
    expect(labels(['commission-admin', 'reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access']],
    ]);
  });

  it('leaves out destinations that are not built yet', () => {
    expect(navFor(['reviewer', 'supervisor', 'access-officer'])).toEqual([]);
  });
});

describe('activeNavHref', () => {
  const groups = navFor(['reporting-officer', 'platform-admin']);

  it.each([
    ['/roster', '/roster'],
    ['/roster/records', '/roster'],
    ['/roster/api-access', '/roster/api-access'],
    ['/commissions/psc', '/commissions'],
    ['/rosters', null],
    ['/', null],
  ])('marks %s under %s', (pathname, expected) => {
    expect(activeNavHref(groups, pathname)).toBe(expected);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two names', () => {
    expect(initials('Juma Omondi')).toBe('JO');
    expect(initials('  amina  ')).toBe('A');
    expect(initials('Dr. Paul Odhiambo')).toBe('DP');
  });
});
