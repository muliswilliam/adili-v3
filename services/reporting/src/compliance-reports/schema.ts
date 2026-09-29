import type { FieldEnvelope } from '@adili/data-access';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Compliance reports (Form M, spec 09): one per Commission per financial year. The `form-m.v1`
 * document, with the officers' names the compile pulled by id, is kept only as an encrypted
 * snapshot under the Commission's key; the clear columns are identifiers, counts, statuses and
 * dates. Row-level security: tenant data (`app.tenant`, or `platform`).
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * reporting.yaml `ReportStatus` as stored: `compiling` until the first compile saves a draft
 * (and again while a recompile runs), `draft`, `reviewed`, `submitted`. `not-started` is a
 * period without a row.
 */
export const REPORT_STATUSES = ['compiling', 'draft', 'reviewed', 'submitted'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** reporting.yaml `ReportSource`. */
export type ReportSource = 'hosted' | 'federated';

/** Headline counts per Form M section, kept in clear for lists and the EACC intake. */
export interface ReportCounts extends Record<string, unknown> {
  initial: SectionCounts;
  biennial: SectionCounts & { noCycleInPeriod: boolean };
  final: SectionCounts;
  clarifications: number;
  accessRequests: { received: number; granted: number; declined: number };
}

export interface SectionCounts {
  expected: number;
  declared: number;
  notDeclared: number;
}

export const complianceReports = pgTable(
  'compliance_reports',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    /** Financial year start year: 2027 is 1 July 2027 to 30 June 2028. */
    fy: integer().notNull(),
    status: text().$type<ReportStatus>().notNull(),
    source: text().$type<ReportSource>().notNull().default('hosted'),
    /** `RPT-<ISSUER>-<FY>-<seq>-<check>`, allocated at confirmation. */
    reference: text(),
    /** When the latest compile was asked for; the draft is current once `compiledAt` passes it. */
    compileRequestedAt: timestamp({ withTimezone: true }),
    compiledAt: timestamp({ withTimezone: true }),
    reviewedBy: text(),
    reviewedByName: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    confirmedBy: text(),
    confirmedByName: text(),
    confirmedAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }),
    late: boolean(),
    /** Base64 AES-256-GCM ciphertext of the `form-m.v1` document; null until first compiled. */
    snapshotCiphertext: text(),
    envelope: jsonb().$type<FieldEnvelope>(),
    canonicalSha256: text(),
    counts: jsonb().$type<ReportCounts>(),
    formMDocumentId: uuid(),
    receiptDocumentId: uuid(),
    ...timestamps,
  },
  (table) => [uniqueIndex('compliance_reports_tenant_fy_key').on(table.tenant, table.fy)],
);

/**
 * Remarks a supervisor wrote on a non-filer row, by obligation. A recompile keeps them; a row
 * without one gets the latest action step's label.
 */
export const reportRemarks = pgTable(
  'report_remarks',
  {
    reportId: uuid()
      .notNull()
      .references(() => complianceReports.id, { onDelete: 'cascade' }),
    tenant: text().notNull(),
    obligationId: uuid().notNull(),
    remark: text().notNull(),
    updatedBy: text().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.reportId, table.obligationId] })],
);

export const complianceReportsSchema = { complianceReports, reportRemarks };
