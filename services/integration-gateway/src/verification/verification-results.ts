import { Injectable } from '@nestjs/common';
import { callerOf, type Principal } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, type SealedField } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import {
  type LegalBasis,
  type LookupOutcome,
  type schema,
  type System,
  type UnavailableReason,
  verificationResults,
} from '../db/schema.js';
import { lookupPerformed } from './lookup-events.js';

export interface VerificationResult {
  id: string;
  system: System;
  subjectHash: string;
  outcome: LookupOutcome;
  reason: UnavailableReason | null;
  cached: boolean;
  latencyMs: number;
  caller: Principal;
  legalBasis: LegalBasis;
  caseRef: string | null;
  /** Tenant the lookup acted for; its key encrypts `payload`. */
  tenant: string | null;
  /** The normalised answer, kept only when there is a tenant to encrypt it for. */
  payload: unknown;
}

/**
 * Writes the verification-results row every registry lookup leaves behind, with the payload
 * encrypted under the tenant's key (bound to the row id), and its `registry.lookup.performed.v1`
 * in the same transaction.
 */
@Injectable()
export class VerificationResults {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly cipher: FieldCipher,
    private readonly events: EventPublisher,
  ) {}

  async record(result: VerificationResult): Promise<void> {
    const sealed = await this.seal(result);
    const requestedBy = callerOf(result.caller);
    await this.db.transaction(async (tx) => {
      await tx.insert(verificationResults).values({
        id: result.id,
        system: result.system,
        subjectHash: result.subjectHash,
        outcome: result.outcome,
        reason: result.reason,
        cached: result.cached,
        latencyMs: Math.round(result.latencyMs),
        caller: requestedBy,
        tenant: result.tenant,
        legalBasis: result.legalBasis,
        caseRef: result.caseRef,
        payloadCiphertext: sealed?.ciphertext ?? null,
        payloadEnvelope: sealed?.envelope ?? null,
      });
      await this.events.record(
        tx,
        lookupPerformed(
          {
            resultId: result.id,
            system: result.system,
            outcome: result.outcome,
            reason: result.reason,
            cached: result.cached,
            legalBasis: result.legalBasis,
            caseRef: result.caseRef,
            subjectHash: result.subjectHash,
            requestedBy,
          },
          result.tenant,
        ),
      );
    });
  }

  private async seal(result: VerificationResult): Promise<SealedField | null> {
    if (result.tenant === null || result.payload === undefined) return null;
    return this.cipher.encrypt({
      tenant: result.tenant,
      recordId: result.id,
      plaintext: JSON.stringify(result.payload),
    });
  }
}
