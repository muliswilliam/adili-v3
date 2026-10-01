import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PLATFORM_TENANT, ProblemException } from '@adili/api-kit';
import { DATABASE, type Database } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import {
  normalizeVerificationId,
  VERIFICATION_AUDITED,
  VERIFICATION_CHECKED,
  type VerificationAuditedData,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { eq } from 'drizzle-orm';

import type { VerificationSchema } from '../db/schema.js';
import { notFoundResult, toVerificationResult, type VerificationResult } from './representation.js';
import { coarseNetwork } from './origin.js';
import { verificationProjection } from './schema.js';

/** Longest code accepted before normalising: the printed form (35) with some slack for spaces. */
export const MAX_CODE_LENGTH = 40;

/**
 * Looks codes up in the projection and records every lookup of a well-formed code (outbox, same
 * transaction) twice: `verification.checked.v1`, identifiers and outcome only, for the declarant's
 * "verified n times"; and `audit.verification.v1` with the coarse origin, for the audit trail.
 */
@Injectable()
export class VerifyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database<VerificationSchema>,
    private readonly events: EventPublisher,
  ) {}

  /**
   * 400 when `code` is not a verification id in any accepted spelling. `clientIp` is the
   * caller's address; only its network is recorded.
   */
  async verify(code: string, clientIp: string | undefined): Promise<VerificationResult> {
    const verificationId = code.length <= MAX_CODE_LENGTH ? normalizeVerificationId(code) : null;
    if (!verificationId) {
      throw new ProblemException({
        type: 'malformed-verification-id',
        title: 'Malformed verification code',
        status: HttpStatus.BAD_REQUEST,
        detail: 'A verification code is ADL followed by 26 letters and digits.',
      });
    }
    const checkedAt = new Date();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(verificationProjection)
        .where(eq(verificationProjection.verificationId, verificationId));
      const result = row
        ? toVerificationResult(row, checkedAt)
        : notFoundResult(verificationId, checkedAt);
      await this.events.record(tx, {
        type: VERIFICATION_CHECKED,
        subject: verificationId,
        data: { verificationId, outcome: result.status } satisfies VerificationCheckedData,
      });
      await this.events.record(tx, {
        type: VERIFICATION_AUDITED,
        subject: verificationId,
        tenant: PLATFORM_TENANT,
        data: {
          verificationId,
          outcome: result.status,
          origin: { network: coarseNetwork(clientIp) },
        } satisfies VerificationAuditedData,
      });
      return result;
    });
  }
}
