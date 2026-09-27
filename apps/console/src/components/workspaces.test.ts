import { describe, expect, it } from 'vitest';

import { workspaceFor, workspacesFor } from './workspaces';

const ids = (roles: string[]) => workspacesFor(roles).map((workspace) => workspace.id);

describe('workspacesFor', () => {
  it('gives reviewers the review queue only', () => {
    expect(ids(['reviewer', 'default-roles-adili'])).toEqual(['review']);
  });

  it('gives supervisors review and approvals, once each', () => {
    expect(ids(['supervisor', 'reviewer'])).toEqual(['review', 'approvals']);
  });

  it('gives EACC analysts Commissions and compliance reports but not the review queue', () => {
    expect(ids(['eacc-analyst'])).toEqual(['commissions', 'compliance']);
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
