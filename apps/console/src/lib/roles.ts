/**
 * Realm roles the console acts on (architecture section 7). Tokens carry others too (for example
 * `declarant` or `default-roles-adili`), so roles from a principal stay plain strings; this list
 * types the places that name a role, so a typo fails typecheck.
 */
export const STAFF_ROLES = [
  'platform-admin',
  'eacc-supervisor',
  'eacc-analyst',
  'commission-admin',
  'supervisor',
  'reviewer',
  'reporting-officer',
  'access-officer',
  'law-enforcement',
  'auditor',
  'helpdesk',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
