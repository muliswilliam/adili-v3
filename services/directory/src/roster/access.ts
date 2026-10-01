import { COMMISSION_ROSTER_ROLES, NATIONAL_ROLES } from '@adili/roles';

/**
 * Roles that read how a Commission's roster is doing, without its personal data: imports, the
 * summary and failed onboarding attempts (spec #27 authorisation matrix, spec 03 story 30). The
 * Commission's reporting officer and commission admin; platform admin and EACC for every
 * Commission. Roster records themselves: `RECORD_READ_ROLES`.
 */
export const ROSTER_OVERVIEW_ROLES = [...COMMISSION_ROSTER_ROLES, ...NATIONAL_ROLES] as const;
