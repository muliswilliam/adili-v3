import { hasValidCheckCharacter } from '@adili/numbering';
import { z } from 'zod';

import { slugSchema } from '../commissions/create-commission.js';
import { ofrSchema } from '../onboarding/representation.js';
import { rosterRecordStateSchema } from '../roster/records/representation.js';

/** Representations of a person (a declarant) to themself and to the helpdesk. */

export const declarantProfileSchema = z.object({
  personId: z.uuid(),
  ofr: ofrSchema,
  fullName: z.string().meta({ description: 'As confirmed at onboarding' }),
  contacts: z
    .object({
      email: z.string().nullable(),
      phone: z.string().nullable().meta({ description: 'E.164' }),
    })
    .meta({ description: 'The contacts verified at the latest onboarding' }),
  commissions: z
    .array(
      z.object({
        slug: slugSchema,
        name: z.string(),
        personnelFileNumber: z.string(),
        rosterRecordId: z.uuid(),
        state: rosterRecordStateSchema,
        onboardedAt: z.iso.datetime().nullable(),
      }),
    )
    .meta({ description: "The person's roster records, one per Commission, ordered by name" }),
});
export type DeclarantProfile = z.infer<typeof declarantProfileSchema>;

export const personSummarySchema = z.object({
  personId: z.uuid(),
  ofr: ofrSchema,
  fullName: z.string(),
  commissions: z
    .array(slugSchema)
    .meta({ description: 'Commissions whose roster records the person is linked to' }),
  createdAt: z.iso.datetime().meta({ description: 'When the account was created' }),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

/** Query of `GET /v1/persons`. */
export const findPersonQuery = z.object({
  ofr: ofrSchema.refine(hasValidCheckCharacter, {
    message: 'Not an officer reference: the check character does not match',
    // Only a well-shaped reference has a check character to verify.
    when: (payload) => payload.issues.length === 0,
  }),
});
export type FindPersonQuery = z.infer<typeof findPersonQuery>;

/** The contacts notifications sends a person's messages to (spec 04). */
export const personContactsSchema = z.object({
  personId: z.uuid(),
  email: z.string().nullable().meta({ description: 'Verified at onboarding; null when none' }),
  phone: z
    .string()
    .nullable()
    .meta({ description: 'E.164, verified at onboarding; null when none' }),
});
export type PersonContacts = z.infer<typeof personContactsSchema>;

/** The national ID a person was onboarded with, for their own registry lookups (spec 05b). */
export const personNationalIdSchema = z.object({
  nationalId: z.string().meta({ description: 'Digits only, as verified at onboarding' }),
});
export type PersonNationalId = z.infer<typeof personNationalIdSchema>;
