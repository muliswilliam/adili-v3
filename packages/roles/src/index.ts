/**
 * Keycloak realm roles (infra/compose/keycloak/adili-realm.json) and the groups of them that a
 * service enforces and an app shows, and the client scopes a service admits and its callers ask
 * for, defined once so the two sides cannot drift apart. A group lives
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

/*
 * OAuth client scopes of the realm's service clients: the scope a service's internal API admits
 * and the one its callers' tokens ask for, named once.
 */

/** The directory's internal pulls (roster records, policy, Commission references). */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

/**
 * A person's verified contacts in the directory: personal data, so a scope of its own, held by
 * the notifications client alone (spec 04).
 */
export const DIRECTORY_PERSON_CONTACTS_SCOPE = 'directory:person-contacts';

/** The notifications messages API (`POST /internal/v1/messages`). */
export const MESSAGES_SCOPE = 'messages';
