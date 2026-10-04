import { describe, expect, it } from 'vitest';

import { opensOwnPolicy, readsCommissionPolicy, workspaceFor, workspacesFor } from './workspaces';

const ids = (roles: string[]) => workspacesFor(roles).map((workspace) => workspace.id);

describe('workspacesFor', () => {
  it('gives reviewers the review queue and obligations', () => {
    expect(ids(['reviewer', 'default-roles-adili'])).toEqual(['review', 'obligations']);
  });

  it('gives supervisors review, approvals, access requests, obligations and Form M, once each', () => {
    expect(ids(['supervisor', 'reviewer'])).toEqual([
      'review',
      'approvals',
      'access',
      'obligations',
      'form-m',
    ]);
  });

  it('opens Form M to its supervisor and commission-admin, read-only to the reporting officer (spec 09)', () => {
    expect(workspaceFor(['supervisor'], 'form-m')).toMatchObject({
      href: '/form-m',
      readOnly: false,
    });
    expect(workspaceFor(['commission-admin'], 'form-m')?.readOnly).toBe(false);
    expect(workspaceFor(['reporting-officer'], 'form-m')?.readOnly).toBe(true);
    for (const roles of [['reviewer'], ['access-officer'], ['eacc-analyst'], ['platform-admin']]) {
      expect(workspaceFor(roles, 'form-m')).toBeUndefined();
    }
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
    expect(workspaceFor(['auditor'], 'audit')).toMatchObject({ readOnly: false });
    expect(workspaceFor(['auditor'], 'audit')?.href).toBeUndefined();
  });

  it('opens Approvals for supervisors only (spec 08)', () => {
    expect(workspaceFor(['supervisor'], 'approvals')).toMatchObject({
      href: '/approvals',
      readOnly: false,
    });
    expect(workspaceFor(['reviewer'], 'approvals')).toBeUndefined();
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

describe('Access requests workspace (spec 10)', () => {
  it('opens for the access officer, who acts', () => {
    expect(workspaceFor(['access-officer'], 'access')).toEqual({
      id: 'access',
      title: 'Access requests',
      description: 'Decide Form K and law enforcement requests for declarations.',
      href: '/access/requests',
      readOnly: false,
    });
  });

  it('opens read-only for the supervisor', () => {
    expect(workspaceFor(['supervisor'], 'access')).toEqual({
      id: 'access',
      title: 'Access requests',
      description:
        'Form K and law enforcement requests for declarations and where each one stands.',
      href: '/access/requests',
      readOnly: true,
    });
  });

  it.each([
    'reviewer',
    'commission-admin',
    'reporting-officer',
    'eacc-analyst',
    'eacc-supervisor',
    'platform-admin',
    'declarant',
  ])('stays closed for %s', (role) => {
    expect(workspaceFor([role], 'access')).toBeUndefined();
  });
});

describe('Law enforcement requests workspace (spec 10 FE-6)', () => {
  it('opens for law enforcement officers, and only them', () => {
    expect(workspacesFor(['law-enforcement'])).toEqual([
      {
        id: 'lea',
        title: 'Law enforcement requests',
        description:
          'Send written requests for declarations to Commissions and download what is granted.',
        href: '/lea/requests',
        readOnly: false,
      },
    ]);
    for (const role of ['access-officer', 'supervisor', 'platform-admin', 'eacc-analyst']) {
      expect(workspaceFor([role], 'lea'), role).toBeUndefined();
    }
  });
});

describe('Platform settings workspace (spec 10 FE-6)', () => {
  it("opens law-enforcement accounts for platform admins, and nobody else's", () => {
    expect(workspaceFor(['platform-admin'], 'platform')).toMatchObject({
      href: '/platform/law-enforcement',
      readOnly: false,
    });
    for (const role of ['eacc-analyst', 'eacc-supervisor', 'access-officer', 'law-enforcement']) {
      expect(workspaceFor([role], 'platform'), role).toBeUndefined();
    }
  });
});

describe("the Obligations workspace's policy page (spec 04 access table)", () => {
  it('opens for commission admins, who change the start date', () => {
    expect(opensOwnPolicy(['commission-admin'])).toBe(true);
    expect(opensOwnPolicy(['reviewer', 'commission-admin'])).toBe(true);
  });

  it.each(['reporting-officer', 'reviewer', 'supervisor', 'platform-admin', 'eacc-analyst'])(
    'stays closed for %s',
    (role) => {
      expect(opensOwnPolicy([role])).toBe(false);
    },
  );
});

describe("the policy card on a Commission's page (spec 04 FE-4)", () => {
  it("is the platform admin's", () => {
    expect(readsCommissionPolicy(['platform-admin'])).toBe(true);
  });

  it.each(['eacc-analyst', 'eacc-supervisor', 'commission-admin', 'reporting-officer'])(
    'is not for %s',
    (role) => {
      expect(readsCommissionPolicy([role])).toBe(false);
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

describe('S16 AI policy workspace', () => {
  it('opens for platform admins', () => {
    expect(workspaceFor(['platform-admin'], 'ai-policy')).toMatchObject({
      href: '/ai-policy',
      readOnly: false,
    });
  });

  it.each([
    'eacc-analyst',
    'eacc-supervisor',
    'commission-admin',
    'supervisor',
    'reviewer',
    'reporting-officer',
    'auditor',
  ])('stays closed for %s', (role) => {
    expect(workspaceFor([role], 'ai-policy')).toBeUndefined();
  });
});
