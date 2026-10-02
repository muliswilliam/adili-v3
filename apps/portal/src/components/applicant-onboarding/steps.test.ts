import { describe, expect, it } from 'vitest';

import { resumeApplicantRoute, routeForApplicantSession } from './steps';

describe('routeForApplicantSession', () => {
  it('sends each state to its step', () => {
    expect(routeForApplicantSession({ state: 'identified' })).toBe(
      '/access/get-started/verify-phone',
    );
    expect(routeForApplicantSession({ state: 'phone-pending' })).toBe(
      '/access/get-started/verify-phone',
    );
    expect(routeForApplicantSession({ state: 'phone-verified' })).toBe(
      '/access/get-started/create',
    );
    expect(routeForApplicantSession({ state: 'confirmed' })).toBe(
      '/access/get-started/check-email',
    );
    expect(routeForApplicantSession({ state: 'expired' })).toBe('/access/get-started');
  });
});

describe('resumeApplicantRoute', () => {
  it('resumes a session in progress', () => {
    expect(resumeApplicantRoute({ state: 'phone-pending' })).toBe(
      '/access/get-started/verify-phone',
    );
    expect(resumeApplicantRoute({ state: 'phone-verified' })).toBe('/access/get-started/create');
  });

  it('does not hold a finished or ended session on its page', () => {
    expect(resumeApplicantRoute({ state: 'confirmed' })).toBeNull();
    expect(resumeApplicantRoute({ state: 'expired' })).toBeNull();
  });
});
