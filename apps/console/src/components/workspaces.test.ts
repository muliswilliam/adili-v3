import { describe, expect, it } from 'vitest';

import { workspacesFor } from './workspaces';

const ids = (roles: string[]) => workspacesFor(roles).map((workspace) => workspace.id);

describe('workspacesFor', () => {
  it('gives reviewers the review queue only', () => {
    expect(ids(['reviewer', 'default-roles-adili'])).toEqual(['review']);
  });

  it('gives supervisors review and approvals, once each', () => {
    expect(ids(['supervisor', 'reviewer'])).toEqual(['review', 'approvals']);
  });

  it('gives EACC analysts compliance reports but not the review queue', () => {
    expect(ids(['eacc-analyst'])).toEqual(['compliance']);
  });

  it('gives declarants nothing in the console', () => {
    expect(ids(['declarant'])).toEqual([]);
  });
});
