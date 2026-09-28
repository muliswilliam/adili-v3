import { Injectable } from '@nestjs/common';
import { callerOf, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { v7 as uuidv7 } from 'uuid';

import {
  type LookupOutcome,
  type schema,
  type System,
  type UnavailableReason,
  verificationResults,
} from '../db/schema.js';

export interface VerificationResult {
  system: System;
  subjectHash: string;
  outcome: LookupOutcome;
  reason: UnavailableReason | null;
  cached: boolean;
  latencyMs: number;
}

/** Writes the verification-results row every registry lookup leaves behind. */
@Injectable()
export class VerificationResults {
  constructor(@InjectDatabase() private readonly db: Database<typeof schema>) {}

  async record(result: VerificationResult, caller: Principal): Promise<void> {
    await this.db.insert(verificationResults).values({
      id: uuidv7(),
      ...result,
      latencyMs: Math.round(result.latencyMs),
      caller: callerOf(caller),
    });
  }
}
