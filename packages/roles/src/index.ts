/**
 * Keycloak realm roles (infra/compose/keycloak/adili-realm.json) and the groups of them that a
 * service enforces and an app shows, defined once so the two cannot drift apart. A group lives
 * here only when both sides check it; a role list one side alone uses stays with that side.
 */

/** Runs the platform; reads every Commission. */
export const PLATFORM_ADMIN = 'platform-admin';

/** A Responsible Commission's own staff, who work on its declarants (spec 04: its obligations). */
export const COMMISSION_STAFF_ROLES = [
  'reporting-officer',
  'reviewer',
  'supervisor',
  'commission-admin',
] as const;

/** EACC's oversight roles: counts for any Commission, never its declarants (spec 04). */
export const EACC_ROLES = ['eacc-analyst', 'eacc-supervisor'] as const;
