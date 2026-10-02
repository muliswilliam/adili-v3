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
      ['Platform', ['Commissions', 'National obligations', 'Agency accounts']],
    ]);
    expect(navFor(['platform-admin'])[0]?.items.map((item) => item.to)).toEqual([
      '/commissions',
      '/obligations/national',
      '/platform/law-enforcement',
    ]);
  });

  it('shows law enforcement officers their Requests under Law enforcement (spec 10)', () => {
    expect(labels(['law-enforcement'])).toEqual([['Law enforcement', ['Requests']]]);
    expect(navFor(['law-enforcement'])[0]?.items[0]?.to).toBe('/lea/requests');
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

  it('shows reviewers Obligations only, leaving out what is not built yet', () => {
    expect(labels(['reviewer'])).toEqual([['Commission', ['Obligations']]]);
  });

  it('shows access officers and supervisors Access requests under Access (spec 10)', () => {
    expect(labels(['access-officer'])).toEqual([['Access', ['Access requests']]]);
    expect(labels(['supervisor'])).toEqual([
      ['Access', ['Access requests']],
      ['Commission', ['Obligations']],
    ]);
    expect(navFor(['access-officer'])[0]?.items[0]?.to).toBe('/access/requests');
  });
});

describe('activeNavHref', () => {
  const groups = navFor(['reporting-officer', 'platform-admin', 'access-officer']);

  it.each([
    ['/roster', '/roster'],
    ['/roster/records', '/roster'],
    ['/roster/api-access', '/roster/api-access'],
    ['/obligations', '/obligations'],
    ['/obligations/policy', '/obligations'],
    ['/obligations/national', '/obligations/national'],
    ['/commissions/psc', '/commissions'],
    ['/access/requests/0190f3a2-0000-7000-8000-000000000001', '/access/requests'],
    ['/access/certified-copies', '/access/requests'],
    ['/access/certified-copies/new', '/access/requests'],
    ['/platform/law-enforcement/DCI', '/platform/law-enforcement'],
    ['/access/lea-requests/0190f3a2-0000-7000-8000-000000000001', '/access/requests'],
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
