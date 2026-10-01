import { describe, expect, it } from 'vitest';

import { activeNavHref, initials, navFor } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows Commissions and National obligations under Platform to platform admins and EACC staff', () => {
    for (const role of ['eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([['Platform', ['Commissions', 'National obligations']]]);
    }
    expect(labels(['platform-admin'])).toEqual([
      ['Platform', ['Commissions', 'National obligations', 'Integrations']],
    ]);
    expect(navFor(['platform-admin'])[0]?.items.map((item) => item.to)).toEqual([
      '/commissions',
      '/obligations/national',
      '/platform/integrations',
    ]);
  });

  it('shows the Roster and API access under Commission to reporting officers', () => {
    expect(labels(['reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations']],
    ]);
    expect(navFor(['reporting-officer'])[0]?.items.map((item) => item.to)).toEqual([
      '/roster',
      '/roster/api-access',
      '/obligations',
    ]);
  });

  it('shows commission admins the Roster but not API access, which they cannot open', () => {
    expect(labels(['commission-admin'])).toEqual([['Commission', ['Roster', 'Obligations']]]);
    expect(labels(['commission-admin', 'reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations']],
    ]);
  });

  it('shows reviewers and supervisors Obligations only, leaving out what is not built yet', () => {
    expect(labels(['reviewer', 'supervisor', 'access-officer'])).toEqual([
      ['Commission', ['Obligations']],
    ]);
    expect(navFor(['access-officer'])).toEqual([]);
  });
});

describe('activeNavHref', () => {
  const groups = navFor(['reporting-officer', 'platform-admin']);

  it.each([
    ['/roster', '/roster'],
    ['/roster/records', '/roster'],
    ['/roster/api-access', '/roster/api-access'],
    ['/obligations', '/obligations'],
    ['/obligations/policy', '/obligations'],
    ['/obligations/national', '/obligations/national'],
    ['/commissions/psc', '/commissions'],
    ['/platform/integrations', '/platform/integrations'],
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
