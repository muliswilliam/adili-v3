import { describe, expect, it } from 'vitest';

import { organisationLabel, organisationOf } from './organisation';

describe('organisationLabel', () => {
  it("names the staff member's Commission", () => {
    expect(organisationLabel(organisationOf('psc', 'Public Service Commission'))).toBe(
      'Public Service Commission',
    );
  });

  it('names the platform team, and falls back to the key when the name is unknown', () => {
    expect(organisationLabel(organisationOf('platform', null))).toBe('Adili Online platform team');
    expect(organisationLabel(organisationOf('tsc', null))).toBe('TSC');
  });

  it('shows nothing for an account with no organisation', () => {
    expect(organisationLabel(organisationOf(null, null))).toBeNull();
  });
});
