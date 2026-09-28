import { COUNTIES, COUNTRIES } from '@adili/ui';

import type { Draft, PersonName } from './contents';

/**
 * Small words-and-values helpers every declaration screen, the summary and the declarations mock
 * share, so a name or a country reads the same everywhere.
 */

/** True when a text answer is missing or only spaces. */
export function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/** "First Other Surname", skipping empty parts; empty when no part is given. */
export function fullName(name: Draft<PersonName> | undefined): string {
  return [name?.firstName, name?.otherNames, name?.surname]
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .map((part) => part.trim())
    .join(' ');
}

/** Whole years between an ISO birth date and an ISO date. */
export function ageOn(birthDate: string, on: string): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split('-').map(Number);
  const [y = 0, m = 0, d = 0] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** A county's name from its code; undefined when there is no code. */
export function countyName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return COUNTIES.find((county) => county.code === code)?.name ?? code;
}

/** A country's name from its ISO code; undefined when there is no code. */
export function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/** How the summary shows a field the declarant has not answered. */
export const UNANSWERED = 'Not answered';

/** The trimmed answer, or "Not answered". */
export function orUnanswered(value: string | undefined): string {
  return value?.trim() ? value.trim() : UNANSWERED;
}
