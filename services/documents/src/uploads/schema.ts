import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { DetectedType, UploadPurpose } from './purposes.js';

export const UPLOAD_STATES = [
  'awaiting-upload',
  'clean',
  'infected',
  'rejected',
  'expired',
] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

export const UPLOAD_REJECTIONS = ['type', 'encoding', 'size', 'missing', 'timeout'] as const;
export type UploadRejection = (typeof UPLOAD_REJECTIONS)[number];

/**
 * Presigned uploads, tenant-scoped under RLS (FORCE ROW LEVEL SECURITY, policy in migration
 * 0002). Object keys are opaque (`<purpose>/<uuidv7>`); the file name is display data kept only
 * here, never in object keys or metadata (ADR-002).
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text().notNull(),
    purpose: text().$type<UploadPurpose>().notNull(),
    state: text({ enum: UPLOAD_STATES }).notNull().default('awaiting-upload'),
    rejection: text({ enum: UPLOAD_REJECTIONS }),
    /** Signature name clamd reported, for infected uploads. */
    threat: text(),
    declaredContentType: text().notNull(),
    detectedType: text().$type<DetectedType>(),
    declaredSize: bigint({ mode: 'number' }).notNull(),
    size: bigint({ mode: 'number' }),
    /** Hex SHA-256 of the scanned bytes, set when clean. */
    sha256: text(),
    fileName: text(),
    quarantineKey: text().notNull().unique(),
    cleanKey: text(),
    /** `sub` of the caller who reserved the upload. */
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** End of the presigned PUT's validity. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Set while a completion runs, so a concurrent one (or the expiry sweep) keeps off. */
    completionStartedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    /**
     * When the owning service first linked the clean upload to its record (a declaration
     * attachment); unlinked clean uploads are orphans.
     */
    linkedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('uploads_awaiting_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} = 'awaiting-upload'`),
    check(
      'uploads_state_check',
      sql`${table.state} in ('awaiting-upload', 'clean', 'infected', 'rejected', 'expired')`,
    ),
    check(
      'uploads_rejection_check',
      sql`(${table.state} = 'rejected') = (${table.rejection} is not null) and (${table.rejection} is null or ${table.rejection} in ('type', 'encoding', 'size', 'missing', 'timeout'))`,
    ),
    check(
      'uploads_clean_check',
      sql`(${table.state} = 'clean') = (${table.sha256} is not null and ${table.cleanKey} is not null and ${table.size} is not null and ${table.detectedType} is not null)`,
    ),
    check(
      'uploads_completed_at_check',
      sql`(${table.state} in ('clean', 'infected', 'rejected')) = (${table.completedAt} is not null)`,
    ),
    check('uploads_linked_at_check', sql`${table.linkedAt} is null or ${table.state} = 'clean'`),
    check('uploads_declared_size_check', sql`${table.declaredSize} > 0`),
  ],
);

export const uploadsSchema = { uploads };
