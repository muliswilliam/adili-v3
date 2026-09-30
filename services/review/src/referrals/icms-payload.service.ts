import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import { GROUNDS_LABELS } from './representation.js';
import { type ReferralGrounds, referrals } from './schema.js';

/**
 * review.yaml `ReferralIcmsPayload`: what ICMS needs of a sent referral (spec 09 BE-5), in the
 * names of the package's cover sheet (`ReferralPackagePayload`) with the declarant's national ID
 * added. The evidence itself stays in the Confidential package EACC downloads.
 */
export interface ReferralIcmsPayload {
  reference: string;
  grounds: ReferralGrounds;
  groundsLabel: string;
  cycleYear: number;
  commission: { name: string; issuerCode: string };
  declarant: { name: string; personnelFileNumber: string; nationalId: string };
  narrative: string;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string;
  approvedAt: string;
  sentAt: string;
}

/** 409 `roster-record-unknown`: the declarant's national ID cannot be read. */
function rosterRecordUnknown(detail: string): ProblemException {
  return new ProblemException(
    {
      type: 'roster-record-unknown',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail,
    },
    { code: 'roster-record-unknown' },
  );
}

/**
 * The ICMS payload the reporting service pulls when EACC pushes a sent referral to ICMS
 * (`internalGetReferralIcmsPayload`). The national ID is read from the directory's roster record of
 * the referral's case (as payroll instructions read theirs) each time, and is kept nowhere here:
 * not stored, logged, put in an event or in workflow history.
 */
@Injectable()
export class ReferralIcmsPayloadService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async payload(tenant: string, referralId: string): Promise<ReferralIcmsPayload> {
    const { referral, rosterRecordId } = await withTenant(
      this.db,
      systemContext(tenant),
      async (tx) => {
        const [found] = await tx
          .select({ referral: referrals, rosterRecordId: reviewCases.rosterRecordId })
          .from(referrals)
          .leftJoin(reviewCases, eq(reviewCases.id, referrals.caseId))
          .where(and(eq(referrals.id, referralId), eq(referrals.status, 'sent')));
        return notFoundIfInvisible(found);
      },
    );
    const { reference, approver, approvedAt, sentAt } = referral;
    if (reference === null || approver === null || approvedAt === null || sentAt === null) {
      throw new Error(`Referral ${referralId} is sent without its reference or dates`);
    }
    if (rosterRecordId === null) {
      throw rosterRecordUnknown(
        'The referral names no roster record of the declarant, so their national ID cannot be read.',
      );
    }
    const [commission, roster] = await withUpstream(() =>
      Promise.all([
        this.directory.getCommission(tenant),
        this.directory.getRosterRecord(tenant, rosterRecordId),
      ]),
    );
    if (!roster) {
      throw rosterRecordUnknown(
        "The Commission's roster has no record of the declarant, so their national ID cannot be read.",
      );
    }
    return {
      reference,
      grounds: referral.grounds,
      groundsLabel: GROUNDS_LABELS[referral.grounds],
      cycleYear: referral.cycleYear,
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      declarant: {
        name: referral.declarantName,
        personnelFileNumber: referral.personnelFileNumber,
        nationalId: roster.nationalId,
      },
      narrative: referral.narrative,
      proposedBy:
        referral.proposerKind === 'system'
          ? 'Adili (system proposal)'
          : (referral.proposerName ?? referral.proposer ?? 'unknown'),
      proposedAt: referral.proposedAt.toISOString(),
      approvedBy: referral.approverName ?? approver,
      approvedAt: approvedAt.toISOString(),
      sentAt: sentAt.toISOString(),
    };
  }
}
