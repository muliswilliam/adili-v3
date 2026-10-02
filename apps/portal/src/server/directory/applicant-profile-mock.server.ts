/**
 * `GET /v1/me/applicant` (#246) for the directory mock: the signed-in applicant's particulars,
 * which pre-fill Form K. A user with the `applicant` realm role gets the profile listed under
 * their username in APPLICANT_PROFILES, or the national ID demo applicant; anyone else gets 403,
 * as the directory answers callers without the role.
 */
import { json } from '../mock-http';
import type { components } from './schema.gen';

type ApplicantProfile = components['schemas']['ApplicantProfile'];

export const DEMO_APPLICANT: ApplicantProfile = {
  personId: '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d',
  fullName: 'Mercy Wanjiku Kamau',
  identityDocument: { kind: 'national-id', number: '28841276', country: null },
  identityStatus: 'verified',
  contacts: { email: 'mercy.kamau@example.com', phone: '+254722418903' },
};

/** A passport applicant, whose identity the Commission checks on their first request. */
export const PASSPORT_APPLICANT: ApplicantProfile = {
  personId: '1b0c9d8e-7f6a-4b5c-8d3e-2f1a0b9c8d7e',
  fullName: 'Kwame Mensah',
  identityDocument: { kind: 'passport', number: 'G2847193', country: 'GH' },
  identityStatus: 'pending-verification',
  contacts: { email: 'kwame.mensah@example.com', phone: '+233244718265' },
};

const APPLICANT_PROFILES: Record<string, ApplicantProfile> = {
  'applicant-passport': PASSPORT_APPLICANT,
};

export function myApplicantProfile(claims: {
  preferred_username?: string;
  realm_access?: { roles?: string[] };
}): Response {
  if (!claims.realm_access?.roles?.includes('applicant')) {
    return json(403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'Requires one of the roles: applicant',
    });
  }
  return json(200, APPLICANT_PROFILES[claims.preferred_username ?? ''] ?? DEMO_APPLICANT);
}
