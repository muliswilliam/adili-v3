import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '@adili/data-access';
import { consumeOnce, type EventEnvelope } from '@adili/events';
import {
  documentIssuedDataSchema,
  documentRevokedDataSchema,
  documentSupersededDataSchema,
} from '@adili/events/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { VerificationSchema } from '../db/schema.js';
import { verifiedDocumentSchema } from './representation.js';
import { verificationProjection } from './schema.js';

/** Of every document event, the fields the projection keeps; the rest are never read. */
const KEPT = {
  verificationId: true,
  disclosureLevel: true,
  sha256: true,
  issuedAt: true,
  status: true,
} as const;
/** Of the public payload only the fields the page shows get through, whatever else it holds. */
const shown = { publicPayload: verifiedDocumentSchema.nullable() };

const documentEventData = documentIssuedDataSchema.pick(KEPT).extend(shown);

export const documentIssuedData = documentEventData;
export const documentSupersededData = documentSupersededDataSchema
  .pick({ ...KEPT, supersededByVerificationId: true, statusChangedAt: true })
  .extend(shown);
export const documentRevokedData = documentRevokedDataSchema
  .pick({ ...KEPT, reasonCategory: true, statusChangedAt: true })
  .extend(shown);

/** A document event's data as the projection takes it. */
export type ProjectedEvent = z.infer<typeof documentEventData> & {
  supersededByVerificationId?: string;
  reasonCategory?: z.infer<typeof documentRevokedData>['reasonCategory'];
  statusChangedAt?: string;
};

/**
 * Writes issuance events into `verification_projection`, once per event (inbox), keeping only
 * what the disclosure level lets the page show (ADR-010 §2): the row is the public answer, so
 * reads mask nothing. Each event carries the whole record, so they apply in any order: a row only
 * moves forward in the documents service's time (its status change time), and never back to
 * valid on a tie.
 */
@Injectable()
export class VerificationProjection {
  constructor(@Inject(DATABASE) private readonly db: Database<VerificationSchema>) {}

  async apply(consumer: string, event: Pick<EventEnvelope, 'id'>, data: ProjectedEvent) {
    const disclosed = data.disclosureLevel !== 'confidential';
    const row = {
      verificationId: data.verificationId,
      status: data.status,
      disclosureLevel: data.disclosureLevel,
      publicPayload: disclosed ? data.publicPayload : null,
      sha256: disclosed ? data.sha256 : null,
      issuedAt: new Date(data.issuedAt),
      supersededBy:
        disclosed && data.status === 'superseded'
          ? (data.supersededByVerificationId ?? null)
          : null,
      revokedReason: disclosed && data.status === 'revoked' ? (data.reasonCategory ?? null) : null,
      updatedAt: new Date(data.statusChangedAt ?? data.issuedAt),
    };
    const t = verificationProjection;
    return consumeOnce(this.db, consumer, event, async (tx) => {
      await tx
        .insert(t)
        .values(row)
        .onConflictDoUpdate({
          target: t.verificationId,
          set: {
            status: sql`excluded.status`,
            disclosureLevel: sql`excluded.disclosure_level`,
            publicPayload: sql`excluded.public_payload`,
            sha256: sql`excluded.sha256`,
            issuedAt: sql`excluded.issued_at`,
            supersededBy: sql`excluded.superseded_by`,
            revokedReason: sql`excluded.revoked_reason`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`excluded.updated_at > ${t.updatedAt} or (excluded.updated_at = ${t.updatedAt} and excluded.status <> 'valid')`,
        });
    });
  }
}
