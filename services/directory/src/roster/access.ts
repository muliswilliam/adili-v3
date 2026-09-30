import { REPORTING_OFFICER_ROLE } from '../commissions/access.js';

/**
 * Roles that read how a Commission's roster is doing, without its personal data: imports, the
 * summary and failed onboarding attempts (spec #27 authorisation matrix, spec 03 story 30). The
 * Commission's reporting officer and commission admin; platform admin and EACC for every
 * Commission. Roster records themselves: `RECORD_READ_ROLES`.
 */
export const ROSTER_OVERVIEW_ROLES = [
  REPORTING_OFFICER_ROLE,
  'commission-admin',
  'platform-admin',
  'eacc-analyst',
  'eacc-supervisor',
] as const;
