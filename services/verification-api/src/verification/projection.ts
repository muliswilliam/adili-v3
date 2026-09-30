import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '@adili/data-access';
import { consumeOnce, type EventEnvelope } from '@adili/events';
import {
  DISCLOSURE_LEVELS,
  DOCUMENT_STATUSES,
  REVOCATION_REASONS,
  VERIFICATION_ID_PATTERN,
} from '@adili/events/contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { VerificationSchema } from '../db/schema.js';
import { verificationProjection } from './schema.js';

const verificationId = z.string().regex(VERIFICATION_ID_PATTERN);
const timestamp = z.iso.datetime({ offset: true });

/** Only these fields of the public payload reach the projection, whatever else an event holds. */
const publicPayload = z.object({
  type: z.string().min(1),
  issuerName: z.string().min(1),
  issuerCode: z.string().min(1),
  issuedAt: timestamp,
  reference: z.string().nullable(),
  version: z.int().positive().nullable(),
});

/** The fields of `DocumentEventData` the projection keeps; the rest are never read. */
const documentEventData = z.object({
  verificationId,
  disclosureLevel: z.enum(DISCLOSURE_LEVELS),
  publicPayload: publicPayload.nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: timestamp,
  status: z.enum(DOCUMENT_STATUSES),
});

export const documentIssuedData = documentEventData;
export const documentSupersededData = documentEventData.extend({
  supersededByVerificationId: verificationId,
  statusChangedAt: timestamp,
});
export const documentRevokedData = documentEventData.extend({
  reasonCategory: z.enum(REVOCATION_REASONS),
  statusChangedAt: timestamp,
});

/** A document event's data as the projection takes it. */
export type ProjectedEvent = z.infer<typeof documentEventData> & {
  supersededByVerificationId?: string;
  reasonCategory?: z.infer<typeof documentRevokedData>['reasonCategory'];
  statusChangedAt?: string;
};

/**
 * Writes issuance events into `verification_projection`, once per event (inbox). Each event
 * carries the whole record, so they apply in any order: a row only moves forward in the
 * documents service's time (its status change time), and never back to valid on a tie.
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
      sha256: data.sha256,
      issuedAt: new Date(data.issuedAt),
      supersededBy:
        disclosed && data.status === 'superseded'
          ? (data.supersededByVerificationId ?? null)
          : null,
      revokedReason: data.status === 'revoked' ? (data.reasonCategory ?? null) : null,
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
