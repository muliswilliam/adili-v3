import { HttpStatus, Injectable } from '@nestjs/common';
import { callerOf, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import type { InstructionPurpose } from '../adapter-kit/lookup-purpose.js';
import { ResilientCalls } from '../adapter-kit/resilient-calls.js';
import { SystemCallLog } from '../adapter-kit/system-call-log.js';
import { icmsReferrals, type schema, type System } from '../db/schema.js';
import { SubjectHasher } from '../verification/subject-hasher.js';
import { IcmsClient } from './icms-client.js';
import {
  type IcmsReferralUnacknowledgedData,
  icmsReferralSubmitted,
  icmsReferralUnacknowledged,
} from './icms-events.js';
import type { IcmsReferral, IcmsReferralRequest } from './icms-records.js';

type ReferralRow = typeof icmsReferrals.$inferSelect;

const ICMS: System = 'icms';

/**
 * What tells one referral from another under the same reference: whom it is about and who
 * referred them. A corrected name or narrative under the same reference is the same referral,
 * which ICMS already holds.
 */
interface Particulars {
  referringCommission: string;
  nationalIdHash: string;
}

/** A referral registered now, or the stored one a replay of its reference finds. */
export interface Submitted {
  referral: IcmsReferral;
  replayed: boolean;
}

/**
 * ICMS referrals (spec 09 S13): a Commission's referral registered with EACC's case management
 * system through the kit (`ResilientCalls`: pause, breaker, rate limit and timeout; never
 * cached), and the registration (case number) stored, idempotent by referral reference.
 *
 * A referral already registered answers the stored registration without calling ICMS again;
 * under the same reference about another declarant or from another Commission it is a conflict.
 * ICMS registers a referral as it receives it (external/icms.yaml: a case number on every
 * answer), so a stored registration is final. A referral ICMS does not answer (down, timed out, breaker open, paused) is
 * `upstream-unavailable` and nothing is recorded as registered: the caller retries, and ICMS,
 * idempotent by reference too, answers a retry of a referral it did receive with the original
 * case. Every call to ICMS leaves a `system_calls` row for coverage, in one transaction with what
 * it achieved: the registration stored and `icms.referral.submitted.v1`, or, unanswered,
 * `icms.referral.unacknowledged.v1` alone.
 */
@Injectable()
export class IcmsReferrals {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly calls: ResilientCalls,
    private readonly callLog: SystemCallLog,
    private readonly icms: IcmsClient,
    private readonly hasher: SubjectHasher,
    private readonly events: EventPublisher,
  ) {}

  async submit(
    request: IcmsReferralRequest,
    purpose: InstructionPurpose,
    caller: Principal,
  ): Promise<Submitted> {
    const particulars = this.particulars(request);
    const stored = await this.find(request.referralReference);
    if (stored) return replay(stored, particulars);

    const requestedBy = callerOf(caller);
    const sentAt = new Date();
    const started = performance.now();
    const call = await this.calls.call(ICMS, (signal) => this.icms.submit(request, signal), {
      log: { referralReference: request.referralReference },
    });
    const logged = { system: ICMS, outcome: call, started, caller: requestedBy };
    const unacknowledged = (reason: IcmsReferralUnacknowledgedData['reason']) =>
      this.db.transaction(async (tx) => {
        await this.callLog.record(logged, tx);
        await this.events.record(
          tx,
          icmsReferralUnacknowledged({
            referralReference: request.referralReference,
            referringCommission: request.referringCommission,
            reason,
            legalBasis: purpose.legalBasis,
            caseRef: purpose.caseRef,
            requestedBy,
          }),
        );
      });
    if (call.outcome === 'unavailable') {
      await unacknowledged(call.reason);
      throw new ProblemException({
        type: 'upstream-unavailable',
        title: 'ICMS unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: `ICMS did not register the referral (${call.reason}). Nothing was recorded as registered; try again.`,
      });
    }
    const registration = call.value;
    if (!sameParticulars(this.particulars(registration), particulars)) {
      await unacknowledged('reference-conflict');
      throw conflict('ICMS holds another referral under this reference.');
    }

    const row: ReferralRow = {
      referralReference: request.referralReference,
      ...particulars,
      status: registration.status,
      caseNumber: registration.caseNumber,
      registeredAt: new Date(registration.registeredAt),
      sentAt,
      requestedBy,
      legalBasis: purpose.legalBasis,
      caseRef: purpose.caseRef,
    };
    const written = await this.db.transaction(async (tx) => {
      await this.callLog.record(logged, tx);
      const [created] = await tx
        .insert(icmsReferrals)
        .values(row)
        .onConflictDoNothing({ target: icmsReferrals.referralReference })
        .returning();
      if (!created) return null;
      await this.events.record(
        tx,
        icmsReferralSubmitted({
          referralReference: created.referralReference,
          referringCommission: created.referringCommission,
          status: created.status,
          caseNumber: created.caseNumber,
          legalBasis: created.legalBasis,
          caseRef: created.caseRef,
          requestedBy,
        }),
      );
      return created;
    });
    if (written) return { referral: toReferral(written), replayed: false };

    // The same reference was stored meanwhile (two sends at once): answer as a replay of it.
    const raced = await this.find(request.referralReference);
    if (!raced) throw new Error('ICMS referral neither inserted nor found');
    return replay(raced, particulars);
  }

  /** The stored registration; null when ICMS registered none under the reference. */
  async read(referralReference: string): Promise<IcmsReferral | null> {
    const row = await this.find(referralReference);
    return row ? toReferral(row) : null;
  }

  private async find(referralReference: string): Promise<ReferralRow | undefined> {
    const [row] = await this.db
      .select()
      .from(icmsReferrals)
      .where(eq(icmsReferrals.referralReference, referralReference))
      .limit(1);
    return row;
  }

  /** A referral's particulars, as sent or as ICMS registered them, the national ID hashed. */
  private particulars(
    referral: Pick<IcmsReferralRequest, 'referringCommission' | 'nationalId'>,
  ): Particulars {
    return {
      referringCommission: referral.referringCommission,
      nationalIdHash: this.hasher.hash(ICMS, `national-id:${referral.nationalId}`),
    };
  }
}

/** Whether two referrals under one reference are the same referral. */
function sameParticulars(one: Particulars, other: Particulars): boolean {
  return (
    one.referringCommission === other.referringCommission &&
    one.nationalIdHash === other.nationalIdHash
  );
}

function replay(stored: ReferralRow, particulars: Particulars): Submitted {
  if (!sameParticulars(stored, particulars)) {
    throw conflict('Another referral was registered under this reference.');
  }
  return { referral: toReferral(stored), replayed: true };
}

function conflict(detail: string): ProblemException {
  return new ProblemException({
    type: 'referral-reference-conflict',
    title: 'Referral reference already used',
    status: HttpStatus.CONFLICT,
    detail,
  });
}

function toReferral(row: ReferralRow): IcmsReferral {
  return {
    referralReference: row.referralReference,
    caseNumber: row.caseNumber,
    status: row.status,
    registeredAt: row.registeredAt.toISOString(),
    sentAt: row.sentAt.toISOString(),
  };
}
