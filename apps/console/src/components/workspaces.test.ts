import { describe, expect, it } from 'vitest';

import { workspaceAccess, workspacesFor } from './workspaces';

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

  // S18
  it('gives the Commissions workspace to platform admins and EACC staff only', () => {
    const allRoles = [
      'declarant',
      'reviewer',
      'supervisor',
      'access-officer',
      'reporting-officer',
      'commission-admin',
      'eacc-analyst',
      'eacc-supervisor',
      'auditor',
      'helpdesk',
      'platform-admin',
    ];
    const withCommissions = allRoles.filter((role) => ids([role]).includes('commissions'));
    expect(withCommissions).toEqual(['eacc-analyst', 'eacc-supervisor', 'platform-admin']);
  });

  it('links the Commissions workspace and describes it by access', () => {
    const [admin] = workspacesFor(['platform-admin']);
    const [analyst] = workspacesFor(['eacc-analyst']);
    expect(admin?.href).toBe('/commissions');
    expect(admin?.description).toBe(
      'Create Responsible Commissions and assign their reporting officers.',
    );
    expect(analyst?.description).toBe(
      'Responsible Commissions, their reporting officers and roster coverage.',
    );
  });
});

describe('workspaceAccess', () => {
  it('gives platform admins write access and EACC staff read access to Commissions', () => {
    expect(workspaceAccess('commissions', ['platform-admin'])).toBe('write');
    expect(workspaceAccess('commissions', ['eacc-analyst'])).toBe('read');
    expect(workspaceAccess('commissions', ['eacc-supervisor', 'eacc-analyst'])).toBe('read');
    expect(workspaceAccess('commissions', ['reviewer'])).toBeNull();
  });

  it('treats workspaces without write roles as writable by everyone who can open them', () => {
    expect(workspaceAccess('review', ['reviewer'])).toBe('write');
  });

  it('only takes workspace ids that exist', () => {
    // @ts-expect-error: a misspelt workspace id fails typecheck.
    expect(workspaceAccess('comissions', ['platform-admin'])).toBeNull();
  });
});
