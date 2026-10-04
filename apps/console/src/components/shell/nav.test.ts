import { describe, expect, it } from 'vitest';

import { activeNavHref, navFor } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows Commissions and National obligations under Platform to platform admins and EACC staff', () => {
    for (const role of ['eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([['Platform', ['Commissions', 'National obligations']]]);
    }
  });

  it('adds Law enforcement, Integrations, AI policy and Help articles under Platform for platform admins only (specs 10, 07b, 07c, 11)', () => {
    expect(labels(['platform-admin'])).toEqual([
      [
        'Platform',
        [
          'Commissions',
          'National obligations',
          'Law enforcement',
          'Integrations',
          'AI policy',
          'Help articles',
        ],
      ],
    ]);
    expect(navFor(['platform-admin'])[0]?.items.map((item) => item.to)).toEqual([
      '/commissions',
      '/obligations/national',
      '/platform/law-enforcement',
      '/platform/integrations',
      '/ai-policy',
      '/help',
    ]);
  });

  it('shows law enforcement officers their Requests under Law enforcement (spec 10)', () => {
    expect(labels(['law-enforcement'])).toEqual([['Law enforcement', ['Requests']]]);
    expect(navFor(['law-enforcement'])[0]?.items[0]?.to).toBe('/lea/requests');
  });

  it('shows the Roster, API access and Help articles under Commission to reporting officers', () => {
    expect(labels(['reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations', 'Help articles']],
      ['Reporting', ['Form M']],
    ]);
    expect(navFor(['reporting-officer'])[0]?.items.map((item) => item.to)).toEqual([
      '/roster',
      '/roster/api-access',
      '/obligations',
      '/help',
    ]);
  });

  it('lists Help articles once for a platform admin who also holds a Commission role (spec 11)', () => {
    const groups = navFor(['platform-admin', 'commission-admin']);
    const help = groups.flatMap((group) => group.items).filter((item) => item.to === '/help');
    expect(help).toHaveLength(1);
    expect(groups[0]?.items.at(-1)?.to).toBe('/help');
  });

  it('shows commission admins the Roster but not API access, which they cannot open', () => {
    expect(labels(['commission-admin'])).toEqual([
      ['Commission', ['Roster', 'Obligations', 'Help articles']],
      ['Reporting', ['Form M']],
    ]);
    expect(labels(['commission-admin', 'reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations', 'Help articles']],
      ['Reporting', ['Form M']],
    ]);
  });

  it('shows reviewers Obligations, the review queue and Actions, leaving out what is not built yet', () => {
    expect(labels(['reviewer'])).toEqual([
      ['Commission', ['Obligations']],
      ['Review', ['Review queue', 'Actions']],
    ]);
  });

  it('shows access officers and supervisors Access requests under Access (spec 10)', () => {
    expect(labels(['access-officer'])).toEqual([['Access', ['Access requests']]]);
    expect(labels(['supervisor'])).toEqual([
      ['Access', ['Access requests']],
      ['Commission', ['Obligations']],
      ['Review', ['Review queue', 'Approvals', 'Actions']],
      ['Reporting', ['Form M']],
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
    ['/form-m', '/form-m'],
    ['/commissions/psc', '/commissions'],
    ['/platform/integrations', '/platform/integrations'],
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

  it('marks a review case under the review queue', () => {
    const review = navFor(['reviewer']);
    expect(activeNavHref(review, '/review')).toBe('/review');
    expect(activeNavHref(review, '/review/cases/ca5e0000-0000-4000-8000-000000000001')).toBe(
      '/review',
    );
  });
});
