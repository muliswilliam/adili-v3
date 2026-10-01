import {
  ACCESS_OFFICER,
  AUDITOR,
  COMMISSION_ADMIN,
  DECLARANT,
  EACC_ANALYST,
  EACC_SUPERVISOR,
  HELPDESK,
  LAW_ENFORCEMENT,
  PLATFORM_ADMIN,
  REPORTING_OFFICER,
  REVIEWER,
  SUPERVISOR,
} from '@adili/roles';

/**
 * Realm roles as people read them (infra/compose/keycloak/adili-realm.json). The one place the
 * console turns a role into words; unknown roles fall back to their name in sentence case.
 */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  [DECLARANT]: 'Declarant',
  [REPORTING_OFFICER]: 'Reporting officer',
  [REVIEWER]: 'Reviewer',
  [SUPERVISOR]: 'Supervisor',
  [COMMISSION_ADMIN]: 'Commission administrator',
  [ACCESS_OFFICER]: 'Access officer',
  [EACC_ANALYST]: 'EACC analyst',
  [EACC_SUPERVISOR]: 'EACC supervisor',
  [AUDITOR]: 'Auditor',
  [HELPDESK]: 'Helpdesk',
  [PLATFORM_ADMIN]: 'Platform administrator',
  [LAW_ENFORCEMENT]: 'Law enforcement',
};

/** Console roles, most senior first, for naming a user by one role (sidebar footer). */
const SENIORITY = [
  PLATFORM_ADMIN,
  EACC_SUPERVISOR,
  EACC_ANALYST,
  COMMISSION_ADMIN,
  SUPERVISOR,
  REVIEWER,
  REPORTING_OFFICER,
  ACCESS_OFFICER,
  LAW_ENFORCEMENT,
  AUDITOR,
  HELPDESK,
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
