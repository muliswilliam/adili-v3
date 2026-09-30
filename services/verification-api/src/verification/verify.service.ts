import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { DATABASE, type Database } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import {
  normalizeVerificationId,
  VERIFICATION_CHECKED,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { eq } from 'drizzle-orm';

import type { VerificationSchema } from '../db/schema.js';
import { notFoundResult, toVerificationResult, type VerificationResult } from './representation.js';
import { verificationProjection } from './schema.js';

/** Longest code accepted before normalising: the printed form (35) with some slack for spaces. */
export const MAX_CODE_LENGTH = 40;

/**
 * Looks codes up in the projection and records every lookup of a well-formed code as
 * `verification.checked.v1` (outbox, same transaction), for the audit trail and the declarant's
 * "verified n times".
 */
@Injectable()
export class VerifyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database<VerificationSchema>,
    private readonly events: EventPublisher,
  ) {}

  /** 400 when `code` is not a verification id in any accepted spelling. */
  async verify(code: string): Promise<VerificationResult> {
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
      return result;
    });
  }
}
