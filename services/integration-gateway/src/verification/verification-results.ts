import { Injectable } from '@nestjs/common';
import { callerOf, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
  InjectDatabase,
  type SealedField,
  withTenant,
} from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

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
  subjectPersonId: string | null;
  /** Tenant the lookup acted for; its key encrypts `payload`. */
  tenant: string | null;
  /** The normalised answer, kept only when there is a tenant to encrypt it for. */
  payload: unknown;
}

/** A recorded lookup as a service of its tenant reads it back (`StoredResult` in the contract). */
export interface StoredResult {
  resultId: string;
  system: System;
  outcome: LookupOutcome;
  checkedAt: string;
  legalBasis: LegalBasis;
  caseRef: string | null;
  /** The normalised answer, decrypted; null unless the lookup found something. */
  payload: Record<string, unknown> | null;
}

/**
 * Writes the verification-results row every registry lookup leaves behind, with the payload
 * encrypted under the tenant's key (bound to the row id), and its `registry.lookup.performed.v1`
 * in the same transaction. Rows are tenant data under row-level security (ADR-006 §5.3): written
 * and read in the tenant's context, a lookup for no tenant in the platform's.
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
    const context = { tenant: result.tenant ?? PLATFORM_TENANT, subject: requestedBy };
    await withTenant(this.db, context, async (tx) => {
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
        subjectPersonId: result.subjectPersonId,
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

  /**
   * The row `id` as `tenant`'s services may read it (`reader` the service reading), payload
   * decrypted, with the person it is about; null when there is no such row or it belongs to
   * another tenant (or to none: lookups for no tenant keep nothing), so the two look the same.
   */
  async read(
    id: string,
    tenant: string,
    reader: string,
  ): Promise<{ result: StoredResult; subjectPersonId: string | null } | null> {
    const [row] = await withTenant(this.db, { tenant, subject: reader }, (tx) =>
      tx.select().from(verificationResults).where(eq(verificationResults.id, id)).limit(1),
    );
    // Row-level security admits the tenant's rows; the platform's context (a service acting for
    // `platform`) admits every row, and its services keep no tenant's answers.
    if (row?.tenant !== tenant) return null;
    let payload: Record<string, unknown> | null = null;
    if (row.payloadCiphertext !== null && row.payloadEnvelope !== null) {
      const plaintext = await this.cipher.decrypt({
        tenant,
        recordId: row.id,
        ciphertext: row.payloadCiphertext,
        envelope: row.payloadEnvelope,
      });
      payload = JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
    }
    return {
      result: {
        resultId: row.id,
        system: row.system,
        outcome: row.outcome,
        checkedAt: row.checkedAt.toISOString(),
        legalBasis: row.legalBasis,
        caseRef: row.caseRef,
        payload,
      },
      subjectPersonId: row.subjectPersonId,
    };
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
