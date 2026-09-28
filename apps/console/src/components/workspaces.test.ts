import { describe, expect, it } from 'vitest';

import { workspaceFor, workspacesFor } from './workspaces';

const ids = (roles: string[]) => workspacesFor(roles).map((workspace) => workspace.id);

describe('workspacesFor', () => {
  it('gives reviewers the review queue and obligations', () => {
    expect(ids(['reviewer', 'default-roles-adili'])).toEqual(['review', 'obligations']);
  });

  it('gives supervisors review, approvals and obligations, once each', () => {
    expect(ids(['supervisor', 'reviewer'])).toEqual(['review', 'approvals', 'obligations']);
  });

  it('gives EACC analysts Commissions, national obligations and compliance reports but not the review queue', () => {
    expect(ids(['eacc-analyst'])).toEqual(['commissions', 'national-obligations', 'compliance']);
  });

  it('gives declarants nothing in the console', () => {
    expect(ids(['declarant'])).toEqual([]);
  });
});

describe('S18 Commissions workspace', () => {
  it('opens for platform admins with write access', () => {
    expect(workspaceFor(['platform-admin'], 'commissions')).toEqual({
      id: 'commissions',
      title: 'Commissions',
      description: 'Create Responsible Commissions and assign their reporting officers.',
      href: '/commissions',
      readOnly: false,
    });
  });

  it.each(['eacc-analyst', 'eacc-supervisor'])('opens read-only for %s', (role) => {
    expect(workspaceFor([role], 'commissions')).toMatchObject({
      href: '/commissions',
      readOnly: true,
      description: 'Responsible Commissions, their reporting officers and roster coverage.',
    });
  });

  it.each([
    'reviewer',
    'supervisor',
    'reporting-officer',
    'commission-admin',
    'access-officer',
    'auditor',
    'helpdesk',
    'declarant',
  ])('stays closed for %s', (role) => {
    expect(workspaceFor([role], 'commissions')).toBeUndefined();
  });

  it('keeps write access when a platform admin also holds an EACC role', () => {
    expect(workspaceFor(['eacc-analyst', 'platform-admin'], 'commissions')?.readOnly).toBe(false);
  });

  it('leaves workspaces that are not built yet without a link', () => {
    expect(workspaceFor(['reviewer'], 'review')).toMatchObject({ readOnly: false });
    expect(workspaceFor(['reviewer'], 'review')?.href).toBeUndefined();
  });
});

describe('Roster workspace', () => {
  it('opens for reporting officers with write access', () => {
    expect(workspaceFor(['reporting-officer'], 'roster')).toEqual({
      id: 'roster',
      title: 'Declarant roster',
      description:
        "Import and maintain your Commission's roster and help officers who cannot onboard.",
      href: '/roster',
      readOnly: false,
    });
  });

  it('opens read-only for commission admins', () => {
    expect(workspaceFor(['commission-admin'], 'roster')).toMatchObject({
      href: '/roster',
      readOnly: true,
      description: "Your Commission's roster and import history.",
    });
  });

  it.each([
    'platform-admin',
    'eacc-analyst',
    'eacc-supervisor',
    'reviewer',
    'supervisor',
    'access-officer',
    'auditor',
    'helpdesk',
    'declarant',
  ])('stays closed for %s', (role) => {
    expect(workspaceFor([role], 'roster')).toBeUndefined();
  });
});

describe('Obligations workspace', () => {
  it.each(['reporting-officer', 'reviewer', 'supervisor', 'commission-admin'])(
    'opens for %s',
    (role) => {
      expect(workspaceFor([role], 'obligations')).toEqual({
        id: 'obligations',
        title: 'Obligations',
        description: 'Who must declare, by when, and who has been reminded.',
        href: '/obligations',
        readOnly: false,
      });
    },
  );

  it.each(['platform-admin', 'eacc-analyst', 'eacc-supervisor', 'access-officer', 'declarant'])(
    'stays closed for %s, who reach counts through the Commission',
    (role) => {
      expect(workspaceFor([role], 'obligations')).toBeUndefined();
    },
  );
});

describe('S16 National obligations workspace', () => {
  it.each(['platform-admin', 'eacc-analyst', 'eacc-supervisor'])('opens for %s', (role) => {
    expect(workspaceFor([role], 'national-obligations')).toEqual({
      id: 'national-obligations',
      title: 'National obligations',
      description: 'Due and overdue counts per Commission.',
      href: '/obligations/national',
      readOnly: false,
    });
  });

  it.each(['reporting-officer', 'reviewer', 'supervisor', 'commission-admin', 'declarant'])(
    'stays closed for %s',
    (role) => {
      expect(workspaceFor([role], 'national-obligations')).toBeUndefined();
    },
  );
});
