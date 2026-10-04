import { describe, expect, it } from 'vitest';

import { activeNavHref, navFor } from './nav';

const labels = (roles: string[]) =>
  navFor(roles).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navFor', () => {
  it('shows EACC staff Commissions and National obligations under Platform, and Referrals received under EACC', () => {
    for (const role of ['eacc-analyst', 'eacc-supervisor']) {
      expect(labels([role])).toEqual([
        ['Platform', ['Commissions', 'National obligations']],
        ['EACC', ['Compliance reports', 'Referrals received', 'Open data']],
      ]);
      expect(navFor([role])[1]?.items[1]?.to).toBe('/eacc/referrals');
    }
  });

  it('shows EACC staff the compliance reports intake under EACC (spec 09)', () => {
    expect(navFor(['eacc-analyst'])[1]?.items[0]?.to).toBe('/eacc/reports');
    expect(activeNavHref(navFor(['eacc-analyst']), '/eacc/reports/0199c100')).toBe('/eacc/reports');
    expect(activeNavHref(navFor(['eacc-analyst']), '/eacc/reports/ncr')).toBe('/eacc/reports');
  });

  it('marks Open data on a release page too (#350)', () => {
    const groups = navFor(['eacc-analyst']);
    expect(groups[1]?.items.map((item) => item.to)).toContain('/eacc/open-data');
    expect(activeNavHref(groups, '/eacc/open-data/0199c000-0000-7000-8000-000000000002')).toBe(
      '/eacc/open-data',
    );
  });

  it('adds Law enforcement, Integrations and AI policy under Platform for platform admins only (specs 10, 07b, 07c)', () => {
    expect(labels(['platform-admin'])).toEqual([
      [
        'Platform',
        ['Commissions', 'National obligations', 'Law enforcement', 'Integrations', 'AI policy'],
      ],
    ]);
    expect(navFor(['platform-admin'])[0]?.items.map((item) => item.to)).toEqual([
      '/commissions',
      '/obligations/national',
      '/platform/law-enforcement',
      '/platform/integrations',
      '/ai-policy',
    ]);
  });

  it('shows law enforcement officers their Requests under Law enforcement (spec 10)', () => {
    expect(labels(['law-enforcement'])).toEqual([['Law enforcement', ['Requests']]]);
    expect(navFor(['law-enforcement'])[0]?.items[0]?.to).toBe('/lea/requests');
  });

  it('shows the Roster and API access under Commission to reporting officers', () => {
    expect(labels(['reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations']],
      ['Reporting', ['Form M']],
    ]);
    expect(navFor(['reporting-officer'])[0]?.items.map((item) => item.to)).toEqual([
      '/roster',
      '/roster/api-access',
      '/obligations',
    ]);
  });

  it('shows commission admins the Roster but not API access, which they cannot open', () => {
    expect(labels(['commission-admin'])).toEqual([
      ['Commission', ['Roster', 'Obligations']],
      ['Reporting', ['Form M']],
    ]);
    expect(labels(['commission-admin', 'reporting-officer'])).toEqual([
      ['Commission', ['Roster', 'API access', 'Obligations']],
      ['Reporting', ['Form M']],
    ]);
  });

  it('shows reviewers Obligations, the review queue and Actions, leaving out what is not built yet', () => {
    expect(labels(['reviewer'])).toEqual([
      ['Commission', ['Obligations']],
      ['Review', ['Review queue', 'Actions', 'Referrals']],
    ]);
  });

  it('shows access officers and supervisors Access requests under Access (spec 10)', () => {
    expect(labels(['access-officer'])).toEqual([['Access', ['Access requests']]]);
    expect(labels(['supervisor'])).toEqual([
      ['Access', ['Access requests']],
      ['Commission', ['Obligations']],
      ['Review', ['Review queue', 'Approvals', 'Actions', 'Referrals']],
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
