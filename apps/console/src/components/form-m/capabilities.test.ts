import { describe, expect, it } from 'vitest';

import { workspaceFor } from '../workspaces';
import { formMCapabilities } from './capabilities';

const of = (roles: string[]) => formMCapabilities(roles, workspaceFor(roles, 'form-m') ?? null);

describe('Form M capabilities (spec 09 access table)', () => {
  it('lets the supervisor compile and review, the commission-admin sign off', () => {
    expect(of(['supervisor'])).toEqual({
      compilesAndReviews: true,
      signsOff: false,
      readOnly: false,
    });
    expect(of(['commission-admin'])).toEqual({
      compilesAndReviews: false,
      signsOff: true,
      readOnly: false,
    });
  });

  it('leaves the reporting officer reading only', () => {
    expect(of(['reporting-officer'])).toEqual({
      compilesAndReviews: false,
      signsOff: false,
      readOnly: true,
    });
  });

  it('gives nothing without the workspace, whatever the roles say', () => {
    expect(formMCapabilities(['supervisor'], null)).toEqual({
      compilesAndReviews: false,
      signsOff: false,
      readOnly: true,
    });
  });
});
