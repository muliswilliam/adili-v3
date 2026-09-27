import { Injectable } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
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

  async record(result: VerificationResult, caller: Principal): Promise<string> {
    const id = uuidv7();
    await this.db.insert(verificationResults).values({
      id,
      ...result,
      latencyMs: Math.round(result.latencyMs),
      // Services are identified by OAuth client; tokens without one fall back to the subject.
      caller: caller.clientId ?? caller.subject,
    });
    return id;
  }
}
