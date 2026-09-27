/**
 * Realm roles as people read them (infra/compose/keycloak/adili-realm.json). The one place the
 * console turns a role into words; unknown roles fall back to their name in sentence case.
 */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  declarant: 'Declarant',
  'reporting-officer': 'Reporting officer',
  reviewer: 'Reviewer',
  supervisor: 'Supervisor',
  'commission-admin': 'Commission administrator',
  'access-officer': 'Access officer',
  'eacc-analyst': 'EACC analyst',
  'eacc-supervisor': 'EACC supervisor',
  auditor: 'Auditor',
  helpdesk: 'Helpdesk',
  'platform-admin': 'Platform administrator',
  'law-enforcement': 'Law enforcement',
};

/** Console roles, most senior first, for naming a user by one role (sidebar footer). */
const SENIORITY = [
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

/** The label of a user's most senior console role, or null when they hold none. */
export function seniorRoleLabel(roles: readonly string[]): string | null {
  const role = SENIORITY.find((candidate) => roles.includes(candidate));
  return role ? roleLabel(role) : null;
}

export function roleLabel(role: string): string {
  const known = ROLE_LABELS[role];
  if (known) return known;
  const words = role.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Hides Keycloak's built-in roles, which mean nothing to users. */
export function platformRoles(roles: readonly string[]): string[] {
  return roles.filter(
    (role) =>
      role !== 'offline_access' &&
      role !== 'uma_authorization' &&
      !role.startsWith('default-roles-'),
  );
}
