import type { ReferralGrounds } from '../projections/events.js';
import type { ReferralIntakeRow } from './intake.js';
import type { IcmsPushError, IcmsStatus } from './schema.js';

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
  pushedBy: { subject: string; name: string } | null;
  error: IcmsPushError | null;
}

/** A page of the intake (reporting.yaml `listReferralIntake`). */
export interface ReferralIntakePage {
  items: ReferralIntakeItem[];
  nextCursor: string | null;
}

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
    pushedBy:
      row.pushedBy === null
        ? null
        : { subject: row.pushedBy, name: row.pushedByName ?? row.pushedBy },
    error: row.error,
  };
}
