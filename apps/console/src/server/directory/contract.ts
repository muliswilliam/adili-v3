import type { components } from './api.gen';

/**
 * Runtime copies of rules in the directory contract (packages/schemas/internal/directory.yaml)
 * that the console checks before sending a request. Types come from `api.gen.ts`, so a contract
 * change that these no longer match fails the typecheck.
 */

type OfficerCategoryCode = components['schemas']['OfficerCategoryCode'];

/** `Slug`: a lowercase letter, then lowercase letters or digits, 2 to 20 characters in all. */
export const SLUG_PATTERN = /^[a-z][a-z0-9]{1,19}$/;

/** Tenant keys no Commission may take (`new` is the create route, `/commissions/new`). */
export const RESERVED_SLUGS: readonly string[] = ['platform', 'new'];

/** `CreateCommission.name` length. */
export const NAME_LENGTH = { min: 3, max: 120 } as const;

/** `AssignReportingOfficer.name` length. */
export const OFFICER_NAME_LENGTH = { min: 2, max: 120 } as const;

/** `AssignReportingOfficer.email` maximum length. */
export const EMAIL_MAX_LENGTH = 254;

/** `AssignReportingOfficer.phone`: E.164, a plus then 7 to 15 digits, not starting with 0. */
export const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

/** `OfficerCategoryCode`: one paragraph of Act s.32 or Regs r.5. */
export const OFFICER_CATEGORY_CODES = [
  'act-s32-2',
  'act-s32-3',
  'act-s32-4',
  'act-s32-5',
  'act-s32-6',
  'act-s32-7',
  'act-s32-8',
  'act-s32-9',
  'act-s32-10',
  'act-s32-11',
  'act-s32-12',
  'act-s32-13',
  'act-s32-14',
  'regs-r5-a',
  'regs-r5-b',
  'regs-r5-c',
  'regs-r5-d',
  'regs-r5-e',
  'regs-r5-f',
] as const satisfies readonly OfficerCategoryCode[];

/** Compile-time check that every contract code is listed above (the reverse of `satisfies`). */
export const ALL_CATEGORY_CODES_LISTED: OfficerCategoryCode extends (typeof OFFICER_CATEGORY_CODES)[number]
  ? true
  : never = true;
