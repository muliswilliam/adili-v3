import { z } from 'zod';

import { nairobiYear } from '../clock.js';
import type { AccessPolicy, CommissionListing } from '../directory/directory-client.js';

/** The first year a Form K can ask for (form-k.v1 `scope.years` minimum): Adili's first cycle. */
export const FIRST_DECLARATION_YEAR = 2025;

/** access.yaml `AccessCommission`: a Responsible Commission an applicant can address. */
export const accessCommissionSchema = z.object({
  slug: z.string().meta({ description: 'The form-k.v1 `responsibleCommission`' }),
  name: z.string(),
  years: z.array(z.int()).meta({
    description:
      'The declaration years (statement-date years) a request can ask of it, ascending: from the year it joined Adili (its earliest obligations-start date, not before 2025) to the current year in Nairobi. Empty while it holds none yet.',
  }),
  decisionDays: z.int().positive().meta({
    description:
      'The days from receipt the Commission has to decide a Form K request, by its policy in force now (a request keeps the period in force when it is received)',
  }),
});

export type AccessCommission = z.infer<typeof accessCommissionSchema>;

/** The years of statement dates the Commission can hold declarations for, as at `now`. */
export function declarationYears(obligationsStartDate: string, now: Date): number[] {
  const from = Math.max(FIRST_DECLARATION_YEAR, Number(obligationsStartDate.slice(0, 4)));
  const to = nairobiYear(now);
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

export function toAccessCommission(
  commission: CommissionListing,
  policy: AccessPolicy,
  now: Date,
): AccessCommission {
  return {
    slug: commission.slug,
    name: commission.name,
    years: declarationYears(commission.obligationsStartDate, now),
    decisionDays: policy.decisionDays,
  };
}
