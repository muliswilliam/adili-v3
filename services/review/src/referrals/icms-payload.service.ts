import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { enforcementLadders } from '../enforcement/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import { GROUNDS_LABELS, type ReferralIcmsPayload } from './representation.js';
import { referrals } from './schema.js';

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
 * the referral's case (as payroll instructions read theirs), or for a referral with no case (two
 * missed cycles) of the ladders on its obligations, each time, and is kept nowhere here: not
 * stored, logged, put in an event or in workflow history.
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
        const sent = notFoundIfInvisible(found);
        if (sent.rosterRecordId !== null || sent.referral.caseId !== null) return sent;
        // No case (two missed cycles): the roster record of the ladders on its obligations, the
        // later obligation's first.
        const obligationIds = sent.referral.sources.obligationIds;
        if (obligationIds.length === 0) return sent;
        const [ladder] = await tx
          .select({ rosterRecordId: enforcementLadders.rosterRecordId })
          .from(enforcementLadders)
          .where(
            and(
              eq(enforcementLadders.subjectKind, 'obligation'),
              inArray(enforcementLadders.subjectId, obligationIds),
              isNotNull(enforcementLadders.rosterRecordId),
            ),
          )
          .orderBy(desc(enforcementLadders.startedAt));
        return { ...sent, rosterRecordId: ladder?.rosterRecordId ?? null };
      },
    );
    const { reference } = referral;
    if (reference === null) throw new Error(`Referral ${referralId} is sent without its reference`);
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
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      declarant: { name: referral.declarantName, nationalId: roster.nationalId },
      narrative: referral.narrative,
    };
  }
}
