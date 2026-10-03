import { z } from 'zod';

import type { Conforms } from '../conforms.js';
import { type Officer, officerSchema, storedOfficer } from '../officer.js';
import { REFERRAL_GROUNDS, type ReferralGrounds } from '../projections/events.js';
import type { ReferralIntakeRow } from './intake.js';
import { ICMS_PUSH_ERRORS, ICMS_STATUSES, type IcmsPushError, type IcmsStatus } from './schema.js';

/** reporting.yaml `ReferralIntakeItem`: a referral in EACC's intake and its ICMS hand-off. */
export interface ReferralIntakeItem {
  referralId: string;
  commission: { slug: string; name: string };
  reference: string;
  grounds: ReferralGrounds;
  cycleYear: number;
  sentAt: string;
  packageDocumentId: string;
  icmsStatus: IcmsStatus;
  icmsCaseNumber: string | null;
  icmsRegisteredAt: string | null;
  pushedAt: string | null;
  pushedBy: Officer | null;
  error: IcmsPushError | null;
}

/** A page of the intake (reporting.yaml `listReferralIntake`). */
export interface ReferralIntakePage {
  items: ReferralIntakeItem[];
  nextCursor: string | null;
}

export const icmsStatusSchema = z.enum(ICMS_STATUSES).meta({
  description:
    'not-pushed until EACC pushes it; pushed once ICMS accepted it without a case number yet; registered with the case number; push-failed when the push could not be completed (push again to retry)',
});

export const icmsPushErrorSchema = z
  .enum(ICMS_PUSH_ERRORS)
  .meta({ description: 'Why the last push failed' });

export const referralGroundsSchema = z.enum(REFERRAL_GROUNDS);

export const referralIntakeItemSchema = z.object({
  referralId: z.uuid(),
  commission: z.object({ slug: z.string(), name: z.string() }),
  reference: z.string().meta({ description: 'The RFL reference' }),
  grounds: referralGroundsSchema,
  cycleYear: z.number().int().meta({ description: 'The declaration cycle the referral is about' }),
  sentAt: z.iso.datetime(),
  packageDocumentId: z
    .uuid()
    .meta({ description: 'The Confidential referral-package document (documents service)' }),
  icmsStatus: icmsStatusSchema,
  icmsCaseNumber: z.string().nullable(),
  icmsRegisteredAt: z.iso.datetime().nullable(),
  pushedAt: z.iso.datetime().nullable(),
  pushedBy: officerSchema.nullable().meta({ description: 'Who last pushed it' }),
  error: icmsPushErrorSchema.nullable(),
});
true satisfies Conforms<ReferralIntakeItem, typeof referralIntakeItemSchema>;

export const referralIntakePageSchema = z.object({
  items: z.array(referralIntakeItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last' }),
});
true satisfies Conforms<ReferralIntakePage, typeof referralIntakePageSchema>;

/** The row as EACC sees it; `commissionName` from the directory (the slug when unknown). */
export function referralIntakeItem(
  row: ReferralIntakeRow,
  commissionName: string,
): ReferralIntakeItem {
  return {
    referralId: row.referralId,
    commission: { slug: row.tenant, name: commissionName },
    reference: row.reference,
    grounds: row.grounds,
    cycleYear: row.cycleYear,
    sentAt: row.sentAt.toISOString(),
    packageDocumentId: row.packageDocumentId,
    icmsStatus: row.icmsStatus,
    icmsCaseNumber: row.icmsCaseNumber,
    icmsRegisteredAt: row.icmsRegisteredAt?.toISOString() ?? null,
    pushedAt: row.pushedAt?.toISOString() ?? null,
    pushedBy: storedOfficer(row.pushedBy, row.pushedByName),
    error: row.error,
  };
}
